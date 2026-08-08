const entryUrl = new URL(import.meta.url);
const usesAssetProxy = entryUrl.pathname === "/api/asset";
const revision = usesAssetProxy ? entryUrl.searchParams.get("v") : null;

function reviewModuleUrl(file, { cacheKey = null } = {}) {
  if (usesAssetProxy) {
    const params = new URLSearchParams({ file });
    if (revision) params.set("v", revision);
    return `/api/asset?${params.toString()}`;
  }
  const suffix = cacheKey ? `?v=${encodeURIComponent(cacheKey)}` : "";
  return `./${file}${suffix}`;
}

const [
  { CandlestickChart },
  { installSymbolScopedExchangeInfoFetch },
  { installStructuralBatchIngestRuntime },
  { installStructuralAttackCountRuntime },
  { installMultiTimeframeReviewRuntime },
  { StructuralExtremeEngine },
] = await Promise.all([
  import(reviewModuleUrl("chart.js", { cacheKey: "26-117-chart-interaction-performance-v1" })),
  import(reviewModuleUrl("signal-lab-v7-binance-market-metadata.js")),
  import(reviewModuleUrl("signal-lab-v7-batch-ingest-runtime.js")),
  import(reviewModuleUrl("signal-lab-v7-attack-count-runtime.js")),
  import(reviewModuleUrl("signal-lab-v7-multi-timeframe-review-runtime.js")),
  import(reviewModuleUrl("signal-lab-v7-structural-extremes.js")),
]);

installSymbolScopedExchangeInfoFetch();
installStructuralBatchIngestRuntime(StructuralExtremeEngine);
installStructuralAttackCountRuntime(StructuralExtremeEngine);
installMultiTimeframeReviewRuntime({
  ChartClass: CandlestickChart,
  EngineClass: StructuralExtremeEngine,
});
await import(reviewModuleUrl("owner-signal-lab-structural-extremes-review.js"));
