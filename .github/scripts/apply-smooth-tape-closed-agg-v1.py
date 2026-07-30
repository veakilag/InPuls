from pathlib import Path
import re

OLD_BUILD = "26-69-tape-stable-pixels-v1"
NEW_BUILD = "26-70-smooth-closed-agg-v1"


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


# Runtime build bump everywhere outside workflow helpers.
for path in Path(".").rglob("*"):
    if not path.is_file() or ".git" in path.parts or ".github" in path.parts:
        continue
    if path.suffix.lower() not in {".js", ".mjs", ".html", ".txt", ".webmanifest"}:
        continue
    text = read(path)
    if OLD_BUILD in text:
        write(path, text.replace(OLD_BUILD, NEW_BUILD))


# Order book / Tape runtime.
path = "orderbook.js"
text = read(path)

old_emphasis = '''export function bookPriceEmphasis(price, referencePrice) {
  const value = Number(price);
  const majorUnit = bookPsychologicalPriceUnit(referencePrice);
  if (!Number.isFinite(value) || !Number.isFinite(majorUnit) || majorUnit <= 0) {
    return { round: false, half: false, majorUnit: null };
  }
  const halfUnit = majorUnit / 2;
  const tolerance = Math.max(Number.EPSILON, majorUnit * 1e-8);
  const nearMultiple = (unit) => {
    const ratio = value / unit;
    return Math.abs(value - Math.round(ratio) * unit) <= tolerance;
  };
  const round = nearMultiple(majorUnit);
  return {
    round,
    half: !round && nearMultiple(halfUnit),
    majorUnit,
  };
}
'''
new_emphasis = '''export function bookPriceEmphasisForUnit(price, majorUnit) {
  const value = Number(price);
  const unit = Number(majorUnit);
  if (!Number.isFinite(value) || !Number.isFinite(unit) || unit <= 0) {
    return { round: false, half: false, majorUnit: null };
  }
  const halfUnit = unit / 2;
  const tolerance = Math.max(Number.EPSILON, unit * 1e-8);
  const nearMultiple = (candidate) => {
    const ratio = value / candidate;
    return Math.abs(value - Math.round(ratio) * candidate) <= tolerance;
  };
  const round = nearMultiple(unit);
  return {
    round,
    half: !round && nearMultiple(halfUnit),
    majorUnit: unit,
  };
}

export function bookPriceEmphasis(price, referencePrice) {
  return bookPriceEmphasisForUnit(price, bookPsychologicalPriceUnit(referencePrice));
}
'''
text = replace_once(text, old_emphasis, new_emphasis, "stable psychological helper")

text = replace_once(
    text,
    'const TAPE_AGG_LABEL_QUANTILE = .95;\n',
    'const TAPE_AGG_LABEL_QUANTILE = .95;\nconst TAPE_AGG_CLOSE_GRACE_MS = 120;\n',
    "aggregate close grace",
)

old_resolve = '''export function resolveTapeWindowEnd(latestTime, frozen, now = Date.now()) {
  const latest = Number(latestTime) || Number(now) || Date.now();
  return latest + (frozen ? 1 : TAPE_LIVE_EDGE_LEAD_MS);
}
'''
new_resolve = '''export function resolveTapeWindowEnd(latestTime, frozen, now = Date.now()) {
  const current = Number(now) || Date.now();
  const latest = Number(latestTime) || current;
  return frozen
    ? latest + 1
    : Math.max(latest, current) + TAPE_LIVE_EDGE_LEAD_MS;
}
'''
text = replace_once(text, old_resolve, new_resolve, "continuous Tape clock")

style_pattern = r'''    \.orderbook-card \.book-ladder-row\.is-price-half:not\(\.is-market\) \{[\s\S]*?    \.orderbook-card \.book-ladder-row\.is-price-round:not\(\.is-market\) strong \{[\s\S]*?    \}\n'''
style_replacement = '''    .orderbook-card .book-ladder-row.is-price-half:not(.is-market),
    .orderbook-card .book-ladder-row.is-price-round:not(.is-market) {
      background: transparent !important;
      box-shadow: none !important;
    }
    .orderbook-card .book-ladder-row.is-price-half:not(.is-market) strong {
      border-left: 1px solid rgba(190, 204, 214, .32);
      color: inherit !important;
      font-weight: 800 !important;
      letter-spacing: 0 !important;
    }
    .orderbook-card .book-ladder-row.is-price-round:not(.is-market) strong {
      border-left: 2px solid color-mix(in srgb, var(--accent) 72%, #fff);
      color: inherit !important;
      font-weight: 800 !important;
      letter-spacing: 0 !important;
    }
'''
text = regex_once(text, style_pattern, style_replacement, "quiet round-level styles")

