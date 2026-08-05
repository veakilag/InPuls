from pathlib import Path


def replace_once(path, old, new):
    target = Path(path)
    text = target.read_text(encoding="utf-8")
    if old not in text:
        raise RuntimeError(f"missing pattern in {path}: {old[:180]!r}")
    target.write_text(text.replace(old, new, 1), encoding="utf-8")


# A crossed first level can make the original setup disappear from the ahead-of-price map.
# Apply all already observed level events first; cancel only a setup that remains untouched.
replace_once(
    "signal-lab-v4-cascades.js",
    '''    for (const event of this.events.values()) {
      if (terminalState(event.state) || event.state !== CASCADE_STATES.SETUP || seen.has(event.id)) continue;
      if (timestamp - event.lastSetupSeenAt > this.config.setupDisappearGraceMs) {
        this.#fail(event, timestamp, "SETUP_CANCELLED");
      }
    }

    this.#applyLevelEvents(levelMap, timestamp);
    this.ingestPrice(price, timestamp, { dataQuality: this.dataQuality, atr: this.atr, source: "SYNC" });''',
    '''    this.#applyLevelEvents(levelMap, timestamp);

    for (const event of this.events.values()) {
      if (terminalState(event.state) || event.state !== CASCADE_STATES.SETUP || seen.has(event.id)) continue;
      if (timestamp - event.lastSetupSeenAt > this.config.setupDisappearGraceMs) {
        this.#fail(event, timestamp, "SETUP_CANCELLED");
      }
    }

    this.ingestPrice(price, timestamp, { dataQuality: this.dataQuality, atr: this.atr, source: "SYNC" });''',
)

# Preserve truthful legacy contracts while explaining the new V4 sequence.
replace_once(
    "owner-signal-lab-v3.html",
    '''          Legacy-кандидаты продолжают использовать фильтр оборота $100 млн и NATR5 1%, чтобы не потерять существующую выборку.
          Каскад V4 собирается отдельным детерминированным контуром от $25 млн оборота и не дальше 3% до первой ступени.
          Система заранее фиксирует SETUP, затем отдельно TRIGGERED, CONFIRMED, EXTENDED, PARTIAL и FAILED.
          Стопы за экстремумами остаются гипотезой микроструктуры: интерфейс показывает только уровни, проходы, качество данных и фактический результат.''',
    '''          Legacy-кандидаты продолжают использовать фильтр оборота выше $100 млн и NATR5 выше 1%, чтобы не потерять существующую выборку.
          Каскад V4 собирается отдельным детерминированным контуром от $25 млн оборота и не дальше 3% до первой ступени.
          Основа — активные high/low и зоны ×N; перед каскадом отдельно проверяются проход, принятие, ретест и прокол с возвратом.
          Система заранее фиксирует SETUP, затем отдельно TRIGGERED, CONFIRMED, EXTENDED, PARTIAL и FAILED.
          Стопы за экстремумами остаются гипотезой микроструктуры: интерфейс показывает только уровни, проходы, качество данных и фактический результат.''',
)

# Stage 3 intentionally changes the owner runtime cache contract inherited from Stage 2.
replace_once(
    "test/signal-lab-v4-levels-integration.test.js",
    '  assert.match(page, /signal-lab-v4-stage2/);',
    '  assert.match(page, /signal-lab-v4-stage3/);',
)

# This test validates outcome math rather than the independent full-return invalidation rule.
replace_once(
    "test/signal-lab-v4-cascades.test.js",
    '  const subject = engine({ maxCascadeDurationMsByTimeframe: { "1m": 60_000 } });',
    '  const subject = engine({\n    maxCascadeDurationMsByTimeframe: { "1m": 60_000 },\n    maxInterLevelPullbackPct: 10,\n    fullReturnTolerancePct: 1,\n  });',
)
