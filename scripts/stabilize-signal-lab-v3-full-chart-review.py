from pathlib import Path


def replace_once(path, old, new, label):
    source = Path(path).read_text()
    count = source.count(old)
    if count != 1:
        raise RuntimeError(f"{label}: expected one match, got {count}")
    Path(path).write_text(source.replace(old, new, 1))


replace_once(
    "signal-lab-v3-full-chart.js",
    '''    if (!preserveActive && activeEpisodeId === this.id) activeEpisodeId = null;''',
    '''    if (!preserveActive && activeEpisodeId === this.id) {
      activeEpisodeId = null;
      globalThis.dispatchEvent?.(new CustomEvent("inpuls:signal-lab-chart-closed", {
        detail: { episodeId: this.id },
      }));
    }''',
    "chart close event",
)

replace_once(
    "signal-lab-v3-full-chart.js",
    '''export function disposeEpisodeFullCharts({ preserveActive = true } = {}) {''',
    '''export function isEpisodeFullChartOpen() {
  return activeEpisodeId !== null;
}

export function disposeEpisodeFullCharts({ preserveActive = true } = {}) {''',
    "chart open state export",
)

replace_once(
    "owner-signal-lab-v3.js",
    '''  disposeEpisodeFullCharts,
  mountEpisodeFullChart,
  resetEpisodeFullChartState,''',
    '''  disposeEpisodeFullCharts,
  isEpisodeFullChartOpen,
  mountEpisodeFullChart,
  resetEpisodeFullChartState,''',
    "owner chart state import",
)

replace_once(
    "owner-signal-lab-v3.js",
    '''  renderTimer: null,
  rendering: false,''',
    '''  renderTimer: null,
  rendering: false,
  pendingRender: false,''',
    "pending render state",
)

replace_once(
    "owner-signal-lab-v3.js",
    '''function scheduleRender(delay = 180) {
  clearTimeout(state.renderTimer);
  state.renderTimer = setTimeout(() => render(), delay);
}''',
    '''function scheduleRender(delay = 180) {
  if (isEpisodeFullChartOpen()) {
    state.pendingRender = true;
    return;
  }
  clearTimeout(state.renderTimer);
  state.renderTimer = setTimeout(() => render(), delay);
}''',
    "schedule render lock",
)

replace_once(
    "owner-signal-lab-v3.js",
    '''async function render() {
  if (state.rendering) return;
  state.rendering = true;''',
    '''async function render() {
  if (isEpisodeFullChartOpen()) {
    state.pendingRender = true;
    return;
  }
  if (state.rendering) return;
  state.pendingRender = false;
  state.rendering = true;''',
    "render lock",
)

replace_once(
    "owner-signal-lab-v3.js",
    '''    const shouldRestart = state.running;
    collector.disconnect();
    resetEpisodeFullChartState();''',
    '''    const shouldRestart = state.running;
    state.pendingRender = false;
    clearTimeout(state.renderTimer);
    collector.disconnect();
    resetEpisodeFullChartState();''',
    "clear records render cancellation",
)

replace_once(
    "owner-signal-lab-v3.js",
    '''window.addEventListener("beforeunload", () => {
  disposeEpisodeFullCharts({ preserveActive: false });
  collector.disconnect();
});
setInterval(() => scheduleRender(0), 5_000);''',
    '''window.addEventListener("inpuls:signal-lab-chart-closed", () => {
  if (!state.pendingRender) return;
  state.pendingRender = false;
  scheduleRender(0);
});
window.addEventListener("beforeunload", () => {
  disposeEpisodeFullCharts({ preserveActive: false });
  collector.disconnect();
});
setInterval(() => scheduleRender(0), 5_000);''',
    "chart close refresh listener",
)

path = Path("test/signal-lab-v3-full-chart.test.js")
source = path.read_text()
anchor = '''test("shared InPuls chart engine owns passive pattern annotations", async () => {
  const source = await readFile(new URL("../chart.js", import.meta.url), "utf8");
  assert.match(source, /export class CandlestickChart/);
  assert.match(source, /setAnnotations\\(annotations = \\[\\]\\)/);
  assert.match(source, /#drawAnnotations\\(ctx\\)/);
  assert.match(source, /annotation\\.type === "zone"/);
  assert.match(source, /annotation\\.type === "point"/);
});
'''
if source.count(anchor) != 1:
    raise RuntimeError("full chart test anchor not found")
source = source.replace(anchor, anchor + '''

test("open full chart locks card rerenders until the reviewer closes it", async () => {
  const chartRuntime = await readFile(new URL("../signal-lab-v3-full-chart.js", import.meta.url), "utf8");
  const ownerRuntime = await readFile(new URL("../owner-signal-lab-v3.js", import.meta.url), "utf8");
  assert.match(chartRuntime, /export function isEpisodeFullChartOpen/);
  assert.match(chartRuntime, /inpuls:signal-lab-chart-closed/);
  assert.match(ownerRuntime, /if \\(isEpisodeFullChartOpen\\(\\)\\) \\{/);
  assert.match(ownerRuntime, /state\\.pendingRender = true/);
  assert.match(ownerRuntime, /window\\.addEventListener\\("inpuls:signal-lab-chart-closed"/);
});
''')
path.write_text(source)

print("Signal Lab V3.3 full chart review lock applied")
