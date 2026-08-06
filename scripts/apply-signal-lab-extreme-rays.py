from pathlib import Path


def replace_once(path: str, old: str, new: str) -> None:
    file = Path(path)
    text = file.read_text(encoding="utf-8")
    count = text.count(old)
    if count != 1:
        raise SystemExit(f"{path}: expected one occurrence, found {count}: {old[:180]!r}")
    file.write_text(text.replace(old, new, 1), encoding="utf-8")


replace_once(
    "signal-lab-v3-full-chart.js",
    'import { CandlestickChart } from "./chart.js?v=26-103-signal-lab-full-chart-v1";',
    'import { CandlestickChart } from "./chart.js?v=signal-lab-v9-extreme-rays";',
)

old_cascade = '''  extrema.forEach((row, index) => {
    target.push({
      type: "point",
      time: row.time,
      price: row.price,
      label: `${marker}${index + 1}`,
      tone: highSide ? "danger" : "success",
    });
    if (index > 0) {'''
new_cascade = '''  extrema.forEach((row, index) => {
    target.push({
      type: "ray",
      startAt: row.time,
      price: row.price,
      label: `${marker}${index + 1}`,
      tone: highSide ? "danger" : "success",
      state: "ACTIVE",
    });
    if (index > 0) {'''
replace_once("signal-lab-v3-full-chart.js", old_cascade, new_cascade)

old_extreme_map = '''function addExtremeMapAnnotations(target, extremeMap, eventAt, eventPrice) {
  const rows = [];
  for (const [timeframe, map] of Object.entries(extremeMap?.timeframes ?? {})) {
    for (const extreme of map?.active ?? []) {
      const price = finite(extreme?.price);
      if (!(price > 0)) continue;
      const distance = eventPrice > 0 ? Math.abs(price - eventPrice) / eventPrice * 100 : 0;
      if (distance > 8) continue;
      rows.push({ ...extreme, timeframe, distance });
    }
  }
  rows.sort((left, right) => left.distance - right.distance || right.confirmedAt - left.confirmedAt);
  for (const extreme of rows.slice(0, 32)) {
    const high = extreme.side === "HIGH";
    const label = `${high ? "H" : "L"} ${extreme.timeframe} ×${extreme.touchCount ?? 1}`;
    target.push({
      type: "point",
      time: extreme.extremeTime,
      price: extreme.price,
      label,
      tone: high ? "danger" : "success",
    });
    target.push({
      type: "line",
      price: extreme.price,
      startAt: extreme.extremeTime,
      endAt: eventAt + 60_000,
      label: `${label} · активен`,
      tone: high ? "danger" : "success",
    });
    if (finite(extreme.confirmedAt) !== null) {
      target.push({
        type: "event",
        time: extreme.confirmedAt,
        label: `${high ? "H" : "L"} подтверждён ${extreme.timeframe}`,
        tone: "blue",
      });
    }
  }
}'''
new_extreme_map = '''function addExtremeMapAnnotations(target, extremeMap, eventAt, eventPrice) {
  const rows = [];
  for (const [timeframe, map] of Object.entries(extremeMap?.timeframes ?? {})) {
    for (const extreme of map?.active ?? []) {
      const price = finite(extreme?.price);
      const extremeTime = finite(extreme?.extremeTime ?? extreme?.time ?? extreme?.at);
      if (!(price > 0) || extremeTime === null) continue;
      const distance = eventPrice > 0 ? Math.abs(price - eventPrice) / eventPrice * 100 : 0;
      if (distance > 8) continue;
      rows.push({ ...extreme, timeframe, price, extremeTime, distance });
    }
  }
  rows.sort((left, right) => left.distance - right.distance || right.confirmedAt - left.confirmedAt);

  // The same physical swing can be present on several timeframes. Keep one ray at
  // the actual extremum point and combine its TF labels instead of painting duplicate
  // lines on top of each other.
  const groups = [];
  for (const row of rows.slice(0, 64)) {
    const side = row.side === "HIGH" ? "HIGH" : "LOW";
    const match = groups.find((group) => {
      if (group.side !== side) return false;
      const priceDistance = Math.abs(group.price - row.price) / Math.max(group.price, row.price) * 100;
      const timeDistance = Math.abs(group.extremeTime - row.extremeTime);
      return priceDistance <= 0.015 && timeDistance <= 2 * 60_000;
    });
    if (match) {
      match.timeframes.add(row.timeframe);
      match.touchCount = Math.max(match.touchCount, Number(row.touchCount) || 1);
      match.confirmedAt = Math.min(match.confirmedAt, finite(row.confirmedAt) ?? match.confirmedAt);
      if (side === "HIGH" && row.price > match.price) {
        match.price = row.price;
        match.extremeTime = row.extremeTime;
      }
      if (side === "LOW" && row.price < match.price) {
        match.price = row.price;
        match.extremeTime = row.extremeTime;
      }
      continue;
    }
    groups.push({
      side,
      price: row.price,
      extremeTime: row.extremeTime,
      confirmedAt: finite(row.confirmedAt) ?? eventAt,
      touchCount: Math.max(1, Number(row.touchCount) || 1),
      timeframes: new Set([row.timeframe]),
      distance: row.distance,
    });
  }

  for (const extreme of groups.slice(0, 32)) {
    const high = extreme.side === "HIGH";
    const timeframes = [...extreme.timeframes]
      .sort((left, right) => (EPISODE_CHART_INTERVALS[left] ?? Infinity) - (EPISODE_CHART_INTERVALS[right] ?? Infinity));
    const label = `${high ? "H" : "L"} ${timeframes.join("/")} ×${extreme.touchCount}`;
    target.push({
      type: "ray",
      startAt: extreme.extremeTime,
      price: extreme.price,
      label,
      tone: high ? "danger" : "success",
      state: "ACTIVE",
      side: extreme.side,
      timeframes,
    });
  }
}'''
replace_once("signal-lab-v3-full-chart.js", old_extreme_map, new_extreme_map)

