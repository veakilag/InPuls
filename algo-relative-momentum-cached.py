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

SCRIPT = Path(__file__).with_name("algo-relative-momentum-deep-dive.py")
spec = importlib.util.spec_from_file_location("inpuls_relative_base", SCRIPT)
research = importlib.util.module_from_spec(spec)
assert spec.loader is not None
sys.modules[spec.name] = research
spec.loader.exec_module(research)

EXITS = [
    research.ExitConfig("wide-5r", 1.6, 1.0, 0.0, 1.5, 0.45, 5.0, 48),
    research.ExitConfig("tail-6r", 1.2, 1.0, 0.05, 2.0, 0.15, 6.0, 96),
    research.ExitConfig("full-8r", 1.0, 1.5, 0.05, 1.5, 0.0, 8.0, 144),
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
    parser.add_argument("--output", default="algo-relative-momentum-result.json")
    return parser.parse_args()


def parse_symbols(value):
    return [item.strip().upper() for item in value.split(",") if item.strip()]


def variants():
    output = []
    for horizon in [12, 48]:
        for strength_rank in [0.80, 0.90]:
            for oi_rank in [0.70, 0.85]:
                for flow_minimum in [0.03, 0.06]:
                    for require_btc_alignment in [False, True]:
                        output.append(
                            {
                                "horizon": horizon,
                                "strengthRank": strength_rank,
                                "oiRank": oi_rank,
                                "flowMinimum": flow_minimum,
                                "volumeRank": 0.70,
                                "requireBtcAlignment": require_btc_alignment,
                            }
                        )
    return output


def build_broad_events(panel):
    output = []
    for horizon in [12, 48]:
        return_rank_column = f"r{horizon}_rank"
        oi_rank_column = f"oi{horizon}_rank"
        flow_column = "flow3" if horizon == 12 else "flow12"
        btc_column = f"btc_r{horizon}"
        for side in [1, -1]:
            directional_rank = panel[return_rank_column] if side > 0 else 1 - panel[return_rank_column]
            directional_flow = side * panel[flow_column]
            close_strength = panel.close_location if side > 0 else 1 - panel.close_location
            mask = (
                panel.active
                & (directional_rank >= 0.80)
                & (panel[oi_rank_column] >= 0.70)
                & (directional_flow >= 0.03)
                & (panel.volume_z_rank >= 0.70)
                & (close_strength >= 0.52)
            )
            events = panel[mask].copy()
            if events.empty:
                continue
            events["side"] = side
            events["entry"] = events.bar + 1
            events["family"] = f"relative-momentum-{horizon}"
            events["horizon"] = horizon
            events["directionalRank"] = directional_rank[mask]
            events["oiRankValue"] = panel.loc[mask, oi_rank_column]
            events["flowStrength"] = directional_flow[mask]
            events["volumeRankValue"] = panel.loc[mask, "volume_z_rank"]
            events["btcAligned"] = side * panel.loc[mask, btc_column] > -0.001
            output.append(events)
    if not output:
        return panel.iloc[0:0].copy()
    events = pd.concat(output, ignore_index=True).sort_values(["symbol", "horizon", "side", "bar"])
    gap = events.groupby(["symbol", "horizon", "side"]).bar.diff()
    events = events[gap.isna() | (gap > 3)].copy()
    return events.sort_values(["time", "symbol", "horizon"]).reset_index(drop=True)


def select_variant(trades, variant):
    selected = trades[
        (trades.horizon == variant["horizon"])
        & (trades.directionalRank >= variant["strengthRank"])
        & (trades.oiRankValue >= variant["oiRank"])
        & (trades.flowStrength >= variant["flowMinimum"])
        & (trades.volumeRankValue >= variant["volumeRank"])
    ]
    if variant["requireBtcAlignment"]:
        selected = selected[selected.btcAligned]
    return research.remove_overlap(selected)


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
    embargo = pd.Timedelta("1d")
    root = Path(options.data_dir)

    frames = {}
    failures = {}
    for symbol in requested:
        try:
            frames[symbol] = research.base.feat(
                research.base.load(root, symbol, start, holdout_end)
            )
        except Exception as error:
            failures[symbol] = str(error)
    development = [symbol for symbol in development if symbol in frames]
    unseen = [symbol for symbol in unseen if symbol in frames]
    if "BTCUSDT" not in frames or len(development) < 6 or len(unseen) < 4:
        raise RuntimeError(
            f"insufficient datasets: development={development}, unseen={unseen}, failures={failures}"
        )

    panel = research.add_panel_features(frames)
    frames = {
        symbol: group.sort_values("time").reset_index(drop=True)
        for symbol, group in panel.groupby("symbol")
    }
    for frame in frames.values():
        frame["bar"] = np.arange(len(frame))
    panel = pd.concat(frames.values(), ignore_index=True)
    frame_arrays = {symbol: research.arrays(frame) for symbol, frame in frames.items()}
    events = build_broad_events(panel)
    if events.empty:
        raise RuntimeError("no broad relative-momentum events")

    fee = 0.0005
    slippage = 0.0002
    grid = variants()
    screened = []
    cached_trades = {}

    print(
        json.dumps(
            {
                "loadedDevelopment": development,
                "loadedUnseen": unseen,
                "broadEvents": len(events),
                "variants": len(grid) * len(EXITS),
            }
        ),
        file=sys.stderr,
        flush=True,
    )

    for exit_config in EXITS:
        print(f"simulate {exit_config.name}", file=sys.stderr, flush=True)
        trades = research.simulate(
            events, frames, frame_arrays, exit_config, fee, slippage
        )
        cached_trades[exit_config.name] = trades
        for variant in grid:
            variant_trades = select_variant(trades, variant)
            train = variant_trades[
                variant_trades.symbol.isin(development)
                & (variant_trades.time < train_end - embargo)
                & (variant_trades.exit_time < train_end)
            ]
            validation = variant_trades[
                variant_trades.symbol.isin(development)
                & (variant_trades.time >= train_end + embargo)
                & (variant_trades.time < validation_end - embargo)
                & (variant_trades.exit_time < validation_end)
            ]
            train_metrics = research.metrics(train)
            validation_metrics = research.metrics(validation)
            if train_metrics["trades"] < 150 or validation_metrics["trades"] < 35:
                continue
            stable = (
                train_metrics["profitFactor"] > 1
                and train_metrics["averageR"] > 0
                and validation_metrics["profitFactor"] > 1
                and validation_metrics["averageR"] > 0
                and validation_metrics["positiveSymbols"] >= 4
            )
            score = research.validation_score(validation_metrics) + min(
                research.validation_score(train_metrics), 5
            )
            screened.append(
                {
                    "variant": variant,
                    "exit": exit_config,
                    "train": train_metrics,
                    "validation": validation_metrics,
                    "stable": stable,
                    "score": score,
                }
            )

    if not screened:
        raise RuntimeError("no cached candidate reached sample-size gate")
    stable_candidates = sorted(
        [candidate for candidate in screened if candidate["stable"]],
        key=lambda item: item["score"],
        reverse=True,
    )
    selected = (
        stable_candidates
        if stable_candidates
        else sorted(screened, key=lambda item: item["score"], reverse=True)
    )[:20]

    results = []
    for candidate in selected:
        variant = candidate["variant"]
        exit_config = candidate["exit"]
        variant_trades = select_variant(cached_trades[exit_config.name], variant)
        holdout = variant_trades[
            variant_trades.symbol.isin(unseen)
            & (variant_trades.time >= validation_end + embargo)
            & (variant_trades.time < holdout_end)
        ]
        holdout = research.remove_overlap(holdout)
        keys = holdout[["symbol", "time", "side", "horizon"]].drop_duplicates()
        selected_events = events.merge(
            keys, on=["symbol", "time", "side", "horizon"], how="inner"
        )
        doubled = research.remove_overlap(
            research.simulate(
                selected_events,
                frames,
                frame_arrays,
                exit_config,
                fee * 2,
                slippage * 2,
            )
        )
        delayed = research.remove_overlap(
            research.simulate(
                selected_events,
                frames,
                frame_arrays,
                exit_config,
                fee,
                slippage,
                delay=1,
            )
        )
        holdout_metrics = research.metrics(holdout)
        doubled_metrics = research.metrics(doubled)
        delayed_metrics = research.metrics(delayed)
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
                "id": f"relative-momentum::{exit_config.name}::{json.dumps(variant, sort_keys=True)}",
                "parameters": variant,
                "exit": asdict(exit_config),
                "selectedFromStableDevelopment": candidate["stable"],
                "strictPass": strict,
                "train": candidate["train"],
                "validation": candidate["validation"],
                "unseenUniverseHoldout": holdout_metrics,
                "doubledCostsHoldout": doubled_metrics,
                "oneBarDelayHoldout": delayed_metrics,
            }
        )

    results.sort(
        key=lambda item: (
            item["strictPass"],
            item["unseenUniverseHoldout"]["averageR"],
            item["unseenUniverseHoldout"]["profitFactor"],
            item["unseenUniverseHoldout"]["trades"],
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
            "broadEvents": len(events),
            "variants": len(grid) * len(EXITS),
            "stableBeforeHoldout": len(stable_candidates),
            "gate": {
                "minimumTrades": 30,
                "profitFactor": ">2",
                "winRate": ">40%",
                "averageR": ">1R",
                "positiveSymbols": ">=4",
                "doubledCosts": "positive",
                "oneBarDelay": "positive",
            },
            "costs": {"feePerSide": fee, "slippagePerSide": slippage},
            "warning": "The unseen-symbol holdout was not used for variant selection.",
        },
        "strictCandidatesFound": sum(item["strictPass"] for item in results),
        "top": results[:10],
    }
    Path(options.output).write_text(
        json.dumps(clean(report), ensure_ascii=False, indent=2), encoding="utf-8"
    )
    print(json.dumps(clean(report), ensure_ascii=False, indent=2))


if __name__ == "__main__":
    main()
