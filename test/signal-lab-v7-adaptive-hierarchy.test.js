import test from "node:test";
import assert from "node:assert/strict";
import {
  buildHierarchicalStructuralLevelMap,
  buildStructuralVolatilityContext,
  structuralChildAdmissionDecision,
  structuralDistanceBaseNatr,
  structuralDistanceNatr,
  structuralNatrAt,
} from "../signal-lab-v7-multi-timeframe-levels.js";

const MINUTE = 60_000;
const END = Date.UTC(2026, 7, 7, 12, 0, 0);

function candles({ start = END - 20 * MINUTE, count = 20, close = 100, halfRange = 0.05, step = MINUTE } = {}) {
  return Array.from({ length: count }, (_, index) => ({
    time: start + index * step,
    open: close,
    high: close + halfRange,
    low: close - halfRange,
    close,
    closeTime: start + index * step + step - 1,
  }));
}

function extreme({ id, side = "HIGH", price = 100, extremeAt = END - 5 * MINUTE, swingAmplitudePct = 0.5, reversalThresholdPct = 0.1 }) {
  return {
    id,
    side,
    price,
    extremeAt,
    confirmedAt: extremeAt + MINUTE - 1,
    active: true,
    status: "CONFIRMED_ACTIVE",
    attackCount: 1,
    touchCount: 1,
    swingAmplitudePct,
    reversalThresholdPct,
    confirmingReversalPct: reversalThresholdPct,
  };
}

test("same percentage swing is admitted on calm market and filtered on high-NATR market", () => {
  const calmContext = buildStructuralVolatilityContext(candles({ halfRange: 0.05 }));
  const volatileContext = buildStructuralVolatilityContext(candles({ halfRange: 5 }));
  const candidate = extreme({ id: "same-swing", swingAmplitudePct: 0.5 });

  const calm = structuralChildAdmissionDecision(candidate, "1m", { volatilityContext: calmContext });
  const volatile = structuralChildAdmissionDecision(candidate, "1m", { volatilityContext: volatileContext });

  assert.equal(calm.admitted, true);
  assert.equal(volatile.admitted, false);
  assert.ok(calm.natrAtExtreme < volatile.natrAtExtreme);
});

test("1m detail becomes stricter as a level moves farther away in current-NATR units", () => {
  const context = buildStructuralVolatilityContext(candles({ halfRange: 0.05 }));
  const near = extreme({ id: "near", price: 100, swingAmplitudePct: 0.32 });
  const far = extreme({ id: "far", price: 99, swingAmplitudePct: 0.32 });

  const nearDecision = structuralChildAdmissionDecision(near, "1m", { volatilityContext: context });
  const farDecision = structuralChildAdmissionDecision(far, "1m", { volatilityContext: context });

  assert.equal(nearDecision.admitted, true);
  assert.equal(farDecision.admitted, false);
  assert.ok(farDecision.distanceNatr > nearDecision.distanceNatr);
  assert.ok(farDecision.requiredSwingPct > nearDecision.requiredSwingPct);
});

test("volatility context exposes historical NATR and current distance in NATR units", () => {
  const rows = candles({ halfRange: 0.1 });
  const context = buildStructuralVolatilityContext(rows);
  const historical = structuralNatrAt(context, rows[5].time);
  const distance = structuralDistanceNatr(99, context);

  assert.ok(historical > 0);
  assert.ok(context.currentNatrPct > 0);
  assert.ok(distance > 0);
});

test("junior confluence with inherited senior price survives adaptive child filtering", () => {
  const oneDayAt = END - 2 * 24 * 60 * 60_000;
  const juniorAt = END - 5 * MINUTE;
  const senior = extreme({
    id: "senior",
    side: "HIGH",
    price: 100,
    extremeAt: oneDayAt,
    swingAmplitudePct: 5,
    reversalThresholdPct: 1,
  });
  const tinyJunior = extreme({
    id: "tiny-junior",
    side: "HIGH",
    price: 100.01,
    extremeAt: juniorAt,
    swingAmplitudePct: 0.05,
    reversalThresholdPct: 0.1,
  });

  const snapshotsByTimeframe = {
    "1d": { active: [senior], history: [senior] },
    "4h": { active: [], history: [] },
    "1h": { active: [], history: [] },
    "15m": { active: [], history: [] },
    "5m": { active: [], history: [] },
    "1m": { active: [tinyJunior], history: [tinyJunior] },
  };
  const candlesByTimeframe = {
    "1d": candles({ start: oneDayAt - 20 * 24 * 60 * 60_000, step: 24 * 60 * 60_000, halfRange: 1 }),
    "4h": [],
    "1h": [],
    "15m": [],
    "5m": [],
    "1m": candles({ halfRange: 5 }),
  };

  const levels = buildHierarchicalStructuralLevelMap({
    snapshotsByTimeframe,
    candlesByTimeframe,
    viewTimeframe: "1m",
    endAt: END,
    tickSize: 0.01,
  });

  assert.equal(levels.length, 1);
  assert.equal(levels[0].sourceTimeframe, "1d");
  assert.deepEqual(levels[0].sources, ["1d", "1m"]);
  assert.deepEqual(levels[0].memberIds, ["senior", "tiny-junior"]);
});


test("V4.3 current NATR compression relaxes scale but never hardens distance", () => {
  const start = END - 120 * MINUTE;
  const rows = Array.from({ length: 120 }, (_, index) => {
    const compressed = index >= 106;
    const halfRange = compressed ? 0.05 : 0.25;
    return {
      time: start + index * MINUTE,
      open: 100,
      high: 100 + halfRange,
      low: 100 - halfRange,
      close: 100,
      closeTime: start + index * MINUTE + MINUTE - 1,
    };
  });
  const context = buildStructuralVolatilityContext(rows);
  const candidate = extreme({
    id: "compression-high",
    side: "HIGH",
    price: 100.1,
    swingAmplitudePct: 0.32,
    reversalThresholdPct: 0.10,
  });
  const decision = structuralChildAdmissionDecision(candidate, "1m", { volatilityContext: context });

  assert.equal(context.volatilityState, "COMPRESSION");
  assert.ok(context.currentNatrPct < context.baseNatrPct);
  assert.ok(context.compressionRatio < 1);
  assert.equal(decision.admitted, true);
  assert.ok(decision.compressionRelief < 1);
  assert.equal(decision.distanceNatr, decision.distanceBaseNatr);
  assert.ok(structuralDistanceNatr(candidate.price, context) > structuralDistanceBaseNatr(candidate.price, context));
});
