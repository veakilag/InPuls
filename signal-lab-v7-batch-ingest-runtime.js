const PATCH_MARKER = Symbol.for("inpuls.structural-extremes.batch-ingest-v1");

const candleTime = (row) => {
  const value = Number(row?.time ?? row?.openTime);
  return Number.isFinite(value) ? value : Number.POSITIVE_INFINITY;
};

export function installStructuralBatchIngestRuntime(EngineClass) {
  const prototype = EngineClass?.prototype;
  if (!prototype || typeof prototype.ingestCandles !== "function") {
    throw new TypeError("StructuralExtremeEngine class is required");
  }
  if (prototype[PATCH_MARKER]) return;

  const originalIngestCandles = prototype.ingestCandles;
  Object.defineProperty(prototype, PATCH_MARKER, {
    value: true,
    configurable: false,
    enumerable: false,
    writable: false,
  });

  prototype.ingestCandles = function optimizedIngestCandles(rows, options = {}) {
    if (options.includeSteps) return originalIngestCandles.call(this, rows, options);

    const ordered = (Array.isArray(rows) ? [...rows] : [])
      .sort((left, right) => candleTime(left) - candleTime(right));
    for (const row of ordered) {
      this.ingestCandle(row, { ...options, emitSnapshot: false });
    }
    return this.snapshot();
  };
}
