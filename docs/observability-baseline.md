# PR 1 — Observability baseline

> PR 1.1 corrects cross-context timing, connection-startup visibility and capture completeness. See [observability-correctness.md](./observability-correctness.md) before interpreting new captures.

## Scope

This PR makes the audited bottlenecks measurable without changing their algorithms, scheduling, data sources, book limits, recovery semantics or rendering ownership.

Diagnostics are off by default. Enable them for one page load with `?obs=1`, or persist the flag with:

```js
localStorage.setItem("inpuls-observability-v1", "1");
location.reload();
```

Disable and reload:

```js
localStorage.removeItem("inpuls-observability-v1");
location.reload();
```

Runtime API:

```js
__INPULS_OBS__.snapshot()
__INPULS_OBS__.reset()
__INPULS_OBS__.download()
```

## Metrics

| Metric | Unit | Meaning |
|---|---:|---|
| `source-to-main` | ms | Live exchange event timestamp to Worker message receipt on the main thread |
| `worker.process` | ms | Diagnostic envelope and payload-size calculation in the Worker |
| `worker.observer-overhead` | ms | Time spent creating diagnostic metadata; includes sampled size calculation |
| `worker.post-to-main` | ms | Worker epoch send timestamp to main-thread epoch receipt timestamp |
| `worker.payload-bytes` | bytes | JSON-encoded message size before diagnostic metadata |
| `main-to-render` | ms | Latest Worker message receipt to completed TAPE/footprint render |
| `source-to-render` | ms | Live exchange event timestamp to completed ladder/TAPE/footprint render |
| `app.render` | ms | Existing full one-second application render |
| `footprint.draw-all` | ms | Existing global footprint draw pass |
| `footprint.render-card` | ms | Existing render cost for one footprint card |
| `tape.render-card` | ms | Existing TAPE render cost for one card |
| `footprint.cards-per-draw` | count | Cards visited by the global draw pass |
| `runtime.long-task` | ms | Browser Long Tasks API entries |
| `frames.*` | ms/count | rAF frame intervals and intervals over 50 ms |
| `memory.*` | bytes | Chromium non-standard heap snapshot when available |

Every distribution reports sample count, p50, p95, p99 and maximum. Samples are capped at 12,000 per metric to retain the beginning of multi-minute captures while bounding opt-in diagnostic memory.

## Diagnostic overhead

Disabled path:

- one module import per participating runtime;
- one boolean branch at each measurement point;
- Worker payload shape and serialization stay unchanged;
- no `requestAnimationFrame` loop and no `PerformanceObserver`.

Enabled path:

- one rAF timestamp per frame;
- two `performance.now()` calls per timed section;
- bounded sample objects;
- one JSON serialization plus `Blob` size calculation for 1 of every 50 Worker messages.

The sampled size calculation is included in `worker.observer-overhead`; `worker.process` covers the existing depth sort/slice and message preparation for book frames. Compare a scenario with and without `?obs=1` to quantify observer effect. A baseline is invalid if enabling diagnostics changes p95 frame interval or receive latency by more than 5%. In that case record the observer effect and rerun with payload-size sampling temporarily reduced in a follow-up PR; do not optimize production code in PR 1.

Synthetic Node check on the PR branch (1,000 iterations, 4,000 levels per side and 500 trades) measured the disabled envelope at 0.0007 ms mean and the enabled sampled envelope at 0.0961 ms mean. Enabled p50 was 0.0004 ms, p95 0.0154 ms and the maximum sampled serialization was 8.5870 ms. These figures validate the sampling budget only; they are not a browser or live-market performance baseline.

## Manual scenarios

Run each scenario after `__INPULS_OBS__.reset()`. Capture at least 60 seconds and download the JSON.

1. Idle workspace: one chart, radar, no open order book.
2. One active order book with TAPE and clusters visible.
3. Four order books on active symbols.
4. Eight order books on active symbols.
5. One high-rate impulse with TAPE visible.
6. Repeat scenario 5 with TAPE hidden.
7. Manual chart drag for 30 seconds.
8. Manual order-book scroll and `Ctrl + wheel` scaling.
9. Background the tab for two minutes, then resume.
10. Force reconnect by toggling network offline/online.

For scenarios 1–5, run once without `obs` and use Chrome Performance/FPS, then once with `obs`. Record observer effect, card count, source state (`LIVE RAW`, `LIVE AGG`, `RECOVERED`, `GAP`, `STALE`, `ERROR`) and device/browser.

## Acceptance criteria

- No signal, order-book, tape, chart or recovery behavior changes.
- Diagnostics remain opt-in.
- Export contains counts and p50/p95/p99.
- Worker payload bytes and exchange-to-main timing are available per message type/symbol.
- Full app render and both footprint scopes are measured.
- Existing known red/hanging test baseline is reported, not hidden.
