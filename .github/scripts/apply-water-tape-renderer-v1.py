from pathlib import Path
import re

OLD_BUILD = "26-70-smooth-closed-agg-v1"
NEW_BUILD = "26-71-water-tape-v1"


def read(path):
    return Path(path).read_text(encoding="utf-8")


def write(path, text):
    Path(path).write_text(text, encoding="utf-8")


def replace_once(text, old, new, label):
    count = text.count(old)
    if count != 1:
        raise SystemExit(f"{label}: expected 1 match, got {count}")
    return text.replace(old, new, 1)


def regex_once(text, pattern, replacement, label, flags=re.S):
    next_text, count = re.subn(pattern, lambda _: replacement, text, count=1, flags=flags)
    if count != 1:
        raise SystemExit(f"{label}: expected 1 regex match, got {count}")
    return next_text


# Atomic runtime bump outside temporary workflow helpers.
for path in Path(".").rglob("*"):
    if not path.is_file() or ".git" in path.parts or ".github" in path.parts:
        continue
    if path.suffix.lower() not in {".js", ".mjs", ".html", ".txt", ".webmanifest"}:
        continue
    text = read(path)
    if OLD_BUILD in text:
        write(path, text.replace(OLD_BUILD, NEW_BUILD))


path = "orderbook.js"
text = read(path)

text = replace_once(
    text,
    '''const TAPE_AGG_EVENT_GRACE_MS = 60;
const TAPE_AGG_WALL_CLOCK_GRACE_MS = 650;
const TAPE_CAMERA_SPEED = 4;''',
    '''const TAPE_AGG_EVENT_GRACE_MS = 60;
const TAPE_AGG_WALL_CLOCK_GRACE_MS = 650;
const TAPE_PRICE_VIEWPORT_TAU_MS = 90;
const TAPE_CLOCK_CORRECTION_TAU_MS = 120;''',
    "water Tape constants",
)

text = replace_once(
    text,
    'const tapeRecentRateBySymbol = new Map();\nconst tapeCardStates = new WeakMap();',
    'const tapeRecentRateBySymbol = new Map();\nconst tapeDataVersionBySymbol = new Map();\nconst tapeCardStates = new WeakMap();',
    "Tape data version map",
)

text = replace_once(
    text,
    '''      lastRenderSignature: null,
      cameraEndTime: null,
      cameraUpdatedAt: null,
      cameraAnimating: false,
      aggSnapshots: new Map(),''',
    '''      lastRenderSignature: null,
      clockEndTime: null,
      clockPerfAt: null,
      priceViewport: null,
      priceViewportAt: null,
      renderModelKey: null,
      rawRenderNodes: [],
      aggSourceBuckets: [],
      aggSnapshots: new Map(),''',
    "water Tape card state",
)

text = replace_once(
    text,
    '''          state.hasFrame = false;
          state.cameraEndTime = null;
          state.cameraUpdatedAt = null;
          state.cameraAnimating = false;
          state.aggSnapshots?.clear?.();''',
    '''          state.hasFrame = false;
          state.clockEndTime = null;
          state.clockPerfAt = null;
          state.priceViewport = null;
          state.priceViewportAt = null;
          state.renderModelKey = null;
          state.rawRenderNodes = [];
          state.aggSourceBuckets = [];
          state.aggSnapshots?.clear?.();''',
    "water Tape symbol reset",
)