replace_once(
    "signal-lab-v3-full-chart.js",
    '''  const canonicalLevelMap = pack?.levelMapLatest ?? pack?.levelMap;
  // Raw per-timeframe extrema remain in Evidence Pack for diagnostics. On the normal
  // chart they are hidden once canonical zones are available, otherwise every physical
  // swing is drawn several times (1m/5m/15m/...).
  if (!(canonicalLevelMap?.activeZones?.length > 0)) {
    addExtremeMapAnnotations(annotations, pack?.extremeMap, eventAt, eventPrice);
  }
  addLevelMapAnnotations(annotations, canonicalLevelMap, eventAt, eventPrice);''',
    '''  const canonicalLevelMap = pack?.levelMapLatest ?? pack?.levelMap;
  // Every active extremum remains visible as a ray from its actual swing point until
  // the detector invalidates it. Canonical zones stay as context, not as a substitute
  // for the underlying extrema.
  addExtremeMapAnnotations(annotations, pack?.extremeMap, eventAt, eventPrice);
  addLevelMapAnnotations(annotations, canonicalLevelMap, eventAt, eventPrice);''',
)

replace_once(
    "signal-lab-v3-full-chart.js",
    '''      annotations.push({
        type: "point",
        time: extremeAt,
        price: extremePrice,
        label: downImpulse ? "LOW" : "HIGH",
        tone: downImpulse ? "success" : "danger",
      });''',
    '''      annotations.push({
        type: "ray",
        startAt: extremeAt,
        price: extremePrice,
        label: downImpulse ? "LOW" : "HIGH",
        tone: downImpulse ? "success" : "danger",
        state: "ACTIVE",
      });''',
)

chart_line_loop = '''    for (const annotation of this.annotations.filter((item) => item.type === "line")) {
      const y = yForPrice(annotation.price);
      const color = colorFor(annotation);
      ctx.strokeStyle = color;
      ctx.setLineDash([6, 4]);
      ctx.beginPath();
      ctx.moveTo(xForTime(annotation.startAt), y);
      ctx.lineTo(xForTime(annotation.endAt), y);
      ctx.stroke();
      ctx.setLineDash([]);
    }

    for (const annotation of this.annotations.filter((item) => item.type === "segment")) {'''
chart_ray_loop = '''    for (const annotation of this.annotations.filter((item) => item.type === "line")) {
      const y = yForPrice(annotation.price);
      const color = colorFor(annotation);
      ctx.strokeStyle = color;
      ctx.setLineDash([6, 4]);
      ctx.beginPath();
      ctx.moveTo(xForTime(annotation.startAt), y);
      ctx.lineTo(xForTime(annotation.endAt), y);
      ctx.stroke();
      ctx.setLineDash([]);
    }

    for (const annotation of this.annotations.filter((item) => item.type === "ray")) {
      const y = yForPrice(annotation.price);
      const originX = xForTime(annotation.startAt);
      const startX = Math.max(margins.left, originX);
      const endX = margins.left + plotWidth;
      if (startX > endX || y < margins.top || y > priceBottom) continue;
      const color = colorFor(annotation);
      ctx.strokeStyle = color;
      ctx.lineWidth = 1.25;
      ctx.setLineDash(annotation.state === "BROKEN" ? [3, 5] : [7, 4]);
      ctx.beginPath();
      ctx.moveTo(startX, y);
      ctx.lineTo(endX, y);
      ctx.stroke();
      ctx.setLineDash([]);
      ctx.lineWidth = 1;
      if (originX >= margins.left && originX <= endX) {
        ctx.fillStyle = "#071018";
        ctx.strokeStyle = color;
        ctx.lineWidth = 1.8;
        ctx.beginPath();
        ctx.arc(originX, y, 3.4, 0, Math.PI * 2);
        ctx.fill();
        ctx.stroke();
        ctx.lineWidth = 1;
      }
    }

    for (const annotation of this.annotations.filter((item) => item.type === "segment")) {'''
