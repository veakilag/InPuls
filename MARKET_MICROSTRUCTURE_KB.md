# InPuls market-microstructure knowledge base

This file is the research foundation for Owner Algo Lab. It records testable mechanisms, not trading promises. Every mechanism must be validated out of sample after fees, slippage and delayed execution before it can enter paper trading.

## 1. Core market mechanics

### Perpetual futures

- A perpetual contract has no expiry. Funding transfers between longs and shorts help pull the perpetual price toward spot/index value.
- Funding and premium are feedback variables, not standalone directional signals. Extreme positive funding means long exposure is expensive and often crowded; extreme negative funding means the reverse.
- Funding can remain extreme during persistent trends. Contrarian entries therefore require evidence that price acceptance and aggressive flow have changed.

Primary references:
- https://arxiv.org/abs/2212.06888
- https://papers.ssrn.com/sol3/papers.cfm?abstract_id=6185958
- https://papers.ssrn.com/sol3/papers.cfm?abstract_id=5576424

### Open interest

Open interest measures outstanding derivative exposure. Price and OI should be interpreted jointly:

| Price | OI | First interpretation | What must confirm it |
|---|---|---|---|
| rising | rising | new risk entering, often trend confirmation | aligned taker flow and acceptable funding/premium |
| falling | rising | new short risk entering | aligned sell flow and no bullish absorption |
| rising | falling | shorts closing / squeeze / deleveraging | whether flow persists or exhausts |
| falling | falling | longs closing / liquidation | whether forced selling exhausts and price reclaims |

OI is not a direct long/short direction measure. Every contract has both sides. Its edge comes from the interaction with price, aggressive flow, crowd ratios, funding and liquidity.

Primary references:
- https://arxiv.org/abs/2310.14973
- https://developers.binance.com/docs/derivatives/usds-margined-futures/market-data/rest-api/Open-Interest-Statistics

### Aggressive order flow

- Taker-buy versus taker-sell imbalance reveals which side is crossing the spread.
- Persistent aggressive flow can produce short-horizon continuation.
- Aggressive flow without price progress indicates absorption; that divergence can precede reversal.
- Flow impact is state-dependent and decays quickly, so it belongs in entry timing rather than long-horizon forecasts.

Primary references:
- https://arxiv.org/abs/2112.02947
- https://arxiv.org/abs/2112.13213
- https://arxiv.org/abs/1402.1288

### Liquidity and liquidations

- Liquidation cascades are reflexive: price movement triggers forced orders, forced orders remove depth, and reduced depth amplifies the next price movement.
- A sudden OI collapse, extreme volume, large directional return and aligned taker flow form a useful liquidation proxy when complete liquidation feeds are unavailable.
- Displayed depth can overstate executable liquidity during stress because hidden liquidity, cancellations and snapshot latency change rapidly.
- Exchange liquidation streams can be throttled or incomplete. Coinglass heatmaps are modeled estimates and require an API plan; they should be treated as an additional feature, not ground truth.

Primary references:
- https://papers.ssrn.com/sol3/papers.cfm?abstract_id=6579278
- https://papers.ssrn.com/sol3/papers.cfm?abstract_id=6891658
- https://papers.ssrn.com/sol3/papers.cfm?abstract_id=6883362
- https://docs.coinglass.com/reference/liquidation-heatmap

### Market makers

- A market maker earns spread but carries inventory and adverse-selection risk.
- When informed/aggressive flow is one-sided, rational liquidity providers widen spreads, reduce displayed size or cancel quotes.
- Large visible walls are not automatically support/resistance. The important behavior is whether liquidity remains, replenishes, is consumed or disappears as price approaches.
- Execution models must reject trades when estimated spread, slippage or order-book instability exceeds the expected edge.

Primary references:
- https://arxiv.org/abs/1409.2618
- https://papers.ssrn.com/sol3/papers.cfm?abstract_id=6891658

## 2. Participant psychology translated into measurable features

### Underreaction and delayed information

Large liquid cryptocurrencies can exhibit momentum because participants update at different speeds. Candidate measurements: multi-horizon returns, BTC lead/lag, cross-sectional relative strength, OI expansion and aligned taker flow.

References:
- https://www.sciencedirect.com/science/article/pii/S0304405X11002613
- https://www.sciencedirect.com/science/article/pii/S1062940822000833
- https://papers.ssrn.com/sol3/papers.cfm?abstract_id=3974583

### Overreaction, salience and lottery demand

Attention-grabbing moves attract retail participation, increase volatility and can create either continuation in liquid leaders or reversal in illiquid names. Candidate measurements: abnormal volume, extreme return, liquidity rank, funding/premium crowding and subsequent flow failure.

References:
- https://www.sciencedirect.com/science/article/pii/S1057521921002349
- https://www.sciencedirect.com/science/article/pii/S1057521922003696
- https://www.sciencedirect.com/science/article/pii/S1057521921001630

### Crowding and squeeze risk

Crowd ratios are most useful at extremes and only when price moves against the crowded side. Candidate measurements: global account ratio, top-trader account ratio, top-trader position ratio, OI change, funding and premium.

## 3. Strategy families to test

1. **OI-confirmed momentum**: breakout or trend continuation only when OI and taker flow expand in the same direction and funding is not excessively crowded.
2. **Liquidation exhaustion reversal**: large directional impulse, sharp OI collapse, extreme flow and a reclaim/failed auction before entering against the impulse.
3. **Liquidation continuation**: forced deleveraging with no reclaim, persistent aggressive flow and disappearing opposite liquidity.
4. **Crowded-side squeeze**: extreme account positioning, price breaking against the crowd and flow confirming the squeeze.
5. **Funding/premium exhaustion**: extreme funding and premium plus flow reversal and failed price progress.
6. **Compression plus leverage build**: volatility compression while OI rises, followed by volume and order-flow expansion.
7. **Cross-sectional relative momentum**: trade the strongest liquid assets in a supportive BTC regime, requiring OI and flow confirmation.
8. **Flow-price divergence**: aggressive flow remains one-sided but price stops progressing, signaling absorption and possible reversal.
9. **Basis dislocation**: premium/index deviation mean reversion conditioned on OI and liquidity regime.
10. **Meta-labelled hybrid**: broad structural events are generated by the rules above; a model estimates expected net R and win probability, then trades only high-confidence events.

## 4. Research rules

- Features must use information available before entry.
- Entry occurs no earlier than the next completed bar.
- Splits are chronological with an embargo around boundaries.
- Parameter/model selection uses train and validation only. Holdout is opened once.
- Same-bar stop and target ambiguity is resolved stop-first.
- Include fees, adverse slippage, delayed-entry stress and doubled-cost stress.
- Require a meaningful trade count and positive performance across several symbols.
- Do not promote a symbol-specific accident as a universal strategy.
- Current INPLAY membership must eventually be reconstructed point-in-time to avoid survivor and look-ahead bias.
- Coinglass data may be added through an owner-supplied API key; the key must never be committed or exposed in the browser.
