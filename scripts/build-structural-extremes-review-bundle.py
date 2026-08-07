from __future__ import annotations

import base64
import json
import re
from pathlib import Path

ROOT = Path(__file__).resolve().parents[1]
OUTPUT = ROOT / "structural-extremes-review-standalone.html"


def read(path: str) -> str:
    return (ROOT / path).read_text(encoding="utf-8")


def b64(value: str) -> str:
    return base64.b64encode(value.encode("utf-8")).decode("ascii")


def replace_import(source: str, pattern: str, replacement: str, label: str) -> str:
    updated, count = re.subn(pattern, replacement, source, count=1, flags=re.MULTILINE)
    if count != 1:
        raise RuntimeError(f"Expected one {label} import, found {count}")
    return updated


html = read("owner-signal-lab-structural-extremes-review.html")
css = read("owner-signal-lab-structural-extremes-review.css")
core_source = read("binance-clock-core.js")
clock_source = read("binance-clock.js")
chart_source = read("chart.js")
detector_source = read("signal-lab-v7-structural-extremes.js")
review_lifecycle_source = read("signal-lab-v7-review-level-lifecycle.js")
metadata_source = read("signal-lab-v7-binance-market-metadata.js")
batch_source = read("signal-lab-v7-batch-ingest-runtime.js")
attack_source = read("signal-lab-v7-attack-count-runtime.js")
levels_source = read("signal-lab-v7-multi-timeframe-levels.js")
multi_runtime_source = read("signal-lab-v7-multi-timeframe-review-runtime.js")
review_source = read("owner-signal-lab-structural-extremes-review.js")

clock_source, clock_imports = re.subn(
    r'^import\s+["\']\.\/binance-clock-core\.js[^"\']*["\'];\s*',
    "",
    clock_source,
    count=1,
    flags=re.MULTILINE,
)
if clock_imports != 1:
    raise RuntimeError("Expected one binance-clock-core import")

chart_source = replace_import(
    chart_source,
    r'^import\s+\{\s*binanceClock\s*\}\s+from\s+["\']\.\/binance-clock\.js[^"\']*["\'];',
    'import { binanceClock } from "__CLOCK_URL__";',
    "binanceClock in chart.js",
)

multi_runtime_source = replace_import(
    multi_runtime_source,
    r'import\s+\{([\s\S]*?)\}\s+from\s+["\']\.\/signal-lab-v7-multi-timeframe-levels\.js[^"\']*["\'];',
    lambda match: f'import {{{match.group(1)}}} from "__LEVELS_URL__";',
    "multi-timeframe levels in review runtime",
)
multi_runtime_source = replace_import(
    multi_runtime_source,
    r'import\s+\{([\s\S]*?)\}\s+from\s+["\']\.\/signal-lab-v7-binance-market-metadata\.js[^"\']*["\'];',
    lambda match: f'import {{{match.group(1)}}} from "__METADATA_URL__";',
    "market metadata in review runtime",
)

review_source = replace_import(
    review_source,
    r'^import\s+\{\s*CandlestickChart\s*\}\s+from\s+["\']\.\/chart\.js[^"\']*["\'];',
    'import { CandlestickChart } from "__CHART_URL__";',
    "chart in review runtime",
)
review_source = replace_import(
    review_source,
    r'import\s+\{([\s\S]*?)\}\s+from\s+["\']\.\/signal-lab-v7-structural-extremes\.js[^"\']*["\'];',
    lambda match: f'import {{{match.group(1)}}} from "__DETECTOR_URL__";',
    "structural detector in review runtime",
)
review_source = replace_import(
    review_source,
    r'import\s+\{([\s\S]*?)\}\s+from\s+["\']\.\/signal-lab-v7-review-level-lifecycle\.js[^"\']*["\'];',
    lambda match: f'import {{{match.group(1)}}} from "__REVIEW_LIFECYCLE_URL__";',
    "review lifecycle in review runtime",
)

