import React, { useEffect, useState } from "react";
import { createRoot } from "react-dom/client";
import "./styles.css";

const tg = window.Telegram?.WebApp;

if (tg) {
  tg.ready();
  tg.expand();
}

const API = "/api";

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
  const [screen, setScreen] = useState("home");

  const [user, setUser] = useState(null);

  const [route, setRoute] = useState(null);
  const [selectedDate, setSelectedDate] = useState(null);
  const [service, setService] = useState(null);

  const [passengers, setPassengers] = useState([
    {
      fullName: "",
      birthDate: "",
      passportNumber: ""
    }
  ]);

  const [consent, setConsent] = useState(false);

  const [selectedSeat, setSelectedSeat] = useState(null);

  const [order, setOrder] = useState(null);

  const [orders, setOrders] = useState([]);

  const [receipt, setReceipt] = useState(null);

  const [timeLeft, setTimeLeft] = useState(1200);

  const [loading, setLoading] = useState(false);

  useEffect(() => {
    authenticate();
  }, []);

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

      const mergedUser = {
        ...data.user,
        telegramId:
          telegramUser?.id ||
          data.user.telegramId,

        username:
          telegramUser?.username ||
          data.user.username ||
          "",

        firstName:
          telegramUser?.first_name ||
          data.user.firstName ||
          "",

        lastName:
          telegramUser?.last_name ||
          data.user.lastName ||
          "",

        photoUrl:
          telegramUser?.photo_url ||
          data.user.photoUrl ||
          ""
      };

      console.log("AUTH SUCCESS:", mergedUser);

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
      const response = await fetch(
        `${API}/orders/user/${telegramId}`
      );

      const data = await response.json();

      if (data.success) {
        setOrders(data.orders);
      }
    } catch {}
  }

  function openRoute(routeName) {
    setRoute(routeName);
    setSelectedDate(null);
    setScreen("service");
  }

  function openService(serviceType) {
    setService(SERVICES[serviceType]);
    setSelectedDate(null);
    setScreen("passport");
  }

  function openPrivacy() {
    setScreen("privacy");
  }

  function openTerms() {
    setScreen("terms");
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

    setLoading(true);

    try {
      const response = await fetch(
        `${API}/profile/passport`,
        {
          method: "POST",
          headers: {
            "Content-Type": "application/json"
          },
          body: JSON.stringify({
            telegramId: user.telegramId,
            passengers,
            consent: true
          })
        }
      );

      const data = await response.json();

      if (!data.success) {
        throw new Error(data.error);
      }

      setScreen("calendar");

    } catch (error) {
      alert(error.message || "Не удалось сохранить данные");
    } finally {
      setLoading(false);
    }
  }

  async function createBooking() {
    if (!selectedSeat) {
      alert("Выберите место");
      return;
    }

    setLoading(true);

    try {
      const response = await fetch(`${API}/orders`, {
        method: "POST",
        headers: {
          "Content-Type": "application/json"
        },
        body: JSON.stringify({
          telegramId: user.telegramId,
          route,
          service: service.title,
          priceRub: service.priceRub,
          priceVnd: service.priceVnd,
          seat: selectedSeat
        })
      });

      const data = await response.json();

      if (!data.success) {
        throw new Error(data.error);
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

    setLoading(true);

    try {
      const response = await fetch(
        `${API}/orders/${order.id}/receipt`,
        {
          method: "POST",
          body: formData
        }
      );

      const data = await response.json();

      if (!data.success) {
        throw new Error(data.error);
      }

      alert(
        "Подтверждение отправлено. Ожидайте проверки оплаты."
      );

      loadOrders(user.telegramId);

      setScreen("bookings");
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
            onContinue={() => setScreen("seats")}
          />
        )}

        {screen === "passport" && (
          <Passport
            passengers={passengers}
            setPassengers={setPassengers}
            consent={consent}
            setConsent={setConsent}
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
            selectedSeat={selectedSeat}
            setSelectedSeat={setSelectedSeat}
            onBack={() => setScreen("passport")}
            onContinue={createBooking}
            loading={loading}
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

        {screen === "bookings" && (
          <Bookings
            orders={orders}
          />
        )}

        {screen === "profile" && (
          <Profile
            user={user}
            onPrivacy={openPrivacy}
            onTerms={openTerms}
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

    </div>
  );
}

/* =========================
   HOME
========================= */

function Home({ onRoute, user }) {
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
            <img
              src={user.photoUrl}
              alt=""
              className="telegram-avatar-image"
            />
          ) : (
            user?.firstName?.[0] || "F"
          )}
        </div>
      </header>

      <section className="hero">
        <div className="hero-glow"></div>

        <div className="hero-content">
          <span className="hero-label">ВИЗАРАН ИЗ НЯЧАНГА/ДАНАНГА</span>

          <h2>
            Быстрое
            <br />
            бронирование поездки
          </h2>

          <p>
            Выберите направление и подходящий
            вариант пребывания.
          </p>
        </div>

      </section>

      <div className="section-heading">
        <div>
          <span>01</span>
          <h2>Направления</h2>
        </div>
        <p>Выберите страну</p>
      </div>

      <div className="routes-list">

        <RouteCard
          title="Лаос"
          route="Нячанг — Лаос"
          description="Штамп 45 дней или виза на 90 дней"
          accent="laos"
          onClick={() => onRoute(ROUTES.LAOS)}
        />

        <RouteCard
          title="Камбоджа"
          route="Нячанг — Камбоджа"
          description="Штамп 45 дней или виза на 90 дней"
          accent="cambodia"
          onClick={() => onRoute(ROUTES.CAMBODIA)}
        />

        <RouteCard
          title="Лаос"
          route="Дананг — Лаос"
          description="Штамп 45 дней или виза на 90 дней"
          accent="laos"
          onClick={() => onRoute(ROUTES.DANANG_LAOS)}
        />

      </div>

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
  onBack,
  onSelect
}) {
  const cambodia =
    route === ROUTES.CAMBODIA;

  return (
    <div>

      <BackButton onClick={onBack} />

      <h1>{route}</h1>

      <p className="subtitle">
        Выберите необходимую услугу
      </p>

      <ServiceCard
        title="Штамп на 45 дней"
        price="500 000 ₫"
        rub="1 600 ₽"
        onClick={() => onSelect("STAMP")}
      />

      <ServiceCard
        title="Виза + штамп на 90 дней"
        price="900 000 ₫"
        rub="3 000 ₽"
        onClick={() => onSelect("VISA")}
      />

      <div className="recommendation">

        <strong>
          Рекомендации
        </strong>

        <p>
          • Возьмите таблетки от укачивания —
          маршрут проходит через серпантин.
        </p>

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
  onClick
}) {
  return (
    <button
      className="service-card"
      onClick={onClick}
    >

      <div>

        <h3>{title}</h3>

        <span className="price-vnd">
          {price}
        </span>

        <span className="price-rub">
          {rub}
        </span>

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
   PASSPORT
========================= */

function Passport({
  passengers,
  setPassengers,
  consent,
  setConsent,
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
  const dates = [
    { day: "01", available: false },
    { day: "02", available: false },
    { day: "03", available: false },
    { day: "04", available: false },
    { day: "05", available: false },
    { day: "06", available: false },
    { day: "07", available: false },
    { day: "08", available: true },
    { day: "09", available: true },
    { day: "10", available: false },
    { day: "11", available: true },
    { day: "12", available: false },
    { day: "13", available: true },
    { day: "14", available: true },
    { day: "15", available: false },
    { day: "16", available: true },
    { day: "17", available: true },
    { day: "18", available: false },
    { day: "19", available: true },
    { day: "20", available: false },
    { day: "21", available: false },
    { day: "22", available: false },
    { day: "23", available: false },
    { day: "24", available: false },
    { day: "25", available: false },
    { day: "26", available: false },
    { day: "27", available: false },
    { day: "28", available: false },
    { day: "29", available: false },
    { day: "30", available: false },
    { day: "31", available: false }
  ];

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

        <div className="vizaran-calendar-heading">
          <span className="vizaran-calendar-kicker">
            ВЫБЕРИТЕ ДАТУ
          </span>

          <h1>{route || "Выбранный рейс"}</h1>

          <p>
            Выберите доступную дату поездки
          </p>
        </div>

      </div>

      <div className="vizaran-calendar-card">

        <div className="vizaran-calendar-month">
          <button type="button" aria-label="Предыдущий месяц">‹</button>

          <div>
            <strong>ОКТЯБРЬ 2026</strong>
            <span>Доступные даты рейса</span>
          </div>

          <button type="button" aria-label="Следующий месяц">›</button>
        </div>

        <div className="vizaran-calendar-week">
          {["ПН", "ВТ", "СР", "ЧТ", "ПТ", "СБ", "ВС"].map(day => (
            <span key={day}>{day}</span>
          ))}
        </div>

        <div className="vizaran-calendar-grid">
          {dates.map(date => {
            const value = `${date.day}.10.2026`;
            const selected = selectedDate === value;

            return (
              <button
                key={value}
                type="button"
                disabled={!date.available}
                className={[
                  "vizaran-calendar-day",
                  date.available ? "available" : "unavailable",
                  selected ? "selected" : ""
                ].join(" ")}
                onClick={() => date.available && setSelectedDate(value)}
              >
                <strong>{date.day}</strong>
              </button>
            );
          })}
        </div>

        <div className="vizaran-calendar-legend">
          <div>
            <span className="calendar-dot available-dot"></span>
            <span>Рейс доступен</span>
          </div>

          <div>
            <span className="calendar-dot unavailable-dot"></span>
            <span>Нет рейса</span>
          </div>

          <div>
            <span className="calendar-dot selected-dot"></span>
            <span>Выбрано</span>
          </div>
        </div>

      </div>

      <div className="vizaran-calendar-bottom">
        <button
          type="button"
          className="vizaran-calendar-submit"
          disabled={!selectedDate}
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

  const takenSeats = new Set([
    "2B",
    "6A",
    "11B",
    "15A"
  ]);

  function renderSeat(seat, type) {
    const taken = takenSeats.has(seat);

    return (
      <button
        key={seat}
        type="button"
        disabled={taken}
        className={[
          "v-seat",
          type === "upper" ? "v-seat-upper" : "v-seat-lower",
          selectedSeat === seat ? "v-seat-selected" : "",
          taken ? "v-seat-taken" : ""
        ].join(" ")}
        onClick={() => setSelectedSeat(seat)}
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
          <p>Выберите место в автобусе</p>
        </div>

        <div className="vizaran-step">
          <span>01</span>
          <small>МЕСТО</small>
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

              <div className="vizaran-seat-grid">
                {seats.map((row, index) => (
                  <React.Fragment key={row.upperLeft}>
                    {renderSeat(row.upperLeft, "upper")}
                    {renderSeat(row.lowerLeft, "lower")}
                    {renderSeat(row.upperRight, "upper")}
                    {renderSeat(row.lowerRight, "lower")}

                    {index === 7 && (
                      <div className="vizaran-bus-service">
                        <span>WC</span>
                        <small>ТУАЛЕТ</small>
                      </div>
                    )}
                  </React.Fragment>
                ))}
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
          disabled={!selectedSeat || loading}
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

        <span>
          Заказ
        </span>

        <strong>
          {order.id}
        </strong>

        <span>
          {order.route}
        </span>

        <span>
          {order.service}
        </span>

        <span>
          Место {order.seat}
        </span>

        <strong>
          {order.priceRub.toLocaleString("ru-RU")} ₽
        </strong>

      </div>

      <div className="payment-methods">

        <div className="payment-method active">
          <div>
            <strong>
              СБП / карта РФ
            </strong>

            <span>
              Доступно
            </span>
          </div>

          <span>
            ✓
          </span>
        </div>

        <div className="payment-method disabled">
          Visa / Mastercard
          <small>Скоро</small>
        </div>

        <div className="payment-method disabled">
          VietQR
          <small>Скоро</small>
        </div>

        <div className="payment-method disabled">
          Crypto
          <small>Скоро</small>
        </div>

      </div>

      <div className="bank-card">

        <span>
          Переведите
        </span>

        <strong>
          {order.priceRub.toLocaleString("ru-RU")} ₽
        </strong>

        <div className="recipient">
          <span>
            Получатель
          </span>

          <strong>
            Ирода К.
          </strong>
        </div>

        <div className="phone-row">

          <strong>
            +7 965 431 72 07
          </strong>

          <button
            onClick={copyPhone}
            className="copy-button"
          >
            {copied
              ? "Скопировано"
              : "Копировать"}
          </button>

        </div>

        <span>
          Сбер Банк
        </span>

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

function Bookings({ orders }) {
  const visaRunOrders = orders.filter((order) => {
    const route = String(order.route || "").toLowerCase();
    return route.includes("лаос") || route.includes("камбод");
  });

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

  return (
    <div className="bookings-page">

      <header className="page-header">
        <span className="page-kicker">FESTO / ПОЕЗДКИ</span>
        <h1>Бронирования</h1>
        <p>
          Ваши забронированные поездки
        </p>
      </header>

      {visaRunOrders.length === 0 ? (
        <div className="empty-bookings">

          <div className="empty-mark">
            <span>✦</span>
          </div>

          <div>
            <h3>Пока нет поездок</h3>
            <p>
              После бронирования поездка
              появится здесь.
            </p>
          </div>

        </div>
      ) : (
        <div className="bookings-list">

          {visaRunOrders.map((order) => {
            const validity = formatValidity(order);

            return (
              <div
                className="booking-card"
                key={order.id}
              >

                <div className="booking-route-line">
                  <div className="booking-route-dot"></div>

                  <div>
                    <span>ВИЗАРАН</span>
                    <h3>{order.route}</h3>
                  </div>
                </div>

                <div className="booking-details">

                  <div>
                    <span>Услуга</span>
                    <strong>{order.service}</strong>
                  </div>

                  <div>
                    <span>Место</span>
                    <strong>{order.seat || "—"}</strong>
                  </div>

                  {validity && (
                    <div className="booking-validity">
                      <span>Действует до</span>
                      <strong>{validity}</strong>
                    </div>
                  )}

                </div>

                <div className="booking-bottom">
                  <span>Стоимость поездки</span>
                  <strong>
                    {order.priceRub?.toLocaleString("ru-RU")} ₽
                  </strong>
                </div>

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