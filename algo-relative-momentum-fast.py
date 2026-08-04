from __future__ import annotations

import importlib.util
import sys
from pathlib import Path

SCRIPT = Path(__file__).with_name("algo-relative-momentum-deep-dive.py")
spec = importlib.util.spec_from_file_location("inpuls_relative_momentum", SCRIPT)
research = importlib.util.module_from_spec(spec)
assert spec.loader is not None
sys.modules[spec.name] = research
spec.loader.exec_module(research)


def focused_variant_grid():
    variants = []
    for horizon in [12, 48]:
        for strength_rank in [0.80, 0.90]:
            for oi_rank in [0.70, 0.85]:
                for flow_minimum in [0.03, 0.06]:
                    for volume_rank in [0.50, 0.70]:
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


research.build_variant_grid = focused_variant_grid
research.main()
