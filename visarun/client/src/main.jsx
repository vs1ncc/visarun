import React, { useEffect, useRef, useState } from "react";
import { createRoot } from "react-dom/client";
import { useLottie, LottieDisplay } from "lottie-react";
import "./styles.css";

const tg = window.Telegram?.WebApp;

if (tg) {
  tg.ready();
  tg.expand();
}

const API = "/api";
const TURNSTILE_SITE_KEY = import.meta.env.VITE_TURNSTILE_SITE_KEY || "";

function loadTurnstileScript() {
  return new Promise((resolve, reject) => {
    if (window.turnstile) return resolve();
    const existing = document.querySelector('script[data-turnstile="true"]');
    if (existing) {
      existing.addEventListener("load", () => resolve(), { once: true });
      existing.addEventListener("error", () => reject(new Error("Не удалось загрузить Cloudflare Turnstile")), { once: true });
      return;
    }
    const script = document.createElement("script");
    script.src = "https://challenges.cloudflare.com/turnstile/v0/api.js?render=explicit";
    script.async = true;
    script.defer = true;
    script.dataset.turnstile = "true";
    script.onload = resolve;
    script.onerror = () => reject(new Error("Не удалось загрузить Cloudflare Turnstile"));
    document.head.appendChild(script);
  });
}

window.addEventListener("error", (event) => {
  console.error("VIZARAN RUNTIME ERROR:", event.error || event.message);
});

window.addEventListener("unhandledrejection", (event) => {
  console.error("VIZARAN PROMISE ERROR:", event.reason);
});


const ROUTES = {
  LAOS: "Нячанг — Лаос",
  CAMBODIA: "Нячанг — Камбоджа",
  DANANG_LAOS: "Дананг — Лаос"
};

const SERVICES = {
  STAMP: {
    title: "Штамп на 45 дней",
    priceVnd: 500000,
    priceRub: 1600
  },

  VISA: {
    title: "Виза + штамп на 90 дней",
    priceVnd: 900000,
    priceRub: 3000
  }
};

