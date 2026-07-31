import { normalizePatternId, PATTERN_STATES } from "./signal-lab-v2-catalog.js";

export const SIGNAL_LAB_V2_EPISODE_VERSION = 1;

const TERMINAL_STATES = new Set(["invalidated", "completed"]);

const ALLOWED_TRANSITIONS = Object.freeze({
  hypothesis: new Set(["candidate", "invalidated"]),
  candidate: new Set(["triggered", "confirmed", "invalidated"]),
  triggered: new Set(["confirmed", "weakening", "invalidated", "completed"]),
  confirmed: new Set(["weakening", "invalidated", "completed"]),
  weakening: new Set(["confirmed", "invalidated", "completed"]),
  invalidated: new Set(),
  completed: new Set(),
});

const finiteOrNull = (value) => {
  const number = Number(value);
  return Number.isFinite(number) ? number : null;
};

const percentDistance = (left, right) => {
  const a = finiteOrNull(left);
  const b = finiteOrNull(right);
  if (a === null || b === null || a <= 0 || b <= 0) return null;
  return Math.abs((b - a) / a) * 100;
};

const cleanSymbol = (value) => String(value ?? "").trim().toUpperCase();

export function createEpisodeId(event = {}) {
  const symbol = cleanSymbol(event.symbol) || "UNKNOWN";
  const patternId = normalizePatternId(event.patternId ?? event.signalType) ?? "unknown";
  const direction = ["up", "down", "neutral"].includes(event.direction)
    ? event.direction
    : "neutral";
  const startedAt = Math.max(0, Math.floor(finiteOrNull(
    event.candidateStartedAt ?? event.triggeredAt,
  ) ?? Date.now()));
  return `episode:${symbol}:${patternId}:${direction}:${startedAt}`;
}

export function createEpisode(event = {}) {
  const patternId = normalizePatternId(event.patternId ?? event.signalType);
  const state = PATTERN_STATES.includes(event.patternState) ? event.patternState : "candidate";
  const triggeredAt = finiteOrNull(event.triggeredAt);
  const candidateStartedAt = finiteOrNull(event.candidateStartedAt) ?? triggeredAt ?? Date.now();
  const eventId = String(event.id ?? "").trim();
  if (!eventId) throw new TypeError("event.id is required");
  if (!cleanSymbol(event.symbol)) throw new TypeError("event.symbol is required");
  if (!patternId) throw new TypeError("known patternId is required");

  return Object.freeze({
    entity: "SignalEpisode",
    episodeVersion: SIGNAL_LAB_V2_EPISODE_VERSION,
    id: event.episodeId || createEpisodeId({ ...event, patternId, candidateStartedAt }),
    symbol: cleanSymbol(event.symbol),
    patternId,
    direction: ["up", "down", "neutral"].includes(event.direction)
      ? event.direction
      : "neutral",
    state,
    candidateStartedAt,
    triggeredAt,
    confirmedAt: finiteOrNull(event.confirmedAt),
    weakeningAt: finiteOrNull(event.weakeningAt),
    invalidatedAt: finiteOrNull(event.invalidatedAt),
    completedAt: finiteOrNull(event.completedAt),
    referencePrice: finiteOrNull(event.referencePrice ?? event.price),
    invalidationPrice: finiteOrNull(event.invalidationPrice),
    lastPrice: finiteOrNull(event.price),
    lastEventAt: triggeredAt ?? candidateStartedAt,
    primaryEventId: eventId,
    eventIds: Object.freeze([eventId]),
    duplicateEventIds: Object.freeze([]),
    formulaVersions: Object.freeze([
      String(event?.formula?.version ?? event?.formulaVersion ?? "unknown"),
    ]),
  });
}

