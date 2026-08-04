from pathlib import Path
import re

ROOT = Path(__file__).resolve().parents[1]
OLD_KEY = "26-112-tape-series-v1"
NEW_KEY = "26-113-flow-candles-series-header-v1"


def read(path):
    return (ROOT / path).read_text(encoding="utf-8")


def write(path, content):
    (ROOT / path).write_text(content, encoding="utf-8")


def replace_once(text, old, new, label):
    count = text.count(old)
    if count != 1:
        raise SystemExit(f"{label}: expected 1 match, found {count}")
    return text.replace(old, new, 1)


def replace_js_function(text, name, replacement):
    marker = f"function {name}("
    start = text.find(marker)
    if start < 0:
        marker = f"export function {name}("
        start = text.find(marker)
    if start < 0:
        raise SystemExit(f"function {name}: not found")
    brace = text.find("{", start)
    if brace < 0:
        raise SystemExit(f"function {name}: opening brace not found")
    depth = 0
    quote = None
    escape = False
    template_depth = 0
    index = brace
    while index < len(text):
        char = text[index]
        if quote:
            if escape:
                escape = False
            elif char == "\\":
                escape = True
            elif char == quote and template_depth == 0:
                quote = None
            elif quote == "`" and char == "$" and index + 1 < len(text) and text[index + 1] == "{":
                template_depth += 1
                depth += 1
                index += 1
        else:
            if char in ('"', "'", "`"):
                quote = char
            elif char == "{":
                depth += 1
            elif char == "}":
                depth -= 1
                if template_depth and quote == "`":
                    template_depth -= 1
                if depth == 0:
                    end = index + 1
                    return text[:start] + replacement.rstrip() + text[end:]
        index += 1
    raise SystemExit(f"function {name}: closing brace not found")


# One atomic runtime key across browser entry points and contract tests.
for path in ROOT.rglob("*"):
    if not path.is_file() or ".git" in path.parts:
        continue
    if path.name == Path(__file__).name or path.name == "agent-flow-candles-series-header-v1.yml":
        continue
    if path.suffix.lower() not in {".js", ".mjs", ".html", ".css", ".txt", ".webmanifest"}:
        continue
    text = path.read_text(encoding="utf-8")
    if OLD_KEY in text:
        path.write_text(text.replace(OLD_KEY, NEW_KEY), encoding="utf-8")


# Move the existing brightness control from Settings into the header, between Download and Sound.
path = "index.html"
html = read(path)
settings_match = re.search(
    r'\n\s*<label class="comfort-control settings-comfort-control"[\s\S]*?</label>',
    html,
)
if not settings_match:
    raise SystemExit("settings brightness control not found")
html = html[:settings_match.start()] + html[settings_match.end():]
header_control = '''
        <label class="comfort-control header-comfort-control" title="Яркость интерфейса">
          <span class="comfort-track" aria-hidden="true">
            <span class="comfort-thumb-icon">
              <svg class="comfort-sun" viewBox="0 0 24 24"><circle cx="12" cy="12" r="3.5"/><path d="M12 2.5v2M12 19.5v2M2.5 12h2M19.5 12h2M5.3 5.3l1.4 1.4M17.3 17.3l1.4 1.4M18.7 5.3l-1.4 1.4M6.7 17.3l-1.4 1.4"/></svg>
              <svg class="comfort-moon" viewBox="0 0 24 24"><path d="M19.4 15.2A8 8 0 0 1 8.8 4.6 8.1 8.1 0 1 0 19.4 15.2Z"/></svg>
            </span>
          </span>
          <input id="comfort-slider" type="range" min="0" max="100" value="55" aria-label="Яркость интерфейса: слева светлее, справа темнее" />
        </label>'''
install_start = html.find('<button id="install-app"')
install_end = html.find('</button>', install_start)
if install_start < 0 or install_end < 0:
    raise SystemExit("install button not found")
install_end += len('</button>')
html = html[:install_end] + header_control + html[install_end:]
write(path, html)


