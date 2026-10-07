import React, { useEffect, useState } from "react";
import { createRoot } from "react-dom/client";
import "./styles.css";

const tg = window.Telegram?.WebApp;

if (tg) {
  tg.ready();
  tg.expand();
}

const API = "/api";

const ROUTES = {
  LAOS: "Нячанг — Лаос",
  CAMBODIA: "Нячанг — Камбоджа"
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
  const [service, setService] = useState(null);

  const [passport, setPassport] = useState({
    fullName: "",
    birthDate: "",
    passportNumber: ""
  });

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
    if (!tg?.initData) {
      return;
    }

    const telegramUser = tg?.initDataUnsafe?.user;

    const response = await fetch(`${API}/auth`, {
      method: "POST",
      headers: {
        "Content-Type": "application/json"
      },
      body: JSON.stringify({
        initData: tg.initData
      })
    });

    const data = await response.json();

    if (data.success) {
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

      setUser(mergedUser);
      loadOrders(mergedUser.telegramId);
    }
  } catch (error) {
    console.error("Telegram authentication error:", error);
  }
}

/* =========================
   HOME
========================= */

function Home({ onRoute, user }) {
  return (
    <div>

      <header className="top-header">

        <div>
          <div className="eyebrow">
            FESTO
          </div>

          <h1>
            Визаран
          </h1>

          <p>
            Быстрое бронирование поездки
            из Нячанга
          </p>
        </div>

        <div className="telegram-avatar">
          {user?.firstName?.[0] || "F"}
        </div>

      </header>

      <section className="hero">

        <div className="hero-glow"></div>

        <span className="hero-label">
          ПОЕЗДКИ ИЗ НЯЧАНГА
        </span>

        <h2>
          Продлите пребывание
          <br />
          без лишних хлопот
        </h2>

        <p>
          Выберите направление,
          услугу и место в автобусе.
        </p>

      </section>

      <div className="section-title">
        Направления
      </div>

      <RouteCard
        title="Нячанг — Лаос"
        description="Продление штампа или виза на 90 дней"
        onClick={() => onRoute(ROUTES.LAOS)}
      />

      <RouteCard
        title="Нячанг — Камбоджа"
        description="Продление штампа или виза на 90 дней"
        onClick={() => onRoute(ROUTES.CAMBODIA)}
      />

    </div>
  );
}

function RouteCard({
  title,
  description,
  onClick
}) {
  return (
    <button
      className="route-card"
      onClick={onClick}
    >

      <div>
        <h3>{title}</h3>
        <p>{description}</p>
      </div>

      <span className="arrow">
        →
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

      <span className="arrow">
        →
      </span>

    </button>
  );
}

/* =========================
   PASSPORT
========================= */

