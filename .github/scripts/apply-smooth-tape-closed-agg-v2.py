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


# Build/cache bump.
for path in Path(".").rglob("*"):
    if not path.is_file() or ".git" in path.parts or ".github" in path.parts:
        continue
    if path.suffix.lower() not in {".js", ".mjs", ".html", ".txt", ".webmanifest"}:
        continue
    text = read(path)
    if OLD_BUILD in text:
        write(path, text.replace(OLD_BUILD, NEW_BUILD))


# Tape and order-book runtime.
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
text = replace_once(text, old_emphasis, new_emphasis, "fixed psychological helper")

text = replace_once(
    text,
    'const TAPE_AGG_LABEL_QUANTILE = .95;\n',
    'const TAPE_AGG_LABEL_QUANTILE = .95;\nconst TAPE_AGG_EVENT_GRACE_MS = 60;\nconst TAPE_AGG_WALL_CLOCK_GRACE_MS = 650;\nconst TAPE_CAMERA_SPEED = 4;\n',
    "Tape close and camera constants",
)

first_round_styles = '''    .orderbook-card .book-ladder-row.is-price-half:not(.is-market) {
      background: rgba(151, 166, 177, .065);
    }
    .orderbook-card .book-ladder-row.is-price-half:not(.is-market) strong {
      border-left: 1px solid rgba(190, 204, 214, .28);
      color: #c9d5da;
      font-weight: 800;
    }
    .orderbook-card .book-ladder-row.is-price-round:not(.is-market) {
      background: color-mix(in srgb, var(--accent) 11%, rgba(166, 181, 192, .11));
      box-shadow: inset 0 1px rgba(218, 229, 235, .16),
                  inset 0 -1px rgba(218, 229, 235, .11);
    }
    .orderbook-card .book-ladder-row.is-price-round:not(.is-market) strong {
      border-left: 2px solid color-mix(in srgb, var(--accent) 76%, #fff);
      color: #f5fafc;
      font-weight: 950;
      letter-spacing: .015em;
    }
'''
quiet_round_styles = '''    .orderbook-card .book-ladder-row.is-price-half:not(.is-market),
    .orderbook-card .book-ladder-row.is-price-round:not(.is-market) {
      background: transparent !important;
      box-shadow: none !important;
    }
    .orderbook-card .book-ladder-row.is-price-half:not(.is-market) strong {
      border-left: 1px solid rgba(190, 204, 214, .32);
      color: inherit !important;
      font-size: inherit !important;
      font-weight: 800 !important;
      text-shadow: none !important;
      letter-spacing: 0 !important;
    }
    .orderbook-card .book-ladder-row.is-price-round:not(.is-market) strong {
      border-left: 2px solid color-mix(in srgb, var(--accent) 72%, #fff);
      color: inherit !important;
      font-size: inherit !important;
      font-weight: 800 !important;
      text-shadow: none !important;
      letter-spacing: 0 !important;
    }
'''
text = replace_once(text, first_round_styles, quiet_round_styles, "primary round styles")