anchor_helper = '''function stableBookPsychologicalUnit(card, referencePrice) {
  const symbol = cardSymbol(card) ?? "";
  if (card.dataset.inpulsPsychologicalSymbol !== symbol) {
    card.dataset.inpulsPsychologicalSymbol = symbol;
    delete card.dataset.inpulsPsychologicalUnit;
  }
  const saved = Number(card.dataset.inpulsPsychologicalUnit);
  if (Number.isFinite(saved) && saved > 0) return saved;
  const unit = bookPsychologicalPriceUnit(referencePrice);
  if (Number.isFinite(unit) && unit > 0) {
    card.dataset.inpulsPsychologicalUnit = String(unit);
    return unit;
  }
  return null;
}

'''
text = replace_once(
    text,
    'function decorateRuntimeBookRows(card) {\n',
    anchor_helper + 'function decorateRuntimeBookRows(card) {\n',
    "psychological unit anchor helper",
)

old_decorate = '''  const referencePrice = prices.length
    ? prices[Math.floor((prices.length - 1) / 2)]
    : null;
  for (const row of rows) {
    const price = parseRuntimeNumber(row.querySelector("strong")?.textContent);
    const emphasis = bookPriceEmphasis(price, referencePrice);
    row.classList.toggle("is-price-round", emphasis.round);
    row.classList.toggle("is-price-half", emphasis.half);
  }
'''
new_decorate = '''  const referencePrice = prices.length
    ? prices[Math.floor((prices.length - 1) / 2)]
    : null;
  const majorUnit = stableBookPsychologicalUnit(card, referencePrice);
  for (const row of rows) {
    const price = parseRuntimeNumber(row.querySelector("strong")?.textContent);
    const emphasis = bookPriceEmphasisForUnit(price, majorUnit);
    row.classList.toggle("is-price-round", emphasis.round);
    row.classList.toggle("is-price-half", emphasis.half);
  }
'''
text = replace_once(text, old_decorate, new_decorate, "anchored row emphasis")

camera_pattern = r'''export function tapeWindowPixelQuantum\(duration, width\) \{[\s\S]*?function buildContinuousTapeWindow\(width, latestTime, requestedEndTime = null, dpr = 1\) \{[\s\S]*?\n\}\n\nfunction tapeTimeX'''
camera_replacement = '''function buildContinuousTapeWindow(width, latestTime, requestedEndTime = null) {
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
    : Math.max(latest + 1, Date.now());
  return {
    duration,
    startTime: endTime - duration,
    endTime,
    plotRight: safeWidth,
  };
}

function tapeTimeX'''
text = regex_once(text, camera_pattern, camera_replacement, "smooth Tape camera")
text = replace_once(
    text,
    'const window = buildContinuousTapeWindow(rect.width, latestTime, endTime, dpr);',
    'const window = buildContinuousTapeWindow(rect.width, latestTime, endTime);',
    "Tape window call",
)

