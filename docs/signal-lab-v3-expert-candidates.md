# Signal Lab V3 — candidate-first learning

Status: experimental owner-only branch. Not a production signal source.

## Product decision

Signal Lab V3 does not try to name a finished setup at the first market movement. It records broad market episodes first, enriches them with available evidence and sends them to manual review.

Pipeline:

```text
market stream
→ broad candidate
→ one deduplicated episode
→ evidence enrichment
→ subsequent price path
→ manual verdict and final pattern label
→ readiness assessment
→ only then a production detector proposal
```

The Event Radar formulas remain unchanged in this branch.

## Research basis

The model was redesigned after reviewing exported Telegram histories from two experienced scalper channels:

- chronological messages and captions;
- attached chart and terminal screenshots;
- repeated terminology and setup families;
- published mistakes, weak entries and changes in execution over time.

The exports did not include the native video files. Therefore order-book transitions that were only visible inside videos are not treated as verified facts. Channel examples are training hypotheses, not proof of statistical edge.

## Main finding

The reviewed scalpers do not trade a single candle shape. Their episodes combine several layers:

1. instrument suitability: active coin, volume, liquidity and session;
2. context: 5m/1m structure, levels, round prices and trend;
3. geometry: level, cascade, range, compression or displacement;
4. possible cause: displayed liquidity, liquidation flow, participant-like activity or stop-liquidity zone;
5. trigger: break, reclaim, rejection, repeated defence, consumption or acceleration;
6. confirmation: trade flow, order book reaction and follow-through;
7. invalidation and subsequent result.

V3 therefore stores observable components separately and does not claim an invisible cause as a fact.

## Candidate families in the first implementation

- upward and downward displacement;
- attempted reclaim after a downward displacement;
- attempted rejection after an upward displacement;
- pressure near a repeatedly tested upper or lower level;
- an attempted level break before acceptance is known;
- three or more ordered extrema forming a cascade structure;
- directional trade-flow acceleration;
- anomalous displayed best-quote liquidity;
- liquidation bursts.

A candidate may contain several pattern hypotheses. For example, an upward level break attempt may later become a valid breakout or a false breakout.

## Relative thresholds

Fixed percentages behave differently on quiet and volatile instruments. V3 derives broad thresholds from NATR when it is available, with safety floors and ceilings.

Examples:

- quiet instruments can create a displacement candidate near the minimum threshold;
- volatile instruments require a larger move;
- level tolerance and approach distance expand moderately with NATR;
- cascade step size adapts to instrument volatility;
- displayed liquidity is measured against a rolling local median as well as a minimum quote value.

These thresholds are deliberately broad and provisional. They are collection parameters, not validated trading rules.

## Episode deduplication

Repeated checks of the same symbol, candidate type and direction are combined into one episode during a cooldown window. The episode records:

- first and last observation time;
- number of observations;
- peak evidence score;
- latest facts and hypotheses;
- final completion time;
- manual review.

One market movement must not create dozens of training cards.

## Evidence score

`evidenceScore` is a collection priority from 0 to 100. It is not:

- win probability;
- expected return;
- trade quality guarantee;
- recommendation to enter.

The score only summarizes how many observable candidate conditions are currently present.

## Data collection

The standalone owner page connects to public Binance USDⓈ-M Futures data:

- `!miniTicker@arr`;
- `!markPrice@arr@1s`;
- `!forceOrder@arr`;
- `!bookTicker`;
- dynamically selected `@aggTrade` streams for active symbols.

Minute candles are warmed from the public Futures REST endpoint for a limited set of active symbols. No user API keys or secrets are used.

## Data limitations

- best-quote liquidity does not represent the full deep book;
- displayed size does not prove trader identity or intent;
- aggregated trades cannot identify one participant;
- geometric extrema are not confirmed stop locations;
- a liquidation burst does not guarantee continuation;
- cross-exchange leadership, OI and full density lifecycle are not yet available in the standalone V3 collector;
- browser background throttling and network gaps must be reflected in data quality.

The UI must never accuse spoofing or state that a large player acted without sufficient evidence.

## Manual verdicts

- `valid` — the final pattern is confirmed by the reviewer;
- `weak` — recognisable but missing important evidence;
- `false_positive` — the candidate was market noise or an incorrect hypothesis;
- `duplicate_episode` — the same underlying move is already represented;
- `wrong_pattern` — a real episode, but another pattern label is more appropriate;
- `insufficient_data` — the screenshot/path/flow is incomplete;
- `missed_pattern` — reserved for manually added episodes the collector did not capture.

## Promotion gate

Nothing in V3 is automatically promoted to Event Radar. A detector proposal needs:

- a formal definition;
- positive examples;
- counterexamples and false positives;
- stable data-quality coverage;
- outcome windows at 15s, 1m, 3m and 5m;
- MFE, MAE and effect duration;
- one explicit formula version;
- documented limitations;
- live shadow validation.

## Files

- `signal-lab-v3-candidates.js` — pure broad candidate detector and episode tracker;
- `signal-lab-v3-collector.js` — standalone public Binance collector;
- `signal-lab-v3-store.js` — local IndexedDB storage, reviews and exports;
- `owner-signal-lab-v3.html` — owner-only candidate review page;
- `owner-signal-lab-v3.js` — UI, filtering, review and export;
- `owner-signal-lab-v3.css` — dedicated interface styles;
- `test/signal-lab-v3.test.js` — candidate, deduplication and storage contracts.