# Compact brightness control that remains visible between Download and Sound.
path = "styles.css"
styles = read(path)
styles += '''

/* v26.113 flow candles, Tape series staircase and header brightness */
.header-comfort-control {
  width: 96px;
  min-width: 76px;
  height: 32px;
  flex: 0 1 96px;
  padding: 0 8px;
  border-radius: 8px;
}
.header-comfort-control .comfort-track { width: 80px; }
.header-comfort-control input { inset: 0 8px; width: 80px; }
@media (max-width: 1180px) {
  .header-comfort-control { width: 78px; flex-basis: 78px; }
  .header-comfort-control .comfort-track,
  .header-comfort-control input { width: 62px; }
}
@media (max-width: 720px) {
  .header-comfort-control { display: grid !important; width: 68px; min-width: 68px; height: 30px; flex-basis: 68px; padding-inline: 6px; }
  .header-comfort-control .comfort-track,
  .header-comfort-control input { width: 56px; }
}
@media (max-width: 470px) {
  .header-comfort-control { width: 58px; min-width: 58px; flex-basis: 58px; }
  .header-comfort-control .comfort-track,
  .header-comfort-control input { width: 46px; }
}
'''
write(path, styles)


# Header contract: four buttons stay four; brightness is a separate control in the requested slot.
path = "test-header-command-bar-v1.mjs"
test_header = read(path)
old_test = '''test("brightness and radar controls live in settings, not the header", () => {
  const html = read("./index.html");
  const header = html.match(/<header class="topbar">[\\s\\S]*?<\\/header>/)?.[0] ?? "";
  const settings = html.match(/<dialog id="settings-dialog"[\\s\\S]*?<\\/dialog>/)?.[0] ?? "";
  assert.doesNotMatch(header, /comfort-slider|event-radar-beta-toggle/);
  assert.match(settings, /comfort-slider/);
  assert.match(settings, /event-radar-beta-toggle/);
});'''
new_test = '''test("brightness sits between Download and Sound while radar stays in settings", () => {
  const html = read("./index.html");
  const header = html.match(/<header class="topbar">[\\s\\S]*?<\\/header>/)?.[0] ?? "";
  const settings = html.match(/<dialog id="settings-dialog"[\\s\\S]*?<\\/dialog>/)?.[0] ?? "";
  const download = header.indexOf('id="install-app"');
  const brightness = header.indexOf('id="comfort-slider"');
  const sound = header.indexOf('id="sound-toggle"');
  assert.ok(download >= 0 && brightness > download && sound > brightness);
  assert.doesNotMatch(header, /event-radar-beta-toggle/);
  assert.doesNotMatch(settings, /comfort-slider/);
  assert.match(settings, /event-radar-beta-toggle/);
});'''
test_header = replace_once(test_header, old_test, new_test, "update header brightness contract")
write(path, test_header)


# Footprint: ignore the transient off-grid market row, use a stable price projection,
# and clamp OHLC points so partially visible candles remain visible.
path = "orderbook-flow-workspace.js"
flow = read(path)
nearest_replacement = '''export function stableFootprintProjectionRows(rows) {
  const normalized = (rows ?? [])
    .map((row) => ({
      ...row,
      index: Number(row?.index),
      price: Number(row?.price),
      y: Number(row?.y),
      height: Math.max(1, Number(row?.height) || 1),
    }))
    .filter((row) => Number.isFinite(row.price) && Number.isFinite(row.y))
    .sort((left, right) => left.price - right.price);
  if (normalized.length < 3) return normalized;
  const step = stableFootprintPriceStep(normalized);
  if (!Number.isFinite(step) || step <= Number.EPSILON) return normalized;

  let best = [];
  for (const anchor of normalized) {
    const aligned = normalized.filter((row) => {
      const units = (row.price - anchor.price) / step;
      return Math.abs(units - Math.round(units)) <= .08;
    });
    if (aligned.length > best.length) best = aligned;
  }
  return best.length >= 2 ? best : normalized;
}

export function projectFootprintPriceRow(rows, price, clampToViewport = false) {
  const target = Number(price);
  const ordered = stableFootprintProjectionRows(rows);
  if (!ordered.length || !Number.isFinite(target)) return null;
  if (ordered.length === 1) {
    if (!clampToViewport && Math.abs(target - ordered[0].price) > Number.EPSILON) return null;
    return { ...ordered[0], price: target, clipped: target !== ordered[0].price };
  }

  const step = rowStep(ordered);
  if (!Number.isFinite(step)) return null;
  const low = ordered[0];
  const high = ordered.at(-1);
  const tolerance = step * .55 + Number.EPSILON;
  if (target < low.price - tolerance) {
    return clampToViewport ? { ...low, price: target, clipped: true } : null;
  }
  if (target > high.price + tolerance) {
    return clampToViewport ? { ...high, price: target, clipped: true } : null;
  }

  const interpolate = (left, right) => {
    const span = right.price - left.price;
    const ratio = Math.abs(span) <= Number.EPSILON ? 0 : (target - left.price) / span;
    return {
      price: target,
      y: left.y + (right.y - left.y) * ratio,
      height: left.height + (right.height - left.height) * ratio,
      clipped: false,
    };
  };
  if (target <= low.price) return interpolate(low, ordered[1]);
  if (target >= high.price) return interpolate(ordered.at(-2), high);
  for (let index = 1; index < ordered.length; index += 1) {
    if (target <= ordered[index].price) return interpolate(ordered[index - 1], ordered[index]);
  }
  return null;
}

function nearestRow(rows, price, clampToViewport = false) {
  return projectFootprintPriceRow(rows, price, clampToViewport);
}'''
flow = replace_js_function(flow, "nearestRow", nearest_replacement)