aggregate_pattern = r'''export function aggregateTapeBuckets\(trades, priceStep = \.01, levelIndex = 0, window = null\) \{[\s\S]*?\n\}\n\nfunction aggregateTapeBurstsContinuous\(trades, rows, window, step, levelIndex = 0\) \{[\s\S]*?\n\}\n'''
aggregate_replacement = '''export function aggregateTapeBuckets(trades, priceStep = .01, levelIndex = 0, window = null) {
  const level = TAPE_AGGREGATION_LEVELS[Math.max(
    0,
    Math.min(TAPE_AGGREGATION_LEVELS.length - 1, Math.floor(Number(levelIndex) || 0)),
  )];
  const baseStep = Math.max(Number.EPSILON, Number(priceStep) || .01);
  const aggregateStep = baseStep * level.priceSteps;
  const buckets = new Map();
  for (const trade of trades ?? []) {
    const time = Number(trade?.time);
    const price = Number(trade?.price);
    const quote = Number(trade?.quote);
    if (![time, price, quote].every(Number.isFinite) || quote <= 0) continue;
    const bucketStart = Math.floor(time / level.bucketMs) * level.bucketMs;
    const bucketEnd = bucketStart + level.bucketMs;
    const priceIndex = Math.round(price / aggregateStep);
    const key = `agg:${level.label}:${bucketStart}:${priceIndex}`;
    const item = buckets.get(key) ?? {
      key,
      time: bucketStart + level.bucketMs / 2,
      lastTime: bucketStart + level.bucketMs / 2,
      price: Number((priceIndex * aggregateStep).toPrecision(15)),
      quote: 0,
      buyQuote: 0,
      sellQuote: 0,
      count: 0,
      bucketStart,
      bucketEnd,
      bucketMs: level.bucketMs,
    };
    item.quote += quote;
    item[trade.side === "sell" ? "sellQuote" : "buyQuote"] += quote;
    item.count += 1;
    buckets.set(key, item);
  }
  return [...buckets.values()]
    .filter((item) => !window || (
      item.bucketEnd >= Number(window.startTime)
      && item.bucketStart <= Number(window.endTime)
    ))
    .sort((left, right) => (
      left.time - right.time || left.price - right.price || left.key.localeCompare(right.key)
    ));
}

function positionAggregateTapeBuckets(buckets, rows) {
  return (buckets ?? [])
    .map((burst) => {
      const position = tapePricePosition(rows, burst.price);
      return position ? { ...burst, row: position } : null;
    })
    .filter(Boolean)
    .slice(-TAPE_MAX_AGG_VISIBLE);
}

function aggregateTapeBurstsContinuous(trades, rows, window, step, levelIndex = 0) {
  return positionAggregateTapeBuckets(
    aggregateTapeBuckets(trades, step, levelIndex, window),
    rows,
  );
}
'''
text = regex_once(text, aggregate_pattern, aggregate_replacement, "immutable aggregate buckets")

old_candidates = '''  const rawPathItems = rawTapeItemsContinuous(recent, rows, window);
  const rawCandidates = recent.filter((trade) => passesTapeFilter(trade, minQuote, 0));
  const aggregatedCandidates = state.mode === "agg"
    ? aggregateTapeBuckets(recent, step, state.aggLevelIndex, window)
        .filter((item) => passesTapeFilter(item, minQuote, 0))
    : [];
  const items = state.mode === "agg"
    ? aggregateTapeBurstsContinuous(recent, rows, window, step, state.aggLevelIndex)
        .filter((item) => passesTapeFilter(item, minQuote, 0))
    : rawTapeItemsContinuous(rawCandidates, rows, window);

  const candidates = state.mode === "agg" ? aggregatedCandidates : rawCandidates;
'''
new_candidates = '''  const rawPathItems = rawTapeItemsContinuous(recent, rows, window);
  const rawCandidates = recent.filter((trade) => passesTapeFilter(trade, minQuote, 0));
  const aggregateClosedBefore = Date.now() - TAPE_AGG_CLOSE_GRACE_MS;
  const closedAggregateBuckets = state.mode === "agg"
    ? aggregateTapeBuckets(stored, step, state.aggLevelIndex, window)
        .filter((item) => item.bucketEnd <= aggregateClosedBefore)
    : [];
  const aggregatedCandidates = closedAggregateBuckets
    .filter((item) => passesTapeFilter(item, minQuote, 0));
  const items = state.mode === "agg"
    ? positionAggregateTapeBuckets(closedAggregateBuckets, rows)
        .filter((item) => passesTapeFilter(item, minQuote, 0))
    : rawTapeItemsContinuous(rawCandidates, rows, window);

  const candidates = state.mode === "agg" ? aggregatedCandidates : rawCandidates;
'''
text = replace_once(text, old_candidates, new_candidates, "closed AGG rendering")

old_path_x = '''      const pathX = snapTapeCoordinate(pathItem.x ?? tapeTimeX(
        pathItem.lastTime ?? pathItem.time,
        window,
        rect.width,
      ), dpr);'''
new_path_x = '''      const pathX = pathItem.x ?? tapeTimeX(
        pathItem.lastTime ?? pathItem.time,
        window,
        rect.width,
      );'''
text = replace_once(text, old_path_x, new_path_x, "smooth path x")
old_base_x = '''    const baseX = snapTapeCoordinate(
      item.x ?? tapeTimeX(item.lastTime ?? item.time, window, rect.width),
      dpr,
    );'''
new_base_x = '''    const baseX = item.x
      ?? tapeTimeX(item.lastTime ?? item.time, window, rect.width);'''
text = replace_once(text, old_base_x, new_base_x, "smooth marker x")