function App() {
  const [screen, setScreenRaw] = useState("home");
  const [screenLoading, setScreenLoading] = useState(false);
  const [loaderAnimation, setLoaderAnimation] = useState(null);
  const screenTimerRef = useRef(null);

  useEffect(() => {
    let active = true;
    fetch("/animations/loader.json")
      .then((response) => {
        if (!response.ok) throw new Error("Не удалось загрузить анимацию");
        return response.json();
      })
      .then((data) => {
        if (active) setLoaderAnimation(data);
      })
      .catch((error) => console.error("LOTTIE LOAD ERROR:", error));

    return () => {
      active = false;
      if (screenTimerRef.current) clearTimeout(screenTimerRef.current);
    };
  }, []);

  function setScreen(nextScreen, animate = false) {
    if (screenTimerRef.current) {
      clearTimeout(screenTimerRef.current);
      screenTimerRef.current = null;
    }

    if (!animate) {
      setScreenLoading(false);
      setScreenRaw(nextScreen);
      return;
    }

    setScreenLoading(true);
    screenTimerRef.current = setTimeout(() => {
      setScreenRaw(nextScreen);
      setScreenLoading(false);
      screenTimerRef.current = null;
    }, 2500);
  }
  const [adminOrders, setAdminOrders] = useState([]);
  const [adminError, setAdminError] = useState("");
  const [adminLoading, setAdminLoading] = useState(false);
  const [serviceSettings, setServiceSettings] = useState({ STAMP: true, VISA: true });

  async function loadServiceSettings() {
    try {
      const response = await fetch(`${API}/service-settings`, { cache: "no-store" });
      const data = await response.json();
      if (response.ok && data.success && data.settings) {
        const settings = {
          STAMP: data.settings.STAMP !== false,
          VISA: data.settings.VISA !== false
        };
        setServiceSettings(settings);
        return settings;
      }
    } catch (error) {
      console.error("SERVICE SETTINGS LOAD ERROR:", error);
    }
    return null;
  }

  useEffect(() => {
    loadServiceSettings();
  }, []);

  useEffect(() => {
    window.scrollTo(0, 0);
  }, [screen]);

  const [user, setUser] = useState(null);

  useEffect(() => {
    function openAdmin() {
      if (user?.username?.toLowerCase() === "yosoycastello") {
        setScreen("admin");
      }
    }

    window.addEventListener("vizaran:open-admin", openAdmin);
    return () => window.removeEventListener("vizaran:open-admin", openAdmin);
  }, [user]);


  const [route, setRoute] = useState(null);
  const [selectedDate, setSelectedDate] = useState(null);
  const [service, setService] = useState(null);

  const [permissionType, setPermissionType] = useState("STAMP");
  const [vietnamEntryDate, setVietnamEntryDate] = useState("");
  const [permissionValidUntil, setPermissionValidUntil] = useState("");

  function calculatePermissionDate(entryDate, type) {
    if (!entryDate) return "";

    const date = new Date(`${entryDate}T12:00:00`);
    if (Number.isNaN(date.getTime())) return "";

    date.setDate(date.getDate() + (type === "VISA" ? 90 : 45));

    const year = date.getFullYear();
    const month = String(date.getMonth() + 1).padStart(2, "0");
    const day = String(date.getDate()).padStart(2, "0");

    return `${year}-${month}-${day}`;
  }

  function updateEntryDate(value) {
    setVietnamEntryDate(value);
    setPermissionValidUntil(calculatePermissionDate(value, permissionType));
  }

  function updatePermissionType(value) {
    setPermissionType(value);
    setPermissionValidUntil(calculatePermissionDate(vietnamEntryDate, value));
  }

  const [passengers, setPassengers] = useState([
    {
      fullName: "",
      birthDate: "",
      passportNumber: ""
    }
  ]);

  const [consent, setConsent] = useState(false);
  const [turnstileToken, setTurnstileToken] = useState("");

  const [selectedSeat, setSelectedSeat] = useState(null);
  const [selectedDrink, setSelectedDrink] = useState("");
  const [selectedSnack, setSelectedSnack] = useState("");
  const [motionSicknessTablets, setMotionSicknessTablets] = useState(false);
  const [medicalWarningAccepted, setMedicalWarningAccepted] = useState(false);


  const [order, setOrder] = useState(null);
  const [draftOrder, setDraftOrder] = useState(null);

  const [orders, setOrders] = useState([]);

  const [receipt, setReceipt] = useState(null);

  const [timeLeft, setTimeLeft] = useState(1200);

  const [loading, setLoading] = useState(false);

  useEffect(() => {
    authenticate();
  }, []);

  async function loadAdminOrders() {
    setAdminLoading(true);
    setAdminError("");

    try {
      if (!tg?.initData) {
        throw new Error("Открой приложение через Telegram.");
      }

      const response = await fetch(`${API}/admin/orders`, {
        headers: {
          "x-telegram-init-data": tg.initData
        }
      });
      const data = await response.json();

      if (!response.ok || !data.success) {
        throw new Error(data.error || "Нет доступа к админ-панели.");
      }

      setAdminOrders(data.orders || []);
    } catch (error) {
      setAdminError(error.message || "Не удалось загрузить заказы.");
    } finally {
      setAdminLoading(false);
    }
  }

  async function reviewReceipt(orderId, action) {
    const reason = action === "reject"
      ? window.prompt("Причина отклонения чека:", "Не удалось подтвердить оплату")
      : "";

    if (action === "reject" && reason === null) return;

    try {
      const response = await fetch(`${API}/orders/${encodeURIComponent(orderId)}/${action}`, {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          "x-telegram-init-data": tg?.initData || ""
        },
        body: JSON.stringify({ reason })
      });
      const data = await response.json();

      if (!response.ok || !data.success) {
        throw new Error(data.error || "Не удалось обработать заказ.");
      }

      await loadAdminOrders();
    } catch (error) {
      window.alert(error.message || "Ошибка обработки заказа.");
    }
  }

  async function authenticate() {
    try {
      console.log("TELEGRAM SDK:", !!tg);
      console.log("INIT DATA:", tg?.initData ? "YES" : "NO");
      console.log(
        "TELEGRAM USER:",
        tg?.initDataUnsafe?.user || "NO USER"
      );

      if (!tg?.initData) {
        alert(
          "Ошибка Telegram: initData не получен.\n\n" +
          "SDK: " + (!!tg ? "OK" : "NOT FOUND") + "\n" +
          "initData: NO"
        );
        return;
      }

      const response = await fetch(`${API}/auth`, {
        method: "POST",
        headers: {
          "Content-Type": "application/json"
        },
        body: JSON.stringify({
          initData: tg.initData
        })
      });

      const text = await response.text();

      console.log("AUTH STATUS:", response.status);
      console.log("AUTH RESPONSE:", text);

      let data;

      try {
        data = JSON.parse(text);
      } catch {
        throw new Error(
          `Сервер вернул не JSON (${response.status}): ${text.slice(0, 300)}`
        );
      }

      if (!response.ok) {
        throw new Error(
          data.error ||
          `Ошибка авторизации: HTTP ${response.status}`
        );
      }

      if (!data.success) {
        throw new Error(
          data.error || "Авторизация не выполнена"
        );
      }

      const telegramUser = tg?.initDataUnsafe?.user;
      const telegramId = telegramUser?.id || data.user.telegramId;
      const initData = tg?.initData || "";

      const profileResponse = await fetch(
        `/api/profile/${encodeURIComponent(telegramId)}`,
        {
          headers: {
            "x-telegram-init-data": initData
          }
        }
      );

      const profileData = await profileResponse.json();

      if (!profileResponse.ok || !profileData.success) {
        throw new Error(
          profileData.error || "Не удалось загрузить профиль"
        );
      }

      const profile = profileData.user;

      const mergedUser = {
        telegramId,
        username: telegramUser?.username || data.user.username || "",
        firstName: telegramUser?.first_name || data.user.firstName || "",
        lastName: telegramUser?.last_name || data.user.lastName || "",
        photoUrl: telegramUser?.photo_url || data.user.photoUrl || "",
        phone: profile.phone || "",
        passport: profile.passport || null
      };

      setUser(mergedUser);
      loadOrders(mergedUser.telegramId);

    } catch (error) {
      console.error("AUTH ERROR:", error);

      alert(
        "Ошибка авторизации:\n\n" +
        error.message
      );
    }
  }

  async function loadOrders(telegramId) {
    try {
      const initData = window.Telegram?.WebApp?.initData;

      if (!initData) {
        throw new Error("Не удалось подтвердить пользователя Telegram");
      }

      const response = await fetch(
        `${API}/orders/user/${telegramId}`,
        {
          headers: {
            "x-telegram-init-data": initData
          }
        }
      );

      const data = await response.json();

      if (!response.ok || !data.success) {
        throw new Error(data.error || "Не удалось загрузить бронирования");
      }

      const userOrders = Array.isArray(data.orders) ? data.orders : [];
      setOrders(userOrders);

      const now = Date.now();

      const resumableOrder = userOrders
        .filter((item) => {
          if (["payment_check", "confirmed", "cancelled", "canceled"].includes(item.status)) {
            return false;
          }

          if (item.status === "awaiting_payment") {
            return !item.paymentDeadline ||
              new Date(item.paymentDeadline).getTime() > now;
          }

          return ["draft", "in_progress"].includes(item.status) &&
            (!item.draftExpiresAt || Number(item.draftExpiresAt) > now);
        })
        .sort((a, b) =>
          new Date(b.updatedAt || b.createdAt || 0) -
          new Date(a.updatedAt || a.createdAt || 0)
        )[0];

      if (resumableOrder) {
        setDraftOrder(resumableOrder);
      }

      return userOrders;
    } catch (error) {
      console.error("LOAD ORDERS ERROR:", error);
      return [];
    }
  }

  async function continueBooking(savedOrder) {
    if (!savedOrder?.id) return;

    setRoute(savedOrder.route || null);
    setPermissionType(savedOrder.permissionType || "STAMP");
    setVietnamEntryDate(savedOrder.vietnamEntryDate || "");
    setPermissionValidUntil(savedOrder.permissionValidUntil || "");
    setSelectedDate(savedOrder.travelDate || null);
    setDraftOrder(savedOrder);

    const matchedService = Object.values(SERVICES).find(
      (item) => item.title === savedOrder.service
    );
    setService(matchedService || {
      title: savedOrder.service,
      priceRub: savedOrder.priceRub,
      priceVnd: savedOrder.priceVnd
    });

    if (savedOrder.status === "awaiting_payment") {
      const deadline = Number(savedOrder.paymentDeadline);
      const remaining = deadline ? Math.max(0, Math.ceil((deadline - Date.now()) / 1000)) : 0;

      if (remaining <= 0) {
        alert("Время оплаты этого заказа истекло. Начните бронирование заново.");
        return;
      }

      setOrder(savedOrder);
      setTimeLeft(remaining);
      setReceipt(null);
      setScreen("payment");
      return;
    }

    if (["draft", "in_progress"].includes(savedOrder.status)) {
      if (savedOrder.draftExpiresAt && Number(savedOrder.draftExpiresAt) <= Date.now()) {
        alert("Срок черновика истёк. Начните бронирование заново.");
        return;
      }

      setSelectedSeat(savedOrder.seat || null);
      setSelectedDrink(savedOrder.options?.drink || "");
      setSelectedSnack(savedOrder.options?.snack || "");
      setMotionSicknessTablets(Boolean(savedOrder.options?.motionSicknessTablets));
      setMedicalWarningAccepted(Boolean(savedOrder.medicalWarningAccepted));

      const stepScreens = {
        permission: "permission",
        passport: "passport",
        calendar: "calendar",
        seats: "seats",
        options: "options"
      };

      setScreen(stepScreens[savedOrder.currentStep] || "permission");
      return;
    }

    alert("Этот заказ нельзя продолжить.");
  }

  async function saveDraftProgress(fields) {
    if (!user?.telegramId || !draftOrder?.id) return false;

    try {
      const response = await fetch(`${API}/orders/${draftOrder.id}`, {
        method: "PATCH",
        headers: {
          "Content-Type": "application/json",
          "x-telegram-init-data": window.Telegram?.WebApp?.initData || ""
        },
        body: JSON.stringify({
          telegramId: user.telegramId,
          ...fields
        })
      });

      const data = await response.json();

      if (!response.ok || !data.success) {
        throw new Error(data.error || "Не удалось сохранить прогресс");
      }

      setDraftOrder(data.order);
      return true;
    } catch (error) {
      console.error("SAVE DRAFT PROGRESS ERROR:", error);
      alert(error.message || "Не удалось сохранить прогресс бронирования");
      return false;
    }
  }

  function openRoute(routeName) {
    setRoute(routeName);
    setSelectedDate(null);
    setScreen("service", true);
  }

  async function openService(serviceType) {
    if (!user?.telegramId || !route) {
      alert("Не удалось определить пользователя или маршрут. Вернитесь и попробуйте ещё раз.");
      return;
    }

    const selectedService = SERVICES[serviceType];
    const type = serviceType === "VISA" ? "VISA" : "STAMP";

    const latestSettings = await loadServiceSettings();
    if (latestSettings && latestSettings[serviceType] === false) {
      alert("Эта услуга временно недоступна. Выберите другую услугу.");
      return;
    }

    setLoading(true);
    try {
      const response = await fetch(`${API}/orders/draft`, {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          "x-telegram-init-data": window.Telegram?.WebApp?.initData || ""
        },
        body: JSON.stringify({
          telegramId: user.telegramId,
          route,
          service: selectedService.title,
          permissionType: type,
          priceRub: selectedService.priceRub,
          priceVnd: selectedService.priceVnd
        })
      });

      const contentType = response.headers.get("content-type") || "";
      const rawResponse = await response.text();

      if (!contentType.includes("application/json")) {
        console.error("DRAFT RESPONSE IS NOT JSON:", {
          status: response.status,
          contentType,
          bodyStart: rawResponse.slice(0, 300)
        });
        throw new Error(`Сервер вернул не JSON (HTTP ${response.status}). Откройте консоль браузера.`);
      }

      const data = JSON.parse(rawResponse);
      if (!response.ok || !data.success) {
        throw new Error(data.error || "Не удалось сохранить черновик");
      }

      setDraftOrder(data.order);
      setService(selectedService);
      setSelectedDate(null);
      setPermissionType(type);
      setVietnamEntryDate(data.order.vietnamEntryDate || "");
      setPermissionValidUntil(data.order.permissionValidUntil || "");
      await loadOrders(user.telegramId);
      setScreen("permission", true);
    } catch (error) {
      alert(error.message || "Не удалось начать бронирование");
    } finally {
      setLoading(false);
    }
  }

  function openPrivacy() {
    setScreen("privacy", true);
  }

  function openTerms() {
    setScreen("terms", true);
  }

  async function savePassportAndContinue() {
    for (let i = 0; i < passengers.length; i++) {
      const passenger = passengers[i];

      if (!passenger.fullName) {
        alert(`Введите ФИО пассажира ${i + 1}`);
        return;
      }

      if (!passenger.birthDate) {
        alert(`Введите дату рождения пассажира ${i + 1}`);
        return;
      }

      if (!passenger.passportNumber) {
        alert(`Введите номер загранпаспорта пассажира ${i + 1}`);
        return;
      }
    }

    if (!consent) {
      alert(
        "Необходимо согласиться с политикой обработки персональных данных"
      );
      return;
    }

    if (!turnstileToken) {
      alert("Пройдите проверку Cloudflare перед продолжением");
      return;
    }

    setLoading(true);

    try {
      const response = await fetch(
        `${API}/profile/passport`,
        {
          method: "POST",
          headers: {
            "Content-Type": "application/json",
            "x-telegram-init-data": window.Telegram?.WebApp?.initData || ""
          },
          body: JSON.stringify({
            telegramId: user.telegramId,
            passengers,
            consent: true,
            turnstileToken
          })
        }
      );

      const text = await response.text();

      let data;

      try {
        data = JSON.parse(text);
      } catch {
        throw new Error(
          `Ошибка сервера (${response.status}): ${text || "пустой ответ"}`
        );
      }

      if (!response.ok || !data.success) {
        throw new Error(
          data.error || `Ошибка сервера (${response.status})`
        );
      }

      setScreen("calendar", true);

    } catch (error) {
      alert(error.message || "Не удалось сохранить данные");
    } finally {
      setLoading(false);
    }
  }

  function continueToOptions() {
    if (!selectedSeat) {
      alert("Выберите место");
      return;
    }
    setScreen("options");
  }

  async function createBooking() {
    if (!selectedSeat) {
      alert("Выберите место");
      return;
    }

    if (!medicalWarningAccepted) {
      alert("Подтвердите ознакомление с противопоказаниями");
      return;
    }

    setLoading(true);

    try {
      if (!draftOrder?.id) {
        throw new Error("Черновик бронирования не найден. Начните бронирование заново.");
      }

      const response = await fetch(`${API}/orders`, {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          "x-telegram-init-data": window.Telegram?.WebApp?.initData || ""
        },
        body: JSON.stringify({
          telegramId: user.telegramId,
          draftOrderId: draftOrder.id,
          travelDate: selectedDate,
          route,
          service: service.title,
          permissionType,
          vietnamEntryDate,
          permissionValidUntil,
          priceRub: service.priceRub,
          priceVnd: service.priceVnd,
          seat: selectedSeat,
          options: {
            drink: selectedDrink || null,
            snack: selectedSnack || null,
            water: "Вода 1 литр",
            motionSicknessTablets
          },
          medicalWarningAccepted
        })
      });

      const data = await response.json();

      if (!data.success) {
        throw new Error(data.error || "Не удалось создать заказ");
      }

      setOrder(data.order);
      setTimeLeft(1200);
      setScreen("payment");
      loadOrders(user.telegramId);
    } catch (error) {
      alert(error.message);
    } finally {
      setLoading(false);
    }
  }

  function formatTime(seconds) {
    const minutes = Math.floor(seconds / 60);
    const secs = seconds % 60;

    return `${String(minutes).padStart(2, "0")}:${String(
      secs
    ).padStart(2, "0")}`;
  }

  async function uploadReceipt() {
    if (!receipt) {
      alert("Выберите файл подтверждения оплаты");
      return;
    }

    const formData = new FormData();

    formData.append("receipt", receipt);
    formData.append("telegramId", String(user.telegramId));

    setLoading(true);

    try {
      const response = await fetch(
        `${API}/orders/${order.id}/receipt`,
        {
          method: "POST",
          headers: {
            "x-telegram-init-data": window.Telegram?.WebApp?.initData || ""
          },
          body: formData
        }
      );

      const data = await response.json();

      if (!data.success) {
        throw new Error(data.error);
      }

      await loadOrders(user.telegramId);

      setScreen("success", true);
    } catch (error) {
      alert(error.message);
    } finally {
      setLoading(false);
    }
  }

  function formatRub(value) {
    return `${value.toLocaleString("ru-RU")} ₽`;
  }

  return (
    <div className="app">

      <main className="content">

        {screen === "home" && (
          <Home
            onRoute={openRoute}
            user={user}
          />
        )}

        {screen === "service" && (
          <ServiceSelection
            route={route}
            serviceSettings={serviceSettings}
            onBack={() => setScreen("home")}
            onSelect={openService}
          />
        )}

        {screen === "calendar" && (
          <CalendarSelection
            route={route}
            selectedDate={selectedDate}
            setSelectedDate={setSelectedDate}
            onBack={() => setScreen("service")}
            onContinue={async () => {
              if (!selectedDate) return;
              const saved = await saveDraftProgress({
                travelDate: selectedDate,
                currentStep: "seats"
              });
              if (saved) setScreen("seats", true);
            }}
          />
        )}

        {screen === "permission" && (
          <PermissionSelection
            permissionType={permissionType}
            onPermissionTypeChange={updatePermissionType}
            entryDate={vietnamEntryDate}
            onEntryDateChange={updateEntryDate}
            validUntil={permissionValidUntil}
            onBack={() => setScreen("service")}
            onContinue={async () => {
              const saved = await saveDraftProgress({
                permissionType,
                vietnamEntryDate: vietnamEntryDate || null,
                permissionValidUntil: permissionValidUntil || null,
                currentStep: "passport"
              });
              if (saved) setScreen("passport", true);
            }}
          />
        )}

        {screen === "passport" && (
          <Passport
            passengers={passengers}
            setPassengers={setPassengers}
            consent={consent}
            setConsent={setConsent}
            turnstileToken={turnstileToken}
            setTurnstileToken={setTurnstileToken}
            onBack={() => setScreen("service")}
            onPrivacy={openPrivacy}
            onContinue={savePassportAndContinue}
            loading={loading}
          />
        )}

        {screen === "seats" && (
          <SeatSelection
            route={route}
            service={service}
            selectedDate={selectedDate}
            selectedSeat={selectedSeat}
            setSelectedSeat={setSelectedSeat}
            onBack={() => setScreen("passport")}
            onContinue={async () => {
              if (!selectedSeat) {
                alert("Выберите место");
                return;
              }
              const saved = await saveDraftProgress({
                travelDate: selectedDate,
                seat: selectedSeat,
                currentStep: "options"
              });
              if (saved) setScreen("options", true);
            }}
            loading={loading}
          />
        )}

        {screen === "options" && (
          <OptionsSelection
            drink={selectedDrink}
            setDrink={setSelectedDrink}
            snack={selectedSnack}
            setSnack={setSelectedSnack}
            tablets={motionSicknessTablets}
            setTablets={setMotionSicknessTablets}
            accepted={medicalWarningAccepted}
            setAccepted={setMedicalWarningAccepted}
            loading={loading}
            onBack={() => setScreen("seats")}
            onContinue={async () => {
              const saved = await saveDraftProgress({
                travelDate: selectedDate,
                seat: selectedSeat,
                options: {
                  drink: selectedDrink || null,
                  snack: selectedSnack || null,
                  water: "Вода 1 литр",
                  motionSicknessTablets
                },
                medicalWarningAccepted,
                currentStep: "payment"
              });
              if (saved) await createBooking();
            }}
          />
        )}

        {screen === "payment" && (
          <Payment
            order={order}
            timeLeft={timeLeft}
            formatTime={formatTime}
            receipt={receipt}
            setReceipt={setReceipt}
            onUpload={uploadReceipt}
            loading={loading}
          />
        )}

        {screen === "success" && (
          <div className="success-page">
            <div className="success-icon" aria-hidden="true">✓</div>
            <h1>Чек отправлен на проверку</h1>
            <p>Мы проверим оплату и обновим информацию в разделе бронирований.</p>
            <button
              type="button"
              className="success-button"
              onClick={() => setScreen("bookings")}
            >
              В бронирования
            </button>
          </div>
        )}

        {screen === "bookings" && (
          <Bookings
            orders={orders}
            onContinue={continueBooking}
          />
        )}

        {screen === "profile" && (
          <Profile
            user={user}
            onPrivacy={openPrivacy}
            onTerms={openTerms}
          />
        )}
        {screen === "admin" && (
          <AdminPanel
            user={user}
            orders={adminOrders}
            loading={adminLoading}
            error={adminError}
            onRefresh={loadAdminOrders}
            onReview={reviewReceipt}
            onBack={() => setScreen("profile")}
          />
        )}


        {screen === "privacy" && (
          <LegalPage
            title="Политика обработки персональных данных"
            url={`${API}/legal/privacy`}
            onBack={() => setScreen("profile")}
          />
        )}

        {screen === "terms" && (
          <LegalPage
            title="Условия сервиса"
            url={`${API}/legal/terms`}
            onBack={() => setScreen("profile")}
          />
        )}

      </main>

      {["home", "bookings", "profile"].includes(screen) && (
        <BottomBar
          screen={screen}
          setScreen={setScreen}
        />
      )}

      {screenLoading && (
        <div className="lottie-transition-overlay" role="status" aria-label="Загрузка">
          {loaderAnimation && (
            <TransitionLottie animationData={loaderAnimation} />
          )}
        </div>
      )}

    </div>
  );
}

