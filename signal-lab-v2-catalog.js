export const SIGNAL_LAB_V2_CATALOG_VERSION = "signal-lab-pattern-catalog-v2";

export const PATTERN_STATES = Object.freeze([
  "hypothesis",
  "candidate",
  "triggered",
  "confirmed",
  "weakening",
  "invalidated",
  "completed",
]);

export const PATTERN_FAMILIES = Object.freeze({
  CONTINUATION: "continuation",
  REVERSAL: "reversal",
  LIQUIDITY: "liquidity",
  SPECIAL: "special",
});

export const PATTERN_STRUCTURES = Object.freeze({
  CASCADE: "cascade",
  LEVEL: "level",
  RANGE: "range",
  BASE: "base",
  IMPULSE: "impulse",
  COMPRESSION: "compression",
  LIQUIDITY: "liquidity",
});

export const PATTERN_ACTIONS = Object.freeze({
  APPROACH: "approach",
  RETEST: "retest",
  SWEEP: "sweep",
  BREAKOUT: "breakout",
  RECLAIM: "reclaim",
  REJECTION: "rejection",
  ABSORPTION: "absorption",
  EXHAUSTION: "exhaustion",
  DISPLACEMENT: "displacement",
});

export const PATTERN_CONFIRMATIONS = Object.freeze({
  TRADE_ACCELERATION: "trade_acceleration",
  AGGRESSOR_DOMINANCE: "aggressor_dominance",
  VOLUME_EXPANSION: "volume_expansion",
  PRICE_ACCEPTANCE: "price_acceptance",
  PRICE_REJECTION: "price_rejection",
  OI_EXPANSION: "oi_expansion",
  OI_CONTRACTION: "oi_contraction",
  LIQUIDATION_BURST: "liquidation_burst",
  BOOK_HOLD: "book_hold",
  BOOK_REPLENISHMENT: "book_replenishment",
  BOOK_REMOVAL: "book_removal",
  CROSS_EXCHANGE_LEAD: "cross_exchange_lead",
});

const freezeDefinition = (definition) => Object.freeze({
  ...definition,
  structures: Object.freeze([...(definition.structures ?? [])]),
  actions: Object.freeze([...(definition.actions ?? [])]),
  confirmations: Object.freeze([...(definition.confirmations ?? [])]),
  aliases: Object.freeze([...(definition.aliases ?? [])]),
  requiredFacts: Object.freeze([...(definition.requiredFacts ?? [])]),
  invalidationFacts: Object.freeze([...(definition.invalidationFacts ?? [])]),
  limitations: Object.freeze([...(definition.limitations ?? [])]),
});

