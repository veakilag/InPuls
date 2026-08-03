const root = document.documentElement;
const chartCanvases = new Set();
const tapeCanvases = new Set();
const originalFilters = new WeakMap();

let baselineValue = null;
let lastChartBrightness = null;
let lastTapeBrightness = null;

function clamp(value, minimum, maximum) {
  return Math.max(minimum, Math.min(maximum, Number(value) || 0));
}

function mixChannel(left, right, amount) {
  return Math.round(left + (right - left) * amount);
}

function mixHex(left, right, amount) {
  const read = (value) => value.match(/[a-f\d]{2}/gi).map((part) => parseInt(part, 16));
  const start = read(left);
  const end = read(right);
  const ratio = clamp(amount, 0, 1);
  return start.map((channel, index) => mixChannel(channel, end[index], ratio));
}

function relativeLuminance(rgb) {
  const channels = rgb.map((channel) => {
    const normalized = channel / 255;
    return normalized <= .04045
      ? normalized / 12.92
      : ((normalized + .055) / 1.055) ** 2.4;
  });
  return channels[0] * .2126 + channels[1] * .7152 + channels[2] * .0722;
}

function brightnessRatio(value, light, dark, baseline) {
  const target = relativeLuminance(mixHex(light, dark, clamp(value, 0, 100) / 100));
  const source = relativeLuminance(mixHex(light, dark, clamp(baseline, 0, 100) / 100));
  return clamp(Math.sqrt((target + .003) / (source + .003)), .48, 2.15);
}

function rememberCanvas(canvas, bucket) {
  if (!(canvas instanceof HTMLCanvasElement)) return;
  bucket.add(canvas);
  if (!originalFilters.has(canvas)) originalFilters.set(canvas, canvas.style.filter);
}

function scanNode(node) {
  if (!(node instanceof Element)) return;
  if (node.matches(".chart-stage canvas")) rememberCanvas(node, chartCanvases);
  if (node.matches(".trade-flow canvas")) rememberCanvas(node, tapeCanvases);
  for (const canvas of node.querySelectorAll?.(".chart-stage canvas") ?? []) {
    rememberCanvas(canvas, chartCanvases);
  }
  for (const canvas of node.querySelectorAll?.(".trade-flow canvas") ?? []) {
    rememberCanvas(canvas, tapeCanvases);
  }
}

function applyBucket(bucket, brightness) {
  const value = Number(brightness).toFixed(3);
  for (const canvas of bucket) {
    if (!canvas.isConnected) {
      bucket.delete(canvas);
      continue;
    }
    const original = originalFilters.get(canvas) || "";
    canvas.style.filter = `${original ? `${original} ` : ""}brightness(${value})`;
  }
}

function clearPreview() {
  for (const bucket of [chartCanvases, tapeCanvases]) {
    for (const canvas of bucket) {
      if (!canvas.isConnected) {
        bucket.delete(canvas);
        continue;
      }
      canvas.style.filter = originalFilters.get(canvas) || "";
    }
  }
  baselineValue = null;
  lastChartBrightness = null;
  lastTapeBrightness = null;
}

scanNode(document.documentElement);
new MutationObserver((records) => {
  for (const record of records) {
    for (const node of record.addedNodes) scanNode(node);
  }
}).observe(document.documentElement, { childList: true, subtree: true });

globalThis.addEventListener("inpuls:comfort-preview", (event) => {
  const value = Number(event.detail?.value);
  if (!Number.isFinite(value)) return;
  if (!Number.isFinite(baselineValue)) {
    baselineValue = Number(root.dataset.comfort ?? localStorage.getItem("inpuls-comfort-v1") ?? value);
  }
  const chartBrightness = brightnessRatio(value, "#1f2227", "#090b0e", baselineValue);
  const tapeBrightness = brightnessRatio(value, "#2d3137", "#111419", baselineValue);
  if (chartBrightness !== lastChartBrightness) {
    lastChartBrightness = chartBrightness;
    applyBucket(chartCanvases, chartBrightness);
  }
  if (tapeBrightness !== lastTapeBrightness) {
    lastTapeBrightness = tapeBrightness;
    applyBucket(tapeCanvases, tapeBrightness);
  }
});

globalThis.addEventListener("inpuls:theme-change", clearPreview);
globalThis.addEventListener("pagehide", clearPreview);