/* =========================
   HOME
========================= */

function TransitionLottie({ animationData }) {
  const lottie = useLottie({
    src: animationData,
    autoplay: true,
    loop: true,
  });

  return (
    <LottieDisplay
      lottie={lottie}
      className="lottie-transition-animation"
    />
  );
}

function Home({ onRoute, user }) {
  const scrollToDirections = () => {
    document.getElementById("directions")?.scrollIntoView({
      behavior: "smooth",
      block: "start"
    });
  };

  return (
    <div className="home-page">

      <header className="top-header">
        <div className="brand-block">
          <div className="eyebrow">FESTO</div>
          <h1>Визаран</h1>
          <p>
            Из Нячанга в Лаос и Камбоджу<br />
            Из Дананга в Лаос
          </p>
        </div>

        <div className="telegram-avatar">
          {user?.photoUrl ? (
            <img src={user.photoUrl} alt="" className="telegram-avatar-image" />
          ) : (
            user?.firstName?.[0] || "F"
          )}
        </div>
      </header>

      <section className="hero">
        <div className="hero-glow"></div>
        <div className="hero-content">
          <span className="hero-label">ВИЗАРАН ИЗ НЯЧАНГА/ДАНАНГА</span>
          <h2>Больше заботы.<br />Меньше лишних расходов.</h2>
          <p>
            Выберите направление, подходящий вариант пребывания
            и забронируйте поездку за несколько шагов.
          </p>
          <button className="home-primary-button" onClick={scrollToDirections}>
            Выбрать направление
            <span className="home-button-arrow" aria-hidden="true">
              <svg viewBox="0 0 24 24" fill="none">
                <path d="M12 3v17M5 13l7 7 7-7" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round" />
              </svg>
            </span>
          </button>
        </div>
      </section>

      <div className="section-heading" id="directions">
        <div>
          <span>01</span>
          <h2>Направления</h2>
        </div>
        <p>Куда отправимся?</p>
      </div>

      <div className="routes-list">
        <RouteCard
          title="Лаос"
          route="Нячанг — Лаос"
          description="Штамп на 45 дней или виза на 90 дней"
          accent="laos"
          onClick={() => onRoute(ROUTES.LAOS)}
        />
        <RouteCard
          title="Камбоджа"
          route="Нячанг — Камбоджа"
          description="Штамп на 45 дней или виза на 90 дней"
          accent="cambodia"
          onClick={() => onRoute(ROUTES.CAMBODIA)}
        />
        <RouteCard
          title="Лаос"
          route="Дананг — Лаос"
          description="Штамп на 45 дней или виза на 90 дней"
          accent="laos"
          onClick={() => onRoute(ROUTES.DANANG_LAOS)}
        />
      </div>

      <section className="home-info-section">
        <div className="home-section-kicker">02 · ВЫГОДА В ДЕТАЛЯХ</div>
        <h2>В поездке важен не только штамп</h2>
        <p className="home-section-intro">
          Мы стараемся сделать дорогу комфортнее, а расходы — понятнее.
          Без ненужных дополнений к стоимости.
        </p>

        <div className="home-benefit-list">
          <div className="home-benefit">
            <span className="home-benefit-icon">₫</span>
            <div>
              <h3>Разумная цена</h3>
              <p>Продумываем стоимость так, чтобы вы не переплачивали за лишнее.</p>
            </div>
          </div>
          <div className="home-benefit">
            <span className="home-benefit-icon">☕</span>
            <div>
              <h3>Небольшие бонусы в дороге</h3>
              <p>
                Напиток на выбор: Coca-Cola, Fanta или Sprite, снеки,
                вода 1 л и таблетки от укачивания на извилистом маршруте.
              </p>
            </div>
          </div>
          <div className="home-benefit">
            <span className="home-benefit-icon">↗</span>
            <div>
              <h3>Всё по делу</h3>
              <p>Помогаем разобраться с поездкой и заранее понять основные шаги.</p>
            </div>
          </div>
        </div>
      </section>

      <section className="home-story-section">
        <div className="home-section-kicker">03 · НАША ИСТОРИЯ</div>
        <h2>Мы только начинаем — и не скрываем этого</h2>
        <p>
          Vizaran запустился в октябре 2026 года. Мы новая компания,
          которая организует визараны из Нячанга и Дананга.
        </p>
        <p>
          Наша цель — помогать людям планировать поездки и экономить
          на оформлении штампов без лишней путаницы.
        </p>
        <p>
          У основателей есть опыт учёбы в Universal Arts School в Испании
          по направлению кинорежиссуры. Мы не выдаём это за многолетний
          опыт визового сервиса — вместо этого делаем ставку на открытость,
          понятные условия и внимание к пассажирам.
        </p>
        <div className="home-honesty-note">
          <span aria-hidden="true">✓</span>
          <p>Новая компания — честно обозначенные условия и возможность связаться с нами.</p>
        </div>
      </section>

      <section className="home-support-section">
        <div className="home-section-kicker">04 · МЫ НА СВЯЗИ</div>
        <h2>Вы не остаётесь один на один с вопросами</h2>
        <p>
          Не уверены, что взять с собой? Возник вопрос перед выездом
          или по дороге? Напишите нам — постараемся помочь и подсказать,
          что делать дальше.
        </p>
        <div className="home-support-note">
          <span aria-hidden="true">✦</span>
          <div>
            <strong>Можно просто написать</strong>
            <p>Без необходимости разбираться во всём самостоятельно.</p>
          </div>
        </div>
      </section>

      <section className="home-loyalty-section">
        <div className="home-section-kicker">05 · ДЛЯ НАШИХ ПАССАЖИРОВ</div>
        <h2>В следующий раз — выгоднее</h2>
        <p>
          После первой поездки получите скидку 50 000 ₫ на следующий визаран.
          При сохранении текущей базовой цены 500 000 ₫ повторная поездка
          обойдётся в 450 000 ₫.
        </p>
        <div className="home-price-comparison">
          <div>
            <span>Обычная цена</span>
            <strong className="home-old-price">500 000 ₫</strong>
          </div>
          <div>
            <span>Для повторной поездки</span>
            <strong className="home-new-price">450 000 ₫</strong>
          </div>
        </div>
        <p className="home-loyalty-footnote">
          Условия скидки подтвердим при бронировании. Дополнительные услуги
          и бонусы сохраняются, если они предусмотрены выбранным маршрутом.
        </p>
      </section>

      <section className="home-faq-section">
        <div className="home-section-kicker">06 · FAQ</div>
        <h2>Частые вопросы</h2>

        <details className="home-faq-item">
          <summary>Сколько стоит поездка?</summary>
          <p>
            Штамп на 45 дней стоит 500 000 ₫. Виза и штамп на 90 дней —
            900 000 ₫. Выберите направление, чтобы перейти к доступным вариантам.
          </p>
        </details>

        <details className="home-faq-item">
          <summary>Что входит в поездку?</summary>
          <p>
            Состав поездки и доступные бонусы зависят от выбранного направления.
            Перед подтверждением бронирования проверьте условия на экране услуги.
          </p>
        </details>

        <details className="home-faq-item">
          <summary>Что делать, если я плохо переношу серпантин?</summary>
          <p>
            Маршрут может проходить по извилистым дорогам. Если вас укачивает,
            подготовьтесь заранее и сообщите нам о своих вопросах до поездки.
          </p>
        </details>

        <details className="home-faq-item">
          <summary>Можно ли написать вам во время поездки?</summary>
          <p>
            Да, вы можете связаться с нами, если появятся вопросы или понадобится
            помощь с организационными моментами.
          </p>
        </details>

        <details className="home-faq-item">
          <summary>Есть ли скидка для постоянных клиентов?</summary>
          <p>
            После первой поездки предусмотрена скидка 50 000 ₫ на следующую.
            Условия повторного бронирования уточним при оформлении.
          </p>
        </details>

        <details className="home-faq-item">
          <summary>Как забронировать поездку?</summary>
          <p>
            Нажмите на нужное направление, выберите услугу и следуйте шагам
            оформления в приложении.
          </p>
        </details>
      </section>

      <section className="home-final-cta">
        <span className="home-section-kicker">ВАША СЛЕДУЮЩАЯ ПОЕЗДКА</span>
        <h2>Готовы выбрать направление?</h2>
        <p>Посмотрите варианты поездок и подберите подходящий для себя.</p>
        <button className="home-primary-button" onClick={scrollToDirections}>
          Забронировать
          <span className="home-button-arrow" aria-hidden="true">
            <svg viewBox="0 0 24 24" fill="none">
              <path d="M12 21V4M5 11l7-7 7 7" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round" />
            </svg>
          </span>
        </button>
      </section>

    </div>
  );
}

function RouteCard({
  title,
  route,
  description,
  accent,
  onClick
}) {
  return (
    <button
      className={`route-card route-card-${accent}`}
      onClick={onClick}
    >
      <div className="route-card-main">

        <div className="route-icon">
          <span>{accent === "laos" ? "🇱🇦" : "🇰🇭"}</span>
        </div>

        <div className="route-copy">
          <span className="route-name">{route}</span>
          <h3>{title}</h3>
          <p>{description}</p>
        </div>

      </div>

      <span className="service-arrow" aria-hidden="true">
        <svg viewBox="0 0 24 24" fill="none">
          <path
            d="M5 12H19M13 6L19 12L13 18"
            stroke="currentColor"
            strokeWidth="1.8"
            strokeLinecap="round"
            strokeLinejoin="round"
          />
        </svg>
      </span>
    </button>
  );
}

/* =========================
   SERVICE
========================= */


function ServiceSelection({
  route,
  serviceSettings,
  onBack,
  onSelect
}) {
  const cambodia =
    route === ROUTES.CAMBODIA;

  return (
    <div className="service-selection-page">

      <BackButton onClick={onBack} />

      <h1>{route}</h1>

      <p className="subtitle">
        Выберите необходимую услугу
      </p>

      <ServiceCard
        title="Штамп на 45 дней"
        price="500 000 ₫"
        rub="1 600 ₽"
        available={serviceSettings?.STAMP !== false}
        onClick={() => onSelect("STAMP")}
      />

      <ServiceCard
        title="Виза + штамп на 90 дней"
        price="900 000 ₫"
        rub="3 000 ₽"
        available={serviceSettings?.VISA !== false}
        onClick={() => onSelect("VISA")}
      />

      <div className="recommendation">

        <strong>
          Рекомендации
        </strong>

        <p>
          • Возьмите наличные для границы —
          рекомендуется от 200 000 ₫
          мелкими купюрами 10 000 и 20 000 ₫.
        </p>

        {cambodia && (
          <>
            <p>
              • Возьмите 2 фотографии 3×4.
            </p>

            <p>
              • Возьмите 30 USD наличными
              для визового сбора Камбоджи.
            </p>

            <p>
              • Доллары должны быть нового образца,
              без заметных повреждений,
              царапин и сильных помятостей.
            </p>
          </>
        )}

      </div>

    </div>
  );
}

function ServiceCard({
  title,
  price,
  rub,
  available = true,
  onClick
}) {
  return (
    <button
      className={`service-card${available ? "" : " service-card-unavailable"}`}
      onClick={available ? onClick : undefined}
      disabled={!available}
      aria-disabled={!available}
    >

      <div>

        <h3>{title}</h3>

        <span className="price-vnd">
          {price}
        </span>

        <span className="price-rub">
          {rub}
        </span>
        {!available && (
          <span className="service-unavailable-label">Временно недоступно</span>
        )}

      </div>

      {available && <span className="service-arrow" aria-hidden="true">
        <svg viewBox="0 0 24 24" fill="none">
          <path
            d="M5 12H19M13 6L19 12L13 18"
            stroke="currentColor"
            strokeWidth="1.8"
            strokeLinecap="round"
            strokeLinejoin="round"
          />
        </svg>
      </span>}

    </button>
  );
}