export const PATTERN_DEFINITIONS = Object.freeze({
  cascade_breakout: freezeDefinition({
    id: "cascade_breakout",
    label: "Пробой каскада",
    family: PATTERN_FAMILIES.CONTINUATION,
    structures: [PATTERN_STRUCTURES.CASCADE],
    actions: [PATTERN_ACTIONS.BREAKOUT],
    confirmations: [
      PATTERN_CONFIRMATIONS.TRADE_ACCELERATION,
      PATTERN_CONFIRMATIONS.PRICE_ACCEPTANCE,
    ],
    aliases: ["cascade", "каскад", "пробой каскадов"],
    requiredFacts: [
      "three_or_more_ordered_extrema",
      "construction_width_percent",
      "nearest_step_broken",
    ],
    invalidationFacts: ["returned_behind_reference_extreme"],
    limitations: [
      "team_examples-are-training-hypotheses",
      "flow-confirmation-may-be-unavailable",
    ],
  }),
  level_breakout: freezeDefinition({
    id: "level_breakout",
    label: "Пробой уровня",
    family: PATTERN_FAMILIES.CONTINUATION,
    structures: [PATTERN_STRUCTURES.LEVEL],
    actions: [PATTERN_ACTIONS.RETEST, PATTERN_ACTIONS.BREAKOUT],
    confirmations: [
      PATTERN_CONFIRMATIONS.TRADE_ACCELERATION,
      PATTERN_CONFIRMATIONS.PRICE_ACCEPTANCE,
    ],
    aliases: [
      "breakout_resistance",
      "breakout_support",
      "breakout",
      "пробой ус",
      "пробой уп",
      "пробой после тестов",
    ],
    requiredFacts: ["two_or_more_distinct_touches", "level_broken"],
    invalidationFacts: ["fast_return_behind_level"],
    limitations: ["touch-independence-needs-validation"],
  }),
  false_breakout: freezeDefinition({
    id: "false_breakout",
    label: "Ложный пробой",
    family: PATTERN_FAMILIES.REVERSAL,
    structures: [PATTERN_STRUCTURES.LEVEL, PATTERN_STRUCTURES.RANGE],
    actions: [PATTERN_ACTIONS.SWEEP, PATTERN_ACTIONS.RECLAIM],
    confirmations: [
      PATTERN_CONFIRMATIONS.PRICE_REJECTION,
      PATTERN_CONFIRMATIONS.TRADE_ACCELERATION,
    ],
    aliases: ["снятие", "возврат после снятия", "ловушка"],
    requiredFacts: ["visible_level", "exit_beyond_level", "return_inside"],
    invalidationFacts: ["accepted_outside_level"],
    limitations: ["trapped-participants-cannot-be-asserted-without-data"],
  }),
  knife_reclaim: freezeDefinition({
    id: "knife_reclaim",
    label: "Нож с быстрым выкупом",
    family: PATTERN_FAMILIES.REVERSAL,
    structures: [PATTERN_STRUCTURES.IMPULSE],
    actions: [PATTERN_ACTIONS.RECLAIM],
    confirmations: [PATTERN_CONFIRMATIONS.PRICE_REJECTION],
    aliases: ["knife", "нож"],
    requiredFacts: ["down_impulse", "fast_recovery"],
    invalidationFacts: ["new_low_without_fast_reclaim"],
    limitations: ["recovery-window-needs-validation"],
  }),
  sharpening_rejection: freezeDefinition({
    id: "sharpening_rejection",
    label: "Заточка с быстрым сливом",
    family: PATTERN_FAMILIES.REVERSAL,
    structures: [PATTERN_STRUCTURES.IMPULSE],
    actions: [PATTERN_ACTIONS.REJECTION],
    confirmations: [PATTERN_CONFIRMATIONS.PRICE_REJECTION],
    aliases: ["sharpening", "заточка"],
    requiredFacts: ["up_impulse", "fast_selloff"],
    invalidationFacts: ["new_high_without_fast_rejection"],
    limitations: [
      "team-term-may-also-describe-execution-method",
      "rejection-window-needs-validation",
    ],
  }),
  compression_breakout: freezeDefinition({
    id: "compression_breakout",
    label: "Выход из сжатия",
    family: PATTERN_FAMILIES.CONTINUATION,
    structures: [PATTERN_STRUCTURES.COMPRESSION],
    actions: [PATTERN_ACTIONS.BREAKOUT],
    confirmations: [
      PATTERN_CONFIRMATIONS.VOLUME_EXPANSION,
      PATTERN_CONFIRMATIONS.TRADE_ACCELERATION,
    ],
    aliases: ["compression", "сжатие", "поджатие"],
    requiredFacts: ["range_contraction", "breakout"],
    invalidationFacts: ["return_to_pre_breakout_range"],
    limitations: ["compression-formula-not-final"],
  }),
  liquidity_hold: freezeDefinition({
    id: "liquidity_hold",
    label: "Удержание ликвидности",
    family: PATTERN_FAMILIES.LIQUIDITY,
    structures: [PATTERN_STRUCTURES.LIQUIDITY, PATTERN_STRUCTURES.BASE],
    actions: [PATTERN_ACTIONS.ABSORPTION],
    confirmations: [
      PATTERN_CONFIRMATIONS.BOOK_HOLD,
      PATTERN_CONFIRMATIONS.BOOK_REPLENISHMENT,
    ],
    aliases: [
      "size_supporter",
      "участник",
      "стакан основания",
      "удержание",
      "подставляш",
    ],
    requiredFacts: ["liquidity_observed", "interaction_observed", "reaction_measured"],
    invalidationFacts: ["liquidity_removed_or_consumed_without_hold"],
    limitations: [
      "large-order-is-not-proof-of-large-player",
      "spoofing-must-not-be-asserted",
    ],
  }),
  liquidity_rearrangement: freezeDefinition({
    id: "liquidity_rearrangement",
    label: "Переставление ликвидности",
    family: PATTERN_FAMILIES.LIQUIDITY,
    structures: [PATTERN_STRUCTURES.LIQUIDITY],
    actions: [PATTERN_ACTIONS.DISPLACEMENT],
    confirmations: [PATTERN_CONFIRMATIONS.BOOK_REMOVAL],
    aliases: ["rearranger", "переставляш", "перестановка сайза"],
    requiredFacts: ["liquidity_observed", "price_level_changed", "age_measured"],
    invalidationFacts: ["movement_was_display_aggregation_only"],
    limitations: [
      "order-movement-is-not-proof-of-intent",
      "display-step-must-not-change-event-identity",
    ],
  }),
  liquidation_cascade: freezeDefinition({
    id: "liquidation_cascade",
    label: "Каскад ликвидаций",
    family: PATTERN_FAMILIES.SPECIAL,
    structures: [PATTERN_STRUCTURES.IMPULSE],
    actions: [PATTERN_ACTIONS.DISPLACEMENT],
    confirmations: [PATTERN_CONFIRMATIONS.LIQUIDATION_BURST],
    aliases: ["ликвидации", "ликвидационный каскад"],
    requiredFacts: ["liquidation_notional", "price_displacement"],
    invalidationFacts: ["flow_stopped_without_continuation"],
    limitations: ["liquidation-feed-coverage-must-be-shown"],
  }),
});