replace_once("chart.js", chart_line_loop, chart_ray_loop)

replace_once(
    "chart.js",
    '''      } else if (annotation.type === "line") {
        label(annotation.label, xForTime(annotation.endAt) - 110, yForPrice(annotation.price), color);
      } else if (annotation.type === "segment" && annotation.label) {''',
    '''      } else if (annotation.type === "line") {
        label(annotation.label, xForTime(annotation.endAt) - 110, yForPrice(annotation.price), color);
      } else if (annotation.type === "ray") {
        const originX = xForTime(annotation.startAt);
        const endX = margins.left + plotWidth;
        if (originX <= endX) {
          label(annotation.label, Math.max(margins.left + 4, originX + 6), yForPrice(annotation.price), color);
        }
      } else if (annotation.type === "segment" && annotation.label) {''',
)

replace_once(
    "signal-lab-chart-modal.js",
    'import { CandlestickChart } from "./chart.js?v=signal-lab-modal-chart-v1";',
    'import { CandlestickChart } from "./chart.js?v=signal-lab-v9-extreme-rays";',
)
replace_once(
    "signal-lab-chart-modal.js",
    '} from "./signal-lab-v3-full-chart.js?v=signal-lab-modal-chart-v1";',
    '} from "./signal-lab-v3-full-chart.js?v=signal-lab-v9-extreme-rays";',
)
replace_once(
    "owner-signal-lab-v3.js",
    '} from "./signal-lab-chart-modal.js?v=signal-lab-v8-smooth-modal-chart";',
    '} from "./signal-lab-chart-modal.js?v=signal-lab-v9-extreme-rays";',
)
replace_once(
    "owner-signal-lab-v3.html",
    '<script type="module" src="./owner-signal-lab-v3.js?v=signal-lab-v8-smooth-modal-chart"></script>',
    '<script type="module" src="./owner-signal-lab-v3.js?v=signal-lab-v9-extreme-rays"></script>',
)

replace_once(
    "scripts/signal-lab-runtime-smoke.mjs",
    "const modalModule = await import('./signal-lab-chart-modal.js?v=signal-lab-v8-smooth-modal-chart');",
    "const modalModule = await import('./signal-lab-chart-modal.js?v=signal-lab-v9-extreme-rays');",
)

replace_once(
    "scripts/signal-lab-runtime-smoke.mjs",
    '''      const button = document.querySelector('[data-field="chart-toggle"]');
      let source = 'CARD_BUTTON';''',
    '''      const annotationModule = await import('./signal-lab-v3-full-chart.js?v=signal-lab-v9-extreme-rays');
      const now = Date.now();
      const rayProbeEpisode = {
        id: 'runtime-smoke-ray',
        symbol: 'BTCUSDT',
        candidateType: 'cascade_breakout',
        stage: 'SETUP',
        firstSeenAt: now - 60_000,
        latest: { price: 100 },
        evidencePack: {
          window: { eventAt: now - 30_000 },
          extremeMap: {
            timeframes: {
              '1m': { active: [{ side: 'HIGH', price: 101, extremeTime: now - 90_000, confirmedAt: now - 60_000, touchCount: 1 }] },
            },
          },
        },
      };
      const rayAnnotationReady = annotationModule.buildPatternAnnotations(rayProbeEpisode)
        .some((annotation) => annotation.type === 'ray' && annotation.startAt === now - 90_000 && annotation.price === 101);
      const button = document.querySelector('[data-field="chart-toggle"]');
      let source = 'CARD_BUTTON';''',
)

replace_once(
    "scripts/signal-lab-runtime-smoke.mjs",
    '''        const modalModule = await import('./signal-lab-chart-modal.js?v=signal-lab-v9-extreme-rays');
        const now = Date.now();
        void modalModule.openEpisodeChartModal({''',
    '''        const modalModule = await import('./signal-lab-chart-modal.js?v=signal-lab-v9-extreme-rays');
        void modalModule.openEpisodeChartModal({''',
)

replace_once(
    "scripts/signal-lab-runtime-smoke.mjs",
    '''        ok: Boolean(timeframeActive && resized && canvasReady && closed),
        source,
        timeframeActive,''',
    '''        ok: Boolean(rayAnnotationReady && timeframeActive && resized && canvasReady && closed),
        source,
        rayAnnotationReady,
        timeframeActive,''',
)

