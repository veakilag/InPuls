from pathlib import Path
import re


def replace_literal(path: str, old: str, new: str) -> None:
    file = Path(path)
    text = file.read_text(encoding="utf-8")
    count = text.count(old)
    if count != 1:
        raise SystemExit(
            f"{path}: expected one literal replacement, found {count}: {old!r}"
        )
    file.write_text(text.replace(old, new, 1), encoding="utf-8")


def replace_regex(path: str, pattern: str, replacement: str) -> None:
    file = Path(path)
    text = file.read_text(encoding="utf-8")
    updated, count = re.subn(pattern, replacement, text, count=1, flags=re.S)
    if count != 1:
        raise SystemExit(
            f"{path}: expected one regex replacement, found {count}: {pattern!r}"
        )
    file.write_text(updated, encoding="utf-8")


replace_literal(
    "signal-lab-v3-candidates.js",
    "  if (\n"
    "    !symbol\n"
    "    || price === null\n"
    "    || price <= 0\n"
    "    || warmupSeconds < settings.minimumWarmupSeconds\n"
    "  ) return [];\n\n"
    "  const result = detectCascadeV4Candidates(metrics, now, settings);\n"
    "  if (!isEligibleForSignalLabV3(metrics, settings)) {",
    "  if (!symbol || price === null || price <= 0) return [];\n\n"
    "  // V4 uses already-loaded historical extrema and level maps. Publish it\n"
    "  // immediately; the 35-second live warmup remains for legacy tape patterns.\n"
    "  const result = detectCascadeV4Candidates(metrics, now, settings);\n"
    "  if (warmupSeconds < settings.minimumWarmupSeconds) {\n"
    "    return result.sort((left, right) => right.evidenceScore - left.evidenceScore);\n"
    "  }\n"
    "  if (!isEligibleForSignalLabV3(metrics, settings)) {",
)

replace_literal(
    "signal-lab-v3-collector.js",
    "      expiredEpisodes: 0,\n      symbols: 0,",
    "      expiredEpisodes: 0,\n      activeEpisodes: 0,\n      symbols: 0,",
)
replace_literal(
    "signal-lab-v3-collector.js",
    "      expiredEpisodes: this.statusState.expiredEpisodes + result.expired.length,\n"
    "      symbols: metrics.length,",
    "      expiredEpisodes: this.statusState.expiredEpisodes + result.expired.length,\n"
    "      activeEpisodes: this.episodes.status().activeEpisodes,\n"
    "      symbols: metrics.length,",
)

replace_regex(
    "owner-signal-lab-v3.html",
    r'<article class="stat-card">\s*'
    r'<span>Активных сейчас</span>\s*'
    r'<strong id="active-count">0</strong>\s*'
    r'</article>',
    '''<article class="stat-card">
                <span>Активных сетапов</span>
                <strong id="active-count">0</strong>
              </article>
              <article class="stat-card">
                <span>Активных экстремумов</span>
                <strong id="extremes-count">0</strong>
              </article>
              <article class="stat-card">
                <span>Монет с экстремумами</span>
                <strong id="extreme-maps-count">0</strong>
              </article>
              <article class="stat-card">
                <span>Каскадов SETUP</span>
                <strong id="cascade-setup-count">0</strong>
              </article>''',
)
replace_literal(
    "owner-signal-lab-v3.html",
    '<script type="module" '
    'src="./owner-signal-lab-v3.js?v=signal-lab-v6-extreme-history-fallback"></script>',
    '<script type="module" '
    'src="./owner-signal-lab-v3.js?v=signal-lab-v7-setup-visibility"></script>',
)

