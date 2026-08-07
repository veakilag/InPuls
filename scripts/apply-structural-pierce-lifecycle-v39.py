from pathlib import Path

ENGINE = Path('signal-lab-v7-structural-extremes.js')
LIFE = Path('signal-lab-v7-review-level-lifecycle.js')
TEST_CORE = Path('test/signal-lab-v7-structural-extremes.test.js')
TEST_V3 = Path('test/signal-lab-v7-structural-extremes-v3.test.js')
TEST_NEW = Path('test/signal-lab-v7-pierce-lifecycle.test.js')
DOC = Path('docs/signal-lab-v7-structural-extremes-stage1.md')


def replace_once(path, old, new):
    text = path.read_text(encoding='utf-8')
    if old not in text:
        raise SystemExit(f'Expected block not found in {path}: {old[:100]!r}')
    path.write_text(text.replace(old, new, 1), encoding='utf-8')


def replace_between(path, start, end, replacement):
    text = path.read_text(encoding='utf-8')
    a = text.find(start)
    b = text.find(end, a)
    if a < 0 or b < 0:
        raise SystemExit(f'Expected range not found in {path}')
    path.write_text(text[:a] + replacement + text[b:], encoding='utf-8')


# Supersede the failed V3.8 temp patch/workflow; V3.9 includes exact attacks + pierce lifecycle.
for stale in [
    Path('scripts/apply-structural-exact-price-attacks-v38.py'),
    Path('.github/workflows/apply-structural-exact-price-attacks-v38.yml'),
]:
    if stale.exists():
        stale.unlink()

replace_once(
    ENGINE,
    'export const STRUCTURAL_EXTREME_ALGORITHM_VERSION = "signal-lab-structural-extremes-stage1-v3-opposite-candidate-2026-08";',
    'export const STRUCTURAL_EXTREME_ALGORITHM_VERSION = "signal-lab-structural-extremes-stage1-v3.9-pierce-lifecycle-2026-08";',
)
replace_once(
    ENGINE,
    '  TOUCHED: "TOUCHED",\n  CROSSED: "CROSSED",',
    '  TOUCHED: "TOUCHED",\n  PIERCED: "PIERCED",\n  CROSSED: "CROSSED",',
)
replace_once(
    ENGINE,
    '  const { attackState, rearmed, crossedBarIndex, acceptanceCount, ...publicRow } = row;',
    '  const { attackState, rearmed, crossedBarIndex, piercedBarIndex, acceptanceCount, ...publicRow } = row;',
)
replace_once(
    ENGINE,
    '      touchCount: 0,\n      crossedAt: undefined,',
    '      touchCount: 0,\n      pierceCount: 0,\n      piercedAt: undefined,\n      lastRejectedPierceAt: undefined,\n      crossedAt: undefined,',
)
replace_once(
    ENGINE,
    '      attackState: "AWAY",\n      rearmed: false,\n      crossedBarIndex: null,\n      acceptanceCount: 0,',
    '      attackState: "AWAY",\n      rearmed: false,\n      crossedBarIndex: null,\n      piercedBarIndex: null,\n      acceptanceCount: 0,',
)

