import { claimSeat, releaseSeat, seatLockKey } from "./seat-lock.js";
import express from "express";
import cors from "cors";
import dotenv from "dotenv";
import crypto from "crypto";
import fs from "fs";
import path from "path";
import multer from "multer";
import OpenAI from "openai";
import { Telegraf } from "telegraf";
import { Redis } from "@upstash/redis";
import { put, get } from "@vercel/blob";
import { Readable } from "node:stream";

dotenv.config();

const app = express();

app.use(cors());
app.use(express.json({ limit: "10mb" }));
app.use(express.urlencoded({ extended: true }));

const PORT = process.env.PORT || 3000;


const DATA_DIR = process.env.VERCEL === "1"
  ? path.join("/tmp", "festo-vizaran-data")
  : path.join(process.cwd(), "server", "data");

const UPLOAD_DIR = path.join(DATA_DIR, "uploads");

fs.mkdirSync(DATA_DIR, { recursive: true });
fs.mkdirSync(UPLOAD_DIR, { recursive: true });

const USERS_FILE = path.join(DATA_DIR, "users.json");
const ORDERS_FILE = path.join(DATA_DIR, "orders.json");

const redis = process.env.UPSTASH_REDIS_REST_URL &&
              process.env.UPSTASH_REDIS_REST_TOKEN
  ? new Redis({
      url: process.env.UPSTASH_REDIS_REST_URL,
      token: process.env.UPSTASH_REDIS_REST_TOKEN
    })
  : null;

if (!redis) {
  console.warn("Upstash Redis is not configured; persistent storage is unavailable.");
}

async function readJson(file) {
  if (!redis) {
    throw new Error("Upstash Redis is not configured");
  }

  const key = `vizaran:${path.basename(file, ".json")}`;
  const stored = await redis.get(key);

  if (stored !== null && stored !== undefined) {
    return stored;
  }

  // One-time import from an existing local data file, if present.
  let initial = [];
  try {
    initial = JSON.parse(fs.readFileSync(file, "utf8"));
    if (!Array.isArray(initial)) initial = [];
  } catch {
    initial = [];
  }

  await redis.set(key, initial);
  return initial;
}

async function writeJson(file, data) {
  if (!redis) {
    throw new Error("Upstash Redis is not configured");
  }

  const key = `vizaran:${path.basename(file, ".json")}`;
  await redis.set(key, data);
}

const bot = process.env.BOT_TOKEN
  ? new Telegraf(process.env.BOT_TOKEN)
  : null;

const openai = process.env.OPENAI_API_KEY
  ? new OpenAI({
      apiKey: process.env.OPENAI_API_KEY
    })
  : null;

/* =========================
   TELEGRAM INIT DATA
========================= */

function validateTelegramInitData(initData) {
  if (!initData || !process.env.BOT_TOKEN) return null;

  try {
    const params = new URLSearchParams(initData);
    const hash = params.get("hash");
    const authDateRaw = params.get("auth_date");

    if (!hash || !authDateRaw || !/^[0-9]+$/.test(authDateRaw)) {
      return null;
    }

    const authDate = Number(authDateRaw);
    const now = Math.floor(Date.now() / 1000);
    const MAX_AGE_SECONDS = 24 * 60 * 60;

    if (
      !Number.isSafeInteger(authDate) ||
      authDate > now + 60 ||
      now - authDate > MAX_AGE_SECONDS
    ) {
      console.warn("Telegram initData expired or invalid auth_date");
      return null;
    }

    params.delete("hash");

    const dataCheckString = Array.from(params.entries())
      .sort(([a], [b]) => a.localeCompare(b))
      .map(([key, value]) => `${key}=${value}`)
      .join("\n");

    const secretKey = crypto
      .createHmac("sha256", "WebAppData")
      .update(process.env.BOT_TOKEN)
      .digest();

    const calculatedHash = crypto
      .createHmac("sha256", secretKey)
      .update(dataCheckString)
      .digest("hex");

    if (
      !/^[a-f0-9]{64}$/i.test(hash) ||
      !crypto.timingSafeEqual(
        Buffer.from(calculatedHash, "hex"),
        Buffer.from(hash, "hex")
      )
    ) {
      console.error("Telegram initData hash mismatch");
      return null;
    }

    const userString = params.get("user");
    if (!userString) return null;

    const user = JSON.parse(userString);
    if (!user || !Number.isSafeInteger(user.id) || user.id <= 0) {
      return null;
    }

    return user;
  } catch (error) {
    console.error("Telegram initData validation error:", error.message);
    return null;
  }
}

async function requireAdmin(req) {
  const initData =
    req.get("x-telegram-init-data") ||
    req.body?.initData;

  const telegramUser = validateTelegramInitData(initData);
  const adminId = process.env.ADMIN_TELEGRAM_ID;

  if (
    !telegramUser ||
    !adminId ||
    String(telegramUser.id) !== String(adminId)
  ) {
    return null;
  }

  return telegramUser;
}

/* =========================
   AUTH
========================= */

app.post("/api/auth", async (req, res) => {
  const { initData } = req.body;

  const telegramUser = validateTelegramInitData(initData);

  if (!telegramUser) {
    return res.status(401).json({
      success: false,
      error: "Telegram authentication failed"
    });
  }

  const users = await readJson(USERS_FILE);

  let user = users.find(
    (item) => item.telegramId === telegramUser.id
  );

  if (!user) {
    user = {
      id: crypto.randomUUID(),
      telegramId: telegramUser.id,
      username: telegramUser.username || "",
      firstName: telegramUser.first_name || "",
      lastName: telegramUser.last_name || "",
      photoUrl: telegramUser.photo_url || "",
      phone: "",
      passport: null,
      createdAt: new Date().toISOString()
    };

    users.push(user);
  } else {
    user.username = telegramUser.username || user.username;
    user.firstName = telegramUser.first_name || user.firstName;
    user.lastName = telegramUser.last_name || user.lastName;
    user.photoUrl = telegramUser.photo_url || user.photoUrl || "";
  }

  await writeJson(USERS_FILE, users);

  res.json({
    success: true,
    user: {
      telegramId: user.telegramId,
      username: user.username || "",
      firstName: user.firstName || "",
      lastName: user.lastName || "",
      photoUrl: user.photoUrl || ""
    }
  });
});

/* =========================
   SAVE PHONE
========================= */

app.post("/api/profile/phone", async (req, res) => {
  try {
    const telegramUser = validateTelegramInitData(
      req.get("x-telegram-init-data") || req.body?.initData
    );

    if (!telegramUser) {
      return res.status(401).json({
        success: false,
        error: "Необходимо подтвердить авторизацию Telegram"
      });
    }

    const { phone } = req.body;
    if (typeof phone !== "string" || !phone.trim() || phone.length > 40) {
      return res.status(400).json({
        success: false,
        error: "Укажите корректный номер телефона"
      });
    }

    const users = await readJson(USERS_FILE);
    const user = users.find(
      (item) => String(item.telegramId) === String(telegramUser.id)
    );

    if (!user) {
      return res.status(404).json({ success: false });
    }

    user.phone = phone.trim();
    await writeJson(USERS_FILE, users);

    return res.json({ success: true });
  } catch (error) {
    console.error("SAVE PHONE ERROR:", error);
    return res.status(500).json({
      success: false,
      error: "Не удалось сохранить телефон"
    });
  }
});

/* =========================
   SAVE PASSPORT
========================= */

async function verifyTurnstileToken(token, remoteIp) {
  const secret = process.env.TURNSTILE_SECRET;
  if (!secret || !token || typeof token !== "string") return false;

  const form = new URLSearchParams({
    secret,
    response: token
  });
  if (remoteIp) form.set("remoteip", remoteIp);

  const response = await fetch(
    "https://challenges.cloudflare.com/turnstile/v0/siteverify",
    {
      method: "POST",
      headers: { "Content-Type": "application/x-www-form-urlencoded" },
      body: form
    }
  );
  if (!response.ok) return false;
  const result = await response.json();
  return result.success === true;
}

