from pathlib import Path

path = Path('test/signal-lab-v7-adaptive-hierarchy.test.js')
text = path.read_text()

old = '''test("junior confluence with inherited senior price survives adaptive child filtering", () => {
  const oneDayAt = END - 2 * 24 * 60 * 60_000;
  const juniorAt = END - 5 * MINUTE;
  const senior = extreme({
    id: "senior",
    side: "HIGH",
    price: 100,
    extremeAt: oneDayAt,
    swingAmplitudePct: 5,
    reversalThresholdPct: 1,
  });
  const tinyJunior = extreme({
    id: "tiny-junior",
    side: "HIGH",
    price: 100.01,
    extremeAt: juniorAt,
    swingAmplitudePct: 0.05,
    reversalThresholdPct: 0.1,
  });

  const snapshotsByTimeframe = {
    "1d": { active: [senior], history: [senior] },
    "4h": { active: [], history: [] },
    "1h": { active: [], history: [] },
    "15m": { active: [], history: [] },
    "5m": { active: [], history: [] },
    "1m": { active: [tinyJunior], history: [tinyJunior] },
  };
  const candlesByTimeframe = {
    "1d": candles({ start: oneDayAt - 20 * 24 * 60 * 60_000, step: 24 * 60 * 60_000, halfRange: 1 }),
    "4h": [],
    "1h": [],
    "15m": [],
    "5m": [],
    "1m": candles({ halfRange: 5 }),
  };

  const levels = buildHierarchicalStructuralLevelMap({
    snapshotsByTimeframe,
    candlesByTimeframe,
    viewTimeframe: "1m",
    endAt: END,
    tickSize: 0.01,
  });

  assert.equal(levels.length, 1);
  assert.equal(levels[0].sourceTimeframe, "1d");
  assert.deepEqual(levels[0].sources, ["1d", "1m"]);
  assert.deepEqual(levels[0].memberIds, ["senior", "tiny-junior"]);
});
'''

new = '''test("5m junior confluence with inherited senior price survives adaptive child filtering on a 1m chart", () => {
  const oneDayAt = END - 2 * 24 * 60 * 60_000;
  const juniorAt = END - 5 * MINUTE;
  const senior = extreme({
    id: "senior",
    side: "HIGH",
    price: 100,
    extremeAt: oneDayAt,
    swingAmplitudePct: 5,
    reversalThresholdPct: 1,
  });
  const tinyJunior = extreme({
    id: "tiny-junior",
    side: "HIGH",
    price: 100.01,
    extremeAt: juniorAt,
    swingAmplitudePct: 0.05,
    reversalThresholdPct: 0.1,
  });

  const snapshotsByTimeframe = {
    "1d": { active: [senior], history: [senior] },
    "4h": { active: [], history: [] },
    "1h": { active: [], history: [] },
    "15m": { active: [], history: [] },
    "5m": { active: [tinyJunior], history: [tinyJunior] },
    // 1m is chart-only under the persistent structural floor contract.
    "1m": { active: [], history: [] },
  };
  const candlesByTimeframe = {
    "1d": candles({ start: oneDayAt - 20 * 24 * 60 * 60_000, step: 24 * 60 * 60_000, halfRange: 1 }),
    "4h": [],
    "1h": [],
    "15m": [],
    "5m": candles({ start: END - 100 * MINUTE, count: 20, step: 5 * MINUTE, halfRange: 5 }),
    "1m": [],
  };

  const levels = buildHierarchicalStructuralLevelMap({
    snapshotsByTimeframe,
    candlesByTimeframe,
    viewTimeframe: "1m",
    endAt: END,
    tickSize: 0.01,
  });

  assert.equal(levels.length, 1);
  assert.equal(levels[0].sourceTimeframe, "1d");
  assert.deepEqual(levels[0].sources, ["1d", "5m"]);
  assert.deepEqual(levels[0].memberIds, ["senior", "tiny-junior"]);
});
'''

if old not in text:
    raise SystemExit('adaptive hierarchy junior-confluence contract not found')
path.write_text(text.replace(old, new, 1))