water_helpers = r'''export function tapeViewportFromRows(rows) {
  const ordered = (rows ?? [])
    .map((row) => ({
      price: Number(row?.price),
      y: Number(row?.y),
      height: Math.max(1, Number(row?.height) || 1),
    }))
    .filter((row) => Number.isFinite(row.price) && Number.isFinite(row.y))
    .sort((left, right) => left.price - right.price);
  if (ordered.length < 2) return null;
  let step = Infinity;
  for (let index = 1; index < ordered.length; index += 1) {
    const gap = ordered[index].price - ordered[index - 1].price;
    if (gap > Number.EPSILON && gap < step) step = gap;
  }
  const low = ordered[0];
  const high = ordered.at(-1);
  if (!Number.isFinite(step) || high.price <= low.price) return null;
  return {
    lowPrice: low.price,
    highPrice: high.price,
    lowY: low.y,
    highY: high.y,
    step,
    rowHeight: ordered.reduce((sum, row) => sum + row.height, 0) / ordered.length,
  };
}

export function advanceTapePriceViewport(
  previous,
  target,
  elapsedMs,
  tauMs = TAPE_PRICE_VIEWPORT_TAU_MS,
) {
  if (!target) return previous ?? null;
  if (!previous) return { ...target };
  const previousSpan = Math.max(Number.EPSILON, previous.highPrice - previous.lowPrice);
  const targetSpan = Math.max(Number.EPSILON, target.highPrice - target.lowPrice);
  const spanRatio = targetSpan / previousSpan;
  const hardReset = spanRatio > 4 || spanRatio < .25;
  const elapsed = Math.max(0, Math.min(250, Number(elapsedMs) || 0));
  const tau = Math.max(1, Number(tauMs) || TAPE_PRICE_VIEWPORT_TAU_MS);
  const alpha = hardReset ? 1 : 1 - Math.exp(-elapsed / tau);
  const mix = (left, right) => Number(left) + (Number(right) - Number(left)) * alpha;
  return {
    lowPrice: mix(previous.lowPrice, target.lowPrice),
    highPrice: mix(previous.highPrice, target.highPrice),
    lowY: mix(previous.lowY, target.lowY),
    highY: mix(previous.highY, target.highY),
    step: mix(previous.step, target.step),
    rowHeight: mix(previous.rowHeight, target.rowHeight),
  };
}

export function projectTapePrice(viewport, price) {
  const target = Number(price);
  if (!viewport || !Number.isFinite(target)) return null;
  const low = Number(viewport.lowPrice);
  const high = Number(viewport.highPrice);
  const span = high - low;
  const step = Math.max(Number.EPSILON, Number(viewport.step) || 0);
  if (!Number.isFinite(span) || span <= Number.EPSILON) return null;
  if (target < low - step * .65 || target > high + step * .65) return null;
  const ratio = (target - low) / span;
  return {
    price: target,
    y: Number(viewport.lowY) + (Number(viewport.highY) - Number(viewport.lowY)) * ratio,
    height: Math.max(1, Number(viewport.rowHeight) || 1),
  };
}

export function advanceWaterTapeClock(
  previousEnd,
  previousAt,
  latestTradeTime,
  packetAt,
  nowPerf,
  frozen = false,
) {
  const latest = Number(latestTradeTime);
  const now = Number(nowPerf);
  const packet = Number(packetAt);
  if (!Number.isFinite(latest) || !Number.isFinite(now)) return null;
  const hasPrevious = previousEnd !== null
    && previousEnd !== undefined
    && Number.isFinite(Number(previousEnd));
  if (frozen) return hasPrevious ? Number(previousEnd) : latest + 1;
  const packetAge = Number.isFinite(packet) ? Math.max(0, now - packet) : 0;
  const desired = latest + packetAge + TAPE_LIVE_EDGE_LEAD_MS;
  if (!hasPrevious) return desired;
  const previous = Number(previousEnd);
  const previousTime = Number(previousAt);
  const elapsed = Number.isFinite(previousTime)
    ? Math.max(0, Math.min(250, now - previousTime))
    : 0;
  const base = previous + elapsed;
  const alpha = 1 - Math.exp(-elapsed / TAPE_CLOCK_CORRECTION_TAU_MS);
  const corrected = base + (desired - base) * alpha;
  return Math.max(previous, corrected);
}

function buildContinuousTapeWindow(width, latestTime, requestedEndTime = null) {
  const safeWidth = Math.max(1, Number(width) || 1);
  const seconds = clampTape(
    Math.floor(safeWidth / TAPE_MIN_SECOND_WIDTH),
    TAPE_MIN_SECONDS,
    TAPE_MAX_SECONDS,
  );
  const duration = seconds * TAPE_SECOND_MS;
  const latest = Number(latestTime) || Date.now();
  const requested = Number(requestedEndTime);
  const endTime = Number.isFinite(requested)
    ? Math.max(latest + 1, requested)
    : latest + 1;
  return {
    duration,
    startTime: endTime - duration,
    endTime,
    plotRight: safeWidth,
  };
}

function tapeTimeX'''