secondary_round_styles = '''    .orderbook-card .book-ladder-row.is-price-half:not(.is-market),
    .orderbook-card .book-ladder-row.is-price-round:not(.is-market) {
      background: transparent !important;
      box-shadow: none !important;
    }
    .orderbook-card .book-ladder-row.is-price-half:not(.is-market) strong {
      border-left: 0 !important;
      color: #d2dbe0 !important;
      font-size: calc(7.4 * var(--font-scale)) !important;
      font-weight: 820 !important;
    }
    .orderbook-card .book-ladder-row.is-price-round:not(.is-market) strong {
      border-left: 0 !important;
      color: #f5fafc !important;
      font-size: calc(8.2 * var(--font-scale)) !important;
      font-weight: 950 !important;
      text-shadow: 0 0 6px color-mix(in srgb, var(--accent) 48%, transparent);
      letter-spacing: .015em;
    }
'''
text = replace_once(text, secondary_round_styles, quiet_round_styles, "visual-priority round styles")

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
    "psychological unit anchor",
)
text = replace_once(
    text,
    '''  const referencePrice = prices.length
    ? prices[Math.floor((prices.length - 1) / 2)]
    : null;
  for (const row of rows) {
    const price = parseRuntimeNumber(row.querySelector("strong")?.textContent);
    const emphasis = bookPriceEmphasis(price, referencePrice);
    row.classList.toggle("is-price-round", emphasis.round);
    row.classList.toggle("is-price-half", emphasis.half);
  }
''',
    '''  const referencePrice = prices.length
    ? prices[Math.floor((prices.length - 1) / 2)]
    : null;
  const majorUnit = stableBookPsychologicalUnit(card, referencePrice);
  for (const row of rows) {
    const price = parseRuntimeNumber(row.querySelector("strong")?.textContent);
    const emphasis = bookPriceEmphasisForUnit(price, majorUnit);
    row.classList.toggle("is-price-round", emphasis.round);
    row.classList.toggle("is-price-half", emphasis.half);
  }
''',
    "anchored row emphasis",
)

camera_block = '''export function advanceTapeCameraEnd(previousEnd, targetEnd, elapsedMs, speed = TAPE_CAMERA_SPEED) {
  const target = Number(targetEnd);
  const previous = Number(previousEnd);
  if (!Number.isFinite(target)) return Number.isFinite(previous) ? previous : null;
  if (!Number.isFinite(previous) || target <= previous) return target;
  const elapsed = Math.max(0, Math.min(250, Number(elapsedMs) || 0));
  const rate = Math.max(.25, Number(speed) || TAPE_CAMERA_SPEED);
  return Math.min(target, previous + Math.max(.5, elapsed * rate));
}

function smoothTapeWindowEnd(state, targetEnd, frozen, now = performance.now()) {
  const target = Number(targetEnd);
  const currentNow = Number(now) || performance.now();
  const previous = Number(state?.cameraEndTime);
  const previousAt = Number(state?.cameraUpdatedAt);
  const reset = frozen || !Number.isFinite(previous) || target < previous;
  const end = reset
    ? target
    : advanceTapeCameraEnd(previous, target, currentNow - previousAt);
  state.cameraEndTime = end;
  state.cameraUpdatedAt = currentNow;
  state.cameraAnimating = !frozen && Number.isFinite(end) && end < target - .25;
  return end;
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
    : Math.max(latest + 1, Date.now());
  const plotRight = safeWidth;
  return {
    duration,
    startTime: endTime - duration,
    endTime,
    plotRight,
  };
}

function tapeTimeX'''
text = regex_once(
    text,
    r'''export function tapeWindowPixelQuantum\(duration, width\) \{[\s\S]*?function tapeTimeX''',
    camera_block,
    "smooth target-bound camera",
)

text = replace_once(
    text,
    '''      hasFrame: false,
      lastRenderSignature: null,
''',
    '''      hasFrame: false,
      lastRenderSignature: null,
      cameraEndTime: null,
      cameraUpdatedAt: null,
      cameraAnimating: false,
      aggSnapshots: new Map(),
''',
    "Tape card animation state",
)

text = replace_once(
    text,
    '''          state.lastSymbol = nextSymbol;
          state.hasFrame = false;
          scheduleTapeDraw(true, card);''',
    '''          state.lastSymbol = nextSymbol;
          state.hasFrame = false;
          state.cameraEndTime = null;
          state.cameraUpdatedAt = null;
          state.cameraAnimating = false;
          state.aggSnapshots?.clear?.();
          scheduleTapeDraw(true, card);''',
    "reset Tape state on symbol",
)

text = replace_once(
    text,
    '''  const endTime = resolveTapeWindowEnd(latestTime, frozen);
  const window = buildContinuousTapeWindow(rect.width, latestTime, endTime, dpr);''',
    '''  const targetEndTime = resolveTapeWindowEnd(latestTime, frozen);
  const endTime = smoothTapeWindowEnd(state, targetEndTime, frozen);
  const window = buildContinuousTapeWindow(rect.width, latestTime, endTime);''',
    "animated Tape window",
)

