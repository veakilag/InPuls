from __future__ import annotations

import argparse
import importlib.util
import json
import math
import sys
from dataclasses import asdict
from pathlib import Path

import numpy as np
import pandas as pd
from sklearn.ensemble import HistGradientBoostingClassifier, HistGradientBoostingRegressor

BASE_SCRIPT = Path(__file__).with_name("algo-relative-momentum-deep-dive.py")
spec = importlib.util.spec_from_file_location("inpuls_microstructure_base", BASE_SCRIPT)
base = importlib.util.module_from_spec(spec)
assert spec.loader is not None
sys.modules[spec.name] = base
spec.loader.exec_module(base)

EXITS = [
    base.ExitConfig("micro-4r", 1.2, 1.0, 0.0, 1.5, 0.25, 4.0, 48),
    base.ExitConfig("micro-6r", 1.0, 1.25, 0.05, 2.0, 0.10, 6.0, 96),
    base.ExitConfig("micro-8r", 1.0, 1.5, 0.05, 1.5, 0.0, 8.0, 144),
]

FEATURES = [
    "d_r1", "d_r3", "d_r12", "d_r48", "d_flow", "d_flow3", "d_flow12",
    "d_oi1", "d_oi3", "d_oi12", "d_oi48", "d_ema", "d_macro",
    "d_btc12", "d_btc48", "d_rel12", "d_rel48", "directional_close",
    "volume_z", "count_z", "atr_rel", "range_atr", "oi_z", "oi_rank",
    "flow_rank", "return_rank", "liquidity_rank", "funding_against", "premium_against",
    "crowd_against", "top_against", "position_against", "dispersion12", "dispersion48",
    "quarter_phase", "price_response", "flow_price_divergence", "liquidation_intensity",
]


def parse_args():
    parser = argparse.ArgumentParser()
    parser.add_argument("--data-dir", required=True)
    parser.add_argument("--development-symbols", required=True)
    parser.add_argument("--unseen-symbols", required=True)
    parser.add_argument("--start", default="2024-01-01")
    parser.add_argument("--train-end", default="2026-01-01")
    parser.add_argument("--validation-end", default="2026-06-01")
    parser.add_argument("--holdout-end", default="2026-07-21")
    parser.add_argument("--output", default="algo-microstructure-meta-result.json")
    return parser.parse_args()


def parse_symbols(value):
    return [item.strip().upper() for item in value.split(",") if item.strip()]