text = regex_once(
    text,
    r'export function advanceTapeCameraEnd\([\s\S]*?\nfunction tapeTimeX',
    water_helpers,
    "replace packet-driven camera with water clock and viewport",
)

water_draw = r'''function refreshTapeRenderModel(state, symbol, stored, step) {
  const version = Number(tapeDataVersionBySymbol.get(symbol)) || 0;
  const modelKey = [
    symbol,
    version,
    Number(step).toPrecision(12),
    state.aggLevelIndex,
  ].join(":");
  if (state.renderModelKey === modelKey) return;
  state.renderModelKey = modelKey;
  state.rawRenderNodes = [...stored]
    .map((trade) => Object.freeze({
      key: `raw:${String(trade.id)}:${trade.time}:${trade.price}:${trade.quantity}`,
      id: trade.id,
      time: Number(trade.time),
      lastTime: Number(trade.time),
      price: Number(trade.price),
      quote: Number(trade.quote),
      buyQuote: trade.side === "buy" ? Number(trade.quote) : 0,
      sellQuote: trade.side === "sell" ? Number(trade.quote) : 0,
      count: 1,
    }))
    .sort((left, right) => (
      left.time - right.time || String(left.id).localeCompare(String(right.id))
    ));
  state.aggSourceBuckets = aggregateTapeBuckets(
    stored,
    step,
    state.aggLevelIndex,
    null,
  );
}

function visibleWaterTapeNodes(nodes, window) {
  return (nodes ?? []).filter((item) => (
    Number(item.time) >= window.startTime
    && Number(item.time) <= window.endTime
  ));
}

function projectWaterTapeNodes(nodes, viewport) {
  const projected = [];
  for (const item of nodes ?? []) {
    const position = projectTapePrice(viewport, item.price);
    if (position) projected.push({ ...item, position });
  }
  return projected;
}

function drawTapeCard(card) {
  const drawStartedAt = performance.now();
  const initialSymbol = cardSymbol(card);
  const skip = (reason, tags = null) => observability.skipRender("tape", reason, {
    symbol: initialSymbol || null,
    ...(tags ?? {}),
  });
  const state = ensureTapeUi(card);
  const flow = card.querySelector(".trade-flow");
  const canvas = state?.canvas;
  const context = state?.context;
  if (!state || !flow || !canvas || !context) {
    skip("missing-dom");
    return;
  }
  if (tapeDocumentHidden) {
    skip("document-hidden");
    return;
  }

  const rect = flow.getBoundingClientRect();
  if (rect.width <= 2 || rect.height <= 2) {
    skip("zero-size");
    return;
  }
  const dprLimit = rect.width >= 900 ? 1.1 : 1.4;
  const dpr = Math.max(1, Math.min(dprLimit, globalThis.devicePixelRatio || 1));
  const pixelWidth = Math.max(1, Math.round(rect.width * dpr));
  const pixelHeight = Math.max(1, Math.round(rect.height * dpr));
  if (canvas.width !== pixelWidth || canvas.height !== pixelHeight) {
    canvas.width = pixelWidth;
    canvas.height = pixelHeight;
    state.hasFrame = false;
  }
  context.setTransform(dpr, 0, 0, dpr, 0, 0);

  if (!state.tapeVisible) {
    context.clearRect(0, 0, rect.width, rect.height);
    state.hasFrame = false;
    setTapeRangeSummary(state, 0, 0);
    setTapeState(state, "");
    skip("layer-hidden");
    return;
  }

  const symbol = initialSymbol;
  if (!symbol) {
    paintTapeSurface(context, rect);
    state.hasFrame = false;
    setTapeState(state, "Выберите монету");
    skip("missing-symbol");
    return;
  }

  const stored = tapeTradesBySymbol.get(symbol) ?? [];
  if (!stored.length) {
    if (!state.hasFrame) paintTapeSurface(context, rect);
    const live = tapeStatusText(card).includes("TAPE");
    setTapeState(
      state,
      live ? "Поток подключён · ждём сделку" : "Подключаю поток сделок…",
      live ? "neutral" : "attention",
    );
    skip(live ? "waiting-trade" : "stream-not-live");
    return;
  }

  const frozen = tapeRecoveryFrozen(symbol);
  if (frozen && state.hasFrame) {
    setTapeState(state, "ПОСЛЕДНИЙ КАДР · ждём свежий поток", "attention");
    skip("recovery-frozen");
    return;
  }

  const rows = visibleBookRows(card, flow);
  const targetViewport = tapeViewportFromRows(rows);
  if (!targetViewport) {
    setTapeState(state, "Жду ценовую шкалу стакана…", "attention");
    skip("missing-price-viewport");
    return;
  }

  const perfNow = performance.now();
  const viewportElapsed = state.priceViewportAt === null
    ? 16
    : perfNow - Number(state.priceViewportAt);
  state.priceViewport = advanceTapePriceViewport(
    state.priceViewport,
    targetViewport,
    viewportElapsed,
  );
  state.priceViewportAt = perfNow;

  const meta = tapeMetaBySymbol.get(symbol) ?? {};
  const latestTime = Number(meta.lastTradeTime)
    || Number(stored[0]?.time)
    || Date.now();
  const endTime = advanceWaterTapeClock(
    state.clockEndTime,
    state.clockPerfAt,
    latestTime,
    meta.lastPacketPerfAt,
    perfNow,
    frozen,
  );
  state.clockEndTime = endTime;
  state.clockPerfAt = perfNow;
  const window = buildContinuousTapeWindow(rect.width, latestTime, endTime);
  const range = visiblePriceRange(rows);
  const step = range?.step ?? .01;
  refreshTapeRenderModel(state, symbol, stored, step);

  const recentRaw = visibleWaterTapeNodes(state.rawRenderNodes, window);
  const aggregateClosedBefore = Math.max(
    latestTime - TAPE_AGG_EVENT_GRACE_MS,
    Number(endTime) - TAPE_AGG_WALL_CLOCK_GRACE_MS,
  );
  const closedAggregates = visibleWaterTapeNodes(
    finalizedAggregateTapeBuckets(
      state,
      state.aggSourceBuckets,
      aggregateClosedBefore,
    ),
    window,
  );

  paintTapeSurface(context, rect);
  state.hasFrame = false;
  setTapeRangeSummary(state, 0, 0);
  drawTapeTimeline(context, rect, window);

  const minQuote = Math.max(0, Number(state.minQuote) || 0);
  const pathItems = projectWaterTapeNodes(recentRaw, state.priceViewport);
  if (pathItems.length > 1) {
    context.save();
    context.strokeStyle = "rgba(130, 151, 160, .34)";
    context.lineWidth = .7;
    context.beginPath();
    let previous = null;
    for (const item of pathItems) {
      const x = tapeTimeX(item.time, window, rect.width);
      const y = item.position.y;
      if (!previous || item.time - previous.time > 1_500) context.moveTo(x, y);
      else context.lineTo(x, y);
      previous = item;
    }
    context.stroke();
    context.restore();
  }

  const sourceItems = state.mode === "agg" ? closedAggregates : recentRaw;
  const candidates = sourceItems.filter((item) => passesTapeFilter(item, minQuote, 0));
  const visibility = classifyTapeCandidates(candidates, range);
  setTapeRangeSummary(state, visibility.above, visibility.below);
  const items = projectWaterTapeNodes(candidates, state.priceViewport);

  if (!candidates.length) {
    setTapeState(state, "Линия всех сделок · нет маркеров по фильтру");
    state.hasFrame = true;
    skip("filter-empty", { recent: recentRaw.length });
    return;
  }
  if (!items.length) {
    setTapeState(state, "Линия всех сделок · маркеры вне видимой цены");
    state.hasFrame = true;
    skip("no-visible-items", { candidates: candidates.length });
    return;
  }

  const staleSuffix = staleTradeSuffix(symbol);
  setTapeState(
    state,
    frozen
      ? "ПОСЛЕДНИЙ КАДР · ждём свежий поток"
      : staleSuffix
        ? `НЕТ НОВЫХ СДЕЛОК${staleSuffix}`
        : "",
    frozen || staleSuffix ? "attention" : "neutral",
  );

  context.textAlign = "center";
  context.textBaseline = "middle";
  context.font = "800 8px Inter, system-ui, sans-serif";

  for (const item of items) {
    const y = item.position.y;
    const buy = item.buyQuote >= item.sellQuote;
    const stroke = buy ? "rgba(88, 239, 184, .9)" : "rgba(255, 121, 137, .9)";
    const strength = stableTapeQuoteStrength(item.quote);
    const baseX = tapeTimeX(item.time, window, rect.width);

    if (state.mode === "raw") {
      if (minQuote > 0) {
        const label = formatTapeUsd(item.quote);
        const measured = context.measureText(label).width;
        const height = clampTape(9 + strength * 4, 9, 15);
        const width = clampTape(measured + 9, 24, Math.min(88, rect.width * .28));
        const x = clampTape(
          baseX,
          width / 2 + .5,
          Math.max(width / 2 + .5, window.plotRight - width / 2 - .5),
        );
        roundedRectPath(context, x - width / 2, y - height / 2, width, height, 2);
        context.fillStyle = buy ? "rgba(42, 191, 137, .82)" : "rgba(222, 70, 87, .84)";
        context.fill();
        context.lineWidth = 1;
        context.strokeStyle = stroke;
        context.stroke();
        context.fillStyle = "rgba(244, 250, 248, .99)";
        context.fillText(label, x, y + .2);
      } else {
        const diameter = clampTape(1.8 + strength * 7, 1.8, 10.8);
        const x = clampTape(
          baseX,
          diameter / 2 + .5,
          Math.max(diameter / 2 + .5, window.plotRight - diameter / 2 - .5),
        );
        context.beginPath();
        context.arc(x, y, diameter / 2, 0, Math.PI * 2);
        context.fillStyle = buy
          ? `rgba(50, 205, 151, ${clampTape(.32 + strength * .26, .32, .84)})`
          : `rgba(238, 91, 108, ${clampTape(.32 + strength * .26, .32, .84)})`;
        context.fill();
        if (diameter >= 4.2) {
          context.lineWidth = diameter >= 7 ? .95 : .6;
          context.strokeStyle = stroke;
          context.stroke();
        }
      }
      continue;
    }

    const showLabel = minQuote > 0 || Boolean(item.showLabel);
    const label = formatTapeUsd(item.quote);
    const diameter = clampTape(4 + strength * 6, 4, 12);
    if (!showLabel) {
      const x = clampTape(
        baseX,
        diameter / 2 + .5,
        Math.max(diameter / 2 + .5, window.plotRight - diameter / 2 - .5),
      );
      context.beginPath();
      context.arc(x, y, diameter / 2, 0, Math.PI * 2);
      context.fillStyle = buy ? "rgba(42, 191, 137, .68)" : "rgba(222, 70, 87, .7)";
      context.fill();
      context.lineWidth = item.count > 1 ? .95 : .6;
      context.strokeStyle = stroke;
      context.stroke();
      continue;
    }

    const measured = context.measureText(label).width;
    const height = clampTape(7 + strength * 6, 7, 14);
    const width = clampTape(measured + 9, 18, Math.min(84, rect.width * .26));
    const x = clampTape(
      baseX,
      width / 2 + .5,
      Math.max(width / 2 + .5, window.plotRight - width / 2 - .5),
    );
    roundedRectPath(context, x - width / 2, y - height / 2, width, height, height * .28);
    context.fillStyle = buy ? "rgba(42, 191, 137, .76)" : "rgba(222, 70, 87, .78)";
    context.fill();
    context.lineWidth = 1;
    context.strokeStyle = stroke;
    context.stroke();
    context.fillStyle = "rgba(244, 250, 248, .98)";
    context.fillText(label, x, y + .2);
  }

  state.hasFrame = true;
  if (observability.enabled) {
    observability.rendered(symbol, "tape");
    observability.record("tape.render-card", performance.now() - drawStartedAt, {
      symbol,
      trades: stored.length,
      items: items.length,
      renderer: "water-v1",
    });
  }
}

function drawAllTapes() {'''