new_observe = r'''  #observeLifecycle(candle) {
    const lowTicks = toTicks(candle.low, this.tickSize);
    const highTicks = toTicks(candle.high, this.tickSize);
    const closeTicks = toTicks(candle.close, this.tickSize);

    const restoreAfterRejectedPierce = (row) => {
      row.status = row.touchCount > 0
        ? STRUCTURAL_EXTREME_STATUSES.TOUCHED
        : STRUCTURAL_EXTREME_STATUSES.CONFIRMED_ACTIVE;
      row.lastRejectedPierceAt = candle.closeTime;
      row.acceptanceCount = 0;
      row.piercedBarIndex = null;
      row.attackState = "AWAY";
      row.rearmed = false;
      this.activeExtremeIds.add(row.id);
      this.eventLog.push(eventRecord("EXTREME_PIERCE_REJECTED", candle.closeTime, {
        extremeId: row.id,
        side: row.side,
        price: row.price,
        pierceCount: row.pierceCount,
      }));
    };

    const acceptBreak = (row) => {
      row.active = false;
      row.status = STRUCTURAL_EXTREME_STATUSES.ACCEPTED;
      row.acceptedAt = candle.closeTime;
      // crossedAt remains the backwards-compatible terminal ray end.
      row.crossedAt = candle.closeTime;
      row.crossedBarIndex = this.barIndex;
      row.acceptanceCount = 0;
      this.activeExtremeIds.delete(row.id);
      this.eventLog.push(eventRecord("EXTREME_BREAK_ACCEPTED", candle.closeTime, {
        extremeId: row.id,
        side: row.side,
        price: row.price,
        pierceCount: row.pierceCount,
      }));
    };

    for (const row of this.extremes) {
      if (!row.active) continue;

      if (row.status === STRUCTURAL_EXTREME_STATUSES.PIERCED) {
        const closeBeyond = row.side === "HIGH"
          ? closeTicks > row.normalizedPrice
          : closeTicks < row.normalizedPrice;
        if (!closeBeyond) {
          restoreAfterRejectedPierce(row);
          continue;
        }
        row.acceptanceCount += 1;
        if (row.acceptanceCount >= this.config.acceptanceBars) acceptBreak(row);
        continue;
      }

      // V3.9: touching the exact exchange tick is an attack. A print through
      // the level is only a pierce attempt until price is accepted beyond it.
      const pierced = row.side === "HIGH"
        ? highTicks > row.normalizedPrice
        : lowTicks < row.normalizedPrice;
      if (pierced) {
        row.status = STRUCTURAL_EXTREME_STATUSES.PIERCED;
        row.piercedAt = candle.closeTime;
        row.piercedBarIndex = this.barIndex;
        row.pierceCount = Math.max(0, Number(row.pierceCount) || 0) + 1;
        row.acceptanceCount = 0;
        row.attackState = "AWAY";
        row.rearmed = false;
        this.eventLog.push(eventRecord("EXTREME_PIERCED", candle.closeTime, {
          extremeId: row.id,
          side: row.side,
          price: row.price,
          pierceCount: row.pierceCount,
        }));

        const closeBeyond = row.side === "HIGH"
          ? closeTicks > row.normalizedPrice
          : closeTicks < row.normalizedPrice;
        if (!closeBeyond) {
          restoreAfterRejectedPierce(row);
          continue;
        }
        row.acceptanceCount = 1;
        if (row.acceptanceCount >= this.config.acceptanceBars) acceptBreak(row);
        continue;
      }

      const exactAttack = row.side === "HIGH"
        ? highTicks === row.normalizedPrice
        : lowTicks === row.normalizedPrice;
      if (exactAttack) {
        if (row.attackState !== "AT_LEVEL") {
          if (row.rearmed && candle.closeTime > row.confirmedAt) {
            row.touchCount += 1;
            row.status = STRUCTURAL_EXTREME_STATUSES.TOUCHED;
            this.eventLog.push(eventRecord("EXTREME_ATTACKED", candle.closeTime, {
              extremeId: row.id,
              attackRetestCount: row.touchCount,
              attackPrice: row.price,
              semantics: "EXACT_PRICE_TICK",
            }));
          }
          row.attackState = "AT_LEVEL";
          row.rearmed = false;
        }
        continue;
      }

      row.attackState = "AWAY";
      const thresholdPct = Math.max(this.config.minimumPercent, row.reversalThresholdPct ?? this.config.minimumPercent);
      // Volatility separates independent attacks but never widens the attack price.
      const rearmPct = Math.max(0.01, thresholdPct * this.config.rearmDistanceFactor);
      const distancePct = row.side === "HIGH"
        ? Math.max(0, (row.price - candle.close) / row.price * 100)
        : Math.max(0, (candle.close - row.price) / row.price * 100);
      if (distancePct >= rearmPct) row.rearmed = true;
    }
  }

'''
replace_between(ENGINE, '  #observeLifecycle(candle) {', '  #reversalThresholdPct(candidatePrice) {', new_observe)

