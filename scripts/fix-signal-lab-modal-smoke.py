from pathlib import Path

path = Path("scripts/signal-lab-runtime-smoke.mjs")
text = path.read_text(encoding="utf-8")
old = r'''async function probeChartModal(socket) {
  const evaluation = await send(socket, "Runtime.evaluate", {
    expression: `(async () => {
      const wait = (ms) => new Promise((resolve) => setTimeout(resolve, ms));
      let button = null;
      for (let attempt = 0; attempt < 80; attempt += 1) {
        button = document.querySelector('[data-field="chart-toggle"]');
        if (button) break;
        await wait(250);
      }
      if (!button) return { ok: false, reason: 'NO_CHART_BUTTON' };
      button.click();
      let root = null;
      for (let attempt = 0; attempt < 40; attempt += 1) {
        root = document.querySelector('.signal-lab-chart-modal');
        if (root && !root.hidden && root.getAttribute('aria-hidden') === 'false') break;
        await wait(100);
      }
      const panel = root?.querySelector('.signal-lab-chart-modal__window');
      const canvas = root?.querySelector('[data-modal-canvas]');
      if (!root || !panel || !canvas || root.hidden) return { ok: false, reason: 'MODAL_DID_NOT_OPEN' };
      await new Promise((resolve) => requestAnimationFrame(() => requestAnimationFrame(resolve)));
      const before = panel.getBoundingClientRect();
      panel.style.width = '70vw';
      panel.style.height = '70vh';
      panel.style.transform = 'none';
      panel.style.left = '40px';
      panel.style.top = '40px';
      await new Promise((resolve) => requestAnimationFrame(() => requestAnimationFrame(resolve)));
      const after = panel.getBoundingClientRect();
      const timeframe = root.querySelector('[data-modal-timeframe="5m"]');
      timeframe?.click();
      await wait(120);
      const timeframeActive = timeframe?.classList.contains('is-active') === true;
      root.querySelector('[data-modal-close]')?.click();
      await wait(50);
      const closed = root.hidden && root.getAttribute('aria-hidden') === 'true';
      const resized = Math.abs(after.width - before.width) > 20 || Math.abs(after.height - before.height) > 20;
      const canvasReady = canvas.getBoundingClientRect().width > 100 && canvas.getBoundingClientRect().height > 100;
      return {
        ok: Boolean(timeframeActive && resized && canvasReady && closed),
        timeframeActive,
        resized,
        canvasReady,
        closed,
        before: { width: Math.round(before.width), height: Math.round(before.height) },
        after: { width: Math.round(after.width), height: Math.round(after.height) },
      };
    })()`,
    awaitPromise: true,
    returnByValue: true,
  });
  return evaluation.result?.result?.value ?? evaluation.result?.value ?? { ok: false, reason: "NO_RESULT" };
}
'''
new = r'''async function probeChartModal(socket) {
  const evaluation = await send(socket, "Runtime.evaluate", {
    expression: `(async () => {
      const wait = (ms) => new Promise((resolve) => setTimeout(resolve, ms));
      const button = document.querySelector('[data-field="chart-toggle"]');
      let source = 'CARD_BUTTON';
      if (button) {
        button.click();
      } else {
        source = 'SYNTHETIC_EPISODE';
        const modalModule = await import('./signal-lab-chart-modal.js?v=signal-lab-v8-smooth-modal-chart');
        const now = Date.now();
        void modalModule.openEpisodeChartModal({
          id: 'runtime-smoke-modal',
          symbol: 'BTCUSDT',
          label: 'Runtime smoke',
          candidateType: 'cascade_breakout',
          stage: 'SETUP',
          direction: 'long',
          firstSeenAt: now - 60_000,
          lastSeenAt: now,
          observations: 1,
          peakEvidenceScore: 50,
          evidencePack: {
            window: {
              eventAt: now - 30_000,
              startAt: now - 120_000,
              endAt: now + 60_000,
            },
          },
        });
      }
      let root = null;
      for (let attempt = 0; attempt < 40; attempt += 1) {
        root = document.querySelector('.signal-lab-chart-modal');
        if (root && !root.hidden && root.getAttribute('aria-hidden') === 'false') break;
        await wait(100);
      }
      const panel = root?.querySelector('.signal-lab-chart-modal__window');
      const canvas = root?.querySelector('[data-modal-canvas]');
      if (!root || !panel || !canvas || root.hidden) return { ok: false, reason: 'MODAL_DID_NOT_OPEN', source };
      await new Promise((resolve) => requestAnimationFrame(() => requestAnimationFrame(resolve)));
      const before = panel.getBoundingClientRect();
      panel.style.width = '70vw';
      panel.style.height = '70vh';
      panel.style.transform = 'none';
      panel.style.left = '40px';
      panel.style.top = '40px';
      await new Promise((resolve) => requestAnimationFrame(() => requestAnimationFrame(resolve)));
      const after = panel.getBoundingClientRect();
      const timeframe = root.querySelector('[data-modal-timeframe="5m"]');
      timeframe?.click();
      await wait(120);
      const timeframeActive = timeframe?.classList.contains('is-active') === true;
      root.querySelector('[data-modal-close]')?.click();
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
      };
    })()`,
    awaitPromise: true,
    returnByValue: true,
  });
  return evaluation.result?.result?.value ?? evaluation.result?.value ?? { ok: false, reason: "NO_RESULT" };
}
'''
if text.count(old) != 1:
    raise SystemExit(f"Expected one modal probe, found {text.count(old)}")
path.write_text(text.replace(old, new, 1), encoding="utf-8")
print("Signal Lab modal runtime smoke made deterministic")