aggregate_replacement = '''export function stableTapeQuoteStrength(value) {
  const quote = Math.max(0, Number(value) || 0);
  return clampTape(Math.log10(1 + quote / 100) / 3, 0, 1.35);
}

export function aggregateTapeBuckets(trades, priceStep = .01, levelIndex = 0, window = null) {
  const level = TAPE_AGGREGATION_LEVELS[Math.max(
    0,
    Math.min(TAPE_AGGREGATION_LEVELS.length - 1, Math.floor(Number(levelIndex) || 0)),
  )];
  const baseStep = Math.max(Number.EPSILON, Number(priceStep) || .01);
  const aggregateStep = baseStep * level.priceSteps;
  const aggregateStepKey = aggregateStep.toPrecision(12);
  const buckets = new Map();
  for (const trade of trades ?? []) {
    const time = Number(trade?.time);
    const price = Number(trade?.price);
    const quote = Number(trade?.quote);
    if (![time, price, quote].every(Number.isFinite) || quote <= 0) continue;
    const bucketStart = Math.floor(time / level.bucketMs) * level.bucketMs;
    const bucketEnd = bucketStart + level.bucketMs;
    if (window && (
      bucketEnd < Number(window.startTime)
      || bucketStart > Number(window.endTime)
    )) continue;
    const priceIndex = Math.round(price / aggregateStep);
    const key = `agg:${level.label}:${aggregateStepKey}:${bucketStart}:${priceIndex}`;
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
  return [...buckets.values()].sort((left, right) => (
    left.time - right.time || left.price - right.price || left.key.localeCompare(right.key)
  ));
}

function finalizedAggregateTapeBuckets(state, buckets, closedBefore) {
  if (!(state.aggSnapshots instanceof Map)) state.aggSnapshots = new Map();
  const output = [];
  for (const bucket of buckets ?? []) {
    let snapshot = state.aggSnapshots.get(bucket.key);
    if (!snapshot && bucket.bucketEnd <= closedBefore) {
      snapshot = Object.freeze({
        ...bucket,
        showLabel: stableTapeQuoteStrength(bucket.quote) >= .62,
      });
      state.aggSnapshots.set(bucket.key, snapshot);
    }
    if (snapshot) output.push(snapshot);
  }
  while (state.aggSnapshots.size > 1_800) {
    state.aggSnapshots.delete(state.aggSnapshots.keys().next().value);
  }
  return output;
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
text = regex_once(
    text,
    r'''export function aggregateTapeBuckets\(trades, priceStep = \.01, levelIndex = 0, window = null\) \{[\s\S]*?\n\}\n\nfunction aggregateTapeBurstsContinuous\(trades, rows, window, step, levelIndex = 0\) \{[\s\S]*?\n\}\n''',
    aggregate_replacement,
    "immutable finalized AGG",
)

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
  const aggregateClosedBefore = Math.max(
    latestTime - TAPE_AGG_EVENT_GRACE_MS,
    Date.now() - TAPE_AGG_WALL_CLOCK_GRACE_MS,
  );
  const closedAggregateBuckets = state.mode === "agg"
    ? finalizedAggregateTapeBuckets(
        state,
        aggregateTapeBuckets(stored, step, state.aggLevelIndex, window),
        aggregateClosedBefore,
      )
    : [];
  const aggregatedCandidates = closedAggregateBuckets
    .filter((item) => passesTapeFilter(item, minQuote, 0));
  const items = state.mode === "agg"
    ? positionAggregateTapeBuckets(closedAggregateBuckets, rows)
        .filter((item) => passesTapeFilter(item, minQuote, 0))
    : rawTapeItemsContinuous(rawCandidates, rows, window);

  const candidates = state.mode === "agg" ? aggregatedCandidates : rawCandidates;
'''
text = replace_once(text, old_candidates, new_candidates, "finalized AGG rendering")