replace_literal(
    "owner-signal-lab-v3.js",
    '} from "./signal-lab-v3-candidates.js?v=signal-lab-v5-patterns-1";\n'
    'import { SignalLabV3Collector } from '
    '"./signal-lab-v3-collector.js?v=signal-lab-v6-extreme-history-fallback";',
    '} from "./signal-lab-v3-candidates.js?v=signal-lab-v7-setup-visibility";\n'
    'import { SignalLabV3Collector } from '
    '"./signal-lab-v3-collector.js?v=signal-lab-v7-setup-visibility";',
)
replace_literal(
    "owner-signal-lab-v3.js",
    '  activeCount: document.querySelector("#active-count"),\n'
    '  reviewedCount: document.querySelector("#reviewed-count"),',
    '  activeCount: document.querySelector("#active-count"),\n'
    '  extremesCount: document.querySelector("#extremes-count"),\n'
    '  extremeMapsCount: document.querySelector("#extreme-maps-count"),\n'
    '  cascadeSetupCount: document.querySelector("#cascade-setup-count"),\n'
    '  reviewedCount: document.querySelector("#reviewed-count"),',
)
replace_literal(
    "owner-signal-lab-v3.js",
    ' · эпизоды ${status.createdEpisodes} · экстремумы ${status.activeExtremes ?? 0}',
    ' · эпизоды ${status.createdEpisodes} '
    '· активные сетапы ${status.activeEpisodes ?? 0} '
    '· экстремумы ${status.activeExtremes ?? 0}',
)
replace_literal(
    "owner-signal-lab-v3.js",
    '  elements.checksCount.textContent = String(status?.checks ?? 0);\n'
    '  elements.warmupCount.textContent = String(status?.warmupLoaded ?? 0);',
    '  elements.checksCount.textContent = String(status?.checks ?? 0);\n'
    '  elements.activeCount.textContent = String(status?.activeEpisodes ?? 0);\n'
    '  elements.extremesCount.textContent = String(status?.activeExtremes ?? 0);\n'
    '  elements.extremeMapsCount.textContent = String(status?.extremeMaps ?? 0);\n'
    '  elements.cascadeSetupCount.textContent = String(status?.cascadeSetups ?? 0);\n'
    '  elements.warmupCount.textContent = String(status?.warmupLoaded ?? 0);',
)

replace_literal(
    "scripts/signal-lab-runtime-smoke.mjs",
    '    && Number(state?.warmupLoaded || 0) > 0\n'
    '    && Number(state?.activeExtremes || 0) > 0',
    '    && Number(state?.warmupLoaded || 0) > 0\n'
    '    && Number(state?.activeEpisodes || 0) > 0\n'
    '    && Number(state?.activeExtremes || 0) > 0',
)

Path("test/signal-lab-v7-setup-visibility.test.js").write_text(
    '''import test from "node:test";
import assert from "node:assert/strict";
import {
  CANDIDATE_TYPES,
  detectExpertCandidates,
} from "../signal-lab-v3-candidates.js";

function cascadeMetrics(overrides = {}) {
  return {
    symbol: "BTCUSDT",
    price: 99,
    updatedAt: 1_000,
    warmupSeconds: 3,
    quoteVolume24h: 50_000_000,
    cascadeMap: {
      active: [{
        id: "BTCUSDT:UP:h1:test",
        state: "SETUP",
        geometricState: "SETUP",
        direction: "UP",
        levelIds: ["h1", "h2"],
        levelPrices: [100, 102],
        adjacentGapPct: [2],
        totalSpanPct: 2,
        levelsBroken: 0,
        touchCounts: [1, 2],
        variants: ["MULTI_TOUCH_LEVEL"],
        compressionType: "NO_COMPRESSION",
        setupDetectedAt: 900,
        setupFeatures: { primaryDistancePct: 1 },
        dataQuality: "LIVE",
        formulaVersion: "test-cascade",
      }],
    },
    ...overrides,
  };
}

test("V4 cascade SETUP is published before the legacy 35-second warmup", () => {
  const candidates = detectExpertCandidates(cascadeMetrics(), 1_000);
  assert.equal(candidates.length, 1);
  assert.equal(candidates[0].candidateType, CANDIDATE_TYPES.CASCADE_V4_UP);
  assert.equal(candidates[0].stage, "forming");
});

test("legacy candidates remain blocked before warmup when no V4 setup exists", () => {
  const candidates = detectExpertCandidates(
    cascadeMetrics({ cascadeMap: { active: [] } }),
    1_000,
  );
  assert.deepEqual(candidates, []);
});
''',
    encoding="utf-8",
)
