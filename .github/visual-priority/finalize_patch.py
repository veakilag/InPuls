from pathlib import Path

OLD = "26-42-orderbook-scroll-theme-v1"
NEW = "26-43-orderbook-visual-priority-v1"

runtime_paths = [
    Path("index.html"),
    Path("app.js"),
    Path("orderbook.js"),
    Path("sw.js"),
    Path("reset-v26.html"),
    Path("reset.js"),
]

for path in runtime_paths:
    source = path.read_text(encoding="utf-8")
    if OLD not in source:
        raise RuntimeError(f"Old build token missing in {path}")
    path.write_text(source.replace(OLD, NEW), encoding="utf-8")

for path in Path(".").glob("test-orderbook-*.mjs"):
    source = path.read_text(encoding="utf-8")
    path.write_text(source.replace(OLD, NEW), encoding="utf-8")

flow_contract = Path("test-orderbook-flow-workspace.mjs")
flow_contract_source = flow_contract.read_text(encoding="utf-8")
old_contract = r'''  assert.match(source, /sellLabelLeft - sellWidth/);
  assert.match(source, /buyLabelRight,/);'''
new_contract = r'''  assert.match(source, /columnLeft \+ columnWidth \* \.25/);
  assert.match(source, /columnLeft \+ columnWidth \* \.75/);
  assert.match(source, /const highRow = nearestRow\(rows, interval\.highPrice\)/);'''
if flow_contract_source.count(old_contract) != 1:
    raise RuntimeError(
        f"Expected one legacy footprint render contract, got {flow_contract_source.count(old_contract)}"
    )
flow_contract.write_text(
    flow_contract_source.replace(old_contract, new_contract, 1),
    encoding="utf-8",
)

test_source = r'''import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";

const app = readFileSync(new URL("./app.js", import.meta.url), "utf8");
const orderbook = readFileSync(new URL("./orderbook.js", import.meta.url), "utf8");
const flow = readFileSync(new URL("./orderbook-flow-workspace.js", import.meta.url), "utf8");
const index = readFileSync(new URL("./index.html", import.meta.url), "utf8");
const sw = readFileSync(new URL("./sw.js", import.meta.url), "utf8");

test("current price has protected right spacing and a dedicated marker", () => {
  assert.match(orderbook, /minmax\(76px, var\(--book-price-width, 8\.8ch\)\)/);
  assert.match(orderbook, /\.book-ladder-row\.is-market strong[\s\S]*margin-right: 4px/);
  assert.match(orderbook, /border-right: 3px solid #66e4ff/);
  assert.match(orderbook, /justify-content: flex-end/);
});

test("ordinary sizes are neutral and anomalies have three tiers", () => {
  assert.match(orderbook, /rgba\(232, 237, 240, \.88\)/);
  assert.match(app, /function anomalyTierForQuote\(quote, threshold\)/);
  assert.match(app, /is-anomaly-tier-\$\{anomalyTier\}/);
  assert.match(orderbook, /is-anomaly-tier-1/);
  assert.match(orderbook, /is-anomaly-tier-2/);
  assert.match(orderbook, /is-anomaly-tier-3/);
});

test("footprint uses split rectangular cells and interval candles", () => {
  assert.match(flow, /export function footprintCellIntensity/);
  assert.match(flow, /columnWidth \* \.25/);
  assert.match(flow, /columnWidth \* \.75/);
  assert.match(flow, /const highRow = nearestRow\(rows, interval\.highPrice\)/);
  assert.match(flow, /const lowRow = nearestRow\(rows, interval\.lowPrice\)/);
  assert.match(flow, /const rising = Number\(interval\.closePrice\) >= Number\(interval\.openPrice\)/);
});

test("visual priority ships one consistent runtime", () => {
  assert.match(index, /26-43-orderbook-visual-priority-v1/);
  assert.match(app, /orderbook\.js\?v=26-43-orderbook-visual-priority-v1/);
  assert.match(orderbook, /orderbook-flow-workspace\.js\?v=26-43-orderbook-visual-priority-v1/);
  assert.match(sw, /26-43-orderbook-visual-priority-v1/);
});
'''
Path("test-orderbook-visual-priority.mjs").write_text(test_source, encoding="utf-8")

Path("visual-priority-diagnostics.txt").unlink(missing_ok=True)
Path("visual-priority-run-error.txt").unlink(missing_ok=True)
for path in Path(".github/visual-priority").glob("*.py"):
    path.unlink(missing_ok=True)
Path(".github/workflows/apply-orderbook-visual-priority.yml").unlink(missing_ok=True)