candle_start = flow.find('      const highRow = nearestRow(rows, interval.highPrice);')
candle_end = flow.find('      state.context.fillStyle = theme.panel;', candle_start)
if candle_start < 0 or candle_end < 0:
    raise SystemExit("footprint candle block not found")
new_candle = '''      const highRow = nearestRow(rows, interval.highPrice, true);
      const lowRow = nearestRow(rows, interval.lowPrice, true);
      const openRow = nearestRow(rows, interval.openPrice, true);
      const closeRow = nearestRow(rows, interval.closePrice, true);
      if (highRow && lowRow && openRow && closeRow) {
        const rising = Number(interval.closePrice) >= Number(interval.openPrice);
        const candleTop = 2;
        const candleBottom = Math.max(candleTop, height - 29);
        const candleY = (row) => clamp(Number(row.y), candleTop, candleBottom);
        const highY = candleY(highRow);
        const lowY = candleY(lowRow);
        const openY = candleY(openRow);
        const closeY = candleY(closeRow);
        const bodyTop = Math.min(openY, closeY);
        const bodyHeight = Math.max(1.5, Math.abs(closeY - openY));
        const bodyWidth = Math.max(2, Math.min(8, candleBodyWidth * 1.22));
        const bodyLeft = candleX - bodyWidth / 2;

        state.context.save();
        state.context.beginPath();
        state.context.rect(columnLeft, candleTop, Math.max(1, dataLeft - columnLeft), Math.max(1, candleBottom - candleTop));
        state.context.clip();
        state.context.strokeStyle = rising ? theme.bullStroke : theme.bearStroke;
        // Match the main chart: a dark filled body with directional outline and wick.
        state.context.fillStyle = theme.bearFill;
        state.context.lineWidth = 1;
        state.context.beginPath();
        state.context.moveTo(candleX, highY);
        state.context.lineTo(candleX, lowY);
        state.context.stroke();
        state.context.fillRect(bodyLeft, bodyTop, bodyWidth, bodyHeight);
        state.context.strokeRect(bodyLeft, bodyTop, bodyWidth, bodyHeight);
        state.context.restore();
      }

'''
flow = flow[:candle_start] + new_candle + flow[candle_end:]

old_footer = '''      state.context.fillStyle = theme.panel;
      state.context.fillRect(columnLeft + 1, height - 22, Math.max(0, columnWidth - 2), 22);
      state.context.textAlign = "center";
      state.context.fillStyle = rgbaHex(theme.text, .94);
      state.context.font = "800 6.5px Inter, system-ui, sans-serif";
      state.context.fillText(
        formatQuoteVolume(interval.quote),
        labelX,
        height - 16,
        Math.max(1, columnWidth - 4),
      );
      state.context.fillStyle = interval.partial
        ? rgbaHex(theme.green, .96)
        : rgbaHex(theme.muted, .82);
      state.context.font = "700 6.5px Inter, system-ui, sans-serif";
      state.context.fillText(
        `${formatIntervalClock(interval.startTime)}${interval.partial ? " · LIVE" : ""}${interval.sessionPartial ? " · P" : ""}`,
        labelX,
        height - 5,
        Math.max(1, columnWidth - 4),
      );
      state.context.font = "800 7px Inter, system-ui, sans-serif";'''
