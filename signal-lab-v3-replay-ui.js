const TIMEFRAMES = Object.freeze({
  "1s": 1_000,
  "5s": 5_000,
  "15s": 15_000,
  "1m": 60_000,
});

const finite = (value) => {
  const number = Number(value);
  return Number.isFinite(number) ? number : null;
};

function formatPrice(value) {
  const number = finite(value);
  if (number === null) return "—";
  const digits = number >= 1_000 ? 2 : number >= 1 ? 4 : 7;
  return number.toLocaleString("en-US", { maximumFractionDigits: digits });
}

function formatSigned(value, digits = 2) {
  const number = finite(value);
  if (number === null) return "—";
  return `${number > 0 ? "+" : ""}${number.toFixed(digits)}%`;
}

function formatClock(timestamp) {
  const value = finite(timestamp);
  if (value === null) return "—";
  return new Intl.DateTimeFormat("ru-RU", {
    hour: "2-digit",
    minute: "2-digit",
    second: "2-digit",
  }).format(new Date(value));
}

export function aggregatePricePoints(points, intervalMs, from = -Infinity, to = Infinity) {
  const buckets = new Map();
  for (const point of Array.isArray(points) ? points : []) {
    const at = finite(point?.at);
    const price = finite(point?.price);
    if (at === null || price === null || price <= 0 || at < from || at > to) continue;
    const time = Math.floor(at / intervalMs) * intervalMs;
    const candle = buckets.get(time);
    if (!candle) {
      buckets.set(time, { time, open: price, high: price, low: price, close: price });
    } else {
      candle.high = Math.max(candle.high, price);
      candle.low = Math.min(candle.low, price);
      candle.close = price;
    }
  }
  return [...buckets.values()].sort((left, right) => left.time - right.time);
}

function minuteCandles(pack, from, to) {
  return (Array.isArray(pack?.minuteCandles) ? pack.minuteCandles : [])
    .map((row) => ({
      time: finite(row?.time),
      open: finite(row?.open),
      high: finite(row?.high),
      low: finite(row?.low),
      close: finite(row?.close),
    }))
    .filter((row) => [row.time, row.open, row.high, row.low, row.close]
      .every((value) => value !== null && value > 0))
    .filter((row) => row.time >= from - 60_000 && row.time <= to)
    .sort((left, right) => left.time - right.time);
}

function candlesFor(pack, intervalMs, from, to) {
  if (intervalMs === 60_000) {
    const rows = minuteCandles(pack, from, to);
    if (rows.length >= 2) return rows;
  }
  return aggregatePricePoints(pack?.pricePoints, intervalMs, from, to);
}

function resizeCanvas(canvas) {
  const ratio = Math.max(1, Math.min(2, window.devicePixelRatio || 1));
  const width = Math.max(320, Math.round(canvas.clientWidth || 680));
  const height = Math.max(190, Math.round(canvas.clientHeight || 260));
  const pixelWidth = Math.round(width * ratio);
  const pixelHeight = Math.round(height * ratio);
  if (canvas.width !== pixelWidth || canvas.height !== pixelHeight) {
    canvas.width = pixelWidth;
    canvas.height = pixelHeight;
  }
  const context = canvas.getContext("2d");
  context.setTransform(ratio, 0, 0, ratio, 0, 0);
  return { context, width, height };
}

function drawEmpty(context, width, height, text) {
  context.clearRect(0, 0, width, height);
  context.fillStyle = "#0a1118";
  context.fillRect(0, 0, width, height);
  context.fillStyle = "#8fa8ba";
  context.font = "13px Inter, system-ui, sans-serif";
  context.textAlign = "center";
  context.fillText(text, width / 2, height / 2);
}