text = replace_once(
    text,
    '''      const pathX = snapTapeCoordinate(pathItem.x ?? tapeTimeX(
        pathItem.lastTime ?? pathItem.time,
        window,
        rect.width,
      ), dpr);''',
    '''      const pathX = pathItem.x ?? tapeTimeX(
        pathItem.lastTime ?? pathItem.time,
        window,
        rect.width,
      );''',
    "continuous path X",
)
text = replace_once(
    text,
    '''    const baseX = snapTapeCoordinate(
      item.x ?? tapeTimeX(item.lastTime ?? item.time, window, rect.width),
      dpr,
    );''',
    '''    const baseX = item.x
      ?? tapeTimeX(item.lastTime ?? item.time, window, rect.width);''',
    "continuous marker X",
)

text = replace_once(
    text,
    '''  const quotes = items.map((item) => Number(item.quote) || 0).filter((value) => value > 0);
  const strengthFor = createTapeStrengthScale(quotes);''',
    '''  const quotes = items.map((item) => Number(item.quote) || 0).filter((value) => value > 0);
  const strengthFor = state.mode === "agg"
    ? stableTapeQuoteStrength
    : createTapeStrengthScale(quotes);''',
    "stable AGG marker strength",
)

text = regex_once(
    text,
    r'''  const aggLabels = state\.mode === "agg"[\s\S]*?    : new Set\(\);''',
    '''  const aggLabels = state.mode === "agg"
    ? new Set(drawItems
        .filter((item) => minQuote > 0 || item.showLabel)
        .map((item) => item.key))
    : new Set();''',
    "stable AGG label decisions",
)

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
  const base = count >= 6 ? 64 : count >= 3 ? 32 : 16;
  const symbols = new Set(
    [...document.querySelectorAll(".orderbook-card")]
      .map((card) => cardSymbol(card))
      .filter(Boolean),
  );
  const recentRate = [...symbols]
    .reduce((total, symbol) => total + (tapeRecentRateBySymbol.get(symbol) || 0), 0);
  if (recentRate > 1_200) return Math.max(base, 72);
  if (recentRate > 600) return Math.max(base, 48);
  if (recentRate > 250) return Math.max(base, 32);
  return base;
}

function animatedTapeCards() {
  return [...document.querySelectorAll(".orderbook-card")].filter((card) => {
    const state = tapeCardStates.get(card);
    return Boolean(card.isConnected && state?.tapeVisible && state.cameraAnimating);
  });
}