function Passport({
  passport,
  setPassport,
  consent,
  setConsent,
  onBack,
  onPrivacy,
  onContinue,
  loading
}) {
  return (
    <div>

      <BackButton onClick={onBack} />

      <h1>
        Данные пассажира
      </h1>

      <p className="subtitle">
        Укажите данные загранпаспорта
      </p>

      <div className="form">

        <label>
          ФИО

          <input
            value={passport.fullName}
            onChange={(e) =>
              setPassport({
                ...passport,
                fullName: e.target.value
              })
            }
            placeholder="Иванов Иван Иванович"
          />
        </label>

        <label>
          Дата рождения

          <input
            type="date"
            value={passport.birthDate}
            onChange={(e) =>
              setPassport({
                ...passport,
                birthDate: e.target.value
              })
            }
          />
        </label>

        <label>
          Номер загранпаспорта

          <input
            value={passport.passportNumber}
            onChange={(e) =>
              setPassport({
                ...passport,
                passportNumber: e.target.value
              })
            }
            placeholder="12 3456789"
          />
        </label>

      </div>

      <label className="consent">

        <input
          type="checkbox"
          checked={consent}
          onChange={(e) =>
            setConsent(e.target.checked)
          }
        />

        <span>
          Согласен с{" "}

          <button
            className="link-button"
            onClick={(e) => {
              e.preventDefault();
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
  );
}

/* =========================
   SEATS
========================= */

function SeatSelection({
  selectedSeat,
  setSelectedSeat,
  onBack,
  onContinue,
  loading
}) {
  const seats = [];

  for (let i = 1; i <= 18; i++) {
    seats.push(`${i}А`);
    seats.push(`${i}Б`);
  }

  seats.push("18В");

  return (
    <div>

      <BackButton onClick={onBack} />

      <h1>
        Выберите место
      </h1>

      <p className="subtitle">
        35-местный автобус
      </p>

      <div className="bus">

        <div className="bus-header">
          ВОДИТЕЛЬ
        </div>

        <div className="bus-floor">

          {seats.map((seat, index) => {

            const taken =
              index === 2 ||
              index === 11 ||
              index === 24;

            return (
              <button
                key={seat}
                disabled={taken}
                className={`
                  seat
                  ${selectedSeat === seat ? "selected" : ""}
                  ${taken ? "taken" : ""}
                `}
                onClick={() =>
                  setSelectedSeat(seat)
                }
              >
                {seat}
              </button>
            );
          })}

        </div>

      </div>

      <div className="seat-legend">

        <span>
          <i className="free"></i>
          Свободно
        </span>

        <span>
          <i className="selected-dot"></i>
          Выбрано
        </span>

        <span>
          <i className="taken-dot"></i>
          Занято
        </span>

      </div>

      <button
        className="primary-button"
        disabled={!selectedSeat || loading}
        onClick={onContinue}
      >
        {loading
          ? "Создаём бронирование..."
          : `Продолжить ${selectedSeat || ""}`}
      </button>

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
  return (
    <div>

      <h1>
        Бронирования
      </h1>

      {orders.length === 0 ? (
        <div className="empty">
          <div className="empty-icon">
            ✦
          </div>

          <h3>
            Пока нет бронирований
          </h3>

          <p>
            Здесь появятся ваши поездки.
          </p>
        </div>
      ) : (
        orders.map((order) => (
          <div
            className="booking-card"
            key={order.id}
          >

            <div className="booking-top">

              <strong>
                {order.route}
              </strong>

              <span
                className={`status ${order.status}`}
              >
                {getStatus(order.status)}
              </span>

            </div>

            <p>
              {order.service}
            </p>

            <div className="booking-info">
              Место {order.seat}
            </div>

            <div className="booking-price">
              {order.priceRub.toLocaleString("ru-RU")} ₽
            </div>

          </div>
        ))
      )}

    </div>
  );
}

function getStatus(status) {
  const statuses = {
    awaiting_payment: "Ожидает оплаты",
    payment_check: "Проверка оплаты",
    confirmed: "Подтверждено"
  };

  return statuses[status] || status;
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
    <div>

      <h1>
        Профиль
      </h1>

      <div className="profile-card">

        <div className="profile-avatar">
          {user?.firstName?.[0] || "U"}
        </div>

        <div>

          <strong>
            {user?.firstName || "Пользователь"}
          </strong>

          <span>
            {user?.username
              ? `@${user.username}`
              : "Username не указан"}
          </span>

        </div>

      </div>

      <div className="profile-section">

        <h3>
          Telegram
        </h3>

        <div className="profile-row">
          <span>
            Ник
          </span>

          <strong>
            {user?.username
              ? `@${user.username}`
              : "—"}
          </strong>
        </div>

        <div className="profile-row">
          <span>
            ID
          </span>

          <strong>
            {user?.telegramId || "—"}
          </strong>
        </div>

      </div>

      <div className="profile-section">

        <h3>
          Телефон
        </h3>

        <div className="profile-row">

          <span>
            Номер
          </span>

          <strong>
            {user?.phone || "Не указан"}
          </strong>

        </div>

      </div>

      <div className="profile-section">

        <h3>
          Паспортные данные
        </h3>

        {user?.passport ? (
          <>
            <div className="profile-row">
              <span>
                ФИО
              </span>

              <strong>
                {user.passport.fullName}
              </strong>
            </div>

            <div className="profile-row">
              <span>
                Дата рождения
              </span>

              <strong>
                {user.passport.birthDate}
              </strong>
            </div>

            <div className="profile-row">
              <span>
                Загранпаспорт
              </span>

              <strong>
                {user.passport.passportNumber}
              </strong>
            </div>
          </>
        ) : (
          <p className="muted">
            Паспортные данные появятся
            после первого бронирования.
          </p>
        )}

      </div>

      <div className="legal-links">

        <button onClick={onPrivacy}>
          Политика обработки
          персональных данных
        </button>

        <button onClick={onTerms}>
          Условия сервиса
        </button>

      </div>

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
        <span>⌂</span>
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
        <span>▣</span>
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
        <span>◯</span>
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
      ← Назад
    </button>
  );
}

createRoot(
  document.getElementById("root")
).render(
  <App />
);