app.post("/api/profile/passport", async (req, res) => {
  try {
    const telegramUser = validateTelegramInitData(
      req.get("x-telegram-init-data") || req.body?.initData
    );

    if (!telegramUser) {
      return res.status(401).json({
        success: false,
        error: "Необходимо подтвердить авторизацию Telegram"
      });
    }

    const { passengers, consent, turnstileToken } = req.body;

    let captchaValid = false;
    try {
      captchaValid = await verifyTurnstileToken(turnstileToken, req.ip);
    } catch (error) {
      console.error("TURNSTILE VERIFY ERROR:", error.message);
    }

    if (!captchaValid) {
      return res.status(403).json({
        success: false,
        error: "Проверка Cloudflare не пройдена. Обновите капчу и попробуйте снова."
      });
    }

    if (consent !== true) {
      return res.status(400).json({
        success: false,
        error: "Необходимо согласие на обработку персональных данных"
      });
    }

    const normalizedPassengers = Array.isArray(passengers)
      ? passengers
          .filter((passenger) =>
            passenger &&
            typeof passenger.fullName === "string" &&
            passenger.fullName.trim() &&
            typeof passenger.birthDate === "string" &&
            passenger.birthDate.trim() &&
            typeof passenger.passportNumber === "string" &&
            passenger.passportNumber.trim()
          )
          .map((passenger) => ({
            fullName: passenger.fullName.trim(),
            birthDate: passenger.birthDate.trim(),
            passportNumber: passenger.passportNumber.trim()
          }))
      : [];

    if (normalizedPassengers.length === 0) {
      return res.status(400).json({
        success: false,
        error: "Необходимо указать данные пассажира"
      });
    }

    const users = await readJson(USERS_FILE);
    const user = users.find(
      (item) => String(item.telegramId) === String(telegramUser.id)
    );

    if (!user) {
      return res.status(404).json({ success: false });
    }

    user.passengers = normalizedPassengers;
    user.passport = {
      ...normalizedPassengers[0],
      consent: true,
      consentAt: new Date().toISOString()
    };

    await writeJson(USERS_FILE, users);

    return res.json({ success: true });
  } catch (error) {
    console.error("SAVE PASSPORT ERROR:", error);
    return res.status(500).json({
      success: false,
      error: "Не удалось сохранить паспортные данные"
    });
  }
});

/* =========================
   GET PROFILE
========================= */

app.get("/api/profile/:telegramId", async (req, res) => {
  try {
    const initData = req.get("x-telegram-init-data");
    const telegramUser = validateTelegramInitData(initData);

    if (!telegramUser) {
      return res.status(401).json({
        success: false,
        error: "Необходимо подтвердить авторизацию Telegram"
      });
    }

    if (String(telegramUser.id) !== String(req.params.telegramId)) {
      return res.status(403).json({
        success: false,
        error: "Нет доступа к профилю другого пользователя"
      });
    }

    const users = await readJson(USERS_FILE);
    const user = users.find(
      (item) => String(item.telegramId) === String(telegramUser.id)
    );

    if (!user) {
      return res.status(404).json({ success: false });
    }

    return res.json({ success: true, user });
  } catch (error) {
    console.error("GET PROFILE ERROR:", error);
    return res.status(500).json({
      success: false,
      error: "Не удалось загрузить профиль"
    });
  }
});

/* =========================
   CREATE ORDER
========================= */

app.post("/api/orders/draft", async (req, res) => {
  try {
    const telegramUser = validateTelegramInitData(
      req.get("x-telegram-init-data") || req.body?.initData
    );

    if (!telegramUser) {
      return res.status(401).json({
        success: false,
        error: "Требуется подтверждение Telegram"
      });
    }

    const { route, service, permissionType, priceRub, priceVnd } = req.body;
    const telegramId = String(telegramUser.id);

    if (req.body?.telegramId && String(req.body.telegramId) !== telegramId) {
      return res.status(403).json({
        success: false,
        error: "Telegram ID не совпадает с авторизованным пользователем"
      });
    }

    if (!route || !service) {
      return res.status(400).json({
        success: false,
        error: "Не хватает данных для черновика"
      });
    }

    const settings = await readServiceSettings();
    const serviceType = permissionType === "VISA" ? "VISA" : "STAMP";
    const expectedService = serviceType === "VISA"
      ? "Виза + штамп на 90 дней"
      : "Штамп на 45 дней";

    if (!settings[serviceType]) {
      return res.status(409).json({
        success: false,
        error: "Эта услуга временно недоступна. Выберите другую услугу."
      });
    }
    if (service !== expectedService) {
      return res.status(400).json({
        success: false,
        error: "Некорректный тип услуги"
      });
    }

    const users = await readJson(USERS_FILE);
    const orders = await readJson(ORDERS_FILE);
    const user = users.find(
      (item) => String(item.telegramId) === String(telegramId)
    );

    if (!user) {
      return res.status(404).json({
        success: false,
        error: "Пользователь не найден"
      });
    }

    const existing = orders.find((item) =>
      String(item.telegramId) === String(telegramId) &&
      item.route === route &&
      item.service === service &&
      ["draft", "in_progress", "awaiting_payment"].includes(item.status) &&
      !item.cancelledAt &&
      (item.status !== "awaiting_payment" ||
        !item.paymentDeadline ||
        item.paymentDeadline > Date.now())
    );

    if (existing) {
      return res.json({ success: true, order: existing });
    }

    const now = Date.now();
    const order = {
      id: `FESTO-${now}-${crypto.randomBytes(3).toString("hex")}`,
      telegramId,
      username: user.username,
      firstName: user.firstName,
      phone: user.phone,
      route,
      service,
      permissionType: permissionType || null,
      priceRub: priceRub ?? null,
      priceVnd: priceVnd ?? null,
      status: "draft",
      currentStep: "permission",
      draftExpiresAt: now + 24 * 60 * 60 * 1000,
      lastReminderAt: null,
      createdAt: new Date(now).toISOString(),
      updatedAt: new Date(now).toISOString()
    };

    orders.push(order);
    await writeJson(ORDERS_FILE, orders);
    await notifyAdmin(order, "draft_created");

    return res.json({ success: true, order });
  } catch (error) {
    console.error("CREATE DRAFT ERROR:", error);
    return res.status(500).json({
      success: false,
      error: "Не удалось создать черновик"
    });
  }
});

