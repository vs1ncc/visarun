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
  if (!initData || !process.env.BOT_TOKEN) {
    return null;
  }

  try {
    const params = new URLSearchParams(initData);
    const hash = params.get("hash");

    if (!hash) {
      return null;
    }

    params.delete("hash");

    const dataCheckString = Array
      .from(params.entries())
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
      calculatedHash.length !== hash.length ||
      !crypto.timingSafeEqual(
        Buffer.from(calculatedHash, "utf8"),
        Buffer.from(hash, "utf8")
      )
    ) {
      console.error("Telegram initData hash mismatch");
      return null;
    }

    const userString = params.get("user");

    if (!userString) {
      return null;
    }

    return JSON.parse(userString);

  } catch (error) {
    console.error(
      "Telegram initData validation error:",
      error.message
    );
    return null;
  }
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
    user
  });
});

/* =========================
   SAVE PHONE
========================= */

app.post("/api/profile/phone", async (req, res) => {
  const { telegramId, phone } = req.body;

  const users = await readJson(USERS_FILE);

  const user = users.find(
    (item) => String(item.telegramId) === String(telegramId)
  );

  if (!user) {
    return res.status(404).json({
      success: false
    });
  }

  user.phone = phone;

  await writeJson(USERS_FILE, users);

  res.json({
    success: true
  });
});

/* =========================
   SAVE PASSPORT
========================= */

app.post("/api/profile/passport", async (req, res) => {
  const {
    telegramId,
    passengers,
    consent
  } = req.body;

  if (!consent) {
    return res.status(400).json({
      success: false,
      error: "Необходимо согласие на обработку персональных данных"
    });
  }

  const users = await readJson(USERS_FILE);

  const user = users.find(
    (item) => String(item.telegramId) === String(telegramId)
  );

  if (!user) {
    return res.status(404).json({
      success: false
    });
  }

  const normalizedPassengers = Array.isArray(passengers)
    ? passengers
        .filter(
          (passenger) =>
            passenger &&
            passenger.fullName &&
            passenger.birthDate &&
            passenger.passportNumber
        )
        .map((passenger) => ({
          fullName: passenger.fullName,
          birthDate: passenger.birthDate,
          passportNumber: passenger.passportNumber
        }))
    : [];

  if (normalizedPassengers.length === 0) {
    return res.status(400).json({
      success: false,
      error: "Необходимо указать данные пассажира"
    });
  }

  user.passengers = normalizedPassengers;

  user.passport = {
    ...normalizedPassengers[0],
    consent: true,
    consentAt: new Date().toISOString()
  };

  await writeJson(USERS_FILE, users);

  res.json({
    success: true
  });
});

/* =========================
   GET PROFILE
========================= */

app.get("/api/profile/:telegramId", async (req, res) => {
  const users = await readJson(USERS_FILE);

  const user = users.find(
    (item) =>
      String(item.telegramId) === String(req.params.telegramId)
  );

  if (!user) {
    return res.status(404).json({
      success: false
    });
  }

  res.json({
    success: true,
    user
  });
});

/* =========================
   CREATE ORDER
========================= */

app.post("/api/orders", async (req, res) => {
  const {
    telegramId,
    route,
    service,
    priceRub,
    priceVnd,
    seat,
    options,
    medicalWarningAccepted
  } = req.body;

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

  if (!user.passport) {
    return res.status(400).json({
      success: false,
      error: "Паспортные данные не заполнены"
    });
  }

  const order = {
    id: `FESTO-${Date.now()}`,
    telegramId,
    username: user.username,
    firstName: user.firstName,
    phone: user.phone,
    route,
    service,
    priceRub,
    priceVnd,
    seat,
    options: options || {},
    medicalWarningAccepted: medicalWarningAccepted === true,
    passport: user.passport,
    status: "awaiting_payment",
    paymentDeadline: Date.now() + 20 * 60 * 1000,
    receipt: null,
    createdAt: new Date().toISOString()
  };

  orders.push(order);

  await writeJson(ORDERS_FILE, orders);

  res.json({
    success: true,
    order
  });
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
    const orders = await readJson(ORDERS_FILE);

    const order = orders.find(
      (item) => item.id === req.params.id
    );

    if (!order) {
      return res.status(404).json({
        success: false
      });
    }

    if (!req.file) {
      return res.status(400).json({
        success: false,
        error: "Файл подтверждения не загружен"
      });
    }

    order.receipt = {
      filename: req.file.filename,
      originalName: req.file.originalname,
      mimetype: req.file.mimetype,
      size: req.file.size,
      uploadedAt: new Date().toISOString()
    };

    order.status = "payment_check";

    await writeJson(ORDERS_FILE, orders);

    await notifyAdmin(order);

    res.json({
      success: true,
      message: "Подтверждение оплаты отправлено на проверку"
    });
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

async function notifyAdmin(order) {
  if (!bot || !process.env.ADMIN_CHAT_ID) {
    return;
  }

  const username = order.username
    ? `@${order.username}`
    : "без username";

  const message = `
🔔 НОВОЕ БРОНИРОВАНИЕ

Заказ: ${order.id}

👤 Telegram: ${username}
Имя: ${order.firstName || "—"}
📞 Телефон: ${order.phone || "—"}

🚌 Маршрут: ${order.route}
🎫 Услуга: ${order.service}
💺 Место: ${order.seat}

💰 Сумма:
${order.priceRub} ₽
${order.priceVnd.toLocaleString("ru-RU")} ₫

📄 Паспорт:
${order.passport.fullName}
${order.passport.birthDate}
${order.passport.passportNumber}

⏳ Статус:
Ожидается проверка оплаты.
`;

  try {
    await bot.telegram.sendMessage(
      process.env.ADMIN_CHAT_ID,
      message
    );
  } catch (error) {
    console.error(
      "Telegram admin notification error:",
      error.message
    );
  }
}

/* =========================
   CONFIRM PAYMENT
========================= */

app.post("/api/orders/:id/confirm", async (req, res) => {
  const orders = await readJson(ORDERS_FILE);

  const order = orders.find(
    (item) => item.id === req.params.id
  );

  if (!order) {
    return res.status(404).json({
      success: false
    });
  }

  order.status = "confirmed";
  order.confirmedAt = new Date().toISOString();

  await writeJson(ORDERS_FILE, orders);

  if (bot) {
    try {
      await bot.telegram.sendMessage(
        order.telegramId,
        `
✅ БРОНИРОВАНИЕ ПОДТВЕРЖДЕНО

Заказ: ${order.id}

Маршрут:
${order.route}

Услуга:
${order.service}

Место:
${order.seat}

Оплата принята.

Мы свяжемся с вами для дальнейших инструкций по поездке.
`
      );
    } catch (error) {
      console.error(error.message);
    }
  }

  res.json({
    success: true
  });
});

/* =========================
   GET USER ORDERS
========================= */

app.get("/api/orders/user/:telegramId", async (req, res) => {
  const orders = await readJson(ORDERS_FILE);

  const userOrders = orders.filter(
    (item) =>
      String(item.telegramId) ===
      String(req.params.telegramId)
  );

  res.json({
    success: true,
    orders: userOrders
  });
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