html = re.sub(
    r'\s*<link\s+rel="stylesheet"\s+href="\.\/owner-signal-lab-structural-extremes-review\.css"\s*\/?>',
    "",
    html,
    count=1,
)
html, removed_entry = re.subn(
    r'\s*<script\s+type="module"\s+src="\.\/owner-signal-lab-structural-extremes-review-entry\.js"\s*></script>',
    "",
    html,
    count=1,
)
if removed_entry != 1:
    raise RuntimeError("Expected one structural review entry script tag")

html = html.replace(
    'href="./owner-signal-lab-v3.html"',
    'href="https://veakilag.github.io/InPuls/owner-signal-lab-v3.html"',
)
html = html.replace("</head>", f"\n    <style>\n{css}\n    </style>\n  </head>", 1)

loader = f"""
<!-- InPulsStructuralExtremesTraderReview · standalone multi-timeframe calibration bundle -->
<script>
(() => {{
  const decode = (encoded) => {{
    const bytes = Uint8Array.from(atob(encoded), (character) => character.charCodeAt(0));
    return new TextDecoder().decode(bytes);
  }};
  const moduleUrl = (source) => URL.createObjectURL(new Blob([source], {{ type: "text/javascript" }}));
  const reportFailure = (error) => {{
    const status = document.querySelector("#status");
    if (status) {{
      status.dataset.state = "error";
      status.textContent = `Ошибка запуска автономной multi-TF разметки: ${{String(error?.message ?? error)}}`;
    }}
    console.error(error);
  }};

  try {{
    (0, eval)(decode({json.dumps(b64(core_source))}));

    const clockUrl = moduleUrl(decode({json.dumps(b64(clock_source))}));
    const chartUrl = moduleUrl(
      decode({json.dumps(b64(chart_source))}).replaceAll("__CLOCK_URL__", clockUrl),
    );
    const detectorUrl = moduleUrl(decode({json.dumps(b64(detector_source))}));
    const reviewLifecycleUrl = moduleUrl(decode({json.dumps(b64(review_lifecycle_source))}));
    const metadataUrl = moduleUrl(decode({json.dumps(b64(metadata_source))}));
    const batchUrl = moduleUrl(decode({json.dumps(b64(batch_source))}));
    const attackUrl = moduleUrl(decode({json.dumps(b64(attack_source))}));
    const levelsUrl = moduleUrl(decode({json.dumps(b64(levels_source))}));
    const multiRuntimeUrl = moduleUrl(
      decode({json.dumps(b64(multi_runtime_source))})
        .replaceAll("__LEVELS_URL__", levelsUrl)
        .replaceAll("__METADATA_URL__", metadataUrl),
    );
    const reviewUrl = moduleUrl(
      decode({json.dumps(b64(review_source))})
        .replaceAll("__CHART_URL__", chartUrl)
        .replaceAll("__DETECTOR_URL__", detectorUrl)
        .replaceAll("__REVIEW_LIFECYCLE_URL__", reviewLifecycleUrl),
    );

    Promise.all([
      import(chartUrl),
      import(detectorUrl),
      import(metadataUrl),
      import(batchUrl),
      import(attackUrl),
      import(multiRuntimeUrl),
    ]).then(([chartModule, detectorModule, metadataModule, batchModule, attackModule, multiModule]) => {{
      metadataModule.installSymbolScopedExchangeInfoFetch();
      batchModule.installStructuralBatchIngestRuntime(detectorModule.StructuralExtremeEngine);
      attackModule.installStructuralAttackCountRuntime(detectorModule.StructuralExtremeEngine);
      multiModule.installMultiTimeframeReviewRuntime({{
        ChartClass: chartModule.CandlestickChart,
        EngineClass: detectorModule.StructuralExtremeEngine,
      }});
      return import(reviewUrl);
    }}).catch(reportFailure);
  }} catch (error) {{
    reportFailure(error);
  }}
}})();
</script>
"""

html = html.replace("</body>", f"{loader}\n  </body>", 1)
OUTPUT.write_text(html, encoding="utf-8")
print(f"Built {OUTPUT.name} ({OUTPUT.stat().st_size} bytes)")