app.patch("/api/orders/:id", async (req, res) => {
  try {
    const telegramUser = validateTelegramInitData(
      req.get("x-telegram-init-data") || req.body?.initData
    );

    if (!telegramUser) {
      return res.status(401).json({
        success: false,
        error: "Требуется подтверждение Telegram"
      });
    }

    const orders = await readJson(ORDERS_FILE);
    const order = orders.find((item) => item.id === req.params.id);

    if (!order) {
      return res.status(404).json({
        success: false,
        error: "Заказ не найден"
      });
    }

    if (String(order.telegramId) !== String(telegramUser.id)) {
      return res.status(403).json({
        success: false,
        error: "Нет доступа к заказу"
      });
    }

    if (["payment_check", "confirmed", "cancelled", "canceled"].includes(order.status)) {
      return res.status(409).json({
        success: false,
        error: "Этот заказ больше нельзя редактировать"
      });
    }

    const proposedRoute = Object.prototype.hasOwnProperty.call(req.body, "route")
      ? req.body.route : order.route;
    const proposedDate = Object.prototype.hasOwnProperty.call(req.body, "travelDate")
      ? req.body.travelDate : order.travelDate;
    const proposedSeat = Object.prototype.hasOwnProperty.call(req.body, "seat")
      ? req.body.seat : order.seat;

    if (proposedSeat && proposedRoute && proposedDate) {
      const checked = await validateSeatBooking({
        route: proposedRoute,
        date: proposedDate,
        seat: proposedSeat,
        orderId: order.id
      });
      if (!checked.ok) {
        return res.status(409).json({ success: false, error: checked.error });
      }
      if (Object.prototype.hasOwnProperty.call(req.body, "seat")) {
        req.body.seat = checked.seat;
      }
      if (Object.prototype.hasOwnProperty.call(req.body, "travelDate")) {
        req.body.travelDate = checked.date;
      }
    }

    const allowed = [
      "route", "service", "permissionType", "vietnamEntryDate",
      "permissionValidUntil", "priceRub", "priceVnd", "travelDate",
      "seat", "options", "medicalWarningAccepted", "passport", "currentStep"
    ];

    const previousOrder = { ...order };

    const previous = {
      route: order.route,
      travelDate: order.travelDate,
      seat: order.seat,
      status: order.status,
      paymentDeadline: order.paymentDeadline,
      lastPaymentReminderAt: order.lastPaymentReminderAt,
      updatedAt: order.updatedAt
    };

    const oldSeat = previous.route && previous.travelDate && previous.seat
      ? {
          route: previous.route,
          date: normalizeTripDate(String(previous.travelDate)),
          seat: String(previous.seat).trim().toUpperCase()
        }
      : null;

    for (const key of allowed) {
      if (Object.prototype.hasOwnProperty.call(req.body, key)) {
        order[key] = req.body[key];
      }
    }

    const now = Date.now();

    if (req.body.startPayment === true) {
      order.status = "awaiting_payment";
      order.paymentDeadline = now + 20 * 60 * 1000;
      order.lastPaymentReminderAt = null;
    } else if (order.status === "draft") {
      order.status = "in_progress";
    }

    order.updatedAt = new Date(now).toISOString();

    const newSeat = order.route && order.travelDate && order.seat
      ? {
          route: order.route,
          date: normalizeTripDate(String(order.travelDate)),
          seat: String(order.seat).trim().toUpperCase()
        }
      : null;

    const seatChanged = newSeat && (
      !oldSeat ||
      oldSeat.route !== newSeat.route ||
      oldSeat.date !== newSeat.date ||
      oldSeat.seat !== newSeat.seat
    );

    let claimedNewSeat = false;
    const needsReservation = newSeat && (
      req.body.startPayment === true ||
      previous.status === "awaiting_payment"
    );

    if (needsReservation && seatChanged) {
      const claimed = await claimSeat(
        redis, newSeat.route, newSeat.date, newSeat.seat,
        order.id,
        order.status === "awaiting_payment"
          ? Math.max(1, Number(order.paymentDeadline || 0) - now)
          : 0
      );

      if (!claimed) {
        Object.assign(order, previousOrder);
        return res.status(409).json({
          success: false,
          error: "Это место уже занято. Выберите другое."
        });
      }
      claimedNewSeat = true;
    } else if (needsReservation && newSeat && !seatChanged) {
      const claimed = await claimSeat(
        redis, newSeat.route, newSeat.date, newSeat.seat,
        order.id,
        order.status === "awaiting_payment"
          ? Math.max(1, Number(order.paymentDeadline || 0) - now)
          : 0
      );

      if (!claimed) {
        Object.assign(order, previousOrder);
        return res.status(409).json({
          success: false,
          error: "Не удалось подтвердить резервирование места."
        });
      }
    }

    try {
      await writeJson(ORDERS_FILE, orders);
    } catch (saveError) {
      Object.assign(order, previousOrder);
      if (claimedNewSeat) {
        await releaseSeat(
          redis, newSeat.route, newSeat.date, newSeat.seat, order.id
        ).catch(() => {});
      }
      throw saveError;
    }

    const oldSeatWasRemoved = oldSeat && !newSeat;
    if (oldSeat && (claimedNewSeat || oldSeatWasRemoved)) {
      await releaseSeat(
        redis, oldSeat.route, oldSeat.date, oldSeat.seat, order.id
      ).catch(error => {
        console.error("OLD SEAT RELEASE ERROR:", error);
      });
    }

    return res.json({ success: true, order });
  } catch (error) {
    console.error("UPDATE ORDER ERROR:", error);
    return res.status(500).json({
      success: false,
      error: "Не удалось обновить заказ"
    });
  }
});

app.post("/api/orders", async (req, res) => {
  try {
    const { telegramId, draftOrderId, permissionType } = req.body;

    if (!telegramId || !draftOrderId) {
      return res.status(400).json({
        success: false,
        error: "Не передан ID черновика"
      });
    }

    const orders = await readJson(ORDERS_FILE);
    const order = orders.find((item) => item.id === draftOrderId);

    if (!order) {
      return res.status(404).json({
        success: false,
        error: "Черновик не найден. Начните бронирование заново."
      });
    }

    if (String(order.telegramId) !== String(telegramId)) {
      return res.status(403).json({
        success: false,
        error: "Нет доступа к заказу"
      });
    }

    if (!["draft", "in_progress"].includes(order.status)) {
      return res.status(409).json({
        success: false,
        error: "Этот черновик уже нельзя отправить на оплату"
      });
    }

    if (order.draftExpiresAt && order.draftExpiresAt <= Date.now()) {
      return res.status(409).json({
        success: false,
        error: "Срок черновика истёк. Начните бронирование заново."
      });
    }

    const checkedSeat = await validateSeatBooking({
      route: order.route,
      date: req.body.travelDate || order.travelDate,
      seat: req.body.seat || order.seat,
      orderId: order.id
    });
    if (!checkedSeat.ok) {
      return res.status(409).json({ success: false, error: checkedSeat.error });
    }

    const users = await readJson(USERS_FILE);
    const user = users.find(
      (item) => String(item.telegramId) === String(telegramId)
    );

    if (!user || !user.passport) {
      return res.status(400).json({
        success: false,
        error: "Паспортные данные не заполнены"
      });
    }

    // SEAT_LOCK_INTEGRATION_V1
    const paymentDeadline = Date.now() + 20 * 60 * 1000;
    const claimed = await claimSeat(
      redis, order.route, checkedSeat.date, checkedSeat.seat,
      order.id, paymentDeadline - Date.now()
    );
    if (!claimed) {
      return res.status(409).json({
        success: false,
        error: "Это место уже забронировал другой клиент. Выберите другое."
      });
    }

    Object.assign(order, {
      permissionType: permissionType || order.permissionType || null,
      vietnamEntryDate: req.body.vietnamEntryDate || null,
      permissionValidUntil: req.body.permissionValidUntil || null,
      travelDate: checkedSeat.date,
      priceRub: req.body.priceRub ?? order.priceRub,
      priceVnd: req.body.priceVnd ?? order.priceVnd,
      seat: checkedSeat.seat,
      options: req.body.options || {},
      medicalWarningAccepted: req.body.medicalWarningAccepted === true,
      passport: user.passport,
      status: "awaiting_payment",
      paymentDeadline,
      lastPaymentReminderAt: null,
      updatedAt: new Date().toISOString()
    });

    try {
      await writeJson(ORDERS_FILE, orders);
    } catch (saveError) {
      await releaseSeat(
        redis, order.route, order.travelDate, order.seat, order.id
      ).catch(() => {});
      throw saveError;
    }
    await notifyAdmin(order, "awaiting_payment");

    return res.json({ success: true, order });
  } catch (error) {
    console.error("CREATE PAYMENT ORDER ERROR:", error);
    return res.status(500).json({
      success: false,
      error: "Не удалось подготовить оплату"
    });
  }
});

/* =========================
   UPLOAD RECEIPT
========================= */

const upload = multer({
  dest: UPLOAD_DIR,
  limits: {
    fileSize: 10 * 1024 * 1024
  }
});