new_footer = '''      state.context.fillStyle = theme.panel;
      state.context.fillRect(columnLeft + 1, height - 28, Math.max(0, columnWidth - 2), 28);
      state.context.textAlign = "center";
      state.context.fillStyle = rgbaHex(theme.text, .97);
      state.context.font = "800 8.5px Inter, system-ui, sans-serif";
      state.context.fillText(
        formatQuoteVolume(interval.quote),
        labelX,
        height - 19,
        Math.max(1, columnWidth - 4),
      );
      state.context.fillStyle = interval.partial
        ? rgbaHex(theme.green, 1)
        : rgbaHex(theme.muted, .9);
      state.context.font = "750 7.5px Inter, system-ui, sans-serif";
      state.context.fillText(
        `${formatIntervalClock(interval.startTime)}${interval.partial ? " · LIVE" : ""}${interval.sessionPartial ? " · P" : ""}`,
        labelX,
        height - 6,
        Math.max(1, columnWidth - 4),
      );
      state.context.font = "800 7px Inter, system-ui, sans-serif";'''
flow = replace_once(flow, old_footer, new_footer, "enlarge footprint footer")
write(path, flow)


# Tape: brighter second ticks and a true time/price staircase for SERIES.
path = "orderbook.js"
orderbook = read(path)
new_timeline = '''function drawTapeTimeline(context, rect, window) {
  const right = Math.max(2, Math.min(Number(window?.plotRight) || rect.width, rect.width));
  const seconds = Math.max(1, window.duration / TAPE_SECOND_MS);
  const pixelsPerSecond = right / seconds;
  const stepSeconds = pixelsPerSecond >= TAPE_TIMELINE_MIN_LABEL_GAP_PX
    ? 1
    : pixelsPerSecond * 2 >= TAPE_TIMELINE_MIN_LABEL_GAP_PX
      ? 2
      : pixelsPerSecond * 5 >= TAPE_TIMELINE_MIN_LABEL_GAP_PX
        ? 5
        : 10;
  const stepMs = stepSeconds * TAPE_SECOND_MS;
  const firstTick = Math.ceil(window.startTime / stepMs) * stepMs;

  context.save();
  context.lineWidth = .95;
  context.strokeStyle = "rgba(66, 225, 173, .46)";
  context.fillStyle = "rgba(177, 205, 197, .88)";
  context.font = "750 8px Inter, system-ui, sans-serif";
  context.textAlign = "center";
  context.textBaseline = "bottom";

  for (let time = firstTick; time < window.endTime; time += stepMs) {
    const x = tapeTimeX(time, window, rect.width);
    if (x < 20 || x > right - 20) continue;
    context.beginPath();
    context.moveTo(x, rect.height - 6);
    context.lineTo(x, rect.height);
    context.stroke();
    context.fillText(formatTapeClock(time), x, rect.height - 7);
  }

  context.restore();
}'''
orderbook = replace_js_function(orderbook, "drawTapeTimeline", new_timeline)

new_series = '''export function aggregateTapeSeries(trades, maximumGapMs = TAPE_SERIES_MAX_GAP_MS) {
  const gapLimit = Math.max(20, Number(maximumGapMs) || TAPE_SERIES_MAX_GAP_MS);
  const ordered = [...(trades ?? [])]
    .filter((trade) => {
      const executionTime = Number(trade?.tradeTime ?? trade?.eventTime ?? trade?.time);
      const displayTime = Number(trade?.displayTime ?? trade?.time);
      const price = Number(trade?.price);
      const quote = Number(trade?.quote);
      return [executionTime, displayTime, price, quote].every(Number.isFinite) && quote > 0;
    })
    .sort((left, right) => {
      const leftTime = Number(left.tradeTime ?? left.eventTime ?? left.time);
      const rightTime = Number(right.tradeTime ?? right.eventTime ?? right.time);
      const timeDelta = leftTime - rightTime;
      if (timeDelta) return timeDelta;
      const leftId = Number(left.id);
      const rightId = Number(right.id);
      if (Number.isFinite(leftId) && Number.isFinite(rightId) && leftId !== rightId) return leftId - rightId;
      return String(left.id).localeCompare(String(right.id));
    });

  const groups = [];
  const ordinalByTime = new Map();
  let current = null;
  const finish = () => {
    if (!current) return;
    current.vwapPrice = current.quantity > 0 ? current.quote / current.quantity : current.firstPrice;
    current.price = current.lastPrice;
    current.lastTime = current.time;
    current.durationMs = Math.max(0, current.lastEventTime - current.firstEventTime);
    current.bucketStart = current.firstEventTime;
    current.bucketEnd = current.lastEventTime;
    current.bucketMs = gapLimit;
    const ordinal = ordinalByTime.get(current.time) ?? 0;
    current.timeOrdinal = ordinal;
    ordinalByTime.set(current.time, ordinal + 1);
    groups.push(current);
    current = null;
  };

  for (const trade of ordered) {
    const executionTime = Number(trade.tradeTime ?? trade.eventTime ?? trade.time);
    const displayTime = Number(trade.displayTime ?? trade.time);
    const side = trade.side === "sell" ? "sell" : "buy";
    const price = Number(trade.price);
    const quote = Number(trade.quote);
    const quantity = Number.isFinite(Number(trade.quantity)) && Number(trade.quantity) > 0
      ? Number(trade.quantity)
      : quote / price;
    const continues = current && current.side === side && executionTime - current.lastEventTime <= gapLimit;

    if (!continues) {
      finish();
      current = {
        key: `series:${executionTime}:${side}:${tapeTradeKey(trade)}`,
        time: displayTime,
        lastTime: displayTime,
        eventTime: executionTime,
        firstEventTime: executionTime,
        lastEventTime: executionTime,
        side,
        firstPrice: price,
        lastPrice: price,
        minPrice: price,
        maxPrice: price,
        price,
        vwapPrice: price,
        quantity: 0,
        quote: 0,
        buyQuote: 0,
        sellQuote: 0,
        count: 0,
        steps: [],
      };
    }

    current.time = Math.max(Number(current.time) || displayTime, displayTime);
    current.lastTime = current.time;
    current.lastEventTime = executionTime;
    current.lastPrice = price;
    current.minPrice = Math.min(current.minPrice, price);
    current.maxPrice = Math.max(current.maxPrice, price);
    current.quantity += quantity;
    current.quote += quote;
    current[side === "sell" ? "sellQuote" : "buyQuote"] += quote;
    current.count += 1;

    const previousStep = current.steps.at(-1);
    if (previousStep && previousStep.time === displayTime) {
      previousStep.price = price;
      previousStep.quote += quote;
      previousStep.count += 1;
    } else {
      current.steps.push({ time: displayTime, eventTime: executionTime, price, quote, count: 1 });
    }
  }

  finish();
  return groups;
}'''
orderbook = replace_js_function(orderbook, "aggregateTapeSeries", new_series)