new_manual = r'''export function manualLevelLifecycle({
  candles,
  side,
  price,
  extremeAt,
  tickSize,
  reversalThresholdPct = 0.5,
  crossingToleranceTicks = 1,
  touchZoneTicks = 2,
  touchZoneFactor = 0.15,
  maximumTouchZonePct = 0.25,
  rearmDistanceFactor = 0.7,
  acceptanceBars = 2,
  explicitCrossAt = null,
}) {
  const rows = Array.isArray(candles) ? candles : [];
  const levelPrice = finite(price);
  const originAt = finite(extremeAt);
  const tick = Math.max(0, finite(tickSize) ?? 0);
  if (!(levelPrice > 0) || originAt === null || !["HIGH", "LOW"].includes(side)) {
    return Object.freeze({
      status: "INVALID",
      active: false,
      crossedAt: null,
      endAt: originAt,
      touchCount: 0,
      retestCount: 0,
      attacks: Object.freeze([]),
      pierces: Object.freeze([]),
    });
  }

  // Old zone arguments remain in the signature for review/export compatibility,
  // but they no longer define an attack.
  void crossingToleranceTicks;
  void touchZoneTicks;
  void touchZoneFactor;
  void maximumTouchZonePct;

  const levelTicks = tick > 0 ? Math.round(levelPrice / tick) : null;
  const rearmPct = Math.max(
    0.01,
    Math.max(0.01, finite(reversalThresholdPct) ?? 0.5)
      * Math.max(0.1, finite(rearmDistanceFactor) ?? 0.7),
  );
  const requiredAcceptanceBars = Math.max(1, Math.round(finite(acceptanceBars) ?? 2));

  let active = true;
  let crossedAt = null;
  let inAttack = false;
  let rearmed = false;
  let pendingPierce = false;
  let acceptanceCount = 0;
  let rejectedPierceCount = 0;
  const attacks = [];
  const pierces = [];

  const isCloseBeyond = (close) => side === "HIGH" ? close > levelPrice : close < levelPrice;

  for (const candle of rows) {
    const candleTime = finite(candle?.time);
    const closeTime = finite(candle?.closeTime) ?? candleTime;
    if (candleTime === null || candleTime <= originAt) continue;
    const high = finite(candle?.high);
    const low = finite(candle?.low);
    const close = finite(candle?.close);
    if (![high, low, close].every(Number.isFinite)) continue;

    if (explicitCrossAt !== null && candleTime >= explicitCrossAt) {
      active = false;
      crossedAt = closeTime;
      pendingPierce = false;
      break;
    }

    if (pendingPierce) {
      if (!isCloseBeyond(close)) {
        rejectedPierceCount += 1;
        pendingPierce = false;
        acceptanceCount = 0;
        inAttack = false;
        rearmed = false;
        continue;
      }
      acceptanceCount += 1;
      if (acceptanceCount >= requiredAcceptanceBars) {
        active = false;
        crossedAt = closeTime;
        pendingPierce = false;
        break;
      }
      continue;
    }

    const highTicks = levelTicks === null ? null : Math.round(high / tick);
    const lowTicks = levelTicks === null ? null : Math.round(low / tick);
    const pierced = side === "HIGH"
      ? (levelTicks === null ? high > levelPrice : highTicks > levelTicks)
      : (levelTicks === null ? low < levelPrice : lowTicks < levelTicks);

    if (pierced) {
      pierces.push(Object.freeze({
        number: pierces.length + 1,
        time: candleTime,
        closeTime,
        price: side === "HIGH" ? high : low,
      }));
      inAttack = false;
      rearmed = false;
      if (!isCloseBeyond(close)) {
        rejectedPierceCount += 1;
        acceptanceCount = 0;
        continue;
      }
      pendingPierce = true;
      acceptanceCount = 1;
      if (acceptanceCount >= requiredAcceptanceBars) {
        active = false;
        crossedAt = closeTime;
        pendingPierce = false;
        break;
      }
      continue;
    }

    const exactAttack = side === "HIGH"
      ? (levelTicks === null ? high === levelPrice : highTicks === levelTicks)
      : (levelTicks === null ? low === levelPrice : lowTicks === levelTicks);

    if (exactAttack) {
      if (!inAttack && rearmed) {
        attacks.push(Object.freeze({
          number: attacks.length + 2,
          time: candleTime,
          closeTime,
          price: levelPrice,
          semantics: "EXACT_PRICE_TICK",
        }));
      }
      inAttack = true;
      rearmed = false;
      continue;
    }

    inAttack = false;
    const awayPct = side === "HIGH"
      ? Math.max(0, (levelPrice - close) / levelPrice * 100)
      : Math.max(0, (close - levelPrice) / levelPrice * 100);
    if (awayPct >= rearmPct) rearmed = true;
  }

  const lastAt = rows.length
    ? finite(rows.at(-1)?.closeTime) ?? finite(rows.at(-1)?.time) ?? originAt
    : originAt;
  const retestCount = attacks.length;
  const touchCount = retestCount + 1;
  const status = active
    ? pendingPierce
      ? "PIERCED"
      : retestCount
        ? "TOUCHED"
        : "ACTIVE"
    : "ACCEPTED";

  return Object.freeze({
    status,
    active,
    crossedAt,
    endAt: crossedAt ?? lastAt,
    touchCount,
    retestCount,
    attacks: Object.freeze(attacks),
    pierces: Object.freeze(pierces),
    pendingPierce,
    rejectedPierceCount,
    rearmPct,
    zonePct: 0,
    attackToleranceTicks: 0,
    attackCountSemantics: "FORMATION_IS_ATTACK_1_EXACT_PRICE_TICK",
    breakSemantics: "PIERCE_THEN_ACCEPTANCE",
  });
}

'''
replace_between(LIFE, 'export function manualLevelLifecycle({', 'export function fixedReviewUrl({', new_manual)