app.post(
  "/api/orders/:id/receipt",
  upload.single("receipt"),
  async (req, res) => {
    let tempPath = req.file?.path;

    try {
      if (!process.env.BLOB_READ_WRITE_TOKEN) {
        return res.status(503).json({
          success: false,
          error: "Хранилище чеков не настроено"
        });
      }

      const telegramId = req.body.telegramId;

      if (!telegramId) {
        return res.status(401).json({
          success: false,
          error: "Не удалось подтвердить владельца заказа"
        });
      }

      const orders = await readJson(ORDERS_FILE);
      const order = orders.find(item => item.id === req.params.id);

      if (!order) {
        return res.status(404).json({ success: false });
      }

      if (String(order.telegramId) !== String(telegramId)) {
        return res.status(403).json({
          success: false,
          error: "Нет доступа к заказу"
        });
      }

      if (!req.file) {
        return res.status(400).json({
          success: false,
          error: "Файл подтверждения не загружен"
        });
      }

      const allowedTypes = [
        "image/jpeg",
        "image/png",
        "image/webp",
        "application/pdf"
      ];

      if (!allowedTypes.includes(req.file.mimetype)) {
        return res.status(415).json({
          success: false,
          error: "Загрузите чек в формате JPG, PNG, WEBP или PDF"
        });
      }

      const buffer = await fs.promises.readFile(req.file.path);
      const extByType = {
        "image/jpeg": "jpg",
        "image/png": "png",
        "image/webp": "webp",
        "application/pdf": "pdf"
      };
      const pathname =
        `receipts/${String(order.id).replace(/[^a-zA-Z0-9_-]/g, "_")}-` +
        `${Date.now()}.${extByType[req.file.mimetype]}`;

      const blob = await put(pathname, buffer, {
        access: "private",
        addRandomSuffix: true,
        contentType: req.file.mimetype,
        token: process.env.BLOB_READ_WRITE_TOKEN
      });

      order.receipt = {
        pathname: blob.pathname,
        originalName: req.file.originalname,
        mimetype: req.file.mimetype,
        size: req.file.size,
        uploadedAt: new Date().toISOString()
      };

      // Keep this order's seat reserved while the receipt is reviewed.
      const claimed = await claimSeat(
        redis, order.route, order.travelDate, order.seat, order.id, 0
      );
      if (!claimed) {
        return res.status(409).json({
          success: false,
          error: "Не удалось закрепить место. Свяжитесь с поддержкой."
        });
      }

      const previousStatus = order.status;
      const previousUpdatedAt = order.updatedAt;
      order.status = "payment_check";
      order.updatedAt = new Date().toISOString();

      try {
        await writeJson(ORDERS_FILE, orders);
      } catch (saveError) {
        order.status = previousStatus;
        order.updatedAt = previousUpdatedAt;

        const remainingTtl = Math.max(
          1,
          Number(order.paymentDeadline || 0) - Date.now()
        );

        await claimSeat(
          redis,
          order.route,
          normalizeTripDate(String(order.travelDate || "")),
          String(order.seat || "").trim().toUpperCase(),
          order.id,
          remainingTtl
        ).catch(rollbackError => {
          console.error("RECEIPT SEAT ROLLBACK ERROR:", rollbackError);
        });

        throw saveError;
      }
      await notifyAdmin(order, "payment_check");
      await notifyClient(
        order,
        `🧾 Чек получен и передан на проверку.\n\n` +
        `Заказ: ${order.id}\n` +
        `Маршрут: ${order.route || "—"}\n\n` +
        "Мы сообщим результат проверки здесь."
      );

      return res.json({
        success: true,
        message: "Подтверждение оплаты отправлено на проверку"
      });
    } catch (error) {
      console.error("UPLOAD RECEIPT ERROR:", error);
      return res.status(500).json({
        success: false,
        error: "Не удалось сохранить чек. Попробуйте ещё раз."
      });
    } finally {
      if (tempPath) {
        await fs.promises.unlink(tempPath).catch(() => {});
      }
    }
  }
);

/* =========================
   AI RECEIPT CHECK
========================= */

async function checkReceiptWithAI(order, filePath) {
  if (!openai) {
    return {
      verified: false,
      confidence: 0,
      reason: "OPENAI_API_KEY не настроен"
    };
  }

  try {
    const fileBuffer = fs.readFileSync(filePath);

    const base64 = fileBuffer.toString("base64");

    const response = await openai.responses.create({
      model: "gpt-5.6",
      input: [
        {
          role: "user",
          content: [
            {
              type: "input_text",
              text: `
Проверь изображение банковского чека.

Заказ:
${order.id}

Ожидаемая сумма:
${order.priceRub} RUB

Получатель:
${process.env.PAYMENT_NAME}

Банк:
${process.env.PAYMENT_BANK}

Номер:
${process.env.PAYMENT_PHONE}

Нужно определить:
1. Есть ли признаки успешного перевода.
2. Совпадает ли сумма.
3. Совпадает ли получатель.
4. Нет ли явных признаков редактирования.
5. Насколько уверенно можно считать чек достоверным.

Верни JSON:
{
  "verified": true,
  "confidence": 0.95,
  "reason": "..."
}

Важно: изображение чека само по себе не доказывает фактическое банковское зачисление.
Если есть сомнения — verified false.
`
            },
            {
              type: "input_image",
              image_url: `data:${order.receipt.mimetype};base64,${base64}`
            }
          ]
        }
      ]
    });

    const text =
      response.output_text ||
      "";

    try {
      return JSON.parse(text);
    } catch {
      return {
        verified: false,
        confidence: 0,
        reason: "AI returned invalid JSON"
      };
    }
  } catch (error) {
    return {
      verified: false,
      confidence: 0,
      reason: error.message
    };
  }
}

/* =========================
   ADMIN NOTIFICATION
========================= */

async function notifyAdmin(order, event = "payment_check") {
  if (!bot || !process.env.ADMIN_CHAT_ID) {
    console.warn("Admin Telegram notification skipped: bot or ADMIN_CHAT_ID missing");
    return false;
  }

  const labels = {
    draft_created: "🆕 СОЗДАН ЧЕРНОВИК БРОНИ",
    awaiting_payment: "💳 БРОНЬ ПЕРЕШЛА К ОПЛАТЕ",
    payment_check: "🧾 ПОЛУЧЕН ЧЕК — НУЖНА ПРОВЕРКА",
    confirmed: "✅ БРОНЬ ПОДТВЕРЖДЕНА"
  };

  const username = order.username ? `@${order.username}` : "без username";
  const passport = order.passport || {};
  const priceRub = order.priceRub ?? "—";
  const priceVnd = Number(order.priceVnd);
  const priceVndText = Number.isFinite(priceVnd)
    ? priceVnd.toLocaleString("ru-RU")
    : "—";

  const message = [
    labels[event] || "🔔 ОБНОВЛЕНИЕ БРОНИРОВАНИЯ",
    "",
    `Заказ: ${order.id || "—"}`,
    `👤 Telegram: ${username}`,
    `Имя: ${order.firstName || "—"}`,
    `📞 Телефон: ${order.phone || "—"}`,
    `🚌 Маршрут: ${order.route || "—"}`,
    `🎫 Услуга: ${order.service || "—"}`,
    `💺 Место: ${order.seat || "—"}`,
    `💰 Сумма: ${priceRub} ₽ / ${priceVndText} ₫`,
    `📄 Паспорт: ${passport.fullName || "не заполнен"}`,
    `Дата рождения: ${passport.birthDate || "—"}`,
    `Номер паспорта: ${passport.passportNumber || "—"}`,
    `Статус: ${order.status || "—"}`
  ].join("\n");

  try {
    await bot.telegram.sendMessage(process.env.ADMIN_CHAT_ID, message);
    console.log("Admin Telegram notification sent:", event, order.id);
    return true;
  } catch (error) {
    console.error("Telegram admin notification error:", error.message);
    return false;
  }
}

async function notifyClient(order, message) {
  if (!bot || !order.telegramId) {
    console.warn("Client Telegram notification skipped: bot or telegramId missing");
    return false;
  }

  try {
    await bot.telegram.sendMessage(String(order.telegramId), message);
    console.log("Client Telegram notification sent:", order.id);
    return true;
  } catch (error) {
    console.error("Telegram client notification error:", error.message);
    return false;
  }
}

/* =========================
   CONFIRM PAYMENT
========================= */


/* =========================
   SCHEDULE API
========================= */

const SCHEDULE_KEY = "vizaran:schedule";
const SERVICE_SETTINGS_KEY = "vizaran:service-settings";
const DEFAULT_SERVICE_SETTINGS = { STAMP: true, VISA: true };

async function readServiceSettings() {
  if (!redis) throw new Error("Upstash Redis is not configured");
  const stored = await redis.get(SERVICE_SETTINGS_KEY);
  let data = stored;
  if (typeof data === "string") {
    try { data = JSON.parse(data); } catch { data = null; }
  }
  return {
    STAMP: data?.STAMP !== false,
    VISA: data?.VISA !== false
  };
}

