# Signal Lab V4 — Stage 4 live validation protocol

## Recommended sample

Do not change detector thresholds before at least 30 manually reviewed V4 cascade episodes from one formula version:

- at least 10 canonical or weak examples;
- at least 10 explicit false examples;
- at least 5 long and 5 short examples;
- include SETUP, TRIGGERED, CONFIRMED, EXTENDED, PARTIAL and FAILED where observed;
- exclude GAP, STALE and unavailable episodes from threshold fitting while retaining them in the audit dataset.

Thirty observations are only the first calibration checkpoint, not statistical proof.

## Review order

Review every episode in the same causal order:

1. Were the source extrema observable and correctly confirmed without look-ahead?
2. Were nearby extrema merged into the correct LevelZone boundaries?
3. Does ×N count independent attacks rather than adjacent candles or trades?
4. Did CASCADE SETUP exist before the first level was crossed?
5. Are K1, K2 and K3 ordered in the actual movement direction?
6. Is TRIGGERED attached to the strict first-level crossing?
7. Is CONFIRMED attached to the second sequential level rather than later outcome knowledge?
8. Is PARTIAL or FAILED based on the configured duration, pullback or return rule?
9. Are 15s/1m/3m/5m outcomes complete enough for outcome analysis?

## Decision rule

- `canonical`: geometry and lifecycle match the trader's interpretation without material correction;
- `weak`: the episode is structurally valid but has weak preparation, loose geometry or poor execution context;
- `false`: the machine created an event that should not be considered a cascade;
- `ambiguous`: two reasonable manual interpretations remain;
- `unavailable`: the evidence pack cannot answer the question.

A failed checklist item is useful evidence. It does not make the sample unavailable by itself. Unknown or unavailable geometry checks block threshold fitting because the disagreement cannot be localized.

## First calibration report

After the first checkpoint, report by formula version and direction:

- number of observations;
- canonical, weak and false counts;
- which layer fails most often;
- distribution of level count, adjacent gaps and ×N;
- setup lead time before K1;
- time and bars K1→K2 and K2→K3;
- inter-level pullback distribution;
- MFE, MAE and duration by lifecycle state;
- data-quality exclusions.

Do not call any of these counts a win rate unless a formal entry, stop, exit and cost model is separately defined.