function PermissionSelection({
  permissionType,
  onPermissionTypeChange,
  entryDate,
  onEntryDateChange,
  validUntil,
  onBack,
  onContinue
}) {
  function displayDate(value) {
    if (!value) return "Выберите дату въезда";
    const [year, month, day] = value.split("-");
    return `${day}.${month}.${year}`;
  }

  return (
    <div className="passport-page">
      <BackButton onClick={onBack} />

      <h1>Виза/Штамп</h1>
      <p className="subtitle">Укажите данные разрешения на пребывание во Вьетнаме</p>

      <section className="passenger-block">
        <h3>Выберите тип разрешения</h3>
        <div className="permission-type-options">
          <button
            type="button"
            className={`permission-type-option ${permissionType === "STAMP" ? "active" : ""}`}
            onClick={() => onPermissionTypeChange("STAMP")}
            aria-pressed={permissionType === "STAMP"}
          >
            Штамп · 45 дней
          </button>
          <button
            type="button"
            className={`permission-type-option ${permissionType === "VISA" ? "active" : ""}`}
            onClick={() => onPermissionTypeChange("VISA")}
            aria-pressed={permissionType === "VISA"}
          >
            Виза · 90 дней
          </button>
        </div>

        <label className="permission-date-label" htmlFor="vietnam-entry-date">
          Дата въезда во Вьетнам
        </label>
        <input
          id="vietnam-entry-date"
          className="birth-date-input"
          type="date"
          value={entryDate}
          onChange={(event) => onEntryDateChange(event.target.value)}
          required
        />

        <div className="permission-validity">
          <span>Дата разрешённого пребывания до:</span>
          <strong>{displayDate(validUntil)}</strong>
          <small>Расчётный срок: {permissionType === "VISA" ? 90 : 45} дней с даты въезда</small>
        </div>
      </section>

      <button
        type="button"
        className="vizaran-calendar-submit"
        disabled={!entryDate || !validUntil}
        onClick={onContinue}
      >
        <span>ПРОДОЛЖИТЬ</span>
      </button>
    </div>
  );
}

/* =========================
   PASSPORT
========================= */

function TurnstileWidget({ siteKey, onToken }) {
  const containerRef = React.useRef(null);
  const [errorCode, setErrorCode] = useState("");

  useEffect(() => {
    let widgetId;
    let cancelled = false;

    setErrorCode("");

    loadTurnstileScript()
      .then(() => {
        if (cancelled || !containerRef.current || !window.turnstile) return;

        widgetId = window.turnstile.render(containerRef.current, {
          sitekey: siteKey,
          callback: (token) => {
            setErrorCode("");
            onToken(token);
          },
          "expired-callback": () => onToken(""),
          "error-callback": (code) => {
            const message = `Turnstile error: ${code || "unknown"}`;
            console.error(message);
            setErrorCode(message);
            onToken("");
          }
        });
      })
      .catch((error) => {
        console.error("TURNSTILE LOAD ERROR:", error);
        setErrorCode(error?.message || "Не удалось загрузить скрипт Turnstile");
        onToken("");
      });

    return () => {
      cancelled = true;
      if (widgetId !== undefined && window.turnstile) {
        window.turnstile.remove(widgetId);
      }
    };
  }, [siteKey, onToken]);

  return (
    <div>
      <div ref={containerRef} aria-label="Проверка безопасности Cloudflare" />
      {errorCode && (
        <p role="alert" style={{ color: "#fca5a5", fontSize: 13, marginTop: 8 }}>
          Не удалось пройти проверку безопасности. Попробуйте ещё раз.
        </p>
      )}
    </div>
  );
}

function Passport({
  passengers,
  setPassengers,
  consent,
  setConsent,
  turnstileToken,
  setTurnstileToken,
  onBack,
  onPrivacy,
  onContinue,
  loading
}) {
  function updatePassenger(index, field, value) {
    setPassengers((current) =>
      current.map((passenger, i) =>
        i === index
          ? { ...passenger, [field]: value }
          : passenger
      )
    );
  }

  function addPassenger() {
    if (passengers.length >= 30) return;

    setPassengers((current) => [
      ...current,
      {
        fullName: "",
        birthDate: "",
        passportNumber: ""
      }
    ]);
  }

  function removePassenger() {
    if (passengers.length <= 1) return;

    setPassengers((current) => current.slice(0, -1));
  }

  return (
    <div className="passport-page">

      <BackButton onClick={onBack} />

      <h1>Данные пассажиров</h1>

      <p className="subtitle">
        Укажите данные загранпаспорта
      </p>

      <div className="passengers-list">

        {passengers.map((passenger, index) => (
          <section className="passenger-block" key={index}>

            <div className="passenger-heading">

              <div>
                <span>ПАССАЖИР</span>
                <h2>Пассажир {index + 1}</h2>
              </div>

              {index === 0 && (
                <div className="passenger-counter">

                  <button
                    type="button"
                    className="passenger-counter-btn"
                    onClick={removePassenger}
                    disabled={passengers.length <= 1}
                    aria-label="Уменьшить количество пассажиров"
                  >
                    <svg viewBox="0 0 24 24" fill="none" aria-hidden="true">
                      <path
                        d="M7 12H17"
                        stroke="currentColor"
                        strokeWidth="1.8"
                        strokeLinecap="round"
                      />
                    </svg>
                  </button>

                  <strong>{passengers.length}</strong>

                  <button
                    type="button"
                    className="passenger-counter-btn"
                    onClick={addPassenger}
                    disabled={passengers.length >= 30}
                    aria-label="Добавить пассажира"
                  >
                    <svg viewBox="0 0 24 24" fill="none" aria-hidden="true">
                      <path
                        d="M12 7V17M7 12H17"
                        stroke="currentColor"
                        strokeWidth="1.8"
                        strokeLinecap="round"
                      />
                    </svg>
                  </button>

                </div>
              )}

            </div>

            <div className="form">

              <label>
                ФИО

                <input
                  value={passenger.fullName}
                  onChange={(e) =>
                    updatePassenger(
                      index,
                      "fullName",
                      e.target.value
                    )
                  }
                  placeholder="Иванов Иван Иванович"
                />
              </label>

              <label>
                Дата рождения

                <div className="birth-date-wrap">

                  <input
                    className="birth-date-input"
                    type="date"
                    value={passenger.birthDate}
                    onChange={(e) =>
                      updatePassenger(
                        index,
                        "birthDate",
                        e.target.value
                      )
                    }
                  />

                  <span
                    className="birth-date-icon"
                    aria-hidden="true"
                  >
                    <svg viewBox="0 0 24 24" fill="none">
                      <rect
                        x="3"
                        y="5"
                        width="18"
                        height="16"
                        rx="3"
                        stroke="currentColor"
                        strokeWidth="1.7"
                      />
                      <path
                        d="M7 3V7M17 3V7M3 10H21"
                        stroke="currentColor"
                        strokeWidth="1.7"
                        strokeLinecap="round"
                      />
                    </svg>
                  </span>

                </div>
              </label>

              <label>
                Номер загранпаспорта

                <input
                  value={passenger.passportNumber}
                  onChange={(e) =>
                    updatePassenger(
                      index,
                      "passportNumber",
                      e.target.value
                    )
                  }
                  placeholder="12 3456789"
                />
              </label>

            </div>

          </section>
        ))}

      </div>

      <div className="passport-footer">

        <div className="turnstile-wrap">
          {TURNSTILE_SITE_KEY ? (
            <TurnstileWidget
              siteKey={TURNSTILE_SITE_KEY}
              onToken={setTurnstileToken}
            />
          ) : (
            <p className="turnstile-error">Проверка безопасности временно недоступна.</p>
          )}
        </div>

        <label className={`consent consent-card ${consent ? "is-checked" : ""}`}>

          <input
            type="checkbox"
            checked={consent}
            onChange={(e) =>
              setConsent(e.target.checked)
            }
          />

          <span className="consent-check" aria-hidden="true">
            <svg viewBox="0 0 24 24" fill="none">
              <path
                d="M6.5 12.5L10.2 16L17.5 8.5"
                stroke="currentColor"
                strokeWidth="2"
                strokeLinecap="round"
                strokeLinejoin="round"
              />
            </svg>
          </span>

          <span className="consent-text">
            Согласен с{" "}

            <button
              type="button"
              className="link-button"
              onClick={(e) => {
                e.preventDefault();
                e.stopPropagation();
                onPrivacy();
              }}
            >
              политикой обработки
              персональных данных
            </button>
          </span>

        </label>

        <button
          className="primary-button"
          disabled={loading}
          onClick={onContinue}
        >
          {loading
            ? "Сохраняем..."
            : "Перейти к бронированию"}
        </button>

      </div>

    </div>
  );
}

function CalendarSelection({
  route,
  selectedDate,
  setSelectedDate,
  onBack,
  onContinue
}) {
  const [month, setMonth] = useState(() => {
    if (selectedDate && /^\d{2}\.\d{2}\.\d{4}$/.test(selectedDate)) {
      const [, mm, yyyy] = selectedDate.split(".");
      return `${yyyy}-${mm}`;
    }
    const now = new Date();
    return `${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, "0")}`;
  });
  const [departures, setDepartures] = useState([]);
  const [monthOpen, setMonthOpen] = useState(false);
  const [scheduleLoading, setScheduleLoading] = useState(true);
  const [scheduleError, setScheduleError] = useState("");

  useEffect(() => {
    let active = true;
    setScheduleLoading(true);
    setScheduleError("");
    setDepartures([]);

    const params = new URLSearchParams({ route: route || "", month });
    fetch(`${API}/schedule?${params.toString()}`)
      .then(async response => {
        const data = await response.json();
        if (!response.ok || !data.success) {
          throw new Error(data.error || "Не удалось загрузить расписание");
        }
        return data;
      })
      .then(data => {
        if (!active) return;
        setMonthOpen(data.monthOpen === true);
        setDepartures(
          data.monthOpen === true && Array.isArray(data.departures)
            ? data.departures.map(item => item.date)
            : []
        );
      })
      .catch(error => {
        if (!active) return;
        setScheduleError(error.message || "Не удалось загрузить расписание");
        setMonthOpen(false);
      })
      .finally(() => {
        if (active) setScheduleLoading(false);
      });

    return () => { active = false; };
  }, [route, month]);

  const [yearText, monthText] = month.split("-");
  const year = Number(yearText);
  const monthIndex = Number(monthText) - 1;
  const monthNames = [
    "ЯНВАРЬ", "ФЕВРАЛЬ", "МАРТ", "АПРЕЛЬ", "МАЙ", "ИЮНЬ",
    "ИЮЛЬ", "АВГУСТ", "СЕНТЯБРЬ", "ОКТЯБРЬ", "НОЯБРЬ", "ДЕКАБРЬ"
  ];
  const daysInMonth = new Date(year, monthIndex + 1, 0).getDate();
  const firstWeekday = (new Date(year, monthIndex, 1).getDay() + 6) % 7;
  const availableDates = new Set(departures);
  const cells = [
    ...Array(firstWeekday).fill(null),
    ...Array.from({ length: daysInMonth }, (_, i) => i + 1)
  ];

  function shiftMonth(delta) {
    const next = new Date(year, monthIndex + delta, 1);
    setMonth(`${next.getFullYear()}-${String(next.getMonth() + 1).padStart(2, "0")}`);
    setSelectedDate("");
  }

  return (
    <div className="vizaran-calendar-page">
      <div className="vizaran-calendar-top">
        <button
          type="button"
          className="back-button vizaran-calendar-back"
          onClick={onBack}
          aria-label="Назад"
        >
          <span className="back-arrow" aria-hidden="true">
            <svg viewBox="0 0 24 24" fill="none">
              <path d="M19 12H5M11 6L5 12L11 18" stroke="currentColor"
                strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round" />
            </svg>
          </span>
        </button>
        <div className="vizaran-calendar-heading">
          <h1>{route || "Выбранный рейс"}</h1>
          <p>Выберите доступную дату поездки</p>
        </div>
      </div>

      <div className="vizaran-calendar-card">
        <div className="vizaran-calendar-month">
          <button type="button" aria-label="Предыдущий месяц"
            onClick={() => shiftMonth(-1)} disabled={scheduleLoading}>‹</button>
          <div>
            <strong>{monthNames[monthIndex]} {year}</strong>
            <span>Доступные даты рейса</span>
          </div>
          <button type="button" aria-label="Следующий месяц"
            onClick={() => shiftMonth(1)} disabled={scheduleLoading}>›</button>
        </div>

        <div className="vizaran-calendar-week">
          {["ПН", "ВТ", "СР", "ЧТ", "ПТ", "СБ", "ВС"].map(day => (
            <span key={day}>{day}</span>
          ))}
        </div>

        <div className="vizaran-calendar-grid">
          {cells.map((day, index) => {
            if (!day) return <span key={`blank-${index}`} aria-hidden="true" />;
            const value = `${String(day).padStart(2, "0")}.${monthText}.${yearText}`;
            const available = monthOpen && availableDates.has(value);
            const selected = selectedDate === value;

            return (
              <button
                key={value}
                type="button"
                disabled={!available || scheduleLoading || Boolean(scheduleError)}
                className={[
                  "vizaran-calendar-day",
                  available ? "available" : "unavailable",
                  selected ? "selected" : ""
                ].join(" ")}
                onClick={() => available && setSelectedDate(value)}
              >
                <strong>{day}</strong>
              </button>
            );
          })}
        </div>

        {scheduleLoading && <p role="status">Загружаем расписание…</p>}
        {scheduleError && <p role="alert">{scheduleError}</p>}
        {!scheduleLoading && !scheduleError && !monthOpen && (
          <p>В этом месяце рейсы пока закрыты для бронирования.</p>
        )}
        {!scheduleLoading && !scheduleError && monthOpen && departures.length === 0 && (
          <p>На этот месяц открытых рейсов нет.</p>
        )}

        <div className="vizaran-calendar-legend">
          <div><span className="calendar-dot available-dot"></span><span>Рейс доступен</span></div>
          <div><span className="calendar-dot unavailable-dot"></span><span>Нет рейса</span></div>
          <div><span className="calendar-dot selected-dot"></span><span>Выбрано</span></div>
        </div>
      </div>

      <div className="vizaran-calendar-bottom">
        <button
          type="button"
          className="vizaran-calendar-submit"
          disabled={!selectedDate || !availableDates.has(selectedDate) ||
            scheduleLoading || Boolean(scheduleError)}
          onClick={onContinue}
        >
          <span>ПРОДОЛЖИТЬ</span>
        </button>
      </div>
    </div>
  );
}