async function writeServiceSettings(settings) {
  if (!redis) throw new Error("Upstash Redis is not configured");
  const normalized = {
    STAMP: settings.STAMP,
    VISA: settings.VISA
  };
  await redis.set(SERVICE_SETTINGS_KEY, normalized);
  return normalized;
}

const VIZARAN_ROUTES = [
  "Нячанг — Лаос",
  "Нячанг — Камбоджа",
  "Дананг — Лаос"
];

async function readSchedule() {
  if (!redis) throw new Error("Upstash Redis is not configured");

  const stored = await redis.get(SCHEDULE_KEY);
  if (!stored) return { months: [], departures: [] };

  let data = stored;
  if (typeof data === "string") {
    try { data = JSON.parse(data); } catch {
      return { months: [], departures: [] };
    }
  }

  return {
    months: Array.isArray(data?.months) ? data.months : [],
    departures: Array.isArray(data?.departures) ? data.departures : []
  };
}

async function writeSchedule(schedule) {
  if (!redis) throw new Error("Upstash Redis is not configured");
  await redis.set(SCHEDULE_KEY, schedule);
}

function normalizeTripDate(value) {
  if (typeof value !== "string") return "";
  const v = value.trim();

  if (/^\d{2}\.\d{2}\.\d{4}$/.test(v)) return v;

  if (/^\d{4}-\d{2}-\d{2}$/.test(v)) {
    const [year, month, day] = v.split("-");
    return `${day}.${month}.${year}`;
  }

  return "";
}

function normalizeMonth(value) {
  if (typeof value !== "string" || !/^\d{4}-\d{2}$/.test(value)) return "";
  const [year, month] = value.split("-").map(Number);
  if (month < 1 || month > 12 || year < 2020 || year > 2100) return "";
  return value;
}

app.get("/api/schedule", async (req, res) => {
  try {
    const route = String(req.query.route || "");
    const month = normalizeMonth(String(req.query.month || ""));

    if (!VIZARAN_ROUTES.includes(route) || !month) {
      return res.status(400).json({
        success: false,
        error: "Не указан корректный маршрут или месяц"
      });
    }

    const schedule = await readSchedule();
    const monthEntry = schedule.months.find(
      item => item.route === route && item.month === month
    );

    const departures = schedule.departures
      .filter(item =>
        item.route === route &&
        normalizeTripDate(item.date)?.split(".").slice(1).join(".") ===
          month.split("-").reverse().join(".") &&
        item.open === true
      )
      .map(item => ({
        date: normalizeTripDate(item.date),
        open: true
      }));

    return res.json({
      success: true,
      route,
      month,
      monthOpen: monthEntry?.open === true,
      departures: monthEntry?.open === true ? departures : []
    });
  } catch (error) {
    console.error("PUBLIC SCHEDULE ERROR:", error);
    return res.status(500).json({
      success: false,
      error: "Не удалось загрузить расписание"
    });
  }
});

async function validateSeatBooking({ route, date, seat, orderId }) {
  const normalizedDate = normalizeTripDate(String(date || ""));
  if (!VIZARAN_ROUTES.includes(String(route || "")) || !normalizedDate || !seat) {
    return { ok: false, error: "Выберите маршрут, дату и место" };
  }

  const schedule = await readSchedule();
  const month = normalizedDate.split(".").reverse().join("-").slice(0, 7);
  const monthEntry = schedule.months.find(
    item => item.route === route && item.month === month
  );
  const departure = schedule.departures.find(
    item => item.route === route &&
      normalizeTripDate(item.date) === normalizedDate &&
      item.open === true
  );

  if (monthEntry?.open !== true || !departure) {
    return { ok: false, error: "Этот рейс закрыт для бронирования" };
  }

  const seatName = String(seat).trim().toUpperCase();
  const validSeats = new Set(
    Array.from({ length: 16 }, (_, i) => [`${i + 1}A`, `${i + 1}B`]).flat()
  );
  if (!validSeats.has(seatName)) {
    return { ok: false, error: "Выбрано некорректное место" };
  }

  if ((departure.disabledSeats || []).map(x => String(x).toUpperCase()).includes(seatName)) {
    return { ok: false, error: "Это место отключено. Выберите другое." };
  }

  const orders = await readJson(ORDERS_FILE);
  const now = Date.now();
  const occupied = orders.some(order =>
    order.id !== orderId &&
    order.route === route &&
    normalizeTripDate(order.travelDate) === normalizedDate &&
    String(order.seat || "").trim().toUpperCase() === seatName &&
    (
      ["payment_check", "confirmed"].includes(order.status) ||
      (order.status === "awaiting_payment" &&
        Number(order.paymentDeadline || 0) > now)
    )
  );

  if (occupied) {
    return { ok: false, error: "Это место уже занято. Выберите другое." };
  }

  return { ok: true, route, date: normalizedDate, seat: seatName };
}

app.get("/api/schedule/seats", async (req, res) => {
  try {
    const route = String(req.query.route || "");
    const date = normalizeTripDate(String(req.query.date || ""));

    if (!VIZARAN_ROUTES.includes(route) || !date) {
      return res.status(400).json({
        success: false,
        error: "Не указан корректный маршрут или дата"
      });
    }

    const [schedule, orders] = await Promise.all([
      readSchedule(),
      readJson(ORDERS_FILE)
    ]);

    const departure = schedule.departures.find(
      item => item.route === route &&
        normalizeTripDate(item.date) === date &&
        item.open === true
    );

    const now = Date.now();
    const bookedSeats = [...new Set(
      orders
        .filter(order =>
          order.route === route &&
          normalizeTripDate(order.travelDate) === date &&
          order.seat &&
          (
            ["payment_check", "confirmed"].includes(order.status) ||
            (order.status === "awaiting_payment" &&
              Number(order.paymentDeadline || 0) > now)
          )
        )
        .map(order => String(order.seat))
    )];

    const allSeats = Array.from(
      { length: 16 },
      (_, i) => [`${i + 1}A`, `${i + 1}B`]
    ).flat();

    const lockValues = redis
      ? await Promise.all(
          allSeats.map(seat =>
            redis.get(seatLockKey(route, date, seat))
          )
        )
      : [];

    const lockedSeats = redis
      ? allSeats.filter((seat, i) =>
          lockValues[i] !== null &&
          lockValues[i] !== undefined &&
          String(lockValues[i]) !== ""
        )
      : [];

    const finalBookedSeats = [...new Set([
      ...bookedSeats.map(seat => String(seat).trim().toUpperCase()),
      ...lockedSeats
    ])];

    return res.json({
      success: true,
      route,
      date,
      available: Boolean(departure),
      bookedSeats: finalBookedSeats,
      disabledSeats: Array.isArray(departure?.disabledSeats)
        ? departure.disabledSeats
        : []
    });
  } catch (error) {
    console.error("PUBLIC SEAT AVAILABILITY ERROR:", error);
    return res.status(500).json({
      success: false,
      error: "Не удалось загрузить занятость мест"
    });
  }
});

app.get("/api/service-settings", async (req, res) => {
  try {
    return res.json({ success: true, settings: await readServiceSettings() });
  } catch (error) {
    console.error("SERVICE SETTINGS READ ERROR:", error);
    return res.status(500).json({
      success: false,
      error: "Не удалось загрузить доступность услуг"
    });
  }
});

app.get("/api/admin/service-settings", async (req, res) => {
  try {
    if (!await requireAdmin(req)) {
      return res.status(403).json({ success: false, error: "Доступ запрещён" });
    }
    return res.json({ success: true, settings: await readServiceSettings() });
  } catch (error) {
    console.error("ADMIN SERVICE SETTINGS READ ERROR:", error);
    return res.status(500).json({
      success: false,
      error: "Не удалось загрузить настройки услуг"
    });
  }
});

app.put("/api/admin/service-settings", async (req, res) => {
  try {
    if (!await requireAdmin(req)) {
      return res.status(403).json({ success: false, error: "Доступ запрещён" });
    }
    const input = req.body?.settings;
    if (!input || typeof input.STAMP !== "boolean" || typeof input.VISA !== "boolean") {
      return res.status(400).json({
        success: false,
        error: "Укажите доступность обеих услуг"
      });
    }
    const settings = await writeServiceSettings(input);
    return res.json({ success: true, settings });
  } catch (error) {
    console.error("ADMIN SERVICE SETTINGS WRITE ERROR:", error);
    return res.status(500).json({
      success: false,
      error: "Не удалось сохранить настройки услуг"
    });
  }
});