def enrich_panel(frames):
    panel = base.add_panel_features(frames)
    panel["minute"] = panel.time.dt.minute
    panel["quarter_phase"] = (panel.minute // 15).astype(float) / 3.0
    panel["dispersion12"] = panel.groupby("time").r12.transform("std").fillna(0)
    panel["dispersion48"] = panel.groupby("time").r48.transform("std").fillna(0)
    return panel


def add_event(output, panel, mask, family, side):
    events = panel[mask].copy()
    if events.empty:
        return
    events["family"] = family
    events["side"] = side if np.isscalar(side) else side[mask]
    events["entry"] = events.bar + 1
    output.append(events)


def build_events(panel):
    output = []
    quarter = panel.minute.isin([0, 15, 30, 45])
    flow_side = np.where(panel.flow >= 0, 1, -1)
    return_side = np.where(panel.r3 >= 0, 1, -1)
    active = panel.active & (panel.volume_z > -0.5)

    quarter_flow = quarter & active & (panel.flow.abs() >= 0.03)
    add_event(output, panel, quarter_flow, "quarter-flow-continuation", flow_side)

    weak_response = (panel.flow * panel.r1 <= 0) | (
        np.where(flow_side > 0, panel.close_location, 1 - panel.close_location) < 0.45
    )
    add_event(
        output,
        panel,
        quarter_flow & weak_response,
        "quarter-flow-absorption",
        -flow_side,
    )

    liquidation = (
        active
        & (panel.m3.abs() >= 1.2)
        & (panel.oi3 <= -0.003)
        & (panel.volume_z >= 0.5)
        & (panel.flow.abs() >= 0.05)
    )
    continuation_close = np.where(return_side > 0, panel.close_location, 1 - panel.close_location)
    add_event(
        output,
        panel,
        liquidation & (continuation_close >= 0.65),
        "liquidation-continuation",
        return_side,
    )
    add_event(
        output,
        panel,
        liquidation & (continuation_close <= 0.45),
        "liquidation-exhaustion",
        -return_side,
    )

    funding_reversal_long = (
        active & (panel.funding_z <= -1.5) & (panel.premium_z <= -1.0)
        & (panel.flow3 > 0) & (panel.close_location >= 0.55)
    )
    funding_reversal_short = (
        active & (panel.funding_z >= 1.5) & (panel.premium_z >= 1.0)
        & (panel.flow3 < 0) & (panel.close_location <= 0.45)
    )
    add_event(output, panel, funding_reversal_long, "funding-premium-exhaustion", 1)
    add_event(output, panel, funding_reversal_short, "funding-premium-exhaustion", -1)

    oi_break_long = (
        quarter & active & (panel.r12_rank >= 0.8) & (panel.oi12_rank >= 0.75)
        & (panel.flow3 >= 0.04) & (panel.volume_z_rank >= 0.7)
    )
    oi_break_short = (
        quarter & active & (panel.r12_rank <= 0.2) & (panel.oi12_rank >= 0.75)
        & (panel.flow3 <= -0.04) & (panel.volume_z_rank >= 0.7)
    )
    add_event(output, panel, oi_break_long, "quarter-oi-breakout", 1)
    add_event(output, panel, oi_break_short, "quarter-oi-breakout", -1)

    if not output:
        return panel.iloc[0:0].copy()
    events = pd.concat(output, ignore_index=True).drop_duplicates(
        ["symbol", "time", "family", "side"]
    )
    events = events.sort_values(["symbol", "family", "side", "bar"])
    gap = events.groupby(["symbol", "family", "side"]).bar.diff()
    events = events[gap.isna() | (gap > 2)].copy()

    side = events.side.astype(float)
    directional = {
        "r1": "d_r1", "r3": "d_r3", "r12": "d_r12", "r48": "d_r48",
        "flow": "d_flow", "flow3": "d_flow3", "flow12": "d_flow12",
        "oi1": "d_oi1", "oi3": "d_oi3", "oi12": "d_oi12", "oi48": "d_oi48",
        "ema": "d_ema", "macro": "d_macro", "btc_r12": "d_btc12",
        "btc_r48": "d_btc48", "rel12": "d_rel12", "rel48": "d_rel48",
    }
    for source, target in directional.items():
        events[target] = side * events[source]
    events["directional_close"] = np.where(side > 0, events.close_location, 1 - events.close_location)
    events["return_rank"] = np.where(side > 0, events.r12_rank, 1 - events.r12_rank)
    events["oi_rank"] = events.oi12_rank
    events["flow_rank"] = np.where(side > 0, events.flow3_rank, 1 - events.flow3_rank)
    events["liquidity_rank"] = events.q24_rank
    events["funding_against"] = -side * events.funding_z
    events["premium_against"] = -side * events.premium_z
    events["crowd_against"] = -side * events.crowd_z
    events["top_against"] = -side * events.top_z
    events["position_against"] = -side * events.pos_z
    events["price_response"] = side * events.r1 / events.atr_rel.replace(0, np.nan)
    events["flow_price_divergence"] = events.d_flow * events.price_response
    events["liquidation_intensity"] = (-events.oi3).clip(lower=0) * events.m3.abs() * (
        1 + events.volume_z.clip(lower=0)
    )
    return events.replace([np.inf, -np.inf], np.nan).sort_values("time").reset_index(drop=True)


def matrix(events, family_columns=None):
    numeric = events[FEATURES].replace([np.inf, -np.inf], np.nan).fillna(0).reset_index(drop=True)
    families = pd.get_dummies(events.family, prefix="family", dtype=float)
    if family_columns is None:
        family_columns = sorted(families.columns)
    families = families.reindex(columns=family_columns, fill_value=0).reset_index(drop=True)
    return pd.concat([numeric, families], axis=1).astype(float), family_columns


def candidate_score(metrics):
    pf = min(metrics["profitFactor"], 8) if math.isfinite(metrics["profitFactor"]) else 8
    return (
        metrics["averageR"] * 8 + math.log1p(pf) + metrics["winRate"] * 2
        + math.log1p(metrics["trades"]) * 0.15 + metrics["positiveSymbols"] * 0.15
    )


def clean(value):
    if isinstance(value, dict):
        return {key: clean(item) for key, item in value.items()}
    if isinstance(value, list):
        return [clean(item) for item in value]
    if isinstance(value, float):
        if math.isinf(value):
            return "Infinity"
        if math.isnan(value):
            return None
        return round(value, 6)
    return value


def main():
    options = parse_args()
    development = parse_symbols(options.development_symbols)
    unseen = parse_symbols(options.unseen_symbols)
    requested = list(dict.fromkeys([*development, *unseen]))
    start = pd.Timestamp(options.start, tz="UTC")
    train_end = pd.Timestamp(options.train_end, tz="UTC")
    validation_end = pd.Timestamp(options.validation_end, tz="UTC")
    holdout_end = pd.Timestamp(options.holdout_end, tz="UTC")
    embargo = pd.Timedelta("1D")
    root = Path(options.data_dir)

    frames = {}
    failures = {}
    for symbol in requested:
        try:
            frames[symbol] = base.base.feat(base.base.load(root, symbol, start, holdout_end))
        except Exception as error:
            failures[symbol] = str(error)
    development = [symbol for symbol in development if symbol in frames]
    unseen = [symbol for symbol in unseen if symbol in frames]
    if "BTCUSDT" not in frames or len(development) < 6 or len(unseen) < 4:
        raise RuntimeError(f"insufficient data: development={development}, unseen={unseen}, failures={failures}")

    panel = enrich_panel(frames)
    frames = {
        symbol: group.sort_values("time").reset_index(drop=True)
        for symbol, group in panel.groupby("symbol")
    }
    for frame in frames.values():
        frame["bar"] = np.arange(len(frame))
    panel = pd.concat(frames.values(), ignore_index=True)
    events = build_events(panel)
    arrays = {symbol: base.arrays(frame) for symbol, frame in frames.items()}
    if events.empty:
        raise RuntimeError("no microstructure events")

    fee = 0.0005
    slippage = 0.0002
    candidates = []
    print(json.dumps({"events": len(events), "families": events.family.value_counts().to_dict()}), file=sys.stderr, flush=True)

    for exit_config in EXITS:
        outcomes = base.simulate(events, frames, arrays, exit_config, fee, slippage)
        train = outcomes[
            outcomes.symbol.isin(development)
            & (outcomes.time < train_end - embargo)
            & (outcomes.exit_time < train_end)
        ].copy()
        validation = outcomes[
            outcomes.symbol.isin(development)
            & (outcomes.time >= train_end + embargo)
            & (outcomes.time < validation_end - embargo)
            & (outcomes.exit_time < validation_end)
        ].copy()
        holdout = outcomes[
            outcomes.symbol.isin(unseen)
            & (outcomes.time >= validation_end + embargo)
            & (outcomes.time < holdout_end)
        ].copy()
        if len(train) < 500 or len(validation) < 80 or len(holdout) < 40 or train.win.nunique() < 2:
            continue

        train_x, family_columns = matrix(train)
        validation_x, _ = matrix(validation, family_columns)
        holdout_x, _ = matrix(holdout, family_columns)
        weights = 1 + np.minimum(np.abs(train.net_r.to_numpy()), 6)
        classifier = HistGradientBoostingClassifier(
            max_iter=180, learning_rate=0.04, max_leaf_nodes=15,
            min_samples_leaf=40, l2_regularization=2, random_state=42,
        )
        regressor = HistGradientBoostingRegressor(
            max_iter=180, learning_rate=0.04, max_leaf_nodes=15,
            min_samples_leaf=40, l2_regularization=2, random_state=42,
        )
        classifier.fit(train_x, train.win, sample_weight=weights)
        regressor.fit(train_x, train.net_r.clip(-6, 8), sample_weight=weights)

        validation["probability"] = classifier.predict_proba(validation_x)[:, 1]
        validation["predictedR"] = regressor.predict(validation_x)
        holdout["probability"] = classifier.predict_proba(holdout_x)[:, 1]
        holdout["predictedR"] = regressor.predict(holdout_x)
        validation["score"] = validation.probability + np.clip(validation.predictedR, -2, 5) / 7
        holdout["score"] = holdout.probability + np.clip(holdout.predictedR, -2, 5) / 7

        thresholds = []
        for probability in [0.35, 0.4, 0.45, 0.5, 0.55, 0.6, 0.65, 0.7]:
            for predicted_r in [-1, -0.5, -0.25, 0, 0.25, 0.5, 0.75, 1]:
                selected = base.remove_overlap(
                    validation[
                        (validation.probability >= probability)
                        & (validation.predictedR >= predicted_r)
                    ]
                )
                metrics = base.metrics(selected)
                if metrics["trades"] >= 35 and metrics["symbols"] >= 4:
                    thresholds.append((candidate_score(metrics), probability, predicted_r, metrics))
        for score, probability, predicted_r, validation_metrics in sorted(thresholds, reverse=True)[:5]:
            selected_holdout = base.remove_overlap(
                holdout[
                    (holdout.probability >= probability)
                    & (holdout.predictedR >= predicted_r)
                ]
            )
            candidates.append(
                {
                    "exit": exit_config,
                    "validationScore": score,
                    "probability": probability,
                    "predictedR": predicted_r,
                    "validation": validation_metrics,
                    "holdout": selected_holdout,
                    "holdoutMetrics": base.metrics(selected_holdout),
                }
            )

    if not candidates:
        raise RuntimeError("no validation candidates")
    candidates.sort(key=lambda item: item["validationScore"], reverse=True)
    finalists = candidates[:15]
    results = []
    key_columns = ["symbol", "time", "family", "side"]

    for candidate in finalists:
        selected = candidate["holdout"]
        keys = selected[key_columns].drop_duplicates()
        selected_events = events.merge(keys, on=key_columns, how="inner")
        doubled = base.remove_overlap(
            base.simulate(selected_events, frames, arrays, candidate["exit"], fee * 2, slippage * 2)
        )
        delayed = base.remove_overlap(
            base.simulate(selected_events, frames, arrays, candidate["exit"], fee, slippage, delay=1)
        )
        holdout_metrics = candidate["holdoutMetrics"]
        doubled_metrics = base.metrics(doubled)
        delayed_metrics = base.metrics(delayed)
        strict = (
            holdout_metrics["trades"] >= 30
            and holdout_metrics["profitFactor"] > 2
            and holdout_metrics["winRate"] > 0.40
            and holdout_metrics["averageR"] > 1
            and holdout_metrics["positiveSymbols"] >= 4
            and doubled_metrics["profitFactor"] > 1
            and doubled_metrics["averageR"] > 0
            and delayed_metrics["profitFactor"] > 1
            and delayed_metrics["averageR"] > 0
        )
        results.append(
            {
                "id": f"micro-meta::{candidate['exit'].name}::p{candidate['probability']}::r{candidate['predictedR']}",
                "exit": asdict(candidate["exit"]),
                "probabilityThreshold": candidate["probability"],
                "predictedRThreshold": candidate["predictedR"],
                "strictPass": strict,
                "validation": candidate["validation"],
                "unseenUniverseHoldout": holdout_metrics,
                "doubledCostsHoldout": doubled_metrics,
                "oneBarDelayHoldout": delayed_metrics,
            }
        )

    results.sort(
        key=lambda item: (
            item["strictPass"], item["unseenUniverseHoldout"]["averageR"],
            item["unseenUniverseHoldout"]["profitFactor"], item["unseenUniverseHoldout"]["trades"],
        ),
        reverse=True,
    )
    report = {
        "methodology": {
            "source": "Binance derivatives history mirror",
            "interval": "5m",
            "developmentSymbols": development,
            "unseenHoldoutSymbols": unseen,
            "loadFailures": failures,
            "train": f"{start.isoformat()}/{train_end.isoformat()}",
            "validation": f"{train_end.isoformat()}/{validation_end.isoformat()}",
            "unseenUniverseHoldout": f"{validation_end.isoformat()}/{holdout_end.isoformat()}",
            "events": len(events),
            "families": sorted(events.family.unique()),
            "baseCosts": {"feePerSide": fee, "slippagePerSide": slippage},
            "gate": {"trades": ">=30", "profitFactor": ">2", "winRate": ">40%", "averageR": ">1R", "positiveSymbols": ">=4", "doubledCosts": "positive", "oneBarDelay": "positive"},
            "warning": "Unseen-symbol holdout was not used to fit models or choose thresholds.",
        },
        "strictCandidatesFound": sum(item["strictPass"] for item in results),
        "top": results[:10],
    }
    Path(options.output).write_text(json.dumps(clean(report), ensure_ascii=False, indent=2), encoding="utf-8")
    print(json.dumps(clean(report), ensure_ascii=False, indent=2))


if __name__ == "__main__":
    main()
