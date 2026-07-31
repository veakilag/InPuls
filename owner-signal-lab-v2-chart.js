export const SIGNAL_LAB_CHART_TIMEFRAMES = Object.freeze({
  "1s": 1_000,
  "5s": 5_000,
  "15s": 15_000,
  "1m": 60_000,
  "5m": 300_000,
});

const finite = (value) => {
  const number = Number(value);
  return Number.isFinite(number) ? number : null;
};

function pointCandles(points, intervalMs) {
  const buckets = new Map();
  for (const point of points ?? []) {
    const at = finite(point?.at);
    const price = finite(point?.price);
    if (at === null || price === null || price <= 0) continue;
    const time = Math.floor(at / intervalMs) * intervalMs;
    const candle = buckets.get(time);
    if (candle) {
      candle.high = Math.max(candle.high, price);
      candle.low = Math.min(candle.low, price);
      candle.close = price;
    } else buckets.set(time, { time, open: price, high: price, low: price, close: price });
  }
  return [...buckets.values()].sort((left, right) => left.time - right.time);
}

function savedCandles(values) {
  return (values ?? []).map((item) => ({
    time: finite(item?.time),
    open: finite(item?.open),
    high: finite(item?.high),
    low: finite(item?.low),
    close: finite(item?.close),
  })).filter((item) => item.time !== null && [item.open, item.high, item.low, item.close]
    .every((value) => value !== null && value > 0));
}

function mergeCandles(candles, points, intervalMs) {
  const map = new Map(candles.map((item) => [
    Math.floor(item.time / intervalMs) * intervalMs,
    { ...item, time: Math.floor(item.time / intervalMs) * intervalMs },
  ]));
  for (const point of pointCandles(points, intervalMs)) {
    const current = map.get(point.time);
    if (current) {
      current.high = Math.max(current.high, point.high);
      current.low = Math.min(current.low, point.low);
      current.close = point.close;
    } else map.set(point.time, point);
  }
  return [...map.values()].sort((left, right) => left.time - right.time);
}

function aggregate(candles, intervalMs) {
  const map = new Map();
  for (const item of candles) {
    const time = Math.floor(item.time / intervalMs) * intervalMs;
    const current = map.get(time);
    if (current) {
      current.high = Math.max(current.high, item.high);
      current.low = Math.min(current.low, item.low);
      current.close = item.close;
    } else map.set(time, { ...item, time });
  }
  return [...map.values()].sort((left, right) => left.time - right.time);
}

export function signalLabCandles(event, timeframe) {
  const intervalMs = SIGNAL_LAB_CHART_TIMEFRAMES[timeframe] ?? 60_000;
  const path = [
    ...(event?.context?.chartContext?.seconds ?? []),
    ...(event?.observation?.pricePath ?? []),
  ];
  if (intervalMs < 60_000) return pointCandles(path, intervalMs);
  const minute = mergeCandles(
    savedCandles(event?.context?.chartContext?.candles),
    event?.observation?.pricePath ?? [],
    60_000,
  );
  return intervalMs === 60_000 ? minute : aggregate(minute, intervalMs);
}

export function drawSignalLabChart(canvas, event, {
  timeframe = "1m",
  extrema = [],
  referencePrice = event?.price,
  invalidationPrice = null,
} = {}) {
  const candles = signalLabCandles(event, timeframe).slice(-80);
  const context = canvas.getContext("2d");
  const ratio = Math.min(2, globalThis.devicePixelRatio || 1);
  const width = Math.max(280, canvas.clientWidth || 560);
  const height = 190;
  canvas.width = Math.round(width * ratio);
  canvas.height = Math.round(height * ratio);
  context.setTransform(ratio, 0, 0, ratio, 0, 0);
  context.clearRect(0, 0, width, height);
  if (candles.length < 2) return false;

  const extra = [referencePrice, invalidationPrice, ...extrema.map((item) => item?.price)]
    .map(finite).filter((value) => value !== null);
  const prices = [...candles.flatMap((item) => [item.high, item.low]), ...extra];
  const minimum = Math.min(...prices);
  const maximum = Math.max(...prices);
  const range = Math.max(maximum - minimum, Math.abs(maximum) * 0.0001);
  const intervalMs = SIGNAL_LAB_CHART_TIMEFRAMES[timeframe] ?? 60_000;
  const firstAt = candles[0].time;
  const lastAt = candles.at(-1).time + intervalMs;
  const timeRange = Math.max(1, lastAt - firstAt);
  const x = (at) => 8 + ((at - firstAt) / timeRange) * (width - 16);
  const y = (price) => 8 + ((maximum - price) / range) * (height - 16);

  context.strokeStyle = "rgba(142,155,167,.14)";
  for (const fraction of [0.25, 0.5, 0.75]) {
    context.beginPath();
    context.moveTo(0, height * fraction);
    context.lineTo(width, height * fraction);
    context.stroke();
  }

  const triggerAt = finite(event?.triggeredAt);
  if (triggerAt !== null && triggerAt >= firstAt && triggerAt <= lastAt) {
    context.strokeStyle = "#65b7ff";
    context.setLineDash([4, 4]);
    context.beginPath();
    context.moveTo(x(triggerAt), 0);
    context.lineTo(x(triggerAt), height);
    context.stroke();
    context.setLineDash([]);
  }

  const level = (value, color) => {
    const price = finite(value);
    if (price === null || price < minimum || price > maximum) return;
    context.strokeStyle = color;
    context.setLineDash([6, 4]);
    context.beginPath();
    context.moveTo(0, y(price));
    context.lineTo(width, y(price));
    context.stroke();
    context.setLineDash([]);
  };
  level(referencePrice, "#42d9b1");
  level(invalidationPrice, "#ff6f80");

  const candleWidth = Math.max(2, Math.min(9, (width - 20) / candles.length * 0.58));
  for (const item of candles) {
    const center = x(item.time + intervalMs / 2);
    const rising = item.close >= item.open;
    context.strokeStyle = rising ? "#42d9b1" : "#ff6f80";
    context.fillStyle = rising ? "rgba(66,217,177,.78)" : "rgba(255,111,128,.78)";
    context.beginPath();
    context.moveTo(center, y(item.high));
    context.lineTo(center, y(item.low));
    context.stroke();
    const top = y(Math.max(item.open, item.close));
    const bottom = y(Math.min(item.open, item.close));
    context.fillRect(center - candleWidth / 2, top, candleWidth, Math.max(1.5, bottom - top));
  }

  context.fillStyle = "#f0bf67";
  for (const item of extrema ?? []) {
    const at = finite(item?.at);
    const price = finite(item?.price);
    if (at === null || price === null || at < firstAt || at > lastAt) continue;
    context.beginPath();
    context.arc(x(at), y(price), 4, 0, Math.PI * 2);
    context.fill();
  }
  return true;
}