text = regex_once(
    text,
    r'function drawTapeCard\(card\) \{[\s\S]*?\n\}\n\nfunction drawAllTapes\(\) \{',
    water_draw,
    "replace Tape painter with water renderer",
)

water_scheduler = r'''function cancelTapeDraw() {
  if (tapeDrawFrame) cancelAnimationFrame(tapeDrawFrame);
  if (tapeDrawTimer) clearTimeout(tapeDrawTimer);
  tapeDrawFrame = 0;
  tapeDrawTimer = 0;
}

function targetTapeFrameMs() {
  const count = Math.max(1, document.querySelectorAll(".orderbook-card").length);
  const base = count >= 6 ? 50 : count >= 3 ? 32 : 16;
  const symbols = new Set(
    [...document.querySelectorAll(".orderbook-card")]
      .map((card) => cardSymbol(card))
      .filter(Boolean),
  );
  const recentRate = [...symbols]
    .reduce((total, symbol) => total + (tapeRecentRateBySymbol.get(symbol) || 0), 0);
  if (recentRate > 1_200) return Math.max(base, 66);
  if (recentRate > 600) return Math.max(base, 48);
  if (recentRate > 250) return Math.max(base, 32);
  return base;
}

function activeTapeCards() {
  return [...document.querySelectorAll(".orderbook-card")].filter((card) => {
    const state = tapeCardStates.get(card);
    const symbol = cardSymbol(card);
    return Boolean(
      card.isConnected
      && state?.tapeVisible
      && symbol
      && (tapeTradesBySymbol.get(symbol)?.length ?? 0) > 0
      && !tapeRecoveryFrozen(symbol)
    );
  });
}

function runTapeDrawFrame(frameNow) {
  tapeDrawFrame = 0;
  if (tapeDocumentHidden) return;
  const activeCards = activeTapeCards();
  const frameMs = targetTapeFrameMs();
  const due = Number(frameNow) - tapeLastDrawAt >= frameMs;
  if (due) {
    activeCards.forEach((card) => dirtyTapeCards.add(card));
    tapeNeedsDraw = tapeNeedsDraw || dirtyTapeCards.size > 0;
    if (tapeNeedsDraw) drawAllTapes();
    tapeLastDrawAt = Number(frameNow);
  }
  if (tapeNeedsDraw || activeCards.length) {
    tapeDrawFrame = requestAnimationFrame(runTapeDrawFrame);
  }
}

function scheduleTapeDraw(force = false, card = null) {
  if (typeof document === "undefined") return;
  tapeNeedsDraw = true;
  if (card?.isConnected) dirtyTapeCards.add(card);
  else tapeDrawAllRequested = true;
  if (tapeDocumentHidden) return;
  if (force) tapeLastDrawAt = 0;
  if (!tapeDrawFrame) tapeDrawFrame = requestAnimationFrame(runTapeDrawFrame);
}

function normalizeTapeTrade'''