series_drawer = '''
function drawTapeSeriesLadder(context, item, viewport, window, rect, stroke, openSeries) {
  const points = [];
  for (const step of item?.steps ?? []) {
    const position = projectTapePrice(viewport, step.price);
    if (!position) continue;
    points.push({
      x: tapeTradeX(step.time, window, rect.width),
      y: position.y,
      time: step.time,
      price: step.price,
    });
  }
  if (!points.length) return null;

  context.save();
  context.beginPath();
  context.rect(0, 0, Math.max(1, window.plotRight), Math.max(1, rect.height - 16));
  context.clip();
  context.strokeStyle = stroke;
  context.lineWidth = openSeries ? 1.65 : 1.2;
  context.lineJoin = "round";
  context.lineCap = "square";
  context.globalAlpha = openSeries ? .98 : .82;
  context.beginPath();
  context.moveTo(points[0].x, points[0].y);
  for (let index = 1; index < points.length; index += 1) {
    const previous = points[index - 1];
    const next = points[index];
    context.lineTo(next.x, previous.y);
    context.lineTo(next.x, next.y);
  }
  context.stroke();
  const terminal = points.at(-1);
  context.beginPath();
  context.arc(terminal.x, terminal.y, openSeries ? 2.4 : 1.8, 0, Math.PI * 2);
  context.fillStyle = stroke;
  context.fill();
  context.restore();
  return terminal;
}

'''
marker = "function drawTapeCard(card) {"
if marker not in orderbook:
    raise SystemExit("drawTapeCard marker not found")
orderbook = orderbook.replace(marker, series_drawer + marker, 1)

loop_marker = '''    const baseX = tapeTradeX(item.time, window, rect.width);

    if (state.mode === "raw") {'''
