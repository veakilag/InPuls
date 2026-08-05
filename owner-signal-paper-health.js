(() => {
  "use strict";

  const HEALTH_KEY = "inpuls-signal-lab-collector-health-v1";
  const INPLAY_KEY = "inpuls-inplay-order-v1";
  const LIVE_AGE_MS = 8_000;
  const POLL_MS = 2_000;

  const readJson = (key, fallback = null) => {
    try {
      const value = JSON.parse(localStorage.getItem(key) || "null");
      return value ?? fallback;
    } catch {
      return fallback;
    }
  };

  const finite = (value) => {
    const number = Number(value);
    return Number.isFinite(number) ? number : null;
  };

  const formatTime = (value) => {
    const number = finite(value);
    if (number === null) return "—";
    return new Intl.DateTimeFormat("ru-RU", {
      hour: "2-digit",
      minute: "2-digit",
      second: "2-digit",
    }).format(new Date(number));
  };

  const createCard = (label, id) => {
    const article = document.createElement("article");
    const span = document.createElement("span");
    const strong = document.createElement("strong");
    span.textContent = label;
    strong.id = id;
    strong.textContent = "—";
    article.append(span, strong);
    return article;
  };

  const diagnostics = document.querySelector(".paper-diagnostics");
  if (!diagnostics) return;

  const health = document.createElement("section");
  health.className = "paper-summary";
  health.setAttribute("aria-label", "Состояние живого сборщика");
  health.append(
    createCard("Рыночный поток", "collector-live"),
    createCard("Последний пакет", "collector-market-at"),
    createCard("Монет проверяется", "collector-symbols"),
    createCard("Проверок рынка", "collector-checks"),
    createCard("Событий Signal Lab", "collector-events"),
    createCard("Наблюдений", "collector-observations"),
    createCard("INPLAY сейчас", "collector-inplay"),
    createCard("Хранилище", "collector-storage"),
    createCard("Вкладка сборщика", "collector-visibility"),
  );
  diagnostics.before(health);

  const elements = {
    shortStatus: document.querySelector("#collector-short-status"),
    live: document.querySelector("#collector-live"),
    marketAt: document.querySelector("#collector-market-at"),
    symbols: document.querySelector("#collector-symbols"),
    checks: document.querySelector("#collector-checks"),
    events: document.querySelector("#collector-events"),
    observations: document.querySelector("#collector-observations"),
    inplay: document.querySelector("#collector-inplay"),
    storage: document.querySelector("#collector-storage"),
    visibility: document.querySelector("#collector-visibility"),
  };

  function setState(element, text, state = "neutral") {
    if (!element) return;
    element.textContent = text;
    element.classList.toggle("paper-positive", state === "positive");
    element.classList.toggle("paper-negative", state === "negative");
  }

  function render() {
    const snapshot = readJson(HEALTH_KEY, null);
    const inplay = readJson(INPLAY_KEY, []);
    const now = Date.now();
    const lastMarketAt = finite(snapshot?.lastMarketAt);
    const marketAge = lastMarketAt === null ? Infinity : Math.max(0, now - lastMarketAt);
    const checks = Math.max(0, Math.floor(finite(snapshot?.checks) ?? 0));
    const symbols = Math.max(0, Math.floor(finite(snapshot?.symbols) ?? 0));
    const hasError = Boolean(snapshot?.lastError) || snapshot?.storageState === "error";
    const isLive = !hasError && checks > 0 && symbols > 0 && marketAge <= LIVE_AGE_MS;
    const isStarting = !snapshot || checks === 0 || lastMarketAt === null;

    if (isLive) {
      setState(elements.live, "BINANCE LIVE", "positive");
      setState(elements.shortStatus, `Сборщик LIVE · ${symbols} монет`, "positive");
    } else if (hasError) {
      setState(elements.live, "ОШИБКА", "negative");
      setState(elements.shortStatus, "Сборщик: ошибка", "negative");
    } else if (isStarting) {
      setState(elements.live, "ЗАПУСКАЕТСЯ");
      setState(elements.shortStatus, "Сборщик запускается…");
    } else {
      setState(elements.live, "ПОТОК ЗАСТЫЛ", "negative");
      setState(elements.shortStatus, "Сборщик: нет свежего рынка", "negative");
    }

    setState(elements.marketAt, formatTime(lastMarketAt));
    setState(elements.symbols, String(symbols));
    setState(elements.checks, String(checks));
    setState(elements.events, String(Math.max(0, Math.floor(finite(snapshot?.signalEvents) ?? 0))));
    setState(elements.observations, String(Math.max(0, Math.floor(finite(snapshot?.observations) ?? 0))));
    setState(elements.inplay, String(Array.isArray(inplay) ? inplay.length : 0));
    setState(
      elements.storage,
      snapshot?.storageState === "available" ? "ДОСТУПНО" : String(snapshot?.storageState ?? "—").toUpperCase(),
      snapshot?.storageState === "available" ? "positive" : hasError ? "negative" : "neutral",
    );
    setState(elements.visibility, String(snapshot?.visibilityState ?? "—").toUpperCase());
  }

  render();
  window.setInterval(render, POLL_MS);
})();
