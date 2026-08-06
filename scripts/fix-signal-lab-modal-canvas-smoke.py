from pathlib import Path

path = Path("scripts/signal-lab-runtime-smoke.mjs")
text = path.read_text(encoding="utf-8")
old = '''      root.querySelector('[data-modal-close]')?.click();
      await wait(50);
      const closed = root.hidden && root.getAttribute('aria-hidden') === 'true';
      const resized = Math.abs(after.width - before.width) > 20 || Math.abs(after.height - before.height) > 20;
      const canvasReady = canvas.getBoundingClientRect().width > 100 && canvas.getBoundingClientRect().height > 100;
      return {
        ok: Boolean(timeframeActive && resized && canvasReady && closed),
        source,
        timeframeActive,
        resized,
        canvasReady,
        closed,
        before: { width: Math.round(before.width), height: Math.round(before.height) },
        after: { width: Math.round(after.width), height: Math.round(after.height) },
      };'''
new = '''      const resized = Math.abs(after.width - before.width) > 20 || Math.abs(after.height - before.height) > 20;
      const canvasRect = canvas.getBoundingClientRect();
      const canvasReady = canvasRect.width > 100 && canvasRect.height > 100;
      root.querySelector('[data-modal-close]')?.click();
      await wait(50);
      const closed = root.hidden && root.getAttribute('aria-hidden') === 'true';
      return {
        ok: Boolean(timeframeActive && resized && canvasReady && closed),
        source,
        timeframeActive,
        resized,
        canvasReady,
        closed,
        before: { width: Math.round(before.width), height: Math.round(before.height) },
        after: { width: Math.round(after.width), height: Math.round(after.height) },
        canvas: { width: Math.round(canvasRect.width), height: Math.round(canvasRect.height) },
      };'''
count = text.count(old)
if count != 1:
    raise SystemExit(f"Expected one canvas smoke block, found {count}")
path.write_text(text.replace(old, new, 1), encoding="utf-8")
print("Canvas readiness is now measured before the modal closes")