# Existing regression now uses exact attacks and accepted break, not adaptive touch zone.
replace_once(TEST_V3, 'test("algorithm level uses adaptive zone and counts two retests internally", () => {', 'test("algorithm level counts only exact-price independent attacks", () => {')
replace_once(TEST_V3, '    candle(5, 102, 104.9, 101.8, 104.7),', '    candle(5, 102, 105, 101.8, 104.7),')

old_manual_rows = '''    candle(2, 97.5, 99.95, 97.4, 99.7),\n    candle(3, 99.5, 99.6, 97, 97.4),\n    candle(4, 97.4, 100, 97.3, 99.8),\n    candle(5, 99.8, 100.3, 99.7, 100.2),'''
new_manual_rows = '''    candle(2, 97.5, 100, 97.4, 99.7),\n    candle(3, 99.5, 99.6, 97, 97.4),\n    candle(4, 97.4, 100, 97.3, 99.8),\n    candle(5, 99.8, 100.3, 99.7, 100.2),\n    candle(6, 100.2, 100.4, 100.1, 100.3),'''
replace_once(TEST_V3, old_manual_rows, new_manual_rows)
replace_once(TEST_V3, '  assert.equal(result.status, "CROSSED");', '  assert.equal(result.status, "ACCEPTED");')
replace_once(TEST_V3, '  assert.equal(result.crossedAt, rows[5].closeTime);', '  assert.equal(result.crossedAt, rows[6].closeTime);')
replace_once(TEST_V3, '    candle(2, 97.5, 99.95, 97.4, 99.7),', '    candle(2, 97.5, 100, 97.4, 99.7),')