loop_replacement = '''    const baseX = tapeTradeX(item.time, window, rect.width);

    if (state.mode === "series") {
      const openSeries = item.status === "open";
      const terminal = drawTapeSeriesLadder(
        context,
        item,
        state.priceViewport,
        window,
        rect,
        stroke,
        openSeries,
      );
      if (!terminal) continue;
      const label = formatTapeUsd(item.quote);
      const labelHeight = clampTape(8 + strength * 5, 8, 14);
      const measured = context.measureText(label).width;
      const labelWidth = clampTape(measured + 10, 22, Math.min(88, rect.width * .28));
      const labelX = clampTape(
        terminal.x,
        labelWidth / 2 + .5,
        Math.max(labelWidth / 2 + .5, window.plotRight - labelWidth / 2 - .5),
      );
      const labelY = clampTape(
        terminal.y,
        labelHeight / 2 + .5,
        Math.max(labelHeight / 2 + .5, rect.height - 17 - labelHeight / 2),
      );
      roundedRectPath(
        context,
        labelX - labelWidth / 2,
        labelY - labelHeight / 2,
        labelWidth,
        labelHeight,
        labelHeight * .28,
      );
      context.fillStyle = buy
        ? `rgba(42, 191, 137, ${openSeries ? .7 : .78})`
        : `rgba(222, 70, 87, ${openSeries ? .72 : .8})`;
      context.fill();
      context.lineWidth = 1;
      context.strokeStyle = stroke;
      context.stroke();
      context.fillStyle = "rgba(244, 250, 248, .99)";
      context.fillText(label, labelX, labelY + .2);
      continue;
    }

    if (state.mode === "raw") {'''
orderbook = replace_once(orderbook, loop_marker, loop_replacement, "insert Tape series staircase renderer")
write(path, orderbook)


# Dedicated regression coverage for stable cluster projection, partial candles,
# main-chart candle styling, the staircase and header placement.
test_path = ROOT / "test-flow-candles-series-header-v1.mjs"
test_path.write_text('''import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";

import {
  projectFootprintPriceRow,
  stableFootprintProjectionRows,
} from "./orderbook-flow-workspace.js?v=26-113-flow-candles-series-header-v1";
import { aggregateTapeSeries } from "./orderbook.js?v=26-113-flow-candles-series-header-v1";

const read = (path) => fs.readFileSync(new URL(path, import.meta.url), "utf8");

const rows = [
  { price: 99, y: 90, height: 10 },
  { price: 100, y: 80, height: 10 },
  { price: 100.37, y: 75, height: 10 },
  { price: 101, y: 70, height: 10 },
  { price: 102, y: 60, height: 10 },
];

test("footprint projection ignores the transient off-grid current-price row", () => {
  const stable = stableFootprintProjectionRows(rows);
  assert.deepEqual(stable.map((row) => row.price), [99, 100, 101, 102]);
  assert.equal(projectFootprintPriceRow(rows, 100.5).y, 75);
});

test("partial OHLC remains projected at the visible edge", () => {
  assert.equal(projectFootprintPriceRow(rows, 105), null);
  const clipped = projectFootprintPriceRow(rows, 105, true);
  assert.equal(clipped.y, 60);
  assert.equal(clipped.clipped, true);
});

test("series keeps one staircase coordinate per visual millisecond", () => {
  const trade = (id, time, price, quote) => ({ id, time, tradeTime: time, displayTime: time, side: "buy", price, quote, quantity: quote / price });
  const series = aggregateTapeSeries([
    trade(1, 1_000, 100, 100),
    trade(2, 1_000, 101, 200),
    trade(3, 1_250, 102, 300),
  ])[0];
  assert.equal(series.steps.length, 2);
  assert.deepEqual(series.steps.map((step) => [step.time, step.price]), [[1_000, 101], [1_250, 102]]);
  assert.equal(series.price, 102);
});

test("runtime draws chart-style cluster candles and a Tape staircase", () => {
  const flow = read("./orderbook-flow-workspace.js");
  const tape = read("./orderbook.js");
  assert.match(flow, /nearestRow\(rows, interval\.highPrice, true\)/);
  assert.match(flow, /state\.context\.fillStyle = theme\.bearFill/);
  assert.match(flow, /state\.context\.rect\(columnLeft, candleTop/);
  assert.match(flow, /height - 28/);
  assert.match(tape, /function drawTapeSeriesLadder/);
  assert.match(tape, /context\.lineTo\(next\.x, previous\.y\)/);
  assert.match(tape, /context\.lineTo\(next\.x, next\.y\)/);
  assert.match(tape, /rgba\(66, 225, 173, \.46\)/);
});

test("brightness is between Download and Sound and runtime key is atomic", () => {
  const html = read("./index.html");
  const header = html.match(/<header class="topbar">[\s\S]*?<\/header>/)?.[0] ?? "";
  assert.ok(header.indexOf('id="install-app"') < header.indexOf('id="comfort-slider"'));
  assert.ok(header.indexOf('id="comfort-slider"') < header.indexOf('id="sound-toggle"'));
  for (const path of ["./index.html", "./app.js", "./orderbook.js", "./orderbook-flow-workspace.js", "./sw.js"]) {
    assert.match(read(path), /26-113-flow-candles-series-header-v1/);
  }
});
''', encoding="utf-8")