const normalizeAlias = (value) => String(value ?? "")
  .trim()
  .toLocaleLowerCase("ru-RU")
  .replace(/ё/g, "е")
  .replace(/[._/\\-]+/g, " ")
  .replace(/\s+/g, " ");

const aliasIndex = new Map();
for (const definition of Object.values(PATTERN_DEFINITIONS)) {
  aliasIndex.set(normalizeAlias(definition.id), definition.id);
  aliasIndex.set(normalizeAlias(definition.label), definition.id);
  for (const alias of definition.aliases) aliasIndex.set(normalizeAlias(alias), definition.id);
}

export function normalizePatternId(value) {
  return aliasIndex.get(normalizeAlias(value)) ?? null;
}

export function getPatternDefinition(value) {
  const id = normalizePatternId(value);
  return id ? PATTERN_DEFINITIONS[id] : null;
}

const finite = (value) => {
  const number = Number(value);
  return Number.isFinite(number) ? number : null;
};

const percent = (value, digits = 2) => {
  const number = finite(value);
  return number === null ? null : `${number.toFixed(digits)}%`;
};

const compactUsd = (value) => {
  const number = finite(value);
  if (number === null) return null;
  return `$${new Intl.NumberFormat("ru-RU", {
    notation: "compact",
    maximumFractionDigits: 1,
  }).format(number)}`;
};

function cascadeFacts(event, facts) {
  const evidence = event?.detectorEvidence ?? {};
  const extrema = Array.isArray(evidence.extrema) ? evidence.extrema : [];
  const count = finite(evidence.extremaCount) ?? (extrema.length || null);
  const width = percent(evidence.zoneWidthPercent);
  const breakout = percent(evidence.breakoutDistancePercent);
  if (count !== null) facts.push(`${Math.round(count)} последовательных экстремума`);
  if (width) facts.push(`диапазон конструкции ${width}`);
  if (breakout) facts.push(`выход за ближайшую ступень ${breakout}`);
}

