import { installSymbolScopedExchangeInfoFetch } from "./signal-lab-v7-binance-market-metadata.js";
import { installStructuralBatchIngestRuntime } from "./signal-lab-v7-batch-ingest-runtime.js";
import { installStructuralAttackCountRuntime } from "./signal-lab-v7-attack-count-runtime.js";
import { StructuralExtremeEngine } from "./signal-lab-v7-structural-extremes.js";

installSymbolScopedExchangeInfoFetch();
installStructuralBatchIngestRuntime(StructuralExtremeEngine);
installStructuralAttackCountRuntime(StructuralExtremeEngine);
await import("./owner-signal-lab-structural-extremes-review.js");