old_target = '''function targetTapeFrameMs() {
  const count = Math.max(1, document.querySelectorAll(".orderbook-card").length);
  const base = count >= 6 ? 84 : count >= 3 ? 66 : 50;
  const symbols = new Set(
    [...document.querySelectorAll(".orderbook-card")]
      .map((card) => cardSymbol(card))
      .filter(Boolean),
  );
  const recentRate = [...symbols]
    .reduce((total, symbol) => total + (tapeRecentRateBySymbol.get(symbol) || 0), 0);
  if (recentRate > 1_200) return Math.max(base, 90);
  if (recentRate > 600) return Math.max(base, 72);
  if (recentRate > 250) return Math.max(base, 58);
  return base;
}
'''
new_target = '''function targetTapeFrameMs() {
  const count = Math.max(1, document.querySelectorAll(".orderbook-card").length);
  const base = count >= 6 ? 72 : count >= 3 ? 48 : 32;
  const symbols = new Set(
    [...document.querySelectorAll(".orderbook-card")]
      .map((card) => cardSymbol(card))
      .filter(Boolean),
  );
  const recentRate = [...symbols]
    .reduce((total, symbol) => total + (tapeRecentRateBySymbol.get(symbol) || 0), 0);
  if (recentRate > 1_200) return Math.max(base, 80);
  if (recentRate > 600) return Math.max(base, 64);
  if (recentRate > 250) return Math.max(base, 48);
  return base;
}

function continuousTapeCards() {
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

function scheduleContinuousTapeFrame() {
  if (tapeDocumentHidden || tapeDrawFrame || tapeDrawTimer) return;
  const cards = continuousTapeCards();
  if (!cards.length) return;
  tapeDrawTimer = setTimeout(() => {
    tapeDrawTimer = 0;
    const activeCards = continuousTapeCards();
    activeCards.forEach((card) => dirtyTapeCards.add(card));
    tapeNeedsDraw = dirtyTapeCards.size > 0;
    if (tapeNeedsDraw && !tapeDrawFrame) {
      tapeDrawFrame = requestAnimationFrame(runTapeDrawFrame);
    }
  }, targetTapeFrameMs());
}
'''
text = replace_once(text, old_target, new_target, "smooth Tape scheduler")

old_run = '''function runTapeDrawFrame() {
  tapeDrawFrame = 0;
  tapeLastDrawAt = performance.now();
  if (tapeNeedsDraw) drawAllTapes();
  if (tapeNeedsDraw && !tapeDocumentHidden) {
    tapeDrawFrame = requestAnimationFrame(runTapeDrawFrame);
  }
}
'''
new_run = '''function runTapeDrawFrame() {
  tapeDrawFrame = 0;
  tapeLastDrawAt = performance.now();
  if (tapeNeedsDraw) drawAllTapes();
  if (tapeNeedsDraw && !tapeDocumentHidden) {
    tapeDrawFrame = requestAnimationFrame(runTapeDrawFrame);
  } else {
    scheduleContinuousTapeFrame();
  }
}
'''
text = replace_once(text, old_run, new_run, "continuous Tape animation")

write(path, text)


# Footprint: remove numeric delta and strengthen dominance colours.
path = "orderbook-flow-workspace.js"
text = read(path)
text = regex_once(
    text,
    r'''\nfunction formatSignedQuoteDelta\(value\) \{[\s\S]*?\n\}\n''',
    '\n',
    "remove footprint delta formatter",
)
text = replace_once(
    text,
    '        const alpha = .24 + clusterStrength * .42;',
    '        const alpha = .38 + clusterStrength * .5;',
    "brighter footprint fill",
)
text = replace_once(
    text,
    '''        state.context.strokeStyle = dominantSide === "B"
          ? rgbaHex(theme.green, .82)
          : dominantSide === "S"
            ? rgbaHex(theme.red, .82)
            : rgbaHex(theme.muted, .36);
        state.context.lineWidth = .75;''',
    '''        state.context.strokeStyle = dominantSide === "B"
          ? rgbaHex(theme.green, .98)
          : dominantSide === "S"
            ? rgbaHex(theme.red, .98)
            : rgbaHex(theme.muted, .52);
        state.context.lineWidth = 1;''',
    "brighter footprint outline",
)
old_values = '''        const deltaText = formatSignedQuoteDelta(cluster.buyQuote - cluster.sellQuote);
        const volumeText = formatQuoteVolume(cluster.quote);
        const valueWidth = Math.max(1, dataWidth * .47);
        state.context.fillStyle = theme.text;
        state.context.font = "800 6.2px Inter, system-ui, sans-serif";
        state.context.textAlign = "left";
        state.context.fillText(deltaText, dataLeft + 2, cluster.row.y, valueWidth);
        state.context.textAlign = "right";
        state.context.fillText(
          volumeText,
          dataLeft + dataWidth - 2,
          cluster.row.y,
          valueWidth,
        );
        state.context.textAlign = "center";
        state.context.font = "800 7px Inter, system-ui, sans-serif";
'''
new_values = '''        const volumeText = formatQuoteVolume(cluster.quote);
        state.context.fillStyle = theme.text;
        state.context.font = "850 6.7px Inter, system-ui, sans-serif";
        state.context.textAlign = "center";
        state.context.fillText(
          volumeText,
          dataLeft + dataWidth / 2,
          cluster.row.y,
          Math.max(1, dataWidth - 4),
        );
        state.context.font = "800 7px Inter, system-ui, sans-serif";
'''
text = replace_once(text, old_values, new_values, "volume-only footprint cells")
write(path, text)


# Chart: both candle bodies use the same dark interior; direction stays in stroke.
path = "chart.js"
text = read(path)
text = replace_once(
    text,
    '      const fill = up ? this.theme.bullFill : this.theme.bearFill;',
    '      const fill = this.theme.bearFill;',
    "matching candle body interiors",
)
write(path, text)


# Rewrite focused regression test.
write("test-tape-stability-followup-v1.mjs", '''import assert from "node:assert/strict";
import test from "node:test";
import { readFileSync } from "node:fs";
import {
  aggregateTapeBuckets,
  bookPriceEmphasis,
  bookPriceEmphasisForUnit,
  bookPsychologicalPriceUnit,
  resolveTapeWindowEnd,
} from "./orderbook.js";

const orderbook = readFileSync(new URL("./orderbook.js", import.meta.url), "utf8");
const footprint = readFileSync(new URL("./orderbook-flow-workspace.js", import.meta.url), "utf8");
const chart = readFileSync(new URL("./chart.js", import.meta.url), "utf8");


test("psychological levels keep one anchored unit for the selected symbol", () => {
  assert.equal(bookPsychologicalPriceUnit(.093), .001);
  assert.deepEqual(bookPriceEmphasis(.093, .093), {
    round: true,
    half: false,
    majorUnit: .001,
  });
  assert.deepEqual(bookPriceEmphasisForUnit(.0925, .001), {
    round: false,
    half: true,
    majorUnit: .001,
  });
  assert.match(orderbook, /function stableBookPsychologicalUnit\(card, referencePrice\)/);
  assert.match(orderbook, /bookPriceEmphasisForUnit\(price, majorUnit\)/);
});


test("Tape camera follows wall clock continuously instead of jumping by pixels", () => {
  assert.equal(resolveTapeWindowEnd(10_000, false, 10_500), 10_680);
  assert.equal(resolveTapeWindowEnd(11_000, false, 10_500), 11_180);
  assert.equal(resolveTapeWindowEnd(10_000, true, 10_500), 10_001);
  assert.doesNotMatch(orderbook, /snapTapeWindowEnd|tapeWindowPixelQuantum/);
  assert.match(orderbook, /function scheduleContinuousTapeFrame\(\)/);
  assert.match(orderbook, /const base = count >= 6 \? 72 : count >= 3 \? 48 : 32/);
  assert.match(orderbook, /const pathX = pathItem\.x \?\? tapeTimeX/);
});


test("AGG buckets keep their full historical volume and render only after close", () => {
  const buckets = aggregateTapeBuckets([
    { id: 1, time: 920, price: 10, quote: 100, side: "buy" },
    { id: 2, time: 1_000, price: 10, quote: 200, side: "sell" },
  ], .01, 0, { startTime: 970, endTime: 1_100 });
  assert.equal(buckets.length, 1);
  assert.equal(buckets[0].bucketStart, 900);
  assert.equal(buckets[0].bucketEnd, 1_080);
  assert.equal(buckets[0].quote, 300);
  assert.equal(buckets[0].buyQuote, 100);
  assert.equal(buckets[0].sellQuote, 200);
  assert.match(orderbook, /aggregateTapeBuckets\(stored, step, state\.aggLevelIndex, window\)/);
  assert.match(orderbook, /item\.bucketEnd <= aggregateClosedBefore/);
});


test("filter preserves all-trade path and labels every qualifying RAW marker", () => {
  assert.match(orderbook, /const rawPathItems = rawTapeItemsContinuous\(recent, rows, window\)/);
  assert.match(orderbook, /const pathDrawItems = layoutTapeSequence\(rawPathItems/);
  assert.match(orderbook, /if \(minQuote > 0\) \{[\s\S]*const label = formatTapeUsd\(item\.quote\)/);
  assert.match(orderbook, /Линия всех сделок · нет маркеров по фильтру/);
});


test("footprint keeps candle left, removes delta text and increases dominance contrast", () => {
  assert.match(footprint, /const candleLeft = columnLeft \+ 2/);
  assert.match(footprint, /const dataLeft = candleLeft \+ candleBodyWidth \+ 2/);
  assert.doesNotMatch(footprint, /formatSignedQuoteDelta|deltaText/);
  assert.match(footprint, /const alpha = \.38 \+ clusterStrength \* \.5/);
  assert.match(footprint, /dataLeft \+ dataWidth \/ 2/);
  assert.match(footprint, /formatQuoteVolume\(cluster\.quote\)/);
});


test("green and red chart candles share the same body interior", () => {
  assert.match(chart, /const fill = this\.theme\.bearFill;/);
  assert.match(chart, /const stroke = up \? this\.theme\.bullStroke : this\.theme\.bearStroke;/);
});
''')

