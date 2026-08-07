import { CandlestickChart } from "./chart.js?v=26-117-chart-interaction-performance-v1";
import { installSymbolScopedExchangeInfoFetch } from "./signal-lab-v7-binance-market-metadata.js";
import { installStructuralBatchIngestRuntime } from "./signal-lab-v7-batch-ingest-runtime.js";
import { installStructuralAttackCountRuntime } from "./signal-lab-v7-attack-count-runtime.js";
import { installMultiTimeframeReviewRuntime } from "./signal-lab-v7-multi-timeframe-review-runtime.js";
import { StructuralExtremeEngine } from "./signal-lab-v7-structural-extremes.js";

installSymbolScopedExchangeInfoFetch();
installStructuralBatchIngestRuntime(StructuralExtremeEngine);
installStructuralAttackCountRuntime(StructuralExtremeEngine);
installMultiTimeframeReviewRuntime({
  ChartClass: CandlestickChart,
  EngineClass: StructuralExtremeEngine,
});
await import("./owner-signal-lab-structural-extremes-review.js");