replace_once(
    "test/signal-lab-v3-full-chart.test.js",
    '''  assert.deepEqual(
    annotations.filter((row) => row.type === "point").map((row) => row.label),
    ["H1", "H2", "H3"],
  );
  assert.equal(annotations.filter((row) => row.type === "segment").length, 2);''',
    '''  assert.deepEqual(
    annotations.filter((row) => row.type === "ray").map((row) => row.label),
    ["H1", "H2", "H3"],
  );
  assert.deepEqual(
    annotations.filter((row) => row.type === "ray").map((row) => row.startAt),
    [10_000, 40_000, 70_000],
  );
  assert.equal(annotations.filter((row) => row.type === "segment").length, 2);''',
)

insert_after = '''test("cascade annotations label staircase extrema as highs or lows", () => {
  const annotations = buildPatternAnnotations({
    id: "CASCADE",
    symbol: "TESTUSDT",
    candidateType: "cascade_structure_up",
    firstSeenAt: 90_000,
    latest: {
      price: 104,
      evidence: {
        side: "high",
        extrema: [
          { at: 10_000, price: 100 },
          { at: 40_000, price: 102 },
          { at: 70_000, price: 103.5 },
        ],
        zoneLower: 100,
        zoneUpper: 103.5,
        nearestStepPrice: 103.5,
      },
    },
    evidencePack: { window: { eventAt: 90_000 }, pricePoints: [] },
  });
  assert.deepEqual(
    annotations.filter((row) => row.type === "ray").map((row) => row.label),
    ["H1", "H2", "H3"],
  );
  assert.deepEqual(
    annotations.filter((row) => row.type === "ray").map((row) => row.startAt),
    [10_000, 40_000, 70_000],
  );
  assert.equal(annotations.filter((row) => row.type === "segment").length, 2);
});
'''
new_test = insert_after + '''
test("active extrema remain rays even when canonical zones are present", () => {
  const annotations = buildPatternAnnotations({
    id: "RAYS",
    symbol: "TESTUSDT",
    candidateType: "cascade_breakout",
    firstSeenAt: 120_000,
    latest: { price: 100 },
    evidencePack: {
      window: { eventAt: 120_000 },
      extremeMap: {
        timeframes: {
          "1m": { active: [
            { side: "HIGH", price: 101, extremeTime: 30_000, confirmedAt: 60_000, touchCount: 2 },
            { side: "LOW", price: 99, extremeTime: 40_000, confirmedAt: 70_000, touchCount: 1 },
          ] },
          "5m": { active: [
            { side: "HIGH", price: 101.00005, extremeTime: 30_000, confirmedAt: 60_000, touchCount: 2 },
          ] },
        },
      },
      levelMapLatest: {
        activeZones: [{
          side: "HIGH",
          lowerPrice: 100.95,
          upperPrice: 101.05,
          firstFormedAt: 30_000,
          touchCount: 2,
          timeframes: ["1m", "5m"],
        }],
      },
    },
  });
  const rays = annotations.filter((row) => row.type === "ray");
  assert.equal(rays.length, 2);
  assert.deepEqual(rays.map((row) => row.startAt).sort((a, b) => a - b), [30_000, 40_000]);
  assert.ok(rays.some((row) => row.label === "H 1m/5m ×2" && row.price === 101.00005));
  assert.ok(rays.some((row) => row.label === "L 1m ×1" && row.price === 99));
  assert.ok(annotations.some((row) => row.type === "zone" && /H зона/.test(row.label)));
});
'''
replace_once("test/signal-lab-v3-full-chart.test.js", insert_after, new_test)

replace_once(
    "test/signal-lab-v3-full-chart.test.js",
    '''  assert.match(source, /annotation\\.type === "zone"/);
  assert.match(source, /annotation\\.type === "point"/);''',
    '''  assert.match(source, /annotation\\.type === "zone"/);
  assert.match(source, /annotation\\.type === "point"/);
  assert.match(source, /annotations\\.filter\\(\\(item\\) => item\\.type === "ray"\\)/);
  assert.match(source, /ctx\\.lineTo\\(endX, y\\)/);''',
)

replace_once(
    "test/signal-lab-modal-chart.test.js",
    'assert.match(html, /signal-lab-v8-smooth-modal-chart/);',
    'assert.match(html, /signal-lab-v9-extreme-rays/);',
)
replace_once(
    "test/signal-lab-modal-chart.test.js",
    '''  assert.match(smoke, /SYNTHETIC_EPISODE/);
  assert.match(smoke, /openEpisodeChartModal/);''',
    '''  assert.match(smoke, /SYNTHETIC_EPISODE/);
  assert.match(smoke, /openEpisodeChartModal/);
  assert.match(smoke, /rayAnnotationReady/);''',
)

print("Signal Lab active extrema ray patch applied")
