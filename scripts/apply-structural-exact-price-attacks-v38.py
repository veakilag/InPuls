from pathlib import Path

ENGINE = Path('signal-lab-v7-structural-extremes.js')
LIFECYCLE = Path('signal-lab-v7-review-level-lifecycle.js')
ATTACK_TEST = Path('test/signal-lab-v7-attack-count-runtime.test.js')
EXACT_TEST = Path('test/signal-lab-v7-exact-price-attacks.test.js')
DOC = Path('docs/signal-lab-v7-structural-extremes-stage1.md')


def replace_once(path: Path, old: str, new: str):
    text = path.read_text(encoding='utf-8')
    if old not in text:
        raise SystemExit(f'Expected block not found in {path}')
    path.write_text(text.replace(old, new, 1), encoding='utf-8')


replace_once(
    ENGINE,
    'export const STRUCTURAL_EXTREME_ALGORITHM_VERSION = "signal-lab-structural-extremes-stage1-v3-opposite-candidate-2026-08";',
    'export const STRUCTURAL_EXTREME_ALGORITHM_VERSION = "signal-lab-structural-extremes-stage1-v3.8-exact-price-attacks-2026-08";',
)

old_engine = '''      const crossed = row.side === "HIGH"\n        ? highTicks > row.normalizedPrice + tolerance\n        : lowTicks < row.normalizedPrice - tolerance;\n      if (crossed) {\n        row.active = false;\n        row.status = STRUCTURAL_EXTREME_STATUSES.CROSSED;\n        row.crossedAt = candle.closeTime;\n        row.crossedBarIndex = this.barIndex;\n        row.acceptanceCount = 0;\n        this.activeExtremeIds.delete(row.id);\n        this.eventLog.push(eventRecord("EXTREME_CROSSED", candle.closeTime, { extremeId: row.id, side: row.side, price: row.price }));\n        continue;\n      }\n      const tickZonePct = this.tickSize * this.config.touchZoneTicks / row.price * 100;\n      const adaptiveZonePct = Math.min(\n        this.config.maximumTouchZonePercent,\n        Math.max(this.config.minimumPercent, row.reversalThresholdPct ?? this.config.minimumPercent) * this.config.touchZoneFactor,\n      );\n      const touchZonePct = Math.max(tickZonePct, adaptiveZonePct);\n      const touchZonePrice = row.price * touchZonePct / 100;\n      const touchesZone = row.side === "HIGH"\n        ? candle.high >= row.price - touchZonePrice\n        : candle.low <= row.price + touchZonePrice;\n      if (touchesZone) {\n        if (row.attackState !== "IN_ZONE") {\n          if (row.rearmed && candle.closeTime > row.confirmedAt) {\n            row.touchCount += 1;\n            row.status = STRUCTURAL_EXTREME_STATUSES.TOUCHED;\n            this.eventLog.push(eventRecord("EXTREME_TOUCHED", candle.closeTime, { extremeId: row.id, touchCount: row.touchCount }));\n          }\n          row.attackState = "IN_ZONE";\n          row.rearmed = false;\n        }\n        continue;\n      }\n      row.attackState = "AWAY";\n      const thresholdPct = Math.max(this.config.minimumPercent, row.reversalThresholdPct ?? this.config.minimumPercent);\n      const rearmPct = Math.max(touchZonePct * 2, thresholdPct * this.config.rearmDistanceFactor);\n      const distancePct = row.side === "HIGH"\n        ? Math.max(0, (row.price - candle.close) / row.price * 100)\n        : Math.max(0, (candle.close - row.price) / row.price * 100);\n      if (distancePct >= rearmPct) row.rearmed = true;'''