text = regex_once(
    text,
    r'function cancelTapeDraw\(\) \{[\s\S]*?\nfunction normalizeTapeTrade',
    water_scheduler,
    "replace packet scheduler with continuous rAF loop",
)

text = replace_once(
    text,
    '''    tapeTradesBySymbol.set(
      symbol,
      mergeTapeHistory(current, chunk, pending.replace),
    );
    pending.replace = false;''',
    '''    tapeTradesBySymbol.set(
      symbol,
      mergeTapeHistory(current, chunk, pending.replace),
    );
    tapeDataVersionBySymbol.set(
      symbol,
      (Number(tapeDataVersionBySymbol.get(symbol)) || 0) + 1,
    );
    pending.replace = false;''',
    "increment Tape model version",
)

text = replace_once(
    text,
    '''    tapeMetaBySymbol.set(symbol, {
      lastPacketAt: Date.now(),
      lastTradeTime: latestTime,
      packets: (Number(previousMeta.packets) || 0) + 1,
    });''',
    '''    tapeMetaBySymbol.set(symbol, {
      lastPacketAt: Date.now(),
      lastPacketPerfAt: performance.now(),
      lastTradeTime: latestTime,
      packets: (Number(previousMeta.packets) || 0) + 1,
    });''',
    "record monotonic packet time",
)