export function drawEvidenceChart(canvas, pack, {
  intervalMs = 5_000,
  selectedAt = pack?.window?.eventAt,
} = {}) {
  const { context, width, height } = resizeCanvas(canvas);
  const from = finite(pack?.window?.startAt) ?? Date.now() - 180_000;
  const latestPointAt = finite(pack?.pricePoints?.at?.(-1)?.at) ?? finite(pack?.window?.updatedAt) ?? Date.now();
  const to = Math.max(from + intervalMs, latestPointAt);
  const candles = candlesFor(pack, intervalMs, from, to);
  if (!candles.length) {
    drawEmpty(context, width, height, "Секундный контекст ещё собирается");
    return;
  }

  const padding = { left: 10, right: 72, top: 12, bottom: 24 };
  const chartWidth = width - padding.left - padding.right;
  const chartHeight = height - padding.top - padding.bottom;
  const low = Math.min(...candles.map((row) => row.low));
  const high = Math.max(...candles.map((row) => row.high));
  const range = Math.max(high - low, high * 0.0002, Number.EPSILON);
  const xFor = (time) => padding.left + ((time - from) / Math.max(1, to - from)) * chartWidth;
  const yFor = (price) => padding.top + (1 - (price - low) / range) * chartHeight;

  context.clearRect(0, 0, width, height);
  context.fillStyle = "#0a1118";
  context.fillRect(0, 0, width, height);
  context.strokeStyle = "rgba(143,168,186,0.12)";
  context.lineWidth = 1;
  context.font = "11px Inter, system-ui, sans-serif";
  context.textAlign = "left";
  context.fillStyle = "#7892a5";
  for (let index = 0; index <= 4; index += 1) {
    const y = padding.top + chartHeight * index / 4;
    context.beginPath();
    context.moveTo(padding.left, y);
    context.lineTo(width - padding.right + 8, y);
    context.stroke();
    const price = high - range * index / 4;
    context.fillText(formatPrice(price), width - padding.right + 12, y + 4);
  }

  const bodyWidth = Math.max(2, Math.min(12, chartWidth / Math.max(10, candles.length) * 0.62));
  for (const candle of candles) {
    const x = xFor(candle.time + intervalMs / 2);
    const openY = yFor(candle.open);
    const closeY = yFor(candle.close);
    const highY = yFor(candle.high);
    const lowY = yFor(candle.low);
    const rising = candle.close >= candle.open;
    context.strokeStyle = rising ? "#5fe0a7" : "#f27d86";
    context.fillStyle = rising ? "#5fe0a7" : "#f27d86";
    context.beginPath();
    context.moveTo(x, highY);
    context.lineTo(x, lowY);
    context.stroke();
    const top = Math.min(openY, closeY);
    const bodyHeight = Math.max(1, Math.abs(openY - closeY));
    context.fillRect(x - bodyWidth / 2, top, bodyWidth, bodyHeight);
  }

  const eventAt = finite(pack?.window?.eventAt);
  if (eventAt !== null) {
    const x = xFor(eventAt);
    context.strokeStyle = "#43e1c2";
    context.setLineDash([5, 4]);
    context.beginPath();
    context.moveTo(x, padding.top);
    context.lineTo(x, padding.top + chartHeight);
    context.stroke();
    context.setLineDash([]);
    context.fillStyle = "#43e1c2";
    context.fillText("КАНДИДАТ", Math.min(width - 130, x + 5), padding.top + 12);
  }

  const cursorAt = finite(selectedAt);
  if (cursorAt !== null) {
    const x = xFor(cursorAt);
    context.strokeStyle = "#64b8ff";
    context.beginPath();
    context.moveTo(x, padding.top);
    context.lineTo(x, padding.top + chartHeight);
    context.stroke();
  }

  context.fillStyle = "#7892a5";
  context.textAlign = "left";
  context.fillText(formatClock(from), padding.left, height - 7);
  context.textAlign = "right";
  context.fillText(formatClock(to), width - padding.right + 8, height - 7);
}

function nearestSnapshot(rows, selectedAt) {
  const list = Array.isArray(rows) ? rows : [];
  if (!list.length) return null;
  let best = list[0];
  let distance = Math.abs(best.at - selectedAt);
  for (const row of list) {
    const nextDistance = Math.abs(row.at - selectedAt);
    if (nextDistance < distance) {
      best = row;
      distance = nextDistance;
    }
  }
  return best;
}