function levelFacts(event, facts) {
  const evidence = event?.detectorEvidence ?? {};
  const touches = finite(evidence.touchCount ?? evidence.touches);
  const level = finite(evidence.level ?? evidence.referencePrice);
  const breakout = percent(evidence.breakoutDistancePercent);
  if (touches !== null) facts.push(`${Math.round(touches)} подтверждённых касания уровня`);
  if (level !== null) facts.push(`уровень ${level}`);
  if (breakout) facts.push(`выход за уровень ${breakout}`);
}

function reversalFacts(event, facts) {
  const evidence = event?.detectorEvidence ?? {};
  const impulse = percent(evidence.impulsePercent ?? evidence.impulse);
  const recovery = percent(evidence.recoveryPercent ?? evidence.recovery);
  const durationMs = finite(evidence.recoveryDurationMs);
  if (impulse) facts.push(`первичный вынос ${impulse}`);
  if (recovery) facts.push(`обратное движение ${recovery}`);
  if (durationMs !== null) facts.push(`реакция за ${(durationMs / 1_000).toFixed(1)}с`);
}

function liquidityFacts(event, facts) {
  const evidence = event?.detectorEvidence ?? {};
  const quote = compactUsd(evidence.quoteUsd);
  const multiple = finite(evidence.sizeMultiple);
  const touches = finite(evidence.touchCount);
  if (quote) facts.push(`наблюдаемая ликвидность около ${quote}`);
  if (multiple !== null) facts.push(`размер ${multiple.toFixed(1)}× к локальной медиане`);
  if (touches !== null) facts.push(`${Math.round(touches)} взаимодействия с уровнем`);
  if (evidence.replenished === true) facts.push("объём пополнялся после исполнения");
  if (evidence.removed === true) facts.push("объём был снят");
}

export function buildEvidenceExplanation(event = {}) {
  const pattern = getPatternDefinition(event.patternId ?? event.signalType);
  const facts = [];
  const id = pattern?.id;
  if (id === "cascade_breakout") cascadeFacts(event, facts);
  else if (id === "level_breakout" || id === "false_breakout") levelFacts(event, facts);
  else if (id === "knife_reclaim" || id === "sharpening_rejection") reversalFacts(event, facts);
  else if (id === "liquidity_hold" || id === "liquidity_rearrangement") liquidityFacts(event, facts);
  else if (id === "liquidation_cascade") {
    const quote = compactUsd(event?.detectorEvidence?.liquidationQuoteUsd
      ?? event?.context?.liquidations?.totalQuote);
    const move = percent(event?.detectorEvidence?.movePercent
      ?? event?.context?.market?.change15s);
    if (quote) facts.push(`ликвидации ${quote}`);
    if (move) facts.push(`смещение цены ${move}`);
  }

  const dataState = String(event?.quality?.state ?? event?.context?.quality?.state ?? "unknown");
  const limitations = [
    ...(pattern?.limitations ?? []),
    ...(Array.isArray(event?.quality?.limitations) ? event.quality.limitations : []),
  ];

  return Object.freeze({
    patternId: pattern?.id ?? null,
    label: pattern?.label ?? String(event?.signalType ?? "Неизвестный кандидат"),
    state: PATTERN_STATES.includes(event?.patternState) ? event.patternState : "candidate",
    facts: Object.freeze(facts.slice(0, 5)),
    dataState,
    limitations: Object.freeze([...new Set(limitations)]),
    interpretation: "facts-only-no-trade-command",
  });
}

export function validatePatternCandidate(candidate = {}) {
  const errors = [];
  const patternId = normalizePatternId(candidate.patternId ?? candidate.signalType);
  if (!patternId) errors.push("unknown-pattern");
  if (!PATTERN_STATES.includes(candidate.patternState ?? "candidate")) errors.push("unknown-state");
  if (!String(candidate.symbol ?? "").trim()) errors.push("symbol-required");
  if (!Number.isFinite(Number(candidate.triggeredAt))) errors.push("triggeredAt-required");
  if (!["up", "down", "neutral"].includes(candidate.direction)) errors.push("direction-required");
  return Object.freeze({
    valid: errors.length === 0,
    patternId,
    errors: Object.freeze(errors),
  });
}
