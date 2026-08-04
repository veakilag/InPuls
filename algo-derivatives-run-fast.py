from __future__ import annotations

import importlib.util
from pathlib import Path

import numpy as np

SCRIPT = Path(__file__).with_name("algo-derivatives-research.py")
spec = importlib.util.spec_from_file_location("inpuls_derivatives_research", SCRIPT)
research = importlib.util.module_from_spec(spec)
assert spec.loader is not None
spec.loader.exec_module(research)

_frame_cache: dict[int, dict[str, np.ndarray]] = {}


def frame_arrays(frame):
    key = id(frame)
    cached = _frame_cache.get(key)
    if cached is None:
        cached = {
            "open": frame["open"].to_numpy(dtype=float),
            "high": frame["high"].to_numpy(dtype=float),
            "low": frame["low"].to_numpy(dtype=float),
            "close": frame["close"].to_numpy(dtype=float),
            "time": frame["time"].to_numpy(),
        }
        _frame_cache[key] = cached
    return cached


def fast_sim_one(frame, event, exit_config, fee, slippage, delay=0):
    arrays = frame_arrays(frame)
    index = int(event.entry) + delay
    size = len(arrays["open"])
    if index >= size - 1:
        return None

    side = int(event.side)
    raw_entry = float(arrays["open"][index])
    atr = float(event.atr)
    entry = raw_entry * (1 + slippage * side)
    risk = atr * exit_config.stop
    if not (raw_entry > 0 and atr > 0 and risk < entry):
        return None

    stop = entry - side * risk
    partial_target = entry + side * risk * exit_config.partial
    runner_target = entry + side * risk * exit_config.runner
    breakeven_trigger = entry + side * risk * exit_config.be
    remaining = 1.0
    pnl = -entry * fee
    partial_done = False
    last_index = index
    final_index = min(size - 1, index + exit_config.hold)

    for candle_index in range(index, final_index + 1):
        high = float(arrays["high"][candle_index])
        low = float(arrays["low"][candle_index])
        close = float(arrays["close"][candle_index])
        last_index = candle_index

        stop_hit = low <= stop if side > 0 else high >= stop
        if stop_hit:
            exit_price = stop * (1 - slippage * side)
            pnl += side * (exit_price - entry) * remaining - exit_price * remaining * fee
            break

        partial_hit = high >= partial_target if side > 0 else low <= partial_target
        if not partial_done and partial_hit:
            exit_price = partial_target * (1 - slippage * side)
            pnl += side * (exit_price - entry) * exit_config.share - exit_price * exit_config.share * fee
            remaining -= exit_config.share
            partial_done = True
            breakeven_hit = high >= breakeven_trigger if side > 0 else low <= breakeven_trigger
            if breakeven_hit:
                stop = entry
            continue

        runner_hit = high >= runner_target if side > 0 else low <= runner_target
        if partial_done and runner_hit:
            exit_price = runner_target * (1 - slippage * side)
            pnl += side * (exit_price - entry) * remaining - exit_price * remaining * fee
            break

        breakeven_hit = high >= breakeven_trigger if side > 0 else low <= breakeven_trigger
        if partial_done and breakeven_hit:
            stop = max(stop, entry) if side > 0 else min(stop, entry)

        if candle_index == final_index:
            exit_price = close * (1 - slippage * side)
            pnl += side * (exit_price - entry) * remaining - exit_price * remaining * fee

    return {
        "net_r": pnl / risk,
        "win": int(pnl > 0),
        "exit": last_index,
        "exit_time": arrays["time"][last_index],
    }


research.sim_one = fast_sim_one
research.main()