app.get("/api/admin/schedule", async (req, res) => {
  try {
    const admin = await requireAdmin(req);
    if (!admin) {
      return res.status(403).json({
        success: false,
        error: "Доступ запрещён"
      });
    }

    return res.json({ success: true, schedule: await readSchedule() });
  } catch (error) {
    console.error("ADMIN SCHEDULE READ ERROR:", error);
    return res.status(500).json({
      success: false,
      error: "Не удалось загрузить расписание"
    });
  }
});

app.put("/api/admin/schedule", async (req, res) => {
  try {
    const admin = await requireAdmin(req);
    if (!admin) {
      return res.status(403).json({
        success: false,
        error: "Доступ запрещён"
      });
    }

    const input = req.body?.schedule;
    if (!input || !Array.isArray(input.months) ||
        !Array.isArray(input.departures)) {
      return res.status(400).json({
        success: false,
        error: "Неверный формат расписания"
      });
    }

    const months = [];
    for (const item of input.months) {
      const month = normalizeMonth(item?.month);
      if (!VIZARAN_ROUTES.includes(item?.route) || !month ||
          typeof item.open !== "boolean") {
        return res.status(400).json({
          success: false,
          error: "Проверьте настройки маршрутов и месяцев"
        });
      }
      months.push({
        route: item.route,
        month,
        open: item.open
      });
    }

    const departures = [];
    for (const item of input.departures) {
      const date = normalizeTripDate(item?.date);
      if (!VIZARAN_ROUTES.includes(item?.route) || !date ||
          typeof item.open !== "boolean") {
        return res.status(400).json({
          success: false,
          error: "Проверьте даты и маршруты рейсов"
        });
      }

      const disabledSeats = Array.isArray(item.disabledSeats)
        ? [...new Set(item.disabledSeats.map(String).filter(seat =>
            /^(?:[1-9]|1[0-6])[AB]$/.test(seat)
          ))]
        : [];

      departures.push({
        route: item.route,
        date,
        open: item.open,
        disabledSeats
      });
    }

    const uniqueMonths = new Set(months.map(x => `${x.route}|${x.month}`));
    const uniqueDepartures = new Set(departures.map(x => `${x.route}|${x.date}`));

    if (uniqueMonths.size !== months.length ||
        uniqueDepartures.size !== departures.length) {
      return res.status(400).json({
        success: false,
        error: "В расписании есть повторяющиеся месяцы или даты"
      });
    }

    const schedule = { months, departures };
    await writeSchedule(schedule);

    return res.json({ success: true, schedule });
  } catch (error) {
    console.error("ADMIN SCHEDULE WRITE ERROR:", error);
    return res.status(500).json({
      success: false,
      error: "Не удалось сохранить расписание"
    });
  }
});

app.get("/api/admin/orders", async (req, res) => {
  try {
    const admin = await requireAdmin(req);

    if (!admin) {
      return res.status(403).json({
        success: false,
        error: "Доступ запрещён"
      });
    }

    const orders = await readJson(ORDERS_FILE);

    return res.json({
      success: true,
      orders: orders
        .filter((order) => [
          "awaiting_payment",
          "payment_check",
          "confirmed",
          "cancelled"
        ].includes(order.status))
        .sort((a, b) =>
          String(b.updatedAt || "").localeCompare(String(a.updatedAt || ""))
        )
    });
  } catch (error) {
    console.error("ADMIN ORDERS ERROR:", error);
    return res.status(500).json({
      success: false,
      error: "Не удалось загрузить заказы"
    });
  }
});

app.get("/api/admin/orders/:id/receipt", async (req, res) => {
  try {
    const admin = await requireAdmin(req);
    if (!admin) {
      return res.status(403).json({
        success: false,
        error: "Доступ запрещён"
      });
    }

    const orders = await readJson(ORDERS_FILE);
    const order = orders.find(item => item.id === req.params.id);

    if (!order) {
      return res.status(404).json({ success: false, error: "Заказ не найден" });
    }

    if (!order.receipt?.pathname) {
      return res.status(404).json({
        success: false,
        error: "Файл этого чека отсутствует в приватном хранилище"
      });
    }

    const result = await get(order.receipt.pathname, {
      access: "private",
      token: process.env.BLOB_READ_WRITE_TOKEN,
      useCache: false
    });

    if (!result || result.statusCode !== 200 || !result.stream) {
      return res.status(404).json({
        success: false,
        error: "Файл чека не найден"
      });
    }

    const contentType = [
      "image/jpeg",
      "image/png",
      "image/webp",
      "application/pdf"
    ].includes(result.blob.contentType)
      ? result.blob.contentType
      : "application/octet-stream";

    res.setHeader("Content-Type", contentType);
    res.setHeader("Content-Disposition", "inline");
    res.setHeader("Cache-Control", "private, no-store, max-age=0");
    res.setHeader("X-Content-Type-Options", "nosniff");

    Readable.fromWeb(result.stream).pipe(res);
  } catch (error) {
    console.error("ADMIN RECEIPT VIEW ERROR:", error);
    if (!res.headersSent) {
      res.status(500).json({
        success: false,
        error: "Не удалось открыть чек"
      });
    } else {
      res.destroy(error);
    }
  }
});

app.post("/api/orders/:id/confirm", async (req, res) => {
  try {
    const admin = await requireAdmin(req);

    if (!admin) {
      return res.status(403).json({
        success: false,
        error: "Доступ запрещён"
      });
    }

    const orders = await readJson(ORDERS_FILE);
    const order = orders.find((item) => item.id === req.params.id);

    if (!order) {
      return res.status(404).json({ success: false });
    }

    if (order.status !== "payment_check") {
      return res.status(409).json({
        success: false,
        error: "Заказ не ожидает проверки оплаты"
      });
    }

    const confirmedSeat = await claimSeat(
      redis,
      order.route,
      normalizeTripDate(String(order.travelDate || "")),
      String(order.seat || "").trim().toUpperCase(),
      order.id,
      0
    );

    if (!confirmedSeat) {
      return res.status(409).json({
        success: false,
        error: "Не удалось закрепить место за заказом. Проверьте доступность места."
      });
    }

    const previousConfirmState = {
      status: order.status,
      confirmedAt: order.confirmedAt,
      updatedAt: order.updatedAt
    };

    order.status = "confirmed";
    order.confirmedAt = new Date().toISOString();
    order.updatedAt = new Date().toISOString();

    try {
      await writeJson(ORDERS_FILE, orders);
    } catch (saveError) {
      Object.assign(order, previousConfirmState);
      await claimSeat(
        redis,
        order.route,
        normalizeTripDate(String(order.travelDate || "")),
        String(order.seat || "").trim().toUpperCase(),
        order.id,
        0
      ).catch(() => {});
      throw saveError;
    }
    await notifyAdmin(order, "confirmed");
    await notifyClient(
      order,
      `✅ БРОНИРОВАНИЕ ПОДТВЕРЖДЕНО\n\n` +
      `Заказ: ${order.id}\n` +
      `Маршрут: ${order.route || "—"}\n` +
      `Услуга: ${order.service || "—"}\n` +
      `Место: ${order.seat || "—"}\n\n` +
      "Оплата принята. Мы свяжемся с вами для дальнейших инструкций."
    );

    return res.json({ success: true });
  } catch (error) {
    console.error("CONFIRM PAYMENT ERROR:", error);
    return res.status(500).json({
      success: false,
      error: "Не удалось подтвердить оплату"
    });
  }
});