function SeatSelection({
  route,
  service,
  selectedDate,
  selectedSeat,
  setSelectedSeat,
  onBack,
  onContinue,
  loading
}) {
  const seats = Array.from({ length: 8 }, (_, i) => ({
    upperLeft: `${i + 1}A`,
    lowerLeft: `${i + 1}B`,
    upperRight: `${i + 9}A`,
    lowerRight: `${i + 9}B`
  }));

  const [bookedSeats, setBookedSeats] = useState(new Set());
  const [disabledSeats, setDisabledSeats] = useState(new Set());
  const [seatsLoading, setSeatsLoading] = useState(true);
  const [seatsError, setSeatsError] = useState("");

  useEffect(() => {
    let active = true;
    setSeatsLoading(true);
    setSeatsError("");
    setBookedSeats(new Set());
    setDisabledSeats(new Set());
    setSelectedSeat("");

    if (!route || !selectedDate) {
      setSeatsError("Сначала выберите маршрут и дату поездки.");
      setSeatsLoading(false);
      return () => { active = false; };
    }

    const params = new URLSearchParams({ route, date: selectedDate });
    fetch(`${API}/schedule/seats?${params.toString()}`)
      .then(async response => {
        const data = await response.json();
        if (!response.ok || !data.success) {
          throw new Error(data.error || "Не удалось загрузить занятость мест");
        }
        return data;
      })
      .then(data => {
        if (!active) return;
        if (data.available !== true) {
          throw new Error("Этот рейс больше недоступен. Вернитесь в календарь и выберите другую дату.");
        }
        setBookedSeats(new Set(Array.isArray(data.bookedSeats) ? data.bookedSeats : []));
        setDisabledSeats(new Set(Array.isArray(data.disabledSeats) ? data.disabledSeats : []));
      })
      .catch(error => {
        if (!active) return;
        setSeatsError(error.message || "Не удалось загрузить места");
      })
      .finally(() => {
        if (active) setSeatsLoading(false);
      });

    return () => { active = false; };
  }, [route, selectedDate]);

  function renderSeat(seat, type) {
    const taken = bookedSeats.has(seat) || disabledSeats.has(seat);
    const unavailable = seatsLoading || Boolean(seatsError) || taken;

    return (
      <button
        key={seat}
        type="button"
        disabled={unavailable}
        className={[
          "v-seat",
          type === "upper" ? "v-seat-upper" : "v-seat-lower",
          selectedSeat === seat ? "v-seat-selected" : "",
          taken ? "v-seat-taken" : ""
        ].join(" ")}
        onClick={() => !unavailable && setSelectedSeat(seat)}
      >
        <span>{seat.replace(/[AB]/, "")}</span>
        <b>{type === "upper" ? "A" : "B"}</b>
      </button>
    );
  }

  return (
    <div className="vizaran-seat-page">
      <div className="vizaran-seat-top">
        <BackButton onClick={onBack} />

        <div className="vizaran-trip">
          <span className="vizaran-trip-label">ВАШ МАРШРУТ</span>
          <h1>{route || "Выбранный маршрут"}</h1>
          <p>Выберите место в автобусе · {selectedDate || "дата не выбрана"}</p>
          {seatsLoading && <p role="status">Загружаем свободные места…</p>}
          {seatsError && <p role="alert">{seatsError}</p>}
        </div>

      </div>

      <div className="vizaran-seat-content">

        <section className="vizaran-bus-wrap">
          <div className="vizaran-bus">

            <div className="vizaran-bus-front">
              <div className="vizaran-front-window"></div>
              <div className="vizaran-driver">
                <span></span>
                ВОДИТЕЛЬ
              </div>
            </div>

            <div className="vizaran-bus-cabin">
              <div className="vizaran-cabin-head">
                <span>САЛОН</span>
                <i>32 МЕСТА</i>
              </div>

              <div className="vizaran-seat-labels">
                <span>A</span>
                <span>B</span>
                <span>A</span>
                <span>B</span>
              </div>

              <div className="vizaran-seat-layout">
                <div className="vizaran-seat-column vizaran-seat-column-left">
                  {seats.map((row) => (
                    <React.Fragment key={row.upperLeft}>
                      {renderSeat(row.upperLeft, "upper")}
                      {renderSeat(row.lowerLeft, "lower")}
                    </React.Fragment>
                  ))}
                </div>

                <div className="vizaran-aisle">
                  <span>ПРОХОД</span>
                </div>

                <div className="vizaran-seat-column vizaran-seat-column-right">
                  {seats.map((row) => (
                    <React.Fragment key={row.upperRight}>
                      {renderSeat(row.upperRight, "upper")}
                      {renderSeat(row.lowerRight, "lower")}
                    </React.Fragment>
                  ))}
                </div>
              </div>

              <div className="vizaran-bus-service">
                <span>WC</span>
                <small>ТУАЛЕТ</small>
              </div>
            </div>

            <div className="vizaran-bus-rear">
              <span>ЗАДНЯЯ ЧАСТЬ</span>
            </div>

          </div>
        </section>

        <aside className="vizaran-seat-sidebar">

          <div className="vizaran-selected-card">
            <span className="vizaran-card-label">ВЫБРАННОЕ МЕСТО</span>

            <div className="vizaran-selected-number">
              {selectedSeat || "—"}
            </div>

            <p>
              {selectedSeat
                ? "Место закреплено за вами"
                : "Выберите свободное место слева"}
            </p>
          </div>

          <div className="vizaran-info-card">
            <span className="vizaran-card-label">В АВТОБУСЕ</span>

            <div className="vizaran-feature">
              <span className="vizaran-feature-icon vizaran-wifi-icon" aria-hidden="true">
  <svg viewBox="0 0 24 24" fill="none">
    <path d="M3 8.5C8.5 4 15.5 4 21 8.5" />
    <path d="M6.5 12C10.2 9.2 13.8 9.2 17.5 12" />
    <path d="M10 15.5C11.3 14.5 12.7 14.5 14 15.5" />
    <circle cx="12" cy="19" r="1.2" fill="currentColor" stroke="none" />
  </svg>
</span>
              <div>
                <strong>Wi-Fi</strong>
                <small>Бесплатный интернет</small>
              </div>
            </div>

            <div className="vizaran-feature">
              <span className="vizaran-feature-icon vizaran-ac-icon" aria-hidden="true">❄</span>
              <div>
                <strong>Кондиционер</strong>
                <small>Комфортная температура</small>
              </div>
            </div>

            <div className="vizaran-feature">
              <span className="vizaran-feature-icon vizaran-wc-icon" aria-hidden="true">WC</span>
              <div>
                <strong>Туалет</strong>
                <small>В салоне автобуса</small>
              </div>
            </div>
          </div>

          <div className="vizaran-legend">
            <span className="vizaran-card-label">МЕСТА</span>

            <div>
              <i className="free"></i>
              <span>Свободно</span>
            </div>

            <div>
              <i className="chosen"></i>
              <span>Выбрано</span>
            </div>

            <div>
              <i className="busy"></i>
              <span>Занято</span>
            </div>
          </div>

        </aside>
      </div>

      <div className="vizaran-seat-bottom">
        <div className="vizaran-price">
          {selectedSeat ? (
            <>
              <span>К ОПЛАТЕ</span>
              <strong>
                {service?.priceRub
                  ? service.priceRub.toLocaleString("ru-RU")
                  : "—"} ₽
              </strong>
            </>
          ) : (
            <>
              <span>ВЫБЕРИТЕ МЕСТО</span>
              <strong>—</strong>
            </>
          )}
        </div>

        <div className="vizaran-bottom-seat">
          <span>МЕСТО</span>
          <strong>{selectedSeat || "—"}</strong>
        </div>

        <button
          className="vizaran-seat-submit"
          disabled={!selectedSeat || loading || seatsLoading || Boolean(seatsError) ||
            bookedSeats.has(selectedSeat) || disabledSeats.has(selectedSeat)}
          onClick={onContinue}
        >
          {loading ? "БРОНИРУЕМ..." : "ПРОДОЛЖИТЬ"}
          <span>→</span>
        </button>
      </div>
    </div>
  );
}

/* =========================
   PAYMENT
========================= */


function OptionsSelection({
  drink, setDrink,
  snack, setSnack,
  tablets, setTablets,
  accepted, setAccepted,
  loading, onBack, onContinue
}) {
  return (
    <div className="vizaran-options-page">
      <header className="vizaran-options-header">
        <BackButton onClick={onBack} />
        <span className="vizaran-options-eyebrow">ВАША ПОЕЗДКА</span>
        <h1>Опции</h1>
        <p>Выберите дополнительные удобства в дорогу</p>
      </header>

      <section className="vizaran-options-group">
        <h2>Напитки</h2>
        {["Кока-Кола", "Фанта", "Спрайт"].map(item => (
          <label className="vizaran-option-row" key={item}>
            <span>{item}</span>
            <input type="radio" name="drink" checked={drink === item}
              onChange={() => setDrink(item)} />
          </label>
        ))}
        <label className="vizaran-option-row">
          <span>Без выбора</span>
          <input type="radio" name="drink" checked={drink === ""}
            onChange={() => setDrink("")} />
        </label>
      </section>

      <section className="vizaran-options-group">
        <h2>Перекус и снеки</h2>
        {["Чипсы Lays", "Печенье"].map(item => (
          <label className="vizaran-option-row" key={item}>
            <span>{item}</span>
            <input type="radio" name="snack" checked={snack === item}
              onChange={() => setSnack(item)} />
          </label>
        ))}
        <label className="vizaran-option-row">
          <span>Без выбора</span>
          <input type="radio" name="snack" checked={snack === ""}
            onChange={() => setSnack("")} />
        </label>
      </section>

      <section className="vizaran-options-group">
        <h2>Включено в поездку</h2>
        <div className="vizaran-option-row">
          <span>Вода 1 литр</span>
          <span className="vizaran-option-included-label">Включено</span>
        </div>
      </section>

      <section className="vizaran-options-group">
        <h2>Таблетки от укачивания</h2>
        <label className="vizaran-option-row">
          <span>Добавить в поездку</span>
          <input type="checkbox" checked={tablets}
            onChange={event => setTablets(event.target.checked)} />
        </label>
      </section>

      <section className="vizaran-medical-warning">
        <strong>Внимание</strong>
        <p>Сервис предоставляет транспортные и организационные услуги. Выдаваемые в дороге средства от укачивания имеют информационный/вспомогательный характер. Перед применением убедитесь в отсутствии у вас аллергических реакций и противопоказаний. За индивидуальную реакцию организма ответственность несет пассажир</p>
        <label className="vizaran-medical-consent">
          <input type="checkbox" checked={accepted}
            onChange={event => setAccepted(event.target.checked)} />
          <span>Я ознакомлен(-а) с возможными противопоказаниями и подтверждаю отсутствие аллергических реакций</span>
        </label>
      </section>

      <div className="vizaran-options-footer">
        <button type="button" className="vizaran-options-continue"
          disabled={!accepted || loading} onClick={onContinue}>
          {loading ? "СОЗДАЁМ ЗАКАЗ..." : "ПРОДОЛЖИТЬ"} <span>→</span>
        </button>
      </div>
    </div>
  );
}

