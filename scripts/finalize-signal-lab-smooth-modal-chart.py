from pathlib import Path


def replace_once(path: str, old: str, new: str) -> None:
    file = Path(path)
    text = file.read_text(encoding="utf-8")
    count = text.count(old)
    if count != 1:
        raise SystemExit(f"{path}: expected one occurrence, found {count}: {old[:140]!r}")
    file.write_text(text.replace(old, new, 1), encoding="utf-8")


replace_once(
    "signal-lab-chart-modal.js",
    '<section class="signal-lab-chart-modal__window" role="dialog" aria-modal="true" aria-labelledby="signal-lab-modal-title">',
    '<section class="signal-lab-chart-modal__window" role="dialog" aria-modal="true" aria-labelledby="signal-lab-modal-title" tabindex="-1">',
)

replace_once(
    "owner-signal-lab-v3.js",
    '''function queueReplayMount(callback) {
  const job = typeof requestIdleCallback === "function"
    ? { kind: "idle", id: requestIdleCallback(callback, { timeout: 900 }) }
    : { kind: "timeout", id: setTimeout(callback, 80) };
  replayIdleJobs.add(job);
  return job;
}''',
    '''function queueReplayMount(callback) {
  const job = { kind: "timeout", id: null };
  const run = () => {
    replayIdleJobs.delete(job);
    callback();
  };
  if (typeof requestIdleCallback === "function") {
    job.kind = "idle";
    job.id = requestIdleCallback(run, { timeout: 900 });
  } else {
    job.id = setTimeout(run, 80);
  }
  replayIdleJobs.add(job);
  return job;
}''',
)

replace_once(
    "test/signal-lab-v3-full-chart.test.js",
    '''test("owner page exposes lazy full chart, markup controls and destructive clear", async () => {
  const html = await readFile(new URL("../owner-signal-lab-v3.html", import.meta.url), "utf8");
  const runtime = await readFile(new URL("../owner-signal-lab-v3.js", import.meta.url), "utf8");
  assert.match(html, /OWNER SIGNAL LAB V5/);
  assert.match(html, /data-field="full-chart"/);
  assert.match(html, /data-chart-timeframe="1s"/);
  assert.match(html, /data-chart-timeframe="1h"/);
  assert.match(html, /data-chart-tool="horizontal"/);
  assert.match(html, /data-field="chart-annotations-toggle"/);
  assert.match(html, /id="clear-records"/);
  assert.match(runtime, /mountEpisodeFullChart/);
  assert.match(runtime, /disposeEpisodeFullCharts/);
  assert.match(runtime, /window\\.confirm/);
  assert.match(runtime, /store\\.clearAll\\(\\)/);
  assert.match(runtime, /collector = createCollector\\(\\)/);
});''',
    '''test("owner page exposes one shared modal chart, markup controls and destructive clear", async () => {
  const html = await readFile(new URL("../owner-signal-lab-v3.html", import.meta.url), "utf8");
  const runtime = await readFile(new URL("../owner-signal-lab-v3.js", import.meta.url), "utf8");
  const modal = await readFile(new URL("../signal-lab-chart-modal.js", import.meta.url), "utf8");
  assert.match(html, /OWNER SIGNAL LAB V5/);
  assert.match(html, /data-field="chart-toggle"/);
  assert.match(html, /id="clear-records"/);
  assert.match(runtime, /openEpisodeChartModal/);
  assert.match(runtime, /deferEvidenceReplay/);
  assert.doesNotMatch(runtime, /mountEpisodeFullChart|disposeEpisodeFullCharts/);
  assert.match(modal, /\["1s", "1с"\]/);
  assert.match(modal, /\["1h", "1ч"\]/);
  assert.match(modal, /buttonGroup\(TIMEFRAMES, "data-modal-timeframe", "1m"\)/);
  assert.match(modal, /data-modal-tool="horizontal"/);
  assert.match(modal, /data-modal-annotations/);
  assert.match(modal, /tabindex="-1"/);
  assert.match(runtime, /window\\.confirm/);
  assert.match(runtime, /store\\.clearAll\\(\\)/);
  assert.match(runtime, /collector = createCollector\\(\\)/);
});''',
)

replace_once(
    "test/signal-lab-v3-full-chart.test.js",
    '''test("open full chart locks card rerenders until the reviewer closes it", async () => {
  const chartRuntime = await readFile(new URL("../signal-lab-v3-full-chart.js", import.meta.url), "utf8");
  const ownerRuntime = await readFile(new URL("../owner-signal-lab-v3.js", import.meta.url), "utf8");
  assert.match(chartRuntime, /export function isEpisodeFullChartOpen/);
  assert.match(chartRuntime, /inpuls:signal-lab-chart-closed/);
  assert.match(ownerRuntime, /if \\(isEpisodeFullChartOpen\\(\\)\\) \\{/);
  assert.match(ownerRuntime, /state\\.pendingRender = true/);
  assert.match(ownerRuntime, /window\\.addEventListener\\("inpuls:signal-lab-chart-closed"/);
});''',
    '''test("shared modal chart stays independent from periodic card rerenders", async () => {
  const modalRuntime = await readFile(new URL("../signal-lab-chart-modal.js", import.meta.url), "utf8");
  const ownerRuntime = await readFile(new URL("../owner-signal-lab-v3.js", import.meta.url), "utf8");
  assert.match(modalRuntime, /let singleton = null/);
  assert.match(modalRuntime, /export function openEpisodeChartModal/);
  assert.match(modalRuntime, /this\\.abortController\\?\\.abort\\(\\)/);
  assert.match(ownerRuntime, /setInterval\\(\\(\\) => scheduleRender\\(0\\), 15_000\\)/);
  assert.doesNotMatch(ownerRuntime, /isEpisodeFullChartOpen|inpuls:signal-lab-chart-closed/);
});''',
)

replace_once(
    "test/signal-lab-v4-performance-hotfix.test.js",
    '''test("owner UI renders a bounded collapsed card window", () => {
  assert.match(owner, /limit: 250/);
  assert.match(owner, /merged\\.slice\\(0, 12\\)/);
  assert.match(owner, /autoOpen: false/);
  assert.doesNotMatch(owner, /merged\\.slice\\(0, 60\\)/);
});''',
    '''test("owner UI renders a bounded card window and defers heavy replay work", () => {
  assert.match(owner, /limit: 250/);
  assert.match(owner, /merged\\.slice\\(0, 12\\)/);
  assert.match(owner, /IntersectionObserver/);
  assert.match(owner, /requestIdleCallback/);
  assert.match(owner, /deferEvidenceReplay/);
  assert.doesNotMatch(owner, /mountEpisodeFullChart|merged\\.slice\\(0, 60\\)/);
});''',
)

for diagnostic in ("test-output.txt", "test-exit-code.txt"):
    Path(diagnostic).unlink(missing_ok=True)

print("Signal Lab modal chart tests and lifecycle finalized")
