from __future__ import annotations

import argparse
import importlib.util
import json
import math
import sys
from dataclasses import asdict, dataclass
from pathlib import Path

import numpy as np
import pandas as pd

BASE_SCRIPT = Path(__file__).with_name("algo-derivatives-research.py")
spec = importlib.util.spec_from_file_location("inpuls_derivatives_base", BASE_SCRIPT)
base = importlib.util.module_from_spec(spec)
assert spec.loader is not None
sys.modules[spec.name] = base
spec.loader.exec_module(base)

EPS = 1e-12


@dataclass(frozen=True)
class ExitConfig:
    name: str
    stop_atr: float
    protect_at_r: float
    protected_r: float
    partial_at_r: float
    partial_share: float
    runner_r: float
    hold_bars: int


EXITS = [
    ExitConfig("wide-5r", 1.6, 1.0, 0.0, 1.5, 0.45, 5.0, 48),
    ExitConfig("tail-6r", 1.2, 1.0, 0.05, 2.0, 0.15, 6.0, 144),
    ExitConfig("tail-8r", 1.2, 1.25, 0.05, 2.5, 0.10, 8.0, 288),
    ExitConfig("full-6r", 1.0, 1.5, 0.05, 1.5, 0.0, 6.0, 144),
    ExitConfig("full-8r", 1.0, 2.0, 0.05, 2.0, 0.0, 8.0, 288),
    ExitConfig("full-10r", 1.0, 2.0, 0.05, 2.0, 0.0, 10.0, 432),
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


def symbols(value: str):
    return [item.strip().upper() for item in value.split(",") if item.strip()]


def directional_close(frame):
    denominator = (frame.high - frame.low).replace(0, np.nan)
    return ((frame.close - frame.low) / denominator).clip(0, 1)


def add_panel_features(frames):
    panel = pd.concat(frames.values(), ignore_index=True)
    panel["close_location"] = directional_close(panel)
    for column in ["r12", "r48", "oi12", "oi48", "flow3", "flow12", "volume_z", "q24"]:
        panel[f"{column}_rank"] = panel.groupby("time")[column].rank(pct=True)
    btc = panel[panel.symbol == "BTCUSDT"][["time", "r12", "r48", "ema", "macro"]].rename(
        columns={name: f"btc_{name}" for name in ["r12", "r48", "ema", "macro"]}
    )
    panel = panel.merge(btc, on="time", how="left")
    panel["rel12"] = panel.r12 - panel.btc_r12
    panel["rel48"] = panel.r48 - panel.btc_r48
    panel["active"] = (panel.q24 > 10_000_000) & (panel.q24_rank >= 0.2)
    return panel


def build_variant_grid():
    variants = []
    for horizon in [12, 48]:
        for strength_rank in [0.70, 0.80, 0.90]:
            for oi_rank in [0.55, 0.70, 0.85]:
                for flow_minimum in [0.02, 0.05, 0.08]:
                    for volume_rank in [0.0, 0.50, 0.70]:
                        for require_btc_alignment in [False, True]:
                            variants.append(
                                {
                                    "horizon": horizon,
                                    "strengthRank": strength_rank,
                                    "oiRank": oi_rank,
                                    "flowMinimum": flow_minimum,
                                    "volumeRank": volume_rank,
                                    "requireBtcAlignment": require_btc_alignment,
                                }
                            )
    return variants


def build_events(panel, variant):
    horizon = variant["horizon"]
    return_column = f"r{horizon}"
    return_rank = f"{return_column}_rank"
    oi_rank = f"oi{horizon}_rank"
    flow_column = "flow3" if horizon == 12 else "flow12"
    btc_column = f"btc_r{horizon}"

    shared = panel.active & (panel.volume_z_rank >= variant["volumeRank"])
    long_mask = (
        shared
        & (panel[return_rank] >= variant["strengthRank"])
        & (panel[oi_rank] >= variant["oiRank"])
        & (panel[flow_column] >= variant["flowMinimum"])
        & (panel.close_location >= 0.52)
    )
    short_mask = (
        shared
        & (panel[return_rank] <= 1 - variant["strengthRank"])
        & (panel[oi_rank] >= variant["oiRank"])
        & (panel[flow_column] <= -variant["flowMinimum"])
        & (panel.close_location <= 0.48)
    )
    if variant["requireBtcAlignment"]:
        long_mask &= panel[btc_column] > -0.001
        short_mask &= panel[btc_column] < 0.001

    output = []
    for mask, side in [(long_mask, 1), (short_mask, -1)]:
        events = panel[mask].copy()
        if events.empty:
            continue
        events["side"] = side
        events["entry"] = events.bar + 1
        events["family"] = f"relative-momentum-{horizon}"
        output.append(events)
    if not output:
        return panel.iloc[0:0].copy()

    events = pd.concat(output, ignore_index=True).sort_values(["symbol", "side", "bar"])
    gap = events.groupby(["symbol", "side"]).bar.diff()
    events = events[gap.isna() | (gap > 3)].copy()
    return events.sort_values(["time", "symbol"]).reset_index(drop=True)


def arrays(frame):
    return {
        "open": frame.open.to_numpy(dtype=float),
        "high": frame.high.to_numpy(dtype=float),
        "low": frame.low.to_numpy(dtype=float),
        "close": frame.close.to_numpy(dtype=float),
        "time": frame.time.to_numpy(),
    }


def simulate_trade(frame_arrays, event, config, fee, slippage, delay=0):
    index = int(event.entry) + delay
    size = len(frame_arrays["open"])
    if index >= size - 1:
        return None

    side = int(event.side)
    raw_entry = float(frame_arrays["open"][index])
    atr = float(event.atr)
    entry = raw_entry * (1 + side * slippage)
    cash_risk = atr * config.stop_atr
    if not (raw_entry > 0 and atr > 0 and cash_risk < entry):
        return None

    stop = entry - side * cash_risk
    protect_trigger = entry + side * cash_risk * config.protect_at_r
    protected_stop = entry + side * cash_risk * config.protected_r
    partial_target = entry + side * cash_risk * config.partial_at_r
    runner_target = entry + side * cash_risk * config.runner_r
    remaining = 1.0
    pnl = -entry * fee
    partial_done = False
    protection_done = False
    final_index = min(size - 1, index + config.hold_bars)
    exit_index = final_index

    for candle_index in range(index, final_index + 1):
        high = float(frame_arrays["high"][candle_index])
        low = float(frame_arrays["low"][candle_index])
        close = float(frame_arrays["close"][candle_index])

        stop_hit = low <= stop if side > 0 else high >= stop
        if stop_hit:
            exit_price = stop * (1 - side * slippage)
            pnl += side * (exit_price - entry) * remaining - exit_price * remaining * fee
            exit_index = candle_index
            break

        protect_hit = high >= protect_trigger if side > 0 else low <= protect_trigger
        if protect_hit and not protection_done:
            stop = protected_stop
            protection_done = True

        partial_hit = high >= partial_target if side > 0 else low <= partial_target
        if config.partial_share > 0 and partial_hit and not partial_done:
            exit_price = partial_target * (1 - side * slippage)
            pnl += (
                side * (exit_price - entry) * config.partial_share
                - exit_price * config.partial_share * fee
            )
            remaining -= config.partial_share
            partial_done = True

        runner_hit = high >= runner_target if side > 0 else low <= runner_target
        if runner_hit:
            exit_price = runner_target * (1 - side * slippage)
            pnl += side * (exit_price - entry) * remaining - exit_price * remaining * fee
            exit_index = candle_index
            break

        if candle_index == final_index:
            exit_price = close * (1 - side * slippage)
            pnl += side * (exit_price - entry) * remaining - exit_price * remaining * fee

    return {
        "net_r": pnl / cash_risk,
        "win": int(pnl > 0),
        "exit": exit_index,
        "exit_time": frame_arrays["time"][exit_index],
    }


def simulate(events, frames, frame_arrays, config, fee, slippage, delay=0):
    rows = []
    for row_index, event in events.iterrows():
        result = simulate_trade(frame_arrays[event.symbol], event, config, fee, slippage, delay)
        if result is not None:
            rows.append({"row_index": row_index, **result})
    if not rows:
        return events.iloc[0:0].copy()
    return events.join(pd.DataFrame(rows).set_index("row_index"), how="inner")


def remove_overlap(trades):
    if trades.empty:
        return trades
    last_exit = {}
    keep = []
    for index, row in trades.sort_values(["time", "symbol"]).iterrows():
        if int(row.entry) <= last_exit.get(row.symbol, -1):
            continue
        keep.append(index)
        last_exit[row.symbol] = int(row.exit)
    return trades.loc[keep].sort_values("time")


def metrics(trades):
    if trades.empty:
        return {
            "trades": 0,
            "winRate": 0.0,
            "profitFactor": 0.0,
            "averageR": 0.0,
            "totalR": 0.0,
            "maxDrawdownR": 0.0,
            "positiveSymbols": 0,
            "symbols": 0,
        }
    values = trades.net_r.astype(float)
    gross_profit = values[values > 0].sum()
    gross_loss = -values[values < 0].sum()
    curve = values.cumsum()
    by_symbol = trades.groupby("symbol").net_r.sum()
    return {
        "trades": int(len(trades)),
        "wins": int((values > 0).sum()),
        "winRate": float((values > 0).mean()),
        "profitFactor": float(gross_profit / gross_loss) if gross_loss > EPS else float("inf"),
        "averageR": float(values.mean()),
        "medianR": float(values.median()),
        "totalR": float(values.sum()),
        "maxDrawdownR": float((curve.cummax() - curve).max()),
        "positiveSymbols": int((by_symbol > 0).sum()),
        "symbols": int(len(by_symbol)),
        "bySymbol": {key: float(value) for key, value in by_symbol.items()},
    }


def validation_score(value):
    profit_factor = min(value["profitFactor"], 8) if math.isfinite(value["profitFactor"]) else 8
    return (
        value["averageR"] * 8
        + math.log1p(profit_factor)
        + value["winRate"] * 2
        + math.log1p(value["trades"]) * 0.15
        + value["positiveSymbols"] * 0.15
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
    development = symbols(options.development_symbols)
    unseen = symbols(options.unseen_symbols)
    all_symbols = list(dict.fromkeys([*development, *unseen]))
    root = Path(options.data_dir)
    start = pd.Timestamp(options.start, tz="UTC")
    train_end = pd.Timestamp(options.train_end, tz="UTC")
    validation_end = pd.Timestamp(options.validation_end, tz="UTC")
    holdout_end = pd.Timestamp(options.holdout_end, tz="UTC")
    embargo = pd.Timedelta("1d")

    frames = {}
    failures = {}
    for symbol in all_symbols:
        try:
            frames[symbol] = base.feat(base.load(root, symbol, start, holdout_end))
        except Exception as error:
            failures[symbol] = str(error)
    development = [symbol for symbol in development if symbol in frames]
    unseen = [symbol for symbol in unseen if symbol in frames]
    if "BTCUSDT" not in frames or len(development) < 6 or len(unseen) < 4:
        raise RuntimeError(
            f"insufficient data: development={development}, unseen={unseen}, failures={failures}"
        )

    panel = add_panel_features(frames)
    frames = {
        symbol: group.sort_values("time").reset_index(drop=True)
        for symbol, group in panel.groupby("symbol")
    }
    for frame in frames.values():
        frame["bar"] = np.arange(len(frame))
    frame_arrays = {symbol: arrays(frame) for symbol, frame in frames.items()}

    fee = 0.0005
    slippage = 0.0002
    variants = build_variant_grid()
    screened = []

    for variant_index, variant in enumerate(variants, start=1):
        events = build_events(pd.concat(frames.values(), ignore_index=True), variant)
        if events.empty:
            continue
        for exit_config in EXITS:
            trades = simulate(events, frames, frame_arrays, exit_config, fee, slippage)
            train = remove_overlap(
                trades[
                    trades.symbol.isin(development)
                    & (trades.time < train_end - embargo)
                    & (trades.exit_time < train_end)
                ]
            )
            validation = remove_overlap(
                trades[
                    trades.symbol.isin(development)
                    & (trades.time >= train_end + embargo)
                    & (trades.time < validation_end - embargo)
                    & (trades.exit_time < validation_end)
                ]
            )
            train_metrics = metrics(train)
            validation_metrics = metrics(validation)
            if train_metrics["trades"] < 150 or validation_metrics["trades"] < 35:
                continue
            stable = (
                train_metrics["profitFactor"] > 1
                and train_metrics["averageR"] > 0
                and validation_metrics["profitFactor"] > 1
                and validation_metrics["averageR"] > 0
                and validation_metrics["positiveSymbols"] >= 4
            )
            screened.append(
                {
                    "variant": variant,
                    "exit": exit_config,
                    "events": events,
                    "train": train_metrics,
                    "validation": validation_metrics,
                    "stable": stable,
                    "score": validation_score(validation_metrics)
                    + min(validation_score(train_metrics), 5),
                }
            )
        if variant_index % 50 == 0:
            print(
                json.dumps(
                    {"variantsProcessed": variant_index, "candidates": len(screened)},
                    ensure_ascii=False,
                ),
                file=sys.stderr,
                flush=True,
            )

    if not screened:
        raise RuntimeError("no relative-momentum candidates reached the sample-size gate")
    stable = sorted(
        [candidate for candidate in screened if candidate["stable"]],
        key=lambda candidate: candidate["score"],
        reverse=True,
    )
    selected = (stable if stable else sorted(screened, key=lambda candidate: candidate["score"], reverse=True))[:20]

    results = []
    for candidate in selected:
        exit_config = candidate["exit"]
        events = candidate["events"]
        base_trades = simulate(events, frames, frame_arrays, exit_config, fee, slippage)
        holdout = remove_overlap(
            base_trades[
                base_trades.symbol.isin(unseen)
                & (base_trades.time >= validation_end + embargo)
                & (base_trades.time < holdout_end)
            ]
        )
        selected_keys = holdout[["symbol", "time", "side"]].drop_duplicates()
        selected_events = events.merge(selected_keys, on=["symbol", "time", "side"], how="inner")
        doubled = remove_overlap(
            simulate(selected_events, frames, frame_arrays, exit_config, fee * 2, slippage * 2)
        )
        delayed = remove_overlap(
            simulate(selected_events, frames, frame_arrays, exit_config, fee, slippage, delay=1)
        )
        holdout_metrics = metrics(holdout)
        doubled_metrics = metrics(doubled)
        delayed_metrics = metrics(delayed)
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
                "id": f"relative-momentum::{exit_config.name}::{json.dumps(candidate['variant'], sort_keys=True)}",
                "parameters": candidate["variant"],
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
        key=lambda result: (
            result["strictPass"],
            result["unseenUniverseHoldout"]["averageR"],
            result["unseenUniverseHoldout"]["profitFactor"],
            result["unseenUniverseHoldout"]["trades"],
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
            "variants": len(variants) * len(EXITS),
            "stableBeforeHoldout": len(stable),
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
            "warning": "The unseen-symbol holdout was not used to select variants in this run.",
        },
        "strictCandidatesFound": sum(result["strictPass"] for result in results),
        "top": results[:10],
    }
    Path(options.output).write_text(
        json.dumps(clean(report), ensure_ascii=False, indent=2), encoding="utf-8"
    )
    print(json.dumps(clean(report), ensure_ascii=False, indent=2))


if __name__ == "__main__":
    main()
