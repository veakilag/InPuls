from pathlib import Path

path = Path("orderbook.js")
text = path.read_text(encoding="utf-8")
old = '''function smoothTapeWindowEnd(state, targetEnd, frozen, now = performance.now()) {
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
'''
new = '''function smoothTapeWindowEnd(state, targetEnd, frozen, now = performance.now()) {
  const target = Number(targetEnd);
  const currentNow = Number(now) || performance.now();
  const hasPrevious = state?.cameraEndTime !== null
    && state?.cameraEndTime !== undefined
    && state?.cameraEndTime !== ""
    && Number.isFinite(Number(state.cameraEndTime));
  const previous = hasPrevious ? Number(state.cameraEndTime) : null;
  const hasPreviousAt = state?.cameraUpdatedAt !== null
    && state?.cameraUpdatedAt !== undefined
    && Number.isFinite(Number(state.cameraUpdatedAt));
  const previousAt = hasPreviousAt ? Number(state.cameraUpdatedAt) : currentNow;
  const reset = frozen || !hasPrevious || target < previous;
  const end = reset
    ? target
    : advanceTapeCameraEnd(previous, target, currentNow - previousAt);
  state.cameraEndTime = end;
  state.cameraUpdatedAt = currentNow;
  state.cameraAnimating = !frozen && Number.isFinite(end) && end < target - .25;
  return end;
}
'''
if text.count(old) != 1:
    raise SystemExit(f"state camera block: expected 1 match, got {text.count(old)}")
path.write_text(text.replace(old, new, 1), encoding="utf-8")

path = Path("test-tape-stability-followup-v1.mjs")
text = path.read_text(encoding="utf-8")
old = '''  assert.match(orderbook, /function scheduleAnimatedTapeFrame\(\)/);
  assert.match(orderbook, /const base = count >= 6 \? 64 : count >= 3 \? 32 : 16/);'''
new = '''  assert.match(orderbook, /function scheduleAnimatedTapeFrame\(\)/);
  assert.match(orderbook, /const hasPrevious = state\?\.cameraEndTime !== null/);
  assert.match(orderbook, /const base = count >= 6 \? 64 : count >= 3 \? 32 : 16/);'''
if text.count(old) != 1:
    raise SystemExit(f"camera source assertion: expected 1 match, got {text.count(old)}")
path.write_text(text.replace(old, new, 1), encoding="utf-8")