app.post("/api/orders/:id/reject", async (req, res) => {
  try {
    const admin = await requireAdmin(req);

    if (!admin) {
      return res.status(403).json({
        success: false,
        error: "Доступ запрещён"
      });
    }

    const orders = await readJson(ORDERS_FILE);
    const order = orders.find((item) => item.id === req.params.id);

    if (!order) {
      return res.status(404).json({ success: false });
    }

    if (order.status !== "payment_check") {
      return res.status(409).json({
        success: false,
        error: "Заказ не ожидает проверки оплаты"
      });
    }

    const retryDeadline = Date.now() + 20 * 60 * 1000;
    const retrySeat = await claimSeat(
      redis,
      order.route,
      normalizeTripDate(String(order.travelDate || "")),
      String(order.seat || "").trim().toUpperCase(),
      order.id,
      20 * 60 * 1000
    );

    if (!retrySeat) {
      return res.status(409).json({
        success: false,
        error: "Место больше не закреплено за этим заказом. Свяжитесь с поддержкой."
      });
    }

    const previousRejectState = {
      status: order.status,
      paymentDeadline: order.paymentDeadline,
      receiptRejectedAt: order.receiptRejectedAt,
      receiptRejectionReason: order.receiptRejectionReason,
      updatedAt: order.updatedAt
    };

    order.status = "awaiting_payment";
    order.paymentDeadline = retryDeadline;
    order.lastPaymentReminderAt = null;
    order.receiptRejectedAt = new Date().toISOString();
    order.receiptRejectionReason = String(req.body?.reason || "")
      .trim()
      .slice(0, 500);
    order.updatedAt = new Date().toISOString();

    try {
      await writeJson(ORDERS_FILE, orders);
    } catch (saveError) {
      Object.assign(order, previousRejectState);
      await claimSeat(
        redis,
        order.route,
        normalizeTripDate(String(order.travelDate || "")),
        String(order.seat || "").trim().toUpperCase(),
        order.id,
        0
      ).catch(() => {});
      throw saveError;
    }
    await notifyClient(
      order,
      `⚠️ Чек по заказу ${order.id} не подтверждён.\n` +
      `${order.receiptRejectionReason || "Пожалуйста, проверьте чек и отправьте его повторно."}`
    );

    return res.json({ success: true });
  } catch (error) {
    console.error("REJECT RECEIPT ERROR:", error);
    return res.status(500).json({
      success: false,
      error: "Не удалось отклонить чек"
    });
  }
});

/* =========================
   GET USER ORDERS
========================= */

app.get("/api/orders/user/:telegramId", async (req, res) => {
  try {
    const initData = req.get("x-telegram-init-data");
    const telegramUser = validateTelegramInitData(initData);

    if (!telegramUser) {
      return res.status(401).json({
        success: false,
        error: "Необходимо подтвердить авторизацию Telegram"
      });
    }

    if (String(telegramUser.id) !== String(req.params.telegramId)) {
      return res.status(403).json({
        success: false,
        error: "Нет доступа к бронированиям другого пользователя"
      });
    }

    const orders = await readJson(ORDERS_FILE);
    const userOrders = orders.filter(
      (item) => String(item.telegramId) === String(telegramUser.id)
    );

    return res.json({
      success: true,
      orders: userOrders
    });
  } catch (error) {
    console.error("GET USER ORDERS ERROR:", error);
    return res.status(500).json({
      success: false,
      error: "Не удалось загрузить бронирования"
    });
  }
});

/* =========================
   LEGAL PAGES
========================= */

const privacyText = `
ПОЛИТИКА ОБРАБОТКИ ПЕРСОНАЛЬНЫХ ДАННЫХ
ООО «Фесто»

1. ОБЩИЕ ПОЛОЖЕНИЯ

Настоящая Политика определяет порядок обработки и защиты персональных данных пользователей сервиса ООО «Фесто».

Оператор персональных данных:

ООО «Фесто»
ИНН: ${process.env.COMPANY_INN}
ОГРН: ${process.env.COMPANY_OGRN}
Адрес: ${process.env.COMPANY_ADDRESS}
Email: ${process.env.COMPANY_EMAIL}

2. ЦЕЛИ ОБРАБОТКИ

Персональные данные обрабатываются для:

— оформления бронирования;
— идентификации пользователя;
— связи с пользователем;
— организации поездки;
— обработки платежей;
— направления уведомлений;
— исполнения обязательств перед пользователем;
— предотвращения мошенничества;
— ведения бухгалтерского и иного обязательного учета;
— соблюдения требований законодательства РФ.

3. СОСТАВ ДАННЫХ

В зависимости от используемых функций могут обрабатываться:

— имя;
— фамилия;
— Telegram ID;
— Telegram username;
— номер телефона;
— дата рождения;
— данные заграничного паспорта;
— сведения о бронировании;
— сведения об оплате;
— документы, загруженные пользователем для подтверждения оплаты.

4. ПРАВОВЫЕ ОСНОВАНИЯ

Обработка осуществляется на основании согласия субъекта персональных данных, необходимости исполнения договора, а также иных оснований, предусмотренных законодательством Российской Федерации.

5. СОГЛАСИЕ

Перед передачей паспортных данных пользователь должен самостоятельно подтвердить согласие на обработку персональных данных.

Согласие является отдельным действием пользователя.

6. ХРАНЕНИЕ

Персональные данные хранятся в течение срока, необходимого для достижения целей обработки, исполнения договора и выполнения требований законодательства.

7. ЗАЩИТА

Оператор принимает необходимые организационные и технические меры для защиты персональных данных от неправомерного доступа, изменения, раскрытия, уничтожения и иных неправомерных действий.

8. ПЕРЕДАЧА ТРЕТЬИМ ЛИЦАМ

Передача осуществляется только в случаях, предусмотренных законодательством, необходимостью исполнения договора либо с согласия пользователя, когда такое согласие требуется.

9. ПРАВА ПОЛЬЗОВАТЕЛЯ

Пользователь вправе:

— получать сведения об обработке своих данных;
— требовать уточнения данных;
— требовать прекращения обработки в предусмотренных законом случаях;
— требовать удаления данных, если их дальнейшее хранение не требуется по закону;
— отозвать согласие в предусмотренных законом случаях.

10. ОТЗЫВ СОГЛАСИЯ

Для отзыва согласия пользователь может обратиться к Оператору по адресу электронной почты:

${process.env.COMPANY_EMAIL}

11. COOKIES И ТЕХНИЧЕСКИЕ ДАННЫЕ

Сервис может использовать технические идентификаторы и данные, необходимые для функционирования Telegram Mini App, авторизации и обеспечения безопасности.

12. ЗАКЛЮЧИТЕЛЬНЫЕ ПОЛОЖЕНИЯ

Политика может изменяться при изменении законодательства либо порядка работы сервиса.

Дата публикации: ${new Date().toLocaleDateString("ru-RU")}
`;

