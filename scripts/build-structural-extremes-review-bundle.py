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


html = read("owner-signal-lab-structural-extremes-review.html")
css = read("owner-signal-lab-structural-extremes-review.css")
core_source = read("binance-clock-core.js")
clock_source = read("binance-clock.js")
chart_source = read("chart.js")
detector_source = read("signal-lab-v7-structural-extremes.js")
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

chart_source, chart_imports = re.subn(
    r'^import\s+\{\s*binanceClock\s*\}\s+from\s+["\']\.\/binance-clock\.js[^"\']*["\'];',
    'import { binanceClock } from "__CLOCK_URL__";',
    chart_source,
    count=1,
    flags=re.MULTILINE,
)
if chart_imports != 1:
    raise RuntimeError("Expected one binanceClock import in chart.js")

review_source, chart_review_imports = re.subn(
    r'^import\s+\{\s*CandlestickChart\s*\}\s+from\s+["\']\.\/chart\.js[^"\']*["\'];',
    'import { CandlestickChart } from "__CHART_URL__";',
    review_source,
    count=1,
    flags=re.MULTILINE,
)
if chart_review_imports != 1:
    raise RuntimeError("Expected one chart import in review runtime")

review_source, detector_review_imports = re.subn(
    r'import\s+\{([\s\S]*?)\}\s+from\s+["\']\.\/signal-lab-v7-structural-extremes\.js[^"\']*["\'];',
    lambda match: f'import {{{match.group(1)}}} from "__DETECTOR_URL__";',
    review_source,
    count=1,
)
if detector_review_imports != 1:
    raise RuntimeError("Expected one structural detector import in review runtime")

html = re.sub(r'\s*<link\s+rel="stylesheet"\s+href="\.\/owner-signal-lab-structural-extremes-review\.css"\s*\/?>', "", html, count=1)
html = re.sub(r'\s*<script\s+type="module"\s+src="\.\/owner-signal-lab-structural-extremes-review\.js"\s*></script>', "", html, count=1)
html = html.replace(
    'href="./owner-signal-lab-v3.html"',
    'href="https://veakilag.github.io/InPuls/owner-signal-lab-v3.html"',
)
html = html.replace("</head>", f"\n    <style>\n{css}\n    </style>\n  </head>", 1)

loader = f"""
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
      status.textContent = `Ошибка запуска автономной разметки: ${{String(error?.message ?? error)}}`;
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
    const reviewUrl = moduleUrl(
      decode({json.dumps(b64(review_source))})
        .replaceAll("__CHART_URL__", chartUrl)
        .replaceAll("__DETECTOR_URL__", detectorUrl),
    );
    import(reviewUrl).catch(reportFailure);
  }} catch (error) {{
    reportFailure(error);
  }}
}})();
</script>
"""

html = html.replace("</body>", f"{loader}\n  </body>", 1)
OUTPUT.write_text(html, encoding="utf-8")
print(f"Built {{OUTPUT.name}} ({{OUTPUT.stat().st_size}} bytes)")