function levelRow(side, row) {
  const price = finite(row?.[0]);
  const quantity = finite(row?.[1]);
  const element = document.createElement("div");
  element.className = `book-row is-${side}`;
  const priceCell = document.createElement("span");
  priceCell.textContent = formatPrice(price);
  const quantityCell = document.createElement("span");
  quantityCell.textContent = quantity === null ? "—" : quantity.toLocaleString("en-US", { maximumFractionDigits: 3 });
  const quoteCell = document.createElement("span");
  quoteCell.textContent = price === null || quantity === null
    ? "—"
    : `$${Math.round(price * quantity).toLocaleString("ru-RU")}`;
  element.append(priceCell, quantityCell, quoteCell);
  return element;
}

function renderBook(target, pack, selectedAt) {
  target.replaceChildren();
  const snapshot = nearestSnapshot(pack?.bookSnapshots, selectedAt);
  if (!snapshot) {
    const empty = document.createElement("div");
    empty.className = "book-empty";
    empty.textContent = "Стакан не был записан до этой точки. Для новых эпизодов depth20 подключается автоматически.";
    target.append(empty);
    return;
  }
  const header = document.createElement("div");
  header.className = "book-columns";
  header.innerHTML = "<span>Цена</span><span>Кол-во</span><span>Объём</span>";
  target.append(header);
  const asks = [...(snapshot.asks ?? [])].slice(0, 8).reverse();
  for (const row of asks) target.append(levelRow("ask", row));
  const bestAsk = finite(snapshot.asks?.[0]?.[0]);
  const bestBid = finite(snapshot.bids?.[0]?.[0]);
  const middle = document.createElement("div");
  middle.className = "book-mid";
  middle.textContent = bestAsk !== null && bestBid !== null
    ? `${formatPrice((bestAsk + bestBid) / 2)} · спред ${formatSigned((bestAsk - bestBid) / bestBid * 100, 3)}`
    : formatClock(snapshot.at);
  target.append(middle);
  for (const row of (snapshot.bids ?? []).slice(0, 8)) target.append(levelRow("bid", row));
}

function fillList(target, rows, emptyText) {
  const values = Array.isArray(rows) && rows.length ? rows : [emptyText];
  target.replaceChildren(...values.map((text) => {
    const item = document.createElement("li");
    item.textContent = text;
    return item;
  }));
}

function renderExplanation(card, pack) {
  const explanation = pack?.traderExplanation;
  card.querySelector('[data-field="explanation-pattern"]').textContent = explanation?.primaryLabel ?? "Гипотеза уточняется";
  card.querySelector('[data-field="explanation-headline"]').textContent = explanation?.headline ?? "Недостаточно данных для объяснения.";
  fillList(card.querySelector('[data-field="explanation-reasons"]'), explanation?.reasoning, "Пока нет достаточных наблюдаемых причин.");
  fillList(card.querySelector('[data-field="explanation-confirmation"]'), explanation?.confirmation, "Подтверждение ещё не сформировано.");
  fillList(card.querySelector('[data-field="explanation-invalidation"]'), explanation?.invalidation, "Условия отмены ещё уточняются.");
  const missing = card.querySelector('[data-field="explanation-missing"]');
  missing.textContent = explanation?.missingEvidence?.length
    ? `Не хватает: ${explanation.missingEvidence.join("; ")}.`
    : "Основные источники контекста записаны.";
  card.querySelector('[data-field="explanation-alternative"]').textContent = explanation?.alternative
    ? `Альтернатива: ${explanation.alternative}.`
    : "";
}

function renderOutcomes(target, pack) {
  const labels = [[15_000, "15с"], [60_000, "1м"], [180_000, "3м"], [300_000, "5м"]];
  target.replaceChildren(...labels.map(([horizon, label]) => {
    const outcome = pack?.outcomes?.[String(horizon)];
    const chip = document.createElement("span");
    chip.className = "outcome-chip";
    chip.textContent = outcome
      ? `${label} ${formatSigned(outcome.movePercent)} · MFE ${formatSigned(outcome.mfePercent)} · MAE ${formatSigned(outcome.maePercent)}`
      : `${label} собирается`;
    return chip;
  }));
}

