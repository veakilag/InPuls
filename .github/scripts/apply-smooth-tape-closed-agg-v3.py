from pathlib import Path

path = Path(".github/scripts/apply-smooth-tape-closed-agg-v2.py")
text = path.read_text(encoding="utf-8")
old = '''export function advanceTapeCameraEnd(previousEnd, targetEnd, elapsedMs, speed = TAPE_CAMERA_SPEED) {
  const target = Number(targetEnd);
  const previous = Number(previousEnd);
  if (!Number.isFinite(target)) return Number.isFinite(previous) ? previous : null;
  if (!Number.isFinite(previous) || target <= previous) return target;
  const elapsed = Math.max(0, Math.min(250, Number(elapsedMs) || 0));
  const rate = Math.max(.25, Number(speed) || TAPE_CAMERA_SPEED);
  return Math.min(target, previous + Math.max(.5, elapsed * rate));
}
'''
new = '''export function advanceTapeCameraEnd(previousEnd, targetEnd, elapsedMs, speed = TAPE_CAMERA_SPEED) {
  const target = Number(targetEnd);
  const hasPrevious = previousEnd !== null
    && previousEnd !== undefined
    && previousEnd !== ""
    && Number.isFinite(Number(previousEnd));
  const previous = hasPrevious ? Number(previousEnd) : null;
  if (!Number.isFinite(target)) return hasPrevious ? previous : null;
  if (!hasPrevious || target <= previous) return target;
  const elapsed = Math.max(0, Math.min(250, Number(elapsedMs) || 0));
  const rate = Math.max(.25, Number(speed) || TAPE_CAMERA_SPEED);
  return Math.min(target, previous + Math.max(.5, elapsed * rate));
}
'''
if text.count(old) != 1:
    raise SystemExit(f"camera helper source: expected 1 match, got {text.count(old)}")
text = text.replace(old, new, 1)
path.write_text(text, encoding="utf-8")
exec(compile(text, str(path), "exec"))