old_crossing_test = '''test("crossing tolerance is independent from the wider reversal tick buffer", () => {\n  const subject = engine({ tickSizeBufferTicks: 3, crossingToleranceTicks: 1 });\n  subject.ingestCandles(risingToConfirmedHigh());\n  subject.ingestCandle(candle(7, 104.3, 104.5, 103.0, 103.5));\n  let snapshot = subject.ingestCandle(candle(8, 103.5, 105.1, 103.4, 105.0));\n  const highId = snapshot.history.find((row) => row.side === "HIGH").id;\n  assert.ok(snapshot.active.some((row) => row.id === highId));\n  snapshot = subject.ingestCandle(candle(9, 105.0, 105.2, 104.8, 105.1));\n  const crossedHigh = snapshot.history.find((row) => row.id === highId);\n  assert.equal(crossedHigh.active, false);\n  assert.equal(crossedHigh.status, STRUCTURAL_EXTREME_STATUSES.CROSSED);\n  assert.ok(snapshot.active.every((row) => row.id !== highId));\n});'''
new_crossing_test = '''test("one-tick pierce that closes back is rejected and level stays active", () => {\n  const subject = engine({ tickSizeBufferTicks: 3, crossingToleranceTicks: 1 });\n  subject.ingestCandles(risingToConfirmedHigh());\n  subject.ingestCandle(candle(7, 104.3, 104.5, 103.0, 103.5));\n  const snapshot = subject.ingestCandle(candle(8, 103.5, 105.1, 103.4, 104.9));\n  const high = snapshot.history.find((row) => row.side === "HIGH");\n  assert.ok(high);\n  assert.equal(high.active, true);\n  assert.equal(high.status, STRUCTURAL_EXTREME_STATUSES.CONFIRMED_ACTIVE);\n  assert.equal(high.pierceCount, 1);\n  assert.equal(high.lastRejectedPierceAt, snapshot.lastCandleTime + STEP - 1);\n});'''
replace_once(TEST_CORE, old_crossing_test, new_crossing_test)

old_pass_test = '''test("actual pass beyond tick tolerance removes active high", () => {\n  const subject = engine();\n  subject.ingestCandles(risingToConfirmedHigh());\n  subject.ingestCandle(candle(7, 104.3, 104.5, 103.0, 103.5));\n  const crossing = candle(8, 103.5, 105.2, 103.4, 105.15);\n  const snapshot = subject.ingestCandle(crossing);\n  assert.equal(snapshot.active.length, 0);\n  assert.equal(snapshot.history[0].status, STRUCTURAL_EXTREME_STATUSES.CROSSED);\n  assert.equal(snapshot.history[0].crossedAt, crossing.closeTime);\n});'''
new_pass_test = '''test("accepted break removes active high only after acceptance beyond the level", () => {\n  const subject = engine();\n  subject.ingestCandles(risingToConfirmedHigh());\n  subject.ingestCandle(candle(7, 104.3, 104.5, 103.0, 103.5));\n  let snapshot = subject.ingestCandle(candle(8, 103.5, 105.2, 103.4, 105.1));\n  assert.equal(snapshot.active.length, 1);\n  assert.equal(snapshot.history[0].status, STRUCTURAL_EXTREME_STATUSES.PIERCED);\n  const accepted = candle(9, 105.1, 105.4, 105.0, 105.2);\n  snapshot = subject.ingestCandle(accepted);\n  assert.equal(snapshot.active.length, 0);\n  assert.equal(snapshot.history[0].status, STRUCTURAL_EXTREME_STATUSES.ACCEPTED);\n  assert.equal(snapshot.history[0].crossedAt, accepted.closeTime);\n});'''
replace_once(TEST_CORE, old_pass_test, new_pass_test)