function scheduleAnimatedTapeFrame() {
  if (tapeDocumentHidden || tapeDrawFrame || tapeDrawTimer) return;
  const cards = animatedTapeCards();
  if (!cards.length) return;
  tapeDrawTimer = setTimeout(() => {
    tapeDrawTimer = 0;
    const activeCards = animatedTapeCards();
    activeCards.forEach((card) => dirtyTapeCards.add(card));
    tapeNeedsDraw = dirtyTapeCards.size > 0;
    if (tapeNeedsDraw && !tapeDrawFrame) {
      tapeDrawFrame = requestAnimationFrame(runTapeDrawFrame);
    }
  }, targetTapeFrameMs());
}
'''
text = replace_once(text, old_target, new_target, "smooth camera scheduler")
text = replace_once(
    text,
    '''function runTapeDrawFrame() {
  tapeDrawFrame = 0;
  tapeLastDrawAt = performance.now();
  if (tapeNeedsDraw) drawAllTapes();
  if (tapeNeedsDraw && !tapeDocumentHidden) {
    tapeDrawFrame = requestAnimationFrame(runTapeDrawFrame);
  }
}
''',
    '''function runTapeDrawFrame() {
  tapeDrawFrame = 0;
  tapeLastDrawAt = performance.now();
  if (tapeNeedsDraw) drawAllTapes();
  if (tapeNeedsDraw && !tapeDocumentHidden) {
    tapeDrawFrame = requestAnimationFrame(runTapeDrawFrame);
  } else {
    scheduleAnimatedTapeFrame();
  }
}
''',
    "animated Tape continuation",
)

text = replace_once(
    text,
    '''      const state = tapeCardStates.get(card);
      if (state) state.hasFrame = false;''',
    '''      const state = tapeCardStates.get(card);
      if (state) {
        state.hasFrame = false;
        state.cameraEndTime = null;
        state.cameraUpdatedAt = null;
        state.cameraAnimating = false;
        state.aggSnapshots?.clear?.();
      }''',
    "reset Tape on replace",
)

write(path, text)


# Footprint: remove numeric delta, keep total volume, increase contrast.
path = "orderbook-flow-workspace.js"
text = read(path)
text = regex_once(
    text,
    r'''\nfunction formatSignedQuoteDelta\(value\) \{[\s\S]*?\n\}\n''',
    '\n',
    "remove delta formatter",
)
text = replace_once(text, '        const alpha = .24 + clusterStrength * .42;', '        const alpha = .38 + clusterStrength * .5;', "stronger cells")
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
    "stronger cell outlines",
)
text = replace_once(
    text,
    '''        const deltaText = formatSignedQuoteDelta(cluster.buyQuote - cluster.sellQuote);
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
''',
    '''        const volumeText = formatQuoteVolume(cluster.quote);
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
''',
    "volume-only cells",
)
write(path, text)


# Chart: green/red bodies share dark interior, direction stays in outline.
path = "chart.js"
text = read(path)
text = replace_once(text, '      const fill = up ? this.theme.bullFill : this.theme.bearFill;', '      const fill = this.theme.bearFill;', "matching body interiors")
write(path, text)


# Focused regression tests.
write("test-tape-stability-followup-v1.mjs", '''import assert from "node:assert/strict";
import test from "node:test";
import { readFileSync } from "node:fs";
import {
  advanceTapeCameraEnd,
  aggregateTapeBuckets,
  bookPriceEmphasis,
  bookPriceEmphasisForUnit,
  bookPsychologicalPriceUnit,
  resolveTapeWindowEnd,
  stableTapeQuoteStrength,
} from "./orderbook.js";

const orderbook = readFileSync(new URL("./orderbook.js", import.meta.url), "utf8");
const footprint = readFileSync(new URL("./orderbook-flow-workspace.js", import.meta.url), "utf8");
const chart = readFileSync(new URL("./chart.js", import.meta.url), "utf8");

test("psychological levels keep one anchored unit per symbol", () => {
  assert.equal(bookPsychologicalPriceUnit(.093), .001);
  assert.deepEqual(bookPriceEmphasis(.093, .093), { round: true, half: false, majorUnit: .001 });
  assert.deepEqual(bookPriceEmphasisForUnit(.0925, .001), { round: false, half: true, majorUnit: .001 });
  assert.match(orderbook, /function stableBookPsychologicalUnit\(card, referencePrice\)/);
  assert.match(orderbook, /bookPriceEmphasisForUnit\(price, majorUnit\)/);
});

test("Tape camera eases only toward the latest real-trade target", () => {
  assert.equal(resolveTapeWindowEnd(10_000, false, 20_000), 10_180);
  assert.equal(resolveTapeWindowEnd(10_000, true, 20_000), 10_001);
  assert.equal(advanceTapeCameraEnd(null, 11_000, 16), 11_000);
  assert.ok(Math.abs(advanceTapeCameraEnd(10_000, 11_000, 16, 4) - 10_064) < 1e-9);
  assert.equal(advanceTapeCameraEnd(10_980, 11_000, 16, 4), 11_000);
  assert.doesNotMatch(orderbook, /snapTapeWindowEnd|tapeWindowPixelQuantum/);
  assert.match(orderbook, /function scheduleAnimatedTapeFrame\(\)/);
  assert.match(orderbook, /const base = count >= 6 \? 64 : count >= 3 \? 32 : 16/);
  assert.match(orderbook, /const pathX = pathItem\.x \?\? tapeTimeX/);
});

