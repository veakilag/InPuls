import test from "node:test";
import assert from "node:assert/strict";
import { installStructuralBatchIngestRuntime } from "../signal-lab-v7-batch-ingest-runtime.js";

class FakeEngine {
  constructor() {
    this.rows = [];
    this.snapshots = 0;
  }

  ingestCandle(row, options = {}) {
    this.rows.push({ row, options });
    if (options.emitSnapshot !== false) this.snapshots += 1;
    return { size: this.rows.length };
  }

  ingestCandles(rows, options = {}) {
    const steps = [];
    for (const row of rows) steps.push(this.ingestCandle(row, { ...options, emitSnapshot: true }));
    return options.includeSteps ? steps : this.snapshot();
  }

  snapshot() {
    this.snapshots += 1;
    return { size: this.rows.length, order: this.rows.map((item) => item.row.time) };
  }
}

test("batch replay emits only one final snapshot and preserves time order", () => {
  installStructuralBatchIngestRuntime(FakeEngine);
  const engine = new FakeEngine();
  const result = engine.ingestCandles([{ time: 3 }, { time: 1 }, { time: 2 }]);
  assert.deepEqual(result, { size: 3, order: [1, 2, 3] });
  assert.equal(engine.snapshots, 1);
  assert.ok(engine.rows.every((item) => item.options.emitSnapshot === false));
});

test("includeSteps keeps original per-candle snapshots", () => {
  installStructuralBatchIngestRuntime(FakeEngine);
  const engine = new FakeEngine();
  const result = engine.ingestCandles([{ time: 2 }, { time: 1 }], { includeSteps: true });
  assert.equal(result.length, 2);
  assert.equal(engine.snapshots, 2);
});