const termsText = `
УСЛОВИЯ СЕРВИСА
ООО «Фесто»

1. ОБЩИЕ ПОЛОЖЕНИЯ

Настоящие Условия регулируют использование сервиса бронирования визаранов ООО «Фесто».

2. ПРЕДМЕТ

Сервис предоставляет пользователю возможность оформить заявку на поездку по выбранному маршруту, выбрать услугу, место в автобусе и произвести оплату.

3. МАРШРУТЫ

В сервисе доступны:

— Нячанг — Лаос;
— Нячанг — Камбоджа.

Конкретные даты, время отправления, порядок прохождения границы и организационные детали сообщаются пользователю дополнительно.

4. УСЛУГИ И ЦЕНЫ

Нячанг — Лаос:

Продление штампа на 45 дней:
500 000 VND / 1 600 RUB.

Виза + штамп на 90 дней:
900 000 VND / 3 000 RUB.

Нячанг — Камбоджа:

Продление штампа:
500 000 VND / 1 600 RUB.

Виза:
900 000 VND / 3 000 RUB.

Размеры платежей, указанные в сервисе, являются фиксированными для соответствующей услуги на момент оформления бронирования, если иное прямо не указано пользователю.

5. ОПЛАТА

Доступный способ:

— перевод на карту РФ / СБП.

Другие способы:

— Visa/Mastercard;
— VietQR;
— Crypto.

На момент публикации они обозначены как «Скоро».

6. СРОК ОПЛАТЫ

После перехода на страницу оплаты пользователю предоставляется 20 минут для совершения платежа и отправки подтверждения.

По истечении указанного срока бронирование может быть отменено или место освобождено.

7. ПОДТВЕРЖДЕНИЕ ОПЛАТЫ

Пользователь обязан предоставить подтверждение оплаты.

Отправленный файл может быть проверен оператором или автоматизированными средствами.

Сам факт загрузки изображения платежного документа не является безусловным доказательством поступления денежных средств.

8. БРОНИРОВАНИЕ

Бронирование считается подтвержденным только после подтверждения оплаты со стороны сервиса.

До подтверждения оплаты место не считается окончательно закрепленным за пользователем.

9. ПАСПОРТНЫЕ ДАННЫЕ

Пользователь обязан самостоятельно проверить правильность введенных паспортных данных.

Ошибки в данных могут привести к невозможности оформления поездки или пересечения границы.

ООО «Фесто» не несет ответственность за последствия предоставления пользователем неверных данных, если ошибка возникла по вине пользователя.

10. ГРАНИЧНЫЕ ТРЕБОВАНИЯ

Порядок пересечения государственной границы зависит от законодательства соответствующих государств, миграционных требований, наличия документов и иных обстоятельств.

ООО «Фесто» не гарантирует принятие решения иностранными государственными органами.

11. ЛАОС

Рекомендуется взять:

— таблетки от укачивания, поскольку маршрут проходит через серпантин;
— наличные деньги для прохождения границы;
— рекомендуется иметь мелкие купюры 10 000 и 20 000 VND;
— ориентировочно иметь при себе от 200 000 VND мелкими купюрами.

12. КАМБОДЖА

Рекомендуется взять:

— таблетки от укачивания;
— наличные деньги для границы;
— купюры 10 000 и 20 000 VND;
— два фотографии 3×4;
— 30 USD наличными для визового сбора.

Доллары для визового сбора рекомендуется иметь в хорошем состоянии, без значительных повреждений, надписей, разрывов и сильных сгибов.

13. ВИЗА И ГАРАНТИИ

ООО «Фесто» не является государственным органом и не принимает решения о выдаче виз.

Получение визы зависит от требований и решений соответствующих государственных органов.

Стоимость организационной услуги не является гарантией положительного решения иностранного государства.

14. ОТВЕТСТВЕННОСТЬ

Стороны несут ответственность в соответствии с законодательством Российской Федерации.

15. ОТКАЗ ОТ УСЛУГИ И ВОЗВРАТ

Вопросы отказа от услуги и возврата денежных средств регулируются законодательством Российской Федерации, условиями конкретной услуги и фактически понесенными расходами исполнителя.

16. ПРЕТЕНЗИИ

Претензии направляются:

${process.env.COMPANY_EMAIL}

17. РЕКВИЗИТЫ

ООО «Фесто»

ИНН:
${process.env.COMPANY_INN}

ОГРН:
${process.env.COMPANY_OGRN}

Адрес:
${process.env.COMPANY_ADDRESS}

Email:
${process.env.COMPANY_EMAIL}

18. ЗАКЛЮЧИТЕЛЬНЫЕ ПОЛОЖЕНИЯ

Используя сервис, пользователь подтверждает, что ознакомился с настоящими Условиями.

Дата публикации:
${new Date().toLocaleDateString("ru-RU")}
`;

app.get("/api/legal/privacy", async (req, res) => {
  res.type("text/plain; charset=utf-8").send(privacyText);
});

app.get("/api/legal/terms", async (req, res) => {
  res.type("text/plain; charset=utf-8").send(termsText);
});

/* =========================
   HEALTH
========================= */

app.get("/api/health", async (req, res) => {
  let redisStatus = "not_configured";

  if (redis) {
    try {
      await redis.ping();
      redisStatus = "connected";
    } catch {
      redisStatus = "error";
    }
  }

  res.json({
    ok: true,
    service: "FESTO Vizaran",
    redis: redisStatus
  });
});


app.get("/api/cron/orders", async (req, res) => {
  const secret = process.env.CRON_SECRET;
  const supplied = req.headers.authorization || "";

  if (!secret || supplied !== `Bearer ${secret}`) {
    return res.status(401).json({ success: false, error: "Unauthorized" });
  }

  try {
    const orders = await readJson(ORDERS_FILE);
    const now = Date.now();
    let changed = false;
    const result = { draftReminders: 0, paymentReminders: 0, cancelled: 0 };

    for (const order of orders) {
      if (["payment_check", "confirmed", "cancelled", "canceled"].includes(order.status)) {
        continue;
      }

      if (["draft", "in_progress"].includes(order.status)) {
        const expiresAt = Number(order.draftExpiresAt || 0);

        if (expiresAt && now >= expiresAt) {
          if (order.route && order.travelDate && order.seat) {
            await releaseSeat(
              redis,
              order.route,
              normalizeTripDate(String(order.travelDate)),
              String(order.seat).trim().toUpperCase(),
              order.id
            );
          }

          order.status = "cancelled";
          order.cancelledAt = new Date(now).toISOString();
          order.cancelReason = "draft_expired";
          order.updatedAt = new Date(now).toISOString();
          changed = true;
          result.cancelled++;
          try {
            await bot.telegram.sendMessage(
              order.telegramId,
              "Черновик бронирования отменён: прошло 24 часа. Если поездка ещё актуальна, начните бронирование заново."
            );
          } catch (error) {
            console.error("Draft cancellation notification failed:", error.message);
          }
          continue;
        }

        const last = Number(order.lastReminderAt || 0);
        if ((!last && now - Number(order.createdAt ? Date.parse(order.createdAt) : now) >= 5 * 60 * 60 * 1000) ||
            (last && now - last >= 5 * 60 * 60 * 1000)) {
          try {
            await bot.telegram.sendMessage(
              order.telegramId,
              "Вы начали бронирование поездки, но не закончили. Продолжить?"
            );
            order.lastReminderAt = now;
            order.updatedAt = new Date(now).toISOString();
            changed = true;
            result.draftReminders++;
          } catch (error) {
            console.error("Draft reminder failed:", error.message);
          }
        }
        continue;
      }

      if (order.status === "awaiting_payment") {
        const deadline = Number(order.paymentDeadline || 0);

        if (deadline && now >= deadline) {
          if (order.route && order.travelDate && order.seat) {
            await releaseSeat(
              redis,
              order.route,
              normalizeTripDate(String(order.travelDate)),
              String(order.seat).trim().toUpperCase(),
              order.id
            );
          }

          order.status = "cancelled";
          order.cancelledAt = new Date(now).toISOString();
          order.cancelReason = "payment_timeout";
          order.updatedAt = new Date(now).toISOString();
          changed = true;
          result.cancelled++;
          try {
            await bot.telegram.sendMessage(
              order.telegramId,
              "Время оплаты истекло, поэтому бронирование отменено. Вы можете оформить его заново."
            );
          } catch (error) {
            console.error("Payment cancellation notification failed:", error.message);
          }
          continue;
        }

        const last = Number(order.lastPaymentReminderAt || 0);
        const reminderBase = last || Number(Date.parse(order.updatedAt || order.createdAt) || now);
        if (now - reminderBase >= 5 * 60 * 1000) {
          try {
            await bot.telegram.sendMessage(
              order.telegramId,
              "Вы начали бронирование поездки, но не закончили. Продолжить оплату?"
            );
            order.lastPaymentReminderAt = now;
            order.updatedAt = new Date(now).toISOString();
            changed = true;
            result.paymentReminders++;
          } catch (error) {
            console.error("Payment reminder failed:", error.message);
          }
        }
      }
    }

    if (changed) await writeJson(ORDERS_FILE, orders);
    return res.json({ success: true, ...result });
  } catch (error) {
    console.error("ORDER CRON ERROR:", error);
    return res.status(500).json({ success: false, error: "Order processing failed" });
  }
});

if (process.env.VERCEL !== "1") {
  app.listen(PORT, () => {
    console.log(`
========================================
FESTO VIZARAN SERVER
========================================

PORT: ${PORT}

Telegram:
${bot ? "CONNECTED" : "NOT CONFIGURED"}

OpenAI:
${openai ? "CONNECTED" : "NOT CONFIGURED"}

========================================
`);
  });
}

export default app;
