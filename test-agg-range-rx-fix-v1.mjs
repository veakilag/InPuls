import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";
import vm from "node:vm";

const worker = readFileSync(new URL("./orderbook-worker.js", import.meta.url), "utf8");
const runtime = readFileSync(new URL("./orderbook.js", import.meta.url), "utf8");
const latencySource = readFileSync(new URL("./orderbook-tape-latency.js", import.meta.url), "utf8");

function latencyApi() {
  const context = {};
  vm.createContext(context);
  vm.runInContext(latencySource, context);
  return context.InPulsTapeLatency;
}

test("negative calibrated RX is unavailable instead of a false zero", () => {
  const { normalizeTiming } = latencyApi();
  assert.equal(normalizeTiming({ E: 1_000, T: 1_000 }, 999, 0).rxLatencyMs, null);
  assert.equal(normalizeTiming({ E: 1_000, T: 1_000 }, 1_000.4, 0).rxLatencyMs, 0.39999999999997726);
});

test("header RX uses only the stable aggTrade feed and never renders literal zero", () => {
  assert.match(worker, /if \(aggregateEvent\) this\.tradeLatency\.record\(trade\.rxLatencyMs, receivedAt\)/);
  assert.match(worker, /latency < 1\s*\? "<1"/);
  assert.doesNotMatch(worker, /Math\.round\(latency\)\}ms/);
});

test("AGG painter renders the aggregate price sweep instead of only its first-price label", () => {
  assert.match(runtime, /function drawAggregatePriceRange\(/);
  assert.match(runtime, /item\?\.minPrice/);
  assert.match(runtime, /item\?\.maxPrice/);
  assert.match(runtime, /projectTapePrice\(viewport, minimum\)/);
  assert.match(runtime, /projectTapePrice\(viewport, maximum\)/);
  assert.ok((runtime.match(/drawAggregatePriceRange\(/g) ?? []).length >= 3);
});