new_engine = '''      // V3.8: an attack is an exact print of the structural price, not an\n      // adaptive volatility zone. Prices are compared in exchange ticks.\n      const crossed = row.side === "HIGH"\n        ? highTicks > row.normalizedPrice\n        : lowTicks < row.normalizedPrice;\n      if (crossed) {\n        row.active = false;\n        row.status = STRUCTURAL_EXTREME_STATUSES.CROSSED;\n        row.crossedAt = candle.closeTime;\n        row.crossedBarIndex = this.barIndex;\n        row.acceptanceCount = 0;\n        this.activeExtremeIds.delete(row.id);\n        this.eventLog.push(eventRecord("EXTREME_CROSSED", candle.closeTime, { extremeId: row.id, side: row.side, price: row.price }));\n        continue;\n      }\n      const exactAttack = row.side === "HIGH"\n        ? highTicks === row.normalizedPrice\n        : lowTicks === row.normalizedPrice;\n      if (exactAttack) {\n        if (row.attackState !== "AT_LEVEL") {\n          if (row.rearmed && candle.closeTime > row.confirmedAt) {\n            row.touchCount += 1;\n            row.status = STRUCTURAL_EXTREME_STATUSES.TOUCHED;\n            this.eventLog.push(eventRecord("EXTREME_ATTACKED", candle.closeTime, {\n              extremeId: row.id,\n              attackRetestCount: row.touchCount,\n              attackPrice: row.price,\n              semantics: "EXACT_PRICE_TICK",\n            }));\n          }\n          row.attackState = "AT_LEVEL";\n          row.rearmed = false;\n        }\n        continue;\n      }\n      row.attackState = "AWAY";\n      const thresholdPct = Math.max(this.config.minimumPercent, row.reversalThresholdPct ?? this.config.minimumPercent);\n      // Volatility may separate two independent attacks, but never widens\n      // the price that qualifies as an attack.\n      const rearmPct = Math.max(0.01, thresholdPct * this.config.rearmDistanceFactor);\n      const distancePct = row.side === "HIGH"\n        ? Math.max(0, (row.price - candle.close) / row.price * 100)\n        : Math.max(0, (candle.close - row.price) / row.price * 100);\n      if (distancePct >= rearmPct) row.rearmed = true;'''
replace_once(ENGINE, old_engine, new_engine)

old_lifecycle = '''  const tolerance = tick * Math.max(0, Math.round(crossingToleranceTicks));\n  const tickZonePct = tick > 0\n    ? tick * Math.max(1, Math.round(touchZoneTicks)) / levelPrice * 100\n    : 0;\n  const adaptiveZonePct = Math.min(\n    Math.max(0.01, finite(maximumTouchZonePct) ?? 0.25),\n    Math.max(0, finite(reversalThresholdPct) ?? 0.5)\n      * Math.max(0.01, finite(touchZoneFactor) ?? 0.15),\n  );\n  const zonePct = Math.max(tickZonePct, adaptiveZonePct);\n  const zoneDistance = levelPrice * zonePct / 100;\n  const rearmPct = Math.max(\n    zonePct * 2,\n    Math.max(0.01, finite(reversalThresholdPct) ?? 0.5)\n      * Math.max(0.1, finite(rearmDistanceFactor) ?? 0.7),\n  );'''
new_lifecycle = '''  const levelTicks = tick > 0 ? Math.round(levelPrice / tick) : null;\n  const rearmPct = Math.max(\n    0.01,\n    Math.max(0.01, finite(reversalThresholdPct) ?? 0.5)\n      * Math.max(0.1, finite(rearmDistanceFactor) ?? 0.7),\n  );\n  const zonePct = 0;'''
replace_once(LIFECYCLE, old_lifecycle, new_lifecycle)

old_loop = '''    const explicitCross = explicitCrossAt !== null && candleTime >= explicitCrossAt;\n    const crossed = side === "HIGH"\n      ? high > levelPrice + tolerance\n      : low < levelPrice - tolerance;\n    if (explicitCross || crossed) {\n      active = false;\n      crossedAt = closeTime;\n      break;\n    }\n\n    const touches = side === "HIGH"\n      ? high >= levelPrice - zoneDistance\n      : low <= levelPrice + zoneDistance;\n\n    if (touches) {\n      if (!inZone && rearmed) {\n        attacks.push(Object.freeze({\n          number: attacks.length + 2,\n          time: candleTime,\n          closeTime,\n          price: side === "HIGH" ? high : low,\n        }));\n      }\n      inZone = true;\n      rearmed = false;\n      continue;\n    }\n\n    inZone = false;'''
new_loop = '''    const highTicks = levelTicks === null ? null : Math.round(high / tick);\n    const lowTicks = levelTicks === null ? null : Math.round(low / tick);\n    const explicitCross = explicitCrossAt !== null && candleTime >= explicitCrossAt;\n    const crossed = side === "HIGH"\n      ? (levelTicks === null ? high > levelPrice : highTicks > levelTicks)\n      : (levelTicks === null ? low < levelPrice : lowTicks < levelTicks);\n    if (explicitCross || crossed) {\n      active = false;\n      crossedAt = closeTime;\n      break;\n    }\n\n    const exactAttack = side === "HIGH"\n      ? (levelTicks === null ? high === levelPrice : highTicks === levelTicks)\n      : (levelTicks === null ? low === levelPrice : lowTicks === levelTicks);\n\n    if (exactAttack) {\n      if (!inZone && rearmed) {\n        attacks.push(Object.freeze({\n          number: attacks.length + 2,\n          time: candleTime,\n          closeTime,\n          price: levelPrice,\n          semantics: "EXACT_PRICE_TICK",\n        }));\n      }\n      inZone = true;\n      rearmed = false;\n      continue;\n    }\n\n    inZone = false;'''
replace_once(LIFECYCLE, old_loop, new_loop)