function Payment({
  order,
  timeLeft,
  formatTime,
  receipt,
  setReceipt,
  onUpload,
  loading
}) {
  const [copied, setCopied] = useState(false);

  function copyPhone() {
    navigator.clipboard.writeText(
      "+79654317207"
    );

    setCopied(true);

    setTimeout(() => {
      setCopied(false);
    }, 1500);
  }

  if (!order) {
    return null;
  }

  return (
    <div>

      <h1>
        Оплата
      </h1>

      <div className="timer-card">

        <span>
          Время на оплату
        </span>

        <strong>
          {formatTime(timeLeft)}
        </strong>

      </div>

      <div className="order-summary">
        <div className="order-line">
          <span>Заказ</span>
          <strong>{order.id}</strong>
        </div>
        <div className="order-line"><span>{order.route}</span></div>
        <div className="order-line"><span>{order.service}</span></div>
        <div className="order-line"><span>Место {order.seat}</span></div>
        <div className="order-line order-total">
          <strong>{order.priceRub.toLocaleString("ru-RU")} ₽</strong>
        </div>
      </div>

      <div className="payment-methods">

        <div className="payment-method active">
          <img
            className="payment-method-logo payment-method-logo-sbp"
            src="/images/payments/sbp-logo.png.webp"
            alt="СБП"
          />
          <span className="payment-method-status">Доступно</span>
        </div>

        <div className="payment-method disabled">
          <img
            className="payment-method-logo"
            src="/images/payments/visa-logo.png.webp"
            alt="Visa"
          />
          <img
            className="payment-method-logo"
            src="/images/payments/mastercard-logo.png.png"
            alt="Mastercard"
          />
          <small>Скоро</small>
        </div>

        <div className="payment-method disabled">
          <img
            className="payment-method-logo payment-method-logo-vietqr"
            src="/images/payments/vietqr-logo.png.png"
            alt="VietQR"
          />
          <small>Скоро</small>
        </div>

      </div>

      <div className="bank-card">
        <div className="bank-detail">
          <span>Переведите —</span>
          <strong>{order.priceRub.toLocaleString("ru-RU")} ₽</strong>
        </div>
        <div className="bank-detail">
          <span>Получатель —</span>
          <strong>Ирода К.</strong>
        </div>
        <div className="bank-name">Альфа Банк</div>
        <div className="phone-row">
          <strong>+7 965 431 72 07</strong>
          <button onClick={copyPhone} className="copy-button">
            {copied ? "Скопировано" : "Копировать"}
          </button>
        </div>
      </div>

      <div className="upload-card">

        <h3>
          После перевода
        </h3>

        <p>
          Загрузите скриншот,
          фотографию или PDF
          подтверждения оплаты.
        </p>

        <input
          type="file"
          accept="image/*,.pdf"
          onChange={(e) =>
            setReceipt(e.target.files?.[0] || null)
          }
        />

        {receipt && (
          <div className="file-selected">
            ✓ {receipt.name}
          </div>
        )}

      </div>

      <button
        className="primary-button"
        disabled={!receipt || loading || timeLeft <= 0}
        onClick={onUpload}
      >
        {loading
          ? "Проверяем..."
          : "Подтвердить бронирование"}
      </button>

    </div>
  );
}

/* =========================
   BOOKINGS
========================= */

function Bookings({ orders, onContinue }) {
  const [activeTab, setActiveTab] = useState("upcoming");

  const visaRunOrders = orders.filter((order) => {
    const route = String(order.route || "").toLowerCase();
    return route.includes("лаос") || route.includes("камбод");
  });

  function getTravelDate(order) {
    const value = order.travelDate || order.selectedDate || order.date;
    if (!value) return null;

    if (typeof value === "string") {
      const match = value.match(/^(\d{1,2})\.(\d{1,2})\.(\d{4})$/);
      if (match) {
        return new Date(Number(match[3]), Number(match[2]) - 1, Number(match[1]));
      }
    }

    const date = new Date(value);
    return Number.isNaN(date.getTime()) ? null : date;
  }

  function isCancelled(order) {
    const status = String(order.status || "").toLowerCase();
    return ["cancelled", "canceled", "отменено", "отменён", "отменен", "отменена"]
      .includes(status) || Boolean(order.cancelledAt);
  }

  function formatValidity(order) {
    const value =
      order.validUntil ||
      order.validityUntil ||
      order.stampValidUntil;

    if (!value) return null;

    const date = new Date(value);
    if (Number.isNaN(date.getTime())) return null;

    return date.toLocaleDateString("ru-RU");
  }

  const today = new Date();
  today.setHours(0, 0, 0, 0);

  const filteredOrders = visaRunOrders.filter((order) => {
    if (activeTab === "cancelled") return isCancelled(order);
    if (isCancelled(order)) return false;

    const travelDate = getTravelDate(order);

    if (activeTab === "previous") {
      return travelDate !== null && travelDate < today;
    }

    // Existing bookings without a saved date stay visible under upcoming.
    return travelDate === null || travelDate >= today;
  });

  const tabs = [
    { id: "upcoming", label: "Предстоящие" },
    { id: "previous", label: "Предыдущие" },
    { id: "cancelled", label: "Отменённые" }
  ];

  return (
    <div className="bookings-page">
      <header className="page-header">
        <span className="page-kicker">FESTO / ПОЕЗДКИ</span>
        <h1>Бронирования</h1>
        <p>Ваши забронированные поездки</p>
      </header>

      <div className="bookings-tabs" role="tablist" aria-label="Категории поездок">
        {tabs.map((tab) => (
          <button
            key={tab.id}
            type="button"
            role="tab"
            aria-selected={activeTab === tab.id}
            className={`bookings-tab ${activeTab === tab.id ? "active" : ""}`}
            onClick={() => setActiveTab(tab.id)}
          >
            {tab.label}
          </button>
        ))}
      </div>

      {filteredOrders.length === 0 ? (
        <div className="bookings-empty">
          <div className="empty-icon">↗</div>
          <h3>
            {activeTab === "upcoming"
              ? "Пока нет предстоящих поездок"
              : activeTab === "previous"
                ? "Предыдущих поездок пока нет"
                : "Отменённых поездок нет"}
          </h3>
          <p>
            {activeTab === "upcoming"
              ? "Здесь появятся ваши забронированные поездки в Лаос и Камбоджу."
              : activeTab === "previous"
                ? "Здесь будут отображаться завершённые поездки."
                : "Здесь будут отображаться отменённые бронирования."}
          </p>
        </div>
      ) : (
        <div className="bookings-list">
          {filteredOrders.map((order) => {
            const validity = formatValidity(order);
            const travelDate = getTravelDate(order);

            return (
              <div className="booking-card" key={order.id}>
                <div className="booking-card-header">
                  <span className="booking-route-label">ВИЗАРАН</span>
                  <span className="booking-status">
                    {isCancelled(order) ? "Отменено" : order.status || "Забронировано"}
                  </span>
                </div>

                <h3>{order.route}</h3>

                {travelDate && (
                  <div className="booking-info-row">
                    <span>Дата поездки</span>
                    <strong>{travelDate.toLocaleDateString("ru-RU")}</strong>
                  </div>
                )}

                <div className="booking-info-row">
                  <span>Услуга</span>
                  <strong>{order.service}</strong>
                </div>

                <div className="booking-info-row">
                  <span>Место</span>
                  <strong>{order.seat || "—"}</strong>
                </div>

                {validity && (
                  <div className="booking-info-row">
                    <span>Штамп действителен до</span>
                    <strong>{validity}</strong>
                  </div>
                )}

                <div className="booking-info-row">
                  <span>Стоимость поездки</span>
                  <strong>{order.priceRub?.toLocaleString("ru-RU")} ₽</strong>
                </div>

                {["draft", "in_progress", "awaiting_payment"].includes(order.status) && (
                  <button
                    type="button"
                    className="primary-button"
                    onClick={() => onContinue?.(order)}
                  >
                    {order.status === "awaiting_payment"
                      ? "Продолжить оплату"
                      : "Продолжить бронирование"}
                  </button>
                )}
              </div>
            );
          })}
        </div>
      )}
    </div>
  );
}

/* =========================
   PROFILE
========================= */


function Profile({
  user,
  onPrivacy,
  onTerms
}) {
  return (
    <div className="profile-page">

      <header className="page-header">
        <span className="page-kicker">FESTO / АККАУНТ</span>
        <h1>Профиль</h1>
        <p>
          Ваши данные для бронирований
        </p>
      </header>

      <section className="profile-identity">

        <div className="profile-avatar">
          {user?.photoUrl ? (
            <img
              src={user.photoUrl}
              alt=""
              className="profile-avatar-image"
            />
          ) : (
            user?.firstName?.[0] || "U"
          )}
        </div>

        <div className="profile-identity-copy">
          <span>ПОЛЬЗОВАТЕЛЬ</span>

          <strong>
            {user?.firstName || "Пользователь"}
          </strong>

          <p>
            {user?.username
              ? `@${user.username}`
              : "Telegram username не указан"}
          </p>
        </div>

      </section>

      <section className="profile-section">

        <div className="profile-section-heading">
          <span className="section-number">01</span>
          <h3>Telegram</h3>
        </div>

        <div className="profile-row">
          <span>Ник</span>
          <strong>
            {user?.username
              ? `@${user.username}`
              : "—"}
          </strong>
        </div>

        <div className="profile-row">
          <span>ID аккаунта</span>
          <strong>
            {user?.telegramId || "—"}
          </strong>
        </div>

      </section>

      <section className="profile-section">

        <div className="profile-section-heading">
          <span className="section-number">02</span>
          <h3>Телефон</h3>
        </div>

        <div className="profile-row">
          <span>Номер</span>
          <strong>
            {user?.phone || "Не указан"}
          </strong>
        </div>

      </section>

      <section className="profile-section">

        <div className="profile-section-heading">
          <span className="section-number">03</span>
          <h3>Паспорт</h3>
        </div>

        {user?.passport ? (
          <>
            <div className="profile-row">
              <span>ФИО</span>
              <strong>{user.passport.fullName}</strong>
            </div>

            <div className="profile-row">
              <span>Дата рождения</span>
              <strong>{user.passport.birthDate}</strong>
            </div>

            <div className="profile-row">
              <span>Загранпаспорт</span>
              <strong>{user.passport.passportNumber}</strong>
            </div>
          </>
        ) : (
          <p className="profile-empty">
            Паспортные данные появятся
            после первого бронирования.
          </p>
        )}

      </section>

      {user?.username?.toLowerCase() === "yosoycastello" && (
        <button
          type="button"
          className="admin-settings-button"
          onClick={() => window.dispatchEvent(new CustomEvent("vizaran:open-admin"))}
        >
          <span>Настройки</span>
          <span aria-hidden="true">→</span>
        </button>
      )}

      <section className="legal-card">

        <div>
          <span>Документы</span>
          <strong>Правила и конфиденциальность</strong>
        </div>

        <div className="legal-buttons">
          <button onClick={onPrivacy}>
            Политика данных
            <span>→</span>
          </button>

          <button onClick={onTerms}>
            Условия сервиса
            <span>→</span>
          </button>
        </div>

      </section>

    </div>
  );
}

/* =========================
   LEGAL
========================= */