write(path, text)


# Replace obsolete source-contract tests with the water renderer contract.
write("test-tape-stability-followup-v1.mjs", '''import assert from "node:assert/strict";
import test from "node:test";
import { readFileSync } from "node:fs";
import {
  advanceTapePriceViewport,
  advanceWaterTapeClock,
  aggregateTapeBuckets,
  bookPriceEmphasis,
  bookPriceEmphasisForUnit,
  bookPsychologicalPriceUnit,
  projectTapePrice,
  stableTapeQuoteStrength,
  tapeViewportFromRows,
} from "./orderbook.js";

const orderbook = readFileSync(new URL("./orderbook.js", import.meta.url), "utf8");
const footprint = readFileSync(new URL("./orderbook-flow-workspace.js", import.meta.url), "utf8");
const chart = readFileSync(new URL("./chart.js", import.meta.url), "utf8");

test("psychological levels keep one anchored unit per symbol", () => {
  assert.equal(bookPsychologicalPriceUnit(.093), .001);
  assert.deepEqual(bookPriceEmphasis(.093, .093), { round: true, half: false, majorUnit: .001 });
  assert.deepEqual(bookPriceEmphasisForUnit(.0925, .001), { round: false, half: true, majorUnit: .001 });
  assert.match(orderbook, /function stableBookPsychologicalUnit\(card, referencePrice\)/);
});

test("water clock moves continuously between WebSocket packets", () => {
  const first = advanceWaterTapeClock(null, null, 10_000, 100, 100, false);
  const second = advanceWaterTapeClock(first, 100, 10_000, 100, 116, false);
  const third = advanceWaterTapeClock(second, 116, 10_000, 100, 132, false);
  assert.ok(second > first);
  assert.ok(third > second);
  assert.equal(advanceWaterTapeClock(third, 132, 10_000, 100, 148, true), third);
  assert.match(orderbook, /function activeTapeCards\(\)/);
  assert.match(orderbook, /requestAnimationFrame\(runTapeDrawFrame\)/);
  assert.doesNotMatch(orderbook, /scheduleAnimatedTapeFrame|cameraAnimating/);
});

test("all trades share one coherent affine price viewport", () => {
  const target = tapeViewportFromRows([
    { price: 99, y: 90, height: 10 },
    { price: 100, y: 50, height: 10 },
    { price: 101, y: 10, height: 10 },
  ]);
  const viewport = advanceTapePriceViewport(null, target, 16);
  assert.equal(projectTapePrice(viewport, 99).y, 90);
  assert.equal(projectTapePrice(viewport, 100).y, 50);
  assert.equal(projectTapePrice(viewport, 101).y, 10);
  assert.match(orderbook, /projectWaterTapeNodes\(recentRaw, state\.priceViewport\)/);
  assert.doesNotMatch(orderbook, /const drawItems = layoutTapeSequence\(items/);
});

test("AGG buckets include the complete intersecting bucket", () => {
  const buckets = aggregateTapeBuckets([
    { id: 1, time: 920, price: 10, quote: 100, side: "buy" },
    { id: 2, time: 1_000, price: 10, quote: 200, side: "sell" },
  ], .01, 0, { startTime: 970, endTime: 1_100 });
  assert.equal(buckets.length, 1);
  assert.equal(buckets[0].quote, 300);
  assert.match(orderbook, /snapshot = Object\.freeze/);
  assert.match(orderbook, /state\.aggSourceBuckets/);
});

test("marker geometry is absolute and independent of visible neighbours", () => {
  assert.equal(stableTapeQuoteStrength(0), 0);
  assert.ok(stableTapeQuoteStrength(10_000) > stableTapeQuoteStrength(1_000));
  assert.match(orderbook, /const strength = stableTapeQuoteStrength\(item\.quote\)/);
  assert.match(orderbook, /const baseX = tapeTimeX\(item\.time, window, rect\.width\)/);
  assert.doesNotMatch(orderbook, /adaptiveRawDiameter\(strength, item\.density/);
});

test("footprint and chart visual requests stay applied", () => {
  assert.doesNotMatch(footprint, /formatSignedQuoteDelta|deltaText/);
  assert.match(footprint, /const alpha = \.38 \+ clusterStrength \* \.5/);
  assert.match(chart, /const fill = this\.theme\.bearFill;/);
});
''')

