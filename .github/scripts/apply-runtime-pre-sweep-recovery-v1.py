from __future__ import annotations

from pathlib import Path
import subprocess

ROOT = Path(__file__).resolve().parents[2]
BASELINE = "8f2669357443e14e200487c0fcde84ec1d6fc4dc"
OLD_BUILD = "26-79-agg-center-tape-scale-settings-v1"
NEW_BUILD = "26-90-runtime-pre-sweep-recovery-v1"

RESTORE = [
    "VERSION.txt",
    "app.js",
    "chart.js",
    "index.html",
    "orderbook-flow-workspace.js",
    "orderbook-worker.js",
    "orderbook.js",
    "refresh.html",
    "refresh.js",
    "reset-v26.html",
    "reset.js",
    "sw.js",
    "test-agg-range-rx-fix-v1.mjs",
    "test-orderbook-flow-workspace.mjs",
    "test-orderbook-guarded-raw-tape.mjs",
    "test-orderbook-resume-v2.mjs",
    "test-orderbook-runtime-stability.mjs",
    "test-orderbook-seamless-resume.mjs",
    "test-orderbook-tape-v2-core.mjs",
    "test-orderbook-visual-priority.mjs",
    "test-raw-stability-core.mjs",
    "test-sealed-agg-round-levels-v1.mjs",
    "test-tape-cluster-lifecycle-v1.mjs",
    "test-tape-stability-followup-v1.mjs",
    "test-tape-threshold-agg-visual-v1.mjs",
    "test-tiger-zero-ms-agg-source-v1.mjs",
    "test/connection-observability.test.js",
    "test/market-memory.test.js",
    "test/orderbook-backpressure.test.js",
    "test/orderbook-render-scheduler.test.js",
    "test/ui.test.js",
]

REMOVE = [
    ".github/scripts/patch-clock-startup-order-v1.py",
    ".github/workflows/browser-smoke-pr104.yml",
    "binance-stream-routing.js",
    "test-arrival-clock-render-decouple-v1.mjs",
    "test-core-feed-footprint-runtime-v1.mjs",
    "test-footprint-live-source-v1.mjs",
    "test-global-connection-radar-cleanup-v1.mjs",
    "test-market-feed-footprint-series-v1.mjs",
    "test-parallel-chart-phasing-v1.mjs",
    "test-readable-flow-smooth-charts-v1.mjs",
    "test-sweep-tape-clock-v1.mjs",
]


def run(*args: str) -> None:
    subprocess.run(args, cwd=ROOT, check=True)


run("git", "checkout", BASELINE, "--", *RESTORE)

for relative in REMOVE:
    path = ROOT / relative
    if path.exists():
        run("git", "rm", "-f", relative)

# Event Radar Beta was intentionally retired later. Keep it retired while
# restoring the stable pre-sweep runtime so no removed asset is requested.
for relative in ("index.html", "sw.js"):
    path = ROOT / relative
    lines = path.read_text(encoding="utf-8").splitlines()
    lines = [line for line in lines if "event-radar-beta" not in line]
    path.write_text("\n".join(lines) + "\n", encoding="utf-8")

# Force a unique PWA generation. This prevents a browser from mixing the
# recovered modules with any 26-79 or 26-89 cache entries.
for path in ROOT.rglob("*"):
    if not path.is_file() or path.suffix.lower() not in {".js", ".mjs", ".html", ".txt", ".webmanifest"}:
        continue
    text = path.read_text(encoding="utf-8")
    if OLD_BUILD in text:
        path.write_text(text.replace(OLD_BUILD, NEW_BUILD), encoding="utf-8")

version = ROOT / "VERSION.txt"
text = version.read_text(encoding="utf-8")
if NEW_BUILD not in text:
    raise RuntimeError("recovery build was not written to VERSION.txt")

index = (ROOT / "index.html").read_text(encoding="utf-8")
if NEW_BUILD not in index or "event-radar-beta" in index:
    raise RuntimeError("index recovery contract failed")

sw = (ROOT / "sw.js").read_text(encoding="utf-8")
if NEW_BUILD not in sw or "event-radar-beta" in sw:
    raise RuntimeError("service worker recovery contract failed")