function AdminPanel({
  user,
  orders,
  loading,
  error,
  onRefresh,
  onReview,
  onBack
}) {
  const [section, setSection] = useState("trips");
  const [selectedTrip, setSelectedTrip] = useState(null);
  const [receiptPreview, setReceiptPreview] = useState(null);
  const [receiptLoading, setReceiptLoading] = useState(false);
  const [receiptError, setReceiptError] = useState("");
  const [schedule, setSchedule] = useState({ months: [], departures: [] });
  const [scheduleLoading, setScheduleLoading] = useState(false);
  const [scheduleSaving, setScheduleSaving] = useState(false);
  const [scheduleMessage, setScheduleMessage] = useState("");
  const [scheduleError, setScheduleError] = useState("");
  const [scheduleRoute, setScheduleRoute] = useState("Нячанг — Лаос");
  const [scheduleMonth, setScheduleMonth] = useState("2026-10");
  const [scheduleDate, setScheduleDate] = useState("2026-10-08");
  const [serviceSettings, setServiceSettings] = useState({ STAMP: true, VISA: true });
  const [serviceSettingsLoading, setServiceSettingsLoading] = useState(false);
  const [serviceSettingsSaving, setServiceSettingsSaving] = useState(false);
  const [serviceSettingsMessage, setServiceSettingsMessage] = useState("");
  const [serviceSettingsError, setServiceSettingsError] = useState("");

  async function loadAdminServiceSettings() {
    setServiceSettingsLoading(true);
    setServiceSettingsError("");
    setServiceSettingsMessage("");
    try {
      const response = await fetch(`${API}/admin/service-settings`, {
        headers: { "x-telegram-init-data": tg?.initData || "" },
        cache: "no-store"
      });
      const data = await response.json();
      if (!response.ok || !data.success) {
        throw new Error(data.error || "Не удалось загрузить настройки услуг");
      }
      setServiceSettings({
        STAMP: data.settings?.STAMP !== false,
        VISA: data.settings?.VISA !== false
      });
    } catch (error) {
      setServiceSettingsError(error.message || "Ошибка загрузки настроек");
    } finally {
      setServiceSettingsLoading(false);
    }
  }

  async function saveAdminServiceSettings(nextSettings) {
    setServiceSettingsSaving(true);
    setServiceSettingsError("");
    setServiceSettingsMessage("");
    try {
      const response = await fetch(`${API}/admin/service-settings`, {
        method: "PUT",
        headers: {
          "Content-Type": "application/json",
          "x-telegram-init-data": tg?.initData || ""
        },
        body: JSON.stringify({ settings: nextSettings })
      });
      const data = await response.json();
      if (!response.ok || !data.success) {
        throw new Error(data.error || "Не удалось сохранить настройки услуг");
      }
      const saved = {
        STAMP: data.settings?.STAMP !== false,
        VISA: data.settings?.VISA !== false
      };
      setServiceSettings(saved);
      setServiceSettingsMessage("Настройки сохранены");
      window.dispatchEvent(new CustomEvent("vizaran:service-settings-updated", {
        detail: saved
      }));
    } catch (error) {
      setServiceSettingsError(error.message || "Ошибка сохранения настроек");
    } finally {
      setServiceSettingsSaving(false);
    }
  }

  useEffect(() => {
    if (section === "services") loadAdminServiceSettings();
  }, [section]);

  const scheduleRoutes = [
    "Нячанг — Лаос",
    "Нячанг — Камбоджа",
    "Дананг — Лаос"
  ];

  useEffect(() => {
    if (section !== "schedule") return;
    let cancelled = false;

    async function loadSchedule() {
      setScheduleLoading(true);
      setScheduleError("");
      try {
        const response = await fetch(`${API}/admin/schedule`, {
          headers: { "x-telegram-init-data": tg?.initData || "" },
          cache: "no-store"
        });
        const data = await response.json();
        if (!response.ok) throw new Error(data.error || "Не удалось загрузить расписание");
        if (!cancelled) setSchedule(data.schedule || { months: [], departures: [] });
      } catch (error) {
        if (!cancelled) setScheduleError(error.message || "Ошибка загрузки расписания");
      } finally {
        if (!cancelled) setScheduleLoading(false);
      }
    }

    loadSchedule();
    return () => { cancelled = true; };
  }, [section]);

  function dateToDisplay(isoDate) {
    if (!/^\d{4}-\d{2}-\d{2}$/.test(isoDate || "")) return "";
    const [year, month, day] = isoDate.split("-");
    return `${day}.${month}.${year}`;
  }

  function displayToDate(value) {
    if (!/^\d{2}\.\d{2}\.\d{4}$/.test(value || "")) return "";
    const [day, month, year] = value.split(".");
    return `${year}-${month}-${day}`;
  }

  function updateSchedule(patch) {
    setSchedule(previous => ({ ...previous, ...patch }));
    setScheduleMessage("");
    setScheduleError("");
  }

  function saveMonth() {
    if (!scheduleMonth) return;
    const months = [...schedule.months];
    const index = months.findIndex(item =>
      item.route === scheduleRoute && item.month === scheduleMonth
    );
    const entry = {
      route: scheduleRoute,
      month: scheduleMonth,
      open: index >= 0 ? !months[index].open : true
    };
    if (index >= 0) months[index] = entry;
    else months.push(entry);
    updateSchedule({ months });
  }

  function saveDeparture() {
    const date = dateToDisplay(scheduleDate);
    if (!date) return;
    const departures = [...schedule.departures];
    const index = departures.findIndex(item =>
      item.route === scheduleRoute && item.date === date
    );
    if (index < 0) {
      departures.push({ route: scheduleRoute, date, open: true, disabledSeats: [] });
    } else {
      departures[index] = { ...departures[index], open: !departures[index].open };
    }
    updateSchedule({ departures });
  }

  function toggleSeatForDeparture(date, seat) {
    const departures = schedule.departures.map(item => {
      if (item.route !== scheduleRoute || item.date !== date) return item;
      const disabledSeats = new Set(item.disabledSeats || []);
      if (disabledSeats.has(seat)) disabledSeats.delete(seat);
      else disabledSeats.add(seat);
      return { ...item, disabledSeats: [...disabledSeats] };
    });
    updateSchedule({ departures });
  }

  async function persistSchedule() {
    setScheduleSaving(true);
    setScheduleError("");
    setScheduleMessage("");
    try {
      const response = await fetch(`${API}/admin/schedule`, {
        method: "PUT",
        headers: {
          "Content-Type": "application/json",
          "x-telegram-init-data": tg?.initData || ""
        },
        body: JSON.stringify({ schedule })
      });
      const data = await response.json();
      if (!response.ok) throw new Error(data.error || "Не удалось сохранить расписание");
      setSchedule(data.schedule);
      setScheduleMessage("Расписание сохранено");
    } catch (error) {
      setScheduleError(error.message || "Ошибка сохранения");
    } finally {
      setScheduleSaving(false);
    }
  }


  useEffect(() => {
    if (user?.username?.toLowerCase() === "yosoycastello") {
      onRefresh();
    }
  }, [user?.username]);

  if (user?.username?.toLowerCase() !== "yosoycastello") {
    return (
      <div className="profile-page">
        <h1>Доступ запрещён</h1>
        <button type="button" onClick={onBack}>Назад в профиль</button>
      </div>
    );
  }

  const pending = orders.filter(order => order.status === "payment_check");

  async function openReceipt(order) {
    setReceiptLoading(true);
    setReceiptError("");
    try {
      const response = await fetch(
        `${API}/admin/orders/${encodeURIComponent(order.id)}/receipt`,
        {
          headers: {
            "x-telegram-init-data": tg?.initData || ""
          },
          cache: "no-store"
        }
      );

      if (!response.ok) {
        let message = "Не удалось открыть чек";
        try {
          const data = await response.json();
          message = data.error || message;
        } catch {}
        throw new Error(message);
      }

      const blob = await response.blob();
      const url = URL.createObjectURL(blob);
      setReceiptPreview(previous => {
        if (previous?.url) URL.revokeObjectURL(previous.url);
        return {
          url,
          name: order.receipt?.originalName || "Чек",
          type: blob.type
        };
      });
    } catch (error) {
      setReceiptError(error.message || "Не удалось открыть чек");
    } finally {
      setReceiptLoading(false);
    }
  }

  function closeReceipt() {
    setReceiptPreview(previous => {
      if (previous?.url) URL.revokeObjectURL(previous.url);
      return null;
    });
  }


  const tripsMap = orders.reduce((acc, order) => {
    const route = order.route || "Маршрут не указан";
    const date = order.travelDate || "";
    const key = `${route}__${date}`;

    if (!acc[key]) {
      acc[key] = { key, route, date, orders: [] };
    }

    acc[key].orders.push(order);
    return acc;
  }, {});

  const trips = Object.values(tripsMap).sort((a, b) => {
    if (!a.date && !b.date) return a.route.localeCompare(b.route, "ru");
    if (!a.date) return 1;
    if (!b.date) return -1;
    return a.date.localeCompare(b.date) || a.route.localeCompare(b.route, "ru");
  });

  const currentTrip = trips.find(trip => trip.key === selectedTrip);

  function formatDate(value) {
    if (!value) return "Дата не указана";
    const parts = value.split("-");
    if (parts.length === 3) return `${parts[2]}.${parts[1]}.${parts[0]}`;
    return value;
  }

  return (
    <div className="profile-page admin-page">
      <header className="page-header admin-page-header">
        <span className="page-kicker">FESTO / ADMIN</span>
        <h1>Панель управления</h1>
        <p>Рейсы, пассажиры и проверка оплат</p>
      </header>

      <div className="admin-toolbar">
        <button type="button" className="admin-back-button" onClick={onBack}>
          <span aria-hidden="true">←</span> Профиль
        </button>
        <button
          type="button"
          className="admin-refresh-button"
          onClick={onRefresh}
          disabled={loading}
        >
          {loading ? "Загрузка…" : "↻ Обновить"}
        </button>
      </div>

      <nav className="admin-tabs" aria-label="Разделы админ-панели">
        <button
          type="button"
          className={section === "trips" ? "admin-tab active" : "admin-tab"}
          onClick={() => {
            setSection("trips");
            setSelectedTrip(null);
          }}
        >
          <span>Рейсы</span>
          <span className="admin-tab-count">{trips.length}</span>
        </button>
        <button
          type="button"
          className={section === "receipts" ? "admin-tab active" : "admin-tab"}
          onClick={() => {
            setSection("receipts");
            setSelectedTrip(null);
          }}
        >
          <span>Чеки</span>
          <span className="admin-tab-count">{pending.length}</span>
        </button>
        <button
          type="button"
          className={section === "schedule" ? "admin-tab active" : "admin-tab"}
          onClick={() => {
            setSection("schedule");
            setSelectedTrip(null);
          }}
        >
          <span>Расписание</span>
        </button>
        <button
          type="button"
          className={section === "services" ? "admin-tab active" : "admin-tab"}
          onClick={() => {
            setSection("services");
            setSelectedTrip(null);
          }}
        >
          <span>Услуги</span>
        </button>
      </nav>

      {error && <p className="admin-error" role="alert">{error}</p>}

      {section === "trips" && (
        <section className="admin-content">
          {currentTrip ? (
            <>
              <button
                type="button"
                className="admin-back-button admin-trip-back"
                onClick={() => setSelectedTrip(null)}
              >
                ← Все рейсы
              </button>

              <div className="admin-trip-heading">
                <span className="page-kicker">СПИСОК ПАССАЖИРОВ</span>
                <h2>{currentTrip.route}</h2>
                <p>{formatDate(currentTrip.date)}</p>
                <span className="admin-passenger-count">
                  {currentTrip.orders.length} пассажир(а/ов)
                </span>
              </div>

              {currentTrip.orders.map(order => (
                <article className="admin-passenger-card" key={order.id}>
                  <div className="admin-passenger-top">
                    <div>
                      <h3>{order.passport?.fullName || order.firstName || "Пассажир"}</h3>
                      <p>Место: {order.seat || "—"}</p>
                    </div>
                    <span className={`admin-status status-${order.status}`}>
                      {({
                        awaiting_payment: "Ожидает оплату",
                        payment_check: "Чек на проверке",
                        confirmed: "Подтверждён",
                        cancelled: "Отменён"
                      })[order.status] || order.status || "—"}
                    </span>
                  </div>

                  <div className="admin-passenger-details">
                    <div><span>Паспорт</span><strong>{order.passport?.passportNumber || "—"}</strong></div>
                    <div><span>Дата рождения</span><strong>{order.passport?.birthDate || "—"}</strong></div>
                    <div><span>Въезд во Вьетнам</span><strong>{formatDate(order.vietnamEntryDate)}</strong></div>
                    <div><span>Разрешение до</span><strong>{formatDate(order.permissionValidUntil)}</strong></div>
                    <div><span>Напиток</span><strong>{order.options?.drink || "Не выбран"}</strong></div>
                    <div><span>Перекус</span><strong>{order.options?.snack || "Не выбран"}</strong></div>
                    <div><span>Таблетки от укачивания</span><strong>{order.options?.motionSicknessTablets ? "Да" : "Нет"}</strong></div>
                    <div><span>Вода</span><strong>{order.options?.water || "Включена"}</strong></div>
                  </div>
                </article>
              ))}
            </>
          ) : (
            <>
              <div className="admin-section-heading">
                <h2>Ближайшие рейсы</h2>
                <p>Выберите дату, чтобы открыть список пассажиров.</p>
              </div>

              {!trips.length && !loading && (
                <div className="admin-empty">
                  <span aria-hidden="true">▤</span>
                  <strong>Пока нет рейсов</strong>
                  <p>Здесь появятся рейсы с бронированиями.</p>
                </div>
              )}

              {trips.map((trip, index) => (
                <button
                  type="button"
                  className="admin-trip-card"
                  key={trip.key}
                  onClick={() => setSelectedTrip(trip.key)}
                >
                  <span className="admin-trip-date">
                    {trip.date ? formatDate(trip.date) : "Без даты"}
                  </span>
                  <span className="admin-trip-main">
                    <strong>{trip.route}</strong>
                    <small>
                      {trip.orders.length} пассажир(а/ов)
                      {trip.orders.some(order => order.status === "payment_check")
                        ? " · Есть чек на проверке"
                        : ""}
                    </small>
                  </span>
                  <span className="admin-trip-arrow" aria-hidden="true">›</span>
                </button>
              ))}
            </>
          )}
        </section>
      )}

      {section === "services" && (
        <section className="admin-content admin-schedule">
          <div className="admin-section-heading">
            <h2>Доступность услуг</h2>
            <p>Отключённая услуга останется видна клиентам с пометкой «Временно недоступно».</p>
          </div>

          {serviceSettingsLoading ? (
            <div className="admin-empty"><strong>Загружаем настройки…</strong></div>
          ) : (
            <div className="admin-schedule-card">
              {[
                { key: "STAMP", title: "Штамп на 45 дней", price: "500 000 ₫ · 1 600 ₽" },
                { key: "VISA", title: "Виза + штамп на 90 дней", price: "900 000 ₫ · 3 000 ₽" }
              ].map(item => (
                <label key={item.key} className="admin-service-setting">
                  <span className="admin-service-setting-copy">
                    <strong>{item.title}</strong>
                    <small>{item.price}</small>
                    <small>{serviceSettings[item.key] ? "Доступна клиентам" : "Временно недоступна"}</small>
                  </span>
                  <input
                    type="checkbox"
                    checked={serviceSettings[item.key]}
                    disabled={serviceSettingsSaving}
                    onChange={event => saveAdminServiceSettings({
                      ...serviceSettings,
                      [item.key]: event.target.checked
                    })}
                    aria-label={`Доступность услуги: ${item.title}`}
                  />
                </label>
              ))}
            </div>
          )}
          {serviceSettingsMessage && <p className="admin-success" role="status">{serviceSettingsMessage}</p>}
          {serviceSettingsError && <p className="admin-error" role="alert">{serviceSettingsError}</p>}
        </section>
      )}

      {section === "schedule" && (
        <section className="admin-content admin-schedule">
          <div className="admin-section-heading">
            <h2>Расписание и места</h2>
            <p>Открывайте месяцы и даты, отключайте отдельные места. Изменения применяются после сохранения.</p>
          </div>

          {scheduleLoading ? (
            <div className="admin-empty"><strong>Загружаем расписание…</strong></div>
          ) : (
            <>
              <label className="admin-schedule-field">
                <span>Маршрут</span>
                <select value={scheduleRoute} onChange={event => setScheduleRoute(event.target.value)}>
                  {scheduleRoutes.map(item => <option key={item} value={item}>{item}</option>)}
                </select>
              </label>

              <div className="admin-schedule-card">
                <h3>Доступность месяца</h3>
                <label className="admin-schedule-field">
                  <span>Месяц</span>
                  <input type="month" value={scheduleMonth} onChange={event => setScheduleMonth(event.target.value)} />
                </label>
                <p>
                  Статус: {
                    schedule.months.find(item => item.route === scheduleRoute && item.month === scheduleMonth)?.open
                      ? "Открыт"
                      : "Закрыт"
                  }
                </p>
                <button type="button" className="admin-schedule-secondary" onClick={saveMonth}>
                  {schedule.months.some(item => item.route === scheduleRoute && item.month === scheduleMonth && item.open)
                    ? "Закрыть месяц"
                    : "Открыть месяц"}
                </button>
              </div>

              <div className="admin-schedule-card">
                <h3>Дата рейса</h3>
                <label className="admin-schedule-field">
                  <span>Дата</span>
                  <input type="date" value={scheduleDate} onChange={event => {
                    setScheduleDate(event.target.value);
                    setScheduleMonth(event.target.value.slice(0, 7));
                  }} />
                </label>
                <p>Добавление даты открывает рейс; повторное нажатие переключает его доступность.</p>
                <button type="button" className="admin-schedule-secondary" onClick={saveDeparture}>
                  {schedule.departures.some(item => item.route === scheduleRoute && item.date === dateToDisplay(scheduleDate) && item.open)
                    ? "Закрыть рейс на эту дату"
                    : "Добавить / открыть рейс"}
                </button>
              </div>

              <div className="admin-schedule-card">
                <h3>Места по датам</h3>
                <p>Нажмите на место, чтобы отключить его или снова сделать доступным. Занятые места по заказам отключить нельзя.</p>
                {schedule.departures
                  .filter(item => item.route === scheduleRoute)
                  .sort((a, b) => displayToDate(a.date).localeCompare(displayToDate(b.date)))
                  .map(item => (
                    <div className="admin-schedule-departure" key={`${item.route}-${item.date}`}>
                      <div className="admin-schedule-departure-head">
                        <strong>{item.date}</strong>
                        <span>{item.open ? "Рейс открыт" : "Рейс закрыт"}</span>
                      </div>
                      <div className="admin-schedule-seat-grid">
                        {Array.from({ length: 32 }, (_, i) => {
                          const seat = `${Math.floor(i / 2) + 1 + (i >= 16 ? 8 : 0)}${i % 2 === 0 ? "A" : "B"}`;
                          const disabled = (item.disabledSeats || []).includes(seat);
                          return (
                            <button
                              key={seat}
                              type="button"
                              className={disabled ? "admin-schedule-seat disabled" : "admin-schedule-seat"}
                              aria-pressed={disabled}
                              onClick={() => toggleSeatForDeparture(item.date, seat)}
                              title={disabled ? "Сделать доступным" : "Отключить место"}
                            >{seat}</button>
                          );
                        })}
                      </div>
                    </div>
                  ))}
                {!schedule.departures.some(item => item.route === scheduleRoute) && (
                  <p>Для этого маршрута пока нет дат. Добавьте рейс выше.</p>
                )}
              </div>

              {scheduleError && <p className="admin-error" role="alert">{scheduleError}</p>}
              {scheduleMessage && <p className="admin-schedule-success" role="status">{scheduleMessage}</p>}
              <button type="button" className="admin-schedule-save" onClick={persistSchedule} disabled={scheduleSaving}>
                {scheduleSaving ? "Сохраняем…" : "Сохранить расписание"}
              </button>
            </>
          )}
        </section>
      )}

      {section === "receipts" && (
        <section className="admin-content">
          <div className="admin-section-heading">
            <h2>Чеки на проверке</h2>
            <p>Подтверждайте оплату или отклоняйте чек с указанием причины.</p>
          </div>

          {!pending.length && !loading && (
            <div className="admin-empty">
              <span aria-hidden="true">✓</span>
              <strong>Нет чеков на проверке</strong>
              <p>Новые чеки появятся здесь после отправки клиентом.</p>
            </div>
          )}

          {pending.map(order => (
            <article className="admin-receipt-card" key={order.id}>
              <span className="page-kicker">ЗАКАЗ {order.id}</span>
              <h3>{order.passport?.fullName || order.firstName || "Пассажир"}</h3>
              <p>{order.route || "Маршрут не указан"}</p>
              <p>Дата поездки: {formatDate(order.travelDate)}</p>
              <p>Место: {order.seat || "—"}</p>
              <div className="admin-receipt-price">
                {order.priceVnd ?? "—"} ₫ <span>/</span> {order.priceRub ?? "—"} ₽
              </div>
              <div className="admin-receipt-file">
                <span>Файл чека</span>
                <strong>{order.receipt?.originalName || "Файл не указан"}</strong>
                <button
                  type="button"
                  className="admin-view-receipt-button"
                  onClick={() => openReceipt(order)}
                  disabled={receiptLoading}
                >
                  {receiptLoading ? "Загрузка…" : "Посмотреть чек"}
                </button>
              </div>
              <div className="admin-receipt-actions">
                <button
                  type="button"
                  className="admin-confirm-button"
                  onClick={() => onReview(order.id, "confirm")}
                >
                  Подтвердить
                </button>
                <button
                  type="button"
                  className="admin-reject-button"
                  onClick={() => onReview(order.id, "reject")}
                >
                  Отклонить
                </button>
              </div>
            </article>
          ))}
        </section>
      )}
      {receiptError && (
        <div className="admin-receipt-error" role="alert">
          <span>{receiptError}</span>
          <button type="button" onClick={() => setReceiptError("")}>Закрыть</button>
        </div>
      )}

      {receiptPreview && (
        <div
          className="admin-receipt-modal"
          role="dialog"
          aria-modal="true"
          aria-label="Просмотр чека"
          onClick={event => {
            if (event.target === event.currentTarget) closeReceipt();
          }}
        >
          <div className="admin-receipt-modal-panel">
            <div className="admin-receipt-modal-header">
              <div>
                <span className="page-kicker">ПРОВЕРКА ОПЛАТЫ</span>
                <h2>{receiptPreview.name}</h2>
              </div>
              <button
                type="button"
                className="admin-receipt-modal-close"
                onClick={closeReceipt}
                aria-label="Закрыть просмотр"
              >×</button>
            </div>
            {receiptPreview.type === "application/pdf" ? (
              <iframe
                className="admin-receipt-document"
                src={receiptPreview.url}
                title="Чек в формате PDF"
              />
            ) : receiptPreview.type.startsWith("image/") ? (
              <img
                className="admin-receipt-image"
                src={receiptPreview.url}
                alt="Загруженный чек"
              />
            ) : (
              <p>Этот формат файла нельзя показать в окне просмотра.</p>
            )}
          </div>
        </div>
      )}
    </div>
  );
}