# Refresh existing source assertions for the intentional contracts.
path = "test-orderbook-tape-v2-core.mjs"
text = read(path)
text = replace_once(
    text,
    '  assert.match(orderbook, /return latest \\+ \\(frozen \\? 1 : TAPE_LIVE_EDGE_LEAD_MS\\)/);',
    '  assert.match(orderbook, /Math\\.max\\(latest, current\\) \\+ TAPE_LIVE_EDGE_LEAD_MS/);',
    "Tape v2 clock assertion",
)
write(path, text)

path = "test-orderbook-visual-priority.mjs"
text = read(path)
text = replace_once(
    text,
    '  assert.match(flow, /formatQuoteVolume\\(cluster\\.quote\\)/);',
    '  assert.match(flow, /formatQuoteVolume\\(cluster\\.quote\\)/);\n  assert.doesNotMatch(flow, /formatSignedQuoteDelta|deltaText/);\n  assert.match(flow, /const alpha = \\.38 \\+ clusterStrength \\* \\.5/);',
    "footprint contrast assertion",
)
text = replace_once(
    text,
    '  assert.match(orderbook, /font-size: calc\\(7\\.4 \\* var\\(--font-scale\\)\\) !important/);\n  assert.match(orderbook, /font-size: calc\\(8\\.2 \\* var\\(--font-scale\\)\\) !important/);',
    '  assert.match(orderbook, /function stableBookPsychologicalUnit\\(card, referencePrice\\)/);\n  assert.doesNotMatch(orderbook, /font-weight: 950/);',
    "round emphasis assertion",
)
text = replace_once(
    text,
    '  assert.match(orderbook, /const pathY = snapTapeCoordinate\\(pathItem\\.row\\.y, dpr\\)/);',
    '  assert.match(orderbook, /const pathY = snapTapeCoordinate\\(pathItem\\.row\\.y, dpr\\)/);\n  assert.match(orderbook, /const pathX = pathItem\\.x \\?\\? tapeTimeX/);',
    "smooth x assertion",
)
write(path, text)

# Append feature flags.
path = "VERSION.txt"
text = read(path)
features = [
    "smooth-tape-camera-v1",
    "closed-agg-buckets-v1",
    "stable-round-level-anchor-v1",
    "brighter-footprint-dominance-v1",
    "directional-outline-candles-v1",
]
lines = text.splitlines()
for index, line in enumerate(lines):
    if line.startswith("Features:"):
        for feature in features:
            if feature not in line:
                line += f", {feature}"
        lines[index] = line
        break
write(path, "\n".join(lines) + "\n")

# Guard against stale contracts.
orderbook = read("orderbook.js")
footprint = read("orderbook-flow-workspace.js")
chart = read("chart.js")
assert OLD_BUILD not in "\n".join(
    read(path) for path in ["VERSION.txt", "app.js", "index.html", "orderbook.js", "sw.js"]
)
assert "snapTapeWindowEnd" not in orderbook
assert "formatSignedQuoteDelta" not in footprint
assert "const fill = this.theme.bearFill;" in chart
assert "item.bucketEnd <= aggregateClosedBefore" in orderbook