export function mountEvidenceReplay(card, episode) {
  const pack = episode?.evidencePack;
  const canvas = card.querySelector('[data-field="chart"]');
  const book = card.querySelector('[data-field="book"]');
  const slider = card.querySelector('[data-field="replay-slider"]');
  const replayTime = card.querySelector('[data-field="replay-time"]');
  const play = card.querySelector('[data-field="replay-play"]');
  const coverage = card.querySelector('[data-field="coverage"]');
  const outcomes = card.querySelector('[data-field="outcomes"]');
  const timeframeButtons = [...card.querySelectorAll("[data-timeframe]")];
  if (!canvas || !book || !slider) return;
  if (!pack) {
    const { context, width, height } = resizeCanvas(canvas);
    drawEmpty(context, width, height, "Эпизод собран до V3.1 — исторического графика Replay нет");
    book.replaceChildren();
    const empty = document.createElement("div");
    empty.className = "book-empty";
    empty.textContent = "Эпизод создан до включения записи depth20. Стакан задним числом восстановить нельзя.";
    book.append(empty);
    coverage.textContent = "Исторический evidence-пакет отсутствует. Новые эпизоды сохраняются с графиком и стаканом.";
    replayTime.textContent = "—";
    play.disabled = true;
    slider.disabled = true;
    timeframeButtons.forEach((button) => { button.disabled = true; });
    renderExplanation(card, null);
    card.querySelector('[data-field="explanation-headline"]').textContent = "Этот эпизод был собран старой версией лаборатории. Моё объяснение появится у новых эпизодов после записи полного контекста.";
    card.querySelector('[data-field="explanation-missing"]').textContent = "Не хватает исторических price points, flow samples и depth20; они не восстанавливаются задним числом.";
    renderOutcomes(outcomes, null);
    return;
  }

  let intervalMs = TIMEFRAMES["5s"];
  let timer = null;
  const startAt = finite(pack?.window?.startAt) ?? Date.now() - 180_000;
  const latestAt = Math.max(
    finite(pack?.pricePoints?.at?.(-1)?.at) ?? startAt,
    finite(pack?.bookSnapshots?.at?.(-1)?.at) ?? startAt,
    finite(pack?.window?.updatedAt) ?? startAt,
  );
  const durationSeconds = Math.max(1, Math.round((latestAt - startAt) / 1_000));
  slider.min = "0";
  slider.max = String(durationSeconds);
  slider.step = "1";
  slider.value = String(Math.max(0, Math.min(durationSeconds, Math.round(((finite(pack?.window?.eventAt) ?? latestAt) - startAt) / 1_000))));

  const render = () => {
    const selectedAt = startAt + Number(slider.value) * 1_000;
    drawEvidenceChart(canvas, pack, { intervalMs, selectedAt });
    renderBook(book, pack, selectedAt);
    renderExplanation(card, pack);
    renderOutcomes(outcomes, pack);
    replayTime.textContent = formatClock(selectedAt);
    coverage.textContent = `Цена: ${pack.coverage?.prePriceSeconds ?? 0}с до · стакан: ${pack.coverage?.preBookSeconds ?? 0}с до / ${pack.coverage?.bookState ?? "not-recorded"} · режим ${pack.bookMode}`;
  };

  timeframeButtons.forEach((button) => button.addEventListener("click", () => {
    intervalMs = TIMEFRAMES[button.dataset.timeframe] ?? TIMEFRAMES["5s"];
    timeframeButtons.forEach((item) => item.classList.toggle("is-active", item === button));
    render();
  }));
  slider.addEventListener("input", render);
  play.addEventListener("click", () => {
    if (timer) {
      clearInterval(timer);
      timer = null;
      play.textContent = "▶ Replay";
      return;
    }
    play.textContent = "Пауза";
    timer = setInterval(() => {
      const next = Number(slider.value) + 1;
      if (next > Number(slider.max)) {
        clearInterval(timer);
        timer = null;
        play.textContent = "▶ Replay";
        return;
      }
      slider.value = String(next);
      render();
    }, 350);
  });

  render();
  requestAnimationFrame(render);
}