test("AGG buckets include the complete intersecting bucket", () => {
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
  assert.match(orderbook, /function finalizedAggregateTapeBuckets\(state, buckets, closedBefore\)/);
  assert.match(orderbook, /aggregateTapeBuckets\(stored, step, state\.aggLevelIndex, window\)/);
  assert.match(orderbook, /snapshot = Object\.freeze/);
});

test("AGG marker size and label eligibility are absolute and immutable", () => {
  assert.equal(stableTapeQuoteStrength(0), 0);
  assert.ok(stableTapeQuoteStrength(10_000) > stableTapeQuoteStrength(1_000));
  assert.match(orderbook, /state\.mode === "agg"[\s\S]*stableTapeQuoteStrength/);
  assert.match(orderbook, /showLabel: stableTapeQuoteStrength\(bucket\.quote\) >= \.62/);
  assert.match(orderbook, /minQuote > 0 \|\| item\.showLabel/);
});

test("filter keeps the all-trade line and labels qualifying RAW trades", () => {
  assert.match(orderbook, /const rawPathItems = rawTapeItemsContinuous\(recent, rows, window\)/);
  assert.match(orderbook, /const pathDrawItems = layoutTapeSequence\(rawPathItems/);
  assert.match(orderbook, /if \(minQuote > 0\) \{[\s\S]*const label = formatTapeUsd\(item\.quote\)/);
});

test("footprint removes numeric delta and strengthens dominance colours", () => {
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

path = "test-orderbook-visual-priority.mjs"
text = read(path)
text = replace_once(
    text,
    '  assert.match(flow, /formatQuoteVolume\\(cluster\\.quote\\)/);',
    '  assert.match(flow, /formatQuoteVolume\\(cluster\\.quote\\)/);\n  assert.doesNotMatch(flow, /formatSignedQuoteDelta|deltaText/);\n  assert.match(flow, /const alpha = \\.38 \\+ clusterStrength \\* \\.5/);',
    "footprint test assertions",
)
text = replace_once(
    text,
    '''  assert.match(orderbook, /font-size: calc\(7\.4 \* var\(--font-scale\)\) !important/);
  assert.match(orderbook, /font-size: calc\(8\.2 \* var\(--font-scale\)\) !important/);''',
    '''  assert.match(orderbook, /function stableBookPsychologicalUnit\(card, referencePrice\)/);
  assert.match(orderbook, /is-price-round:not\(\.is-market\) strong \{[\s\S]*font-size: inherit !important;[\s\S]*font-weight: 800 !important;/);''',
    "round-level test assertions",
)
text = replace_once(
    text,
    '  assert.match(orderbook, /const pathY = snapTapeCoordinate\\(pathItem\\.row\\.y, dpr\\)/);',
    '  assert.match(orderbook, /const pathY = snapTapeCoordinate\\(pathItem\\.row\\.y, dpr\\)/);\n  assert.match(orderbook, /const pathX = pathItem\\.x \\?\\? tapeTimeX/);',
    "smooth X test assertion",
)
write(path, text)

# Feature flags.
path = "VERSION.txt"
text = read(path)
features = [
    "smooth-tape-camera-v2",
    "immutable-closed-agg-v1",
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

# Final guards.
orderbook = read("orderbook.js")
footprint = read("orderbook-flow-workspace.js")
chart = read("chart.js")
assert OLD_BUILD not in "\n".join(read(p) for p in ["VERSION.txt", "app.js", "index.html", "orderbook.js", "sw.js"])
assert "snapTapeWindowEnd" not in orderbook
assert "formatSignedQuoteDelta" not in footprint
assert "const fill = this.theme.bearFill;" in chart
assert "snapshot = Object.freeze" in orderbook
assert "font-size: calc(8.2" not in orderbook