TEST_NEW.write_text(r'''import test from "node:test";
import assert from "node:assert/strict";
import { manualLevelLifecycle } from "../signal-lab-v7-review-level-lifecycle.js";

const BASE = Date.UTC(2026, 7, 7, 0, 0, 0);
const STEP = 60_000;
function candle(index, open, high, low, close) {
  return { time: BASE + index * STEP, closeTime: BASE + (index + 1) * STEP - 1, open, high, low, close, volume: 1, closed: true };
}
const common = { side: "HIGH", price: 105, extremeAt: BASE, tickSize: 0.1, reversalThresholdPct: 1, rearmDistanceFactor: 0.5, acceptanceBars: 2 };

test("near miss is not an attack", () => {
  const result = manualLevelLifecycle({ ...common, candles: [candle(1, 104, 104.4, 103, 103.5), candle(2, 103.5, 104.9, 103.2, 104.7)] });
  assert.equal(result.retestCount, 0);
  assert.equal(result.touchCount, 1);
});

test("exact price after rearm is a new attack", () => {
  const result = manualLevelLifecycle({ ...common, candles: [candle(1, 104, 104.4, 103, 103.5), candle(2, 103.5, 105, 103.2, 104.7)] });
  assert.equal(result.retestCount, 1);
  assert.equal(result.touchCount, 2);
});

test("pierce that closes back is rejected, not a break", () => {
  const result = manualLevelLifecycle({ ...common, candles: [candle(1, 104, 104.4, 103, 103.5), candle(2, 103.5, 105.1, 103.2, 104.9)] });
  assert.equal(result.active, true);
  assert.equal(result.crossedAt, null);
  assert.equal(result.rejectedPierceCount, 1);
  assert.equal(result.pierces.length, 1);
});

test("accepted break needs persistence beyond the level", () => {
  const result = manualLevelLifecycle({ ...common, candles: [candle(1, 104, 104.4, 103, 103.5), candle(2, 103.5, 105.2, 103.2, 105.1), candle(3, 105.1, 105.4, 105.0, 105.2)] });
  assert.equal(result.active, false);
  assert.equal(result.status, "ACCEPTED");
  assert.equal(result.crossedAt, BASE + 4 * STEP - 1);
});

test("rejected pierce can be followed by a later second break attempt", () => {
  const result = manualLevelLifecycle({ ...common, candles: [
    candle(1, 104, 104.4, 103, 103.5),
    candle(2, 103.5, 105.1, 103.2, 104.9),
    candle(3, 104.9, 103.8, 102.8, 103.2),
    candle(4, 103.2, 105.2, 103.0, 105.1),
    candle(5, 105.1, 105.4, 105.0, 105.2),
  ] });
  assert.equal(result.pierces.length, 2);
  assert.equal(result.rejectedPierceCount, 1);
  assert.equal(result.active, false);
});
''', encoding='utf-8')

text = DOC.read_text(encoding='utf-8')
marker = '## V3.9 — атака, закол и подтверждённый пробой'
if marker not in text:
    text += r'''

## V3.9 — атака, закол и подтверждённый пробой

Уровень больше не снимается от первого тика за цену.

- формирование экстремума = атака ×1;
- новая атака ×N считается только при печати ровно того же биржевого tick после достаточного ухода и возврата;
- недоход до цены — подход, но не атака;
- первый проход хотя бы на tick за уровень — `PIERCED` (закол / попытка пробоя), а не финальный пробой;
- если цена закрывается обратно по эту сторону уровня, закол считается отклонённым (`EXTREME_PIERCE_REJECTED`), уровень остаётся активным;
- подтверждённый пробой наступает только после принятия цены за уровнем; базовая техническая эвристика Stage 1 — `acceptanceBars` последовательных закрытий за уровнем;
- после отклонённого закола допускается последующая повторная попытка пробоя; её пригодность для повторного входа в каскад будет оцениваться отдельным pattern/context-слоем, а не самим детектором уровня.

Важно: ATR/волатильность используется только для rearm между самостоятельными атаками и не расширяет цену, которая считается атакой.
'''
    DOC.write_text(text, encoding='utf-8')