export function transitionEpisode(episode, nextState, patch = {}) {
  if (!episode || episode.entity !== "SignalEpisode") {
    throw new TypeError("SignalEpisode is required");
  }
  if (!PATTERN_STATES.includes(nextState)) throw new TypeError("Unknown episode state");
  if (nextState !== episode.state && !ALLOWED_TRANSITIONS[episode.state]?.has(nextState)) {
    throw new Error(`Invalid episode transition: ${episode.state} -> ${nextState}`);
  }
  const at = finiteOrNull(patch.at) ?? Date.now();
  const timestamps = {};
  if (nextState === "triggered") timestamps.triggeredAt = episode.triggeredAt ?? at;
  if (nextState === "confirmed") timestamps.confirmedAt = episode.confirmedAt ?? at;
  if (nextState === "weakening") timestamps.weakeningAt = at;
  if (nextState === "invalidated") timestamps.invalidatedAt = at;
  if (nextState === "completed") timestamps.completedAt = at;
  return Object.freeze({
    ...episode,
    ...patch,
    ...timestamps,
    state: nextState,
    lastEventAt: Math.max(episode.lastEventAt ?? 0, at),
    eventIds: Object.freeze([...(episode.eventIds ?? [])]),
    duplicateEventIds: Object.freeze([...(episode.duplicateEventIds ?? [])]),
    formulaVersions: Object.freeze([...(episode.formulaVersions ?? [])]),
  });
}

export function belongsToEpisode(episode, event = {}, {
  duplicateWindowMs = 90_000,
  maximumReferenceDistancePercent = 0.75,
} = {}) {
  if (!episode || TERMINAL_STATES.has(episode.state)) return false;
  const patternId = normalizePatternId(event.patternId ?? event.signalType);
  if (cleanSymbol(event.symbol) !== episode.symbol) return false;
  if (patternId !== episode.patternId) return false;
  if ((event.direction ?? "neutral") !== episode.direction) return false;
  const at = finiteOrNull(event.triggeredAt ?? event.candidateStartedAt);
  if (at === null || at < episode.candidateStartedAt) return false;
  if (at - (episode.lastEventAt ?? episode.candidateStartedAt) > duplicateWindowMs) return false;
  const distance = percentDistance(
    episode.referencePrice,
    event.referencePrice ?? event.price,
  );
  return distance === null || distance <= maximumReferenceDistancePercent;
}

export function appendEpisodeEvent(episode, event = {}, options = {}) {
  if (!belongsToEpisode(episode, event, options)) {
    throw new Error("Event does not belong to episode");
  }
  const eventId = String(event.id ?? "").trim();
  if (!eventId) throw new TypeError("event.id is required");
  const eventIds = [...new Set([...(episode.eventIds ?? []), eventId])];
  const duplicateEventIds = eventId === episode.primaryEventId
    ? [...(episode.duplicateEventIds ?? [])]
    : [...new Set([...(episode.duplicateEventIds ?? []), eventId])];
  const formulaVersion = String(event?.formula?.version ?? event?.formulaVersion ?? "unknown");
  const formulaVersions = [...new Set([...(episode.formulaVersions ?? []), formulaVersion])];
  const at = finiteOrNull(event.triggeredAt ?? event.candidateStartedAt) ?? Date.now();
  return Object.freeze({
    ...episode,
    lastEventAt: Math.max(episode.lastEventAt ?? 0, at),
    lastPrice: finiteOrNull(event.price) ?? episode.lastPrice,
    eventIds: Object.freeze(eventIds),
    duplicateEventIds: Object.freeze(duplicateEventIds),
    formulaVersions: Object.freeze(formulaVersions),
  });
}

export function groupEventsIntoEpisodes(events = [], options = {}) {
  const ordered = [...events].sort((left, right) => (
    (finiteOrNull(left?.triggeredAt ?? left?.candidateStartedAt) ?? 0)
    - (finiteOrNull(right?.triggeredAt ?? right?.candidateStartedAt) ?? 0)
  ));
  const episodes = [];
  const eventToEpisode = new Map();
  for (const event of ordered) {
    let index = -1;
    for (let cursor = episodes.length - 1; cursor >= 0; cursor -= 1) {
      if (belongsToEpisode(episodes[cursor], event, options)) {
        index = cursor;
        break;
      }
    }
    if (index < 0) {
      const episode = createEpisode(event);
      episodes.push(episode);
      eventToEpisode.set(event.id, episode.id);
    } else {
      const episode = appendEpisodeEvent(episodes[index], event, options);
      episodes[index] = episode;
      eventToEpisode.set(event.id, episode.id);
    }
  }
  return Object.freeze({
    episodes: Object.freeze(episodes),
    eventToEpisode,
  });
}