replace_once(
    LIFECYCLE,
    '    attackCountSemantics: "FORMATION_IS_ATTACK_1",\n',
    '    attackCountSemantics: "FORMATION_IS_ATTACK_1_EXACT_PRICE_TICK",\n    attackToleranceTicks: 0,\n',
)

replace_once(
    ATTACK_TEST,
    '    candle(5, 102, 104.9, 101.8, 104.7),',
    '    candle(5, 102, 105, 101.8, 104.7),',
)

EXACT_TEST.write_text(r'''import test from "node:test";
import assert from "node:assert/strict";
import { manualLevelLifecycle } from "../signal-lab-v7-review-level-lifecycle.js";

const BASE = Date.UTC(2026, 7, 7, 0, 0, 0);
const STEP = 60_000;
function candle(index, open, high, low, close) {
  return {
    time: BASE + index * STEP,
    closeTime: BASE + (index + 1) * STEP - 1,
    open, high, low, close, volume: 1000, closed: true,
  };
}

const common = {
  side: "HIGH",
  price: 105,
  extremeAt: BASE,
  tickSize: 0.1,
  reversalThresholdPct: 1,
  rearmDistanceFactor: 0.5,
};

test("near miss inside former volatility zone is not an attack", () => {
  const result = manualLevelLifecycle({
    ...common,
    candles: [
      candle(1, 104, 104.5, 103, 103.5),
      candle(2, 103.5, 104.9, 103.2, 104.7),
    ],
  });
  assert.equal(result.retestCount, 0);
  assert.equal(result.touchCount, 1);
  assert.equal(result.attackToleranceTicks, 0);
});

test("exact same tick after rearm is a new attack", () => {
  const result = manualLevelLifecycle({
    ...common,
    candles: [
      candle(1, 104, 104.5, 103, 103.5),
      candle(2, 103.5, 105, 103.2, 104.7),
    ],
  });
  assert.equal(result.retestCount, 1);
  assert.equal(result.touchCount, 2);
  assert.equal(result.attacks[0].price, 105);
  assert.equal(result.attacks[0].semantics, "EXACT_PRICE_TICK");
});

test("one tick through the level is a break, not an attack", () => {
  const result = manualLevelLifecycle({
    ...common,
    candles: [
      candle(1, 104, 104.5, 103, 103.5),
      candle(2, 103.5, 105.1, 103.2, 104.7),
    ],
  });
  assert.equal(result.active, false);
  assert.equal(result.status, "CROSSED");
  assert.equal(result.retestCount, 0);
});

test("consecutive candles on the same exact price remain one attack until rearm", () => {
  const result = manualLevelLifecycle({
    ...common,
    candles: [
      candle(1, 104, 104.5, 103, 103.5),
      candle(2, 103.5, 105, 103.2, 104.7),
      candle(3, 104.7, 105, 104.2, 104.8),
      candle(4, 104.8, 105, 104.3, 104.9),
    ],
  });
  assert.equal(result.retestCount, 1);
  assert.equal(result.touchCount, 2);
});
''', encoding='utf-8')

text = DOC.read_text(encoding='utf-8')
marker = '## V3.8 — точная цена атаки'
if marker not in text:
    text += r'''

## V3.8 — точная цена атаки

Атака уровня отделена от подхода к уровню.

- формирование экстремума = атака ×1;
- новая атака засчитывается только если HIGH/LOW свечи печатает ровно тот же биржевой tick, что и цена уровня;
- процентная/ATR-зона больше не увеличивает ×N;
- недоход до уровня — это подход, но не атака;
- первый tick за уровень — пробой, а не атака;
- несколько подряд свечей на одной цене без достаточного ухода остаются одной атакой;
- адаптивный rearm по волатильности используется только чтобы отделить две самостоятельные атаки, но не расширяет допустимую цену атаки.

Это определение нужно для будущего паттерна пробоя: повторные удары в одну цену могут сопоставляться с крупным лимитным сайзом на этой же цене. Это не определение каскада.
'''
    DOC.write_text(text, encoding='utf-8')