path = "test-orderbook-resume-v2.mjs"
test_text = read(path)
test_text = regex_once(
    test_text,
    r'test\("Tape window stays at the latest real trade instead of drawing future emptiness", \(\) => \{[\s\S]*?\n\}\);',
    '''test("Tape clock advances continuously while the live stream is healthy", () => {
  assert.match(orderbook, /export function advanceWaterTapeClock\(/);
  assert.match(orderbook, /const packetAge = Number\.isFinite\(packet\)/);
  assert.match(orderbook, /const base = previous \+ elapsed/);
  assert.match(orderbook, /function activeTapeCards\(\)/);
});''',
    "resume test water clock",
)
write(path, test_text)

# Append explicit regression coverage for event-stable geometry.
write("test-water-tape-renderer-v1.mjs", '''import assert from "node:assert/strict";
import test from "node:test";
import { readFileSync } from "node:fs";
import {
  advanceTapePriceViewport,
  advanceWaterTapeClock,
  projectTapePrice,
  tapeViewportFromRows,
} from "./orderbook.js";

const source = readFileSync(new URL("./orderbook.js", import.meta.url), "utf8");

test("adding a neighbouring trade cannot change an existing event coordinate", () => {
  const viewport = tapeViewportFromRows([
    { price: 10, y: 100, height: 10 },
    { price: 11, y: 50, height: 10 },
    { price: 12, y: 0, height: 10 },
  ]);
  const before = projectTapePrice(viewport, 11);
  const after = projectTapePrice(viewport, 11);
  assert.deepEqual(after, before);
  assert.match(source, /key: `raw:\$\{String\(trade\.id\)\}/);
  assert.match(source, /Object\.freeze\(\{/);
});

test("viewport changes move the whole historical layer coherently", () => {
  const first = tapeViewportFromRows([
    { price: 100, y: 100, height: 10 },
    { price: 101, y: 50, height: 10 },
    { price: 102, y: 0, height: 10 },
  ]);
  const second = tapeViewportFromRows([
    { price: 101, y: 100, height: 10 },
    { price: 102, y: 50, height: 10 },
    { price: 103, y: 0, height: 10 },
  ]);
  const moved = advanceTapePriceViewport(first, second, 16, 90);
  assert.ok(moved.lowPrice > first.lowPrice && moved.lowPrice < second.lowPrice);
  assert.ok(projectTapePrice(moved, 102));
});

test("clock never steps backward and does not depend on packet cadence", () => {
  const a = advanceWaterTapeClock(null, null, 1_000, 0, 0, false);
  const b = advanceWaterTapeClock(a, 0, 1_000, 0, 16, false);
  const c = advanceWaterTapeClock(b, 16, 1_008, 16, 32, false);
  assert.ok(b >= a);
  assert.ok(c >= b);
});

test("renderer does not feed historical items through collision layout", () => {
  const drawBlock = source.match(/function drawTapeCard\(card\) \{[\s\S]*?\n\}\n\nfunction drawAllTapes/)?.[0] ?? "";
  assert.ok(drawBlock);
  assert.doesNotMatch(drawBlock, /layoutTapeSequence|nearestVisibleRow|tapePricePosition/);
  assert.match(drawBlock, /projectWaterTapeNodes/);
  assert.match(drawBlock, /tapeTimeX\(item\.time, window, rect\.width\)/);
});
''')

path = "VERSION.txt"
version = read(path)
features = [
    "water-tape-renderer-v1",
    "continuous-stream-clock-v1",
    "coherent-price-viewport-v1",
    "immutable-trade-render-nodes-v1",
]
lines = version.splitlines()
for index, line in enumerate(lines):
    if line.startswith("Features:"):
        for feature in features:
            if feature not in line:
                line += f", {feature}"
        lines[index] = line
        break
write(path, "\n".join(lines) + "\n")

# Guard the essential architecture in the generated tree.
orderbook = read("orderbook.js")
assert "function activeTapeCards()" in orderbook
assert "advanceWaterTapeClock" in orderbook
assert "projectWaterTapeNodes" in orderbook
assert "layoutTapeSequence(items" not in orderbook
assert "cameraAnimating" not in orderbook
assert OLD_BUILD not in "\n".join(read(p) for p in ["VERSION.txt", "app.js", "index.html", "orderbook.js", "sw.js"])