function LegalPage({
  title,
  url,
  onBack
}) {
  const [text, setText] = useState(
    "Загрузка..."
  );

  useEffect(() => {

    fetch(url)
      .then((res) => res.text())
      .then(setText)
      .catch(() =>
        setText("Не удалось загрузить документ.")
      );

  }, [url]);

  return (
    <div>

      <BackButton onClick={onBack} />

      <h1>
        {title}
      </h1>

      <div className="legal-text">
        {text}
      </div>

    </div>
  );
}

/* =========================
   BOTTOM BAR
========================= */

function BottomBar({
  screen,
  setScreen
}) {
  return (
    <nav className="bottom-bar">
      <span
        className={`bottom-bar-indicator ${
          screen === "bookings" ? "is-bookings" :
          screen === "profile" ? "is-profile" : "is-home"
        }`}
        aria-hidden="true"
      />

      <button
        className={
          screen === "home"
            ? "nav-active"
            : ""
        }
        onClick={() =>
          setScreen("home")
        }
      >
        <span className="nav-icon" aria-hidden="true">
          <svg viewBox="0 0 24 24" fill="none">
            <path d="M3.5 10.8 12 3.8l8.5 7" />
            <path d="M5.5 9.8v9.7h13V9.8" />
            <path d="M9.5 19.5v-5h5v5" />
          </svg>
        </span>
        <small>Главная</small>
      </button>

      <button
        className={
          screen === "bookings"
            ? "nav-active"
            : ""
        }
        onClick={() =>
          setScreen("bookings")
        }
      >
        <span className="nav-icon" aria-hidden="true">
          <svg viewBox="0 0 24 24" fill="none">
            <path d="M5 7.5h14v11H5z" />
            <path d="M8 7.5V5h8v2.5" />
            <path d="M8 12h8" />
            <path d="M8 15.5h5" />
          </svg>
        </span>
        <small>Бронирования</small>
      </button>

      <button
        className={
          screen === "profile"
            ? "nav-active"
            : ""
        }
        onClick={() =>
          setScreen("profile")
        }
      >
        <span className="nav-icon" aria-hidden="true">
          <svg viewBox="0 0 24 24" fill="none">
            <circle cx="12" cy="8" r="3.2" />
            <path d="M5.5 20c.8-3.3 3.1-5.2 6.5-5.2s5.7 1.9 6.5 5.2" />
          </svg>
        </span>
        <small>Профиль</small>
      </button>

    </nav>
  );
}

/* =========================
   HELPERS
========================= */

function BackButton({ onClick }) {
  return (
    <button
      className="back-button"
      onClick={onClick}
    >
      <span className="back-arrow" aria-hidden="true">
        <svg viewBox="0 0 24 24" fill="none">
          <path
            d="M19 12H5M11 6L5 12L11 18"
            stroke="currentColor"
            strokeWidth="1.8"
            strokeLinecap="round"
            strokeLinejoin="round"
          />
        </svg>
      </span>
    </button>
  );
}

createRoot(
  document.getElementById("root")
).render(
  <App />
);
