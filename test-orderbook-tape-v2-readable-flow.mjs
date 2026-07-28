import assert from 'node:assert/strict';
import test from 'node:test';
import {
  TAPE_READABLE_LAYOUT,
  adaptiveRawDiameter,
  buildReadableTapeLayout,
  quantileThreshold,
  selectReadableAggLabels,
} from './orderbook-tape-layout.js';

function windowFor(width, duration=12000) {
  return { startTime: 1000, duration, endTime: 1000+duration, plotRight: width };
}

test('sparse trades stay on real time', () => {
  const window = windowFor(600);
  const items = [1000, 5000, 9000].map((offset, id) => ({ id, time: window.startTime + offset }));
  const laid = buildReadableTapeLayout(items, window, 600);
  for (const item of laid) assert.ok(Math.abs(item.x - item.baseX) < 1e-9);
});

test('same-time packet remains local and chronological', () => {
  const window = windowFor(320);
  const items = Array.from({length: 1_200}, (_, id) => ({ id, time: window.endTime - 5 }));
  const laid = buildReadableTapeLayout(items, window, 320);
  assert.deepEqual(laid.map(x=>x.id), items.map(x=>x.id));
  assert.ok(laid.at(-1).x - laid[0].x <= TAPE_READABLE_LAYOUT.maxExtraSpanPx + 1e-9);
  for (let i=1;i<laid.length;i++) assert.ok(laid[i].x >= laid[i-1].x);
});

test('continuous flow is split into local groups', () => {
  const window = windowFor(800, 12000);
  const items = Array.from({length: 600}, (_, id) => ({ id, time: window.startTime + id * 20 }));
  const laid = buildReadableTapeLayout(items, window, 800);
  assert.equal(laid.length, items.length);
  assert.ok(laid.every(x=>Number.isFinite(x.x)));
  assert.ok(Math.max(...laid.map(x=>x.density)) <= TAPE_READABLE_LAYOUT.maxClusterItems);
});

test('neighboring dense groups never cross chronological order', () => {
  const window = windowFor(500);
  const timeAtX = (x) => (
    window.startTime + x / window.plotRight * window.duration
  );
  const first = Array.from(
    { length: 20 },
    (_, id) => ({ id, time: timeAtX(100) }),
  );
  const second = Array.from(
    { length: 20 },
    (_, index) => ({ id: 20 + index, time: timeAtX(104) }),
  );
  const laid = buildReadableTapeLayout([...first, ...second], window, 500);
  const firstEnd = Math.max(...laid.slice(0, 20).map((item) => item.x));
  const secondStart = Math.min(...laid.slice(20).map((item) => item.x));
  assert.ok(firstEnd <= secondStart + 1e-9);
  for (let index = 1; index < laid.length; index += 1) {
    assert.ok(laid[index].x >= laid[index - 1].x);
  }
});

test('dense raw dots shrink while large sparse dots stay visible', () => {
  const sparseLarge = adaptiveRawDiameter(1, 1, 600);
  const denseLarge = adaptiveRawDiameter(1, 100, 600);
  const denseSmall = adaptiveRawDiameter(0, 100, 600);
  assert.ok(sparseLarge <= TAPE_READABLE_LAYOUT.maxDiameterPx);
  assert.ok(denseLarge < sparseLarge);
  assert.ok(denseSmall >= TAPE_READABLE_LAYOUT.minDiameterPx);
});

test('agg labels are selective and non-overlapping', () => {
  const items = Array.from({length: 30}, (_, id) => ({
    key: `k${id}`, quote: 100+id, x: 100 + id*.5, y: 40, label: String(100+id), height: 12,
  }));
  const selected = selectReadableAggLabels(items, text => text.length*6, {width: 500}, {maximum: 3, quantile:.8});
  assert.ok(selected.size <= 3);
  assert.ok(selected.size >= 1);
  assert.equal(quantileThreshold([1,2,3,4,5], .8), 4);
});
