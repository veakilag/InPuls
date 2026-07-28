(function installInPulsOrderBookDepthProjection(scope) {
  "use strict";

  const DEFAULT_EXACT_LIMIT = 280;
  const DEFAULT_DENSITY_LIMIT = 96;
  const DEFAULT_BAND_COUNT = 128;

  function positiveInteger(value, fallback, minimum = 0) {
    const numeric = Math.floor(Number(value));
    return Number.isFinite(numeric) && numeric >= minimum ? numeric : fallback;
  }

  function normalizeLevels(levels, side) {
    return [...(levels ?? [])]
      .map((row, sourceIndex) => ({
        sourceIndex,
        price: Number(row?.[0]),
        quantity: Number(row?.[1]),
      }))
      .filter((row) => (
        Number.isFinite(row.price)
        && row.price > 0
        && Number.isFinite(row.quantity)
        && row.quantity > 0
      ))
      .sort(side === "bid"
        ? (left, right) => right.price - left.price
        : (left, right) => left.price - right.price);
  }

  function aggregateFarBands(rows, side, bandCount, excludedIndexes) {
    const remaining = rows.filter((row, index) => !excludedIndexes.has(index));
    if (!remaining.length || bandCount <= 0) return [];

    const near = Number(remaining[0].price);
    const far = Number(remaining.at(-1).price);
    const span = Math.abs(far - near);
    if (!Number.isFinite(span) || span <= Number.EPSILON) {
      const quantity = remaining.reduce((sum, row) => sum + row.quantity, 0);
      const quote = remaining.reduce((sum, row) => sum + row.price * row.quantity, 0);
      const price = quote / Math.max(Number.MIN_VALUE, quantity);
      return [[price, quantity]];
    }

    const buckets = new Map();
    for (const row of remaining) {
      const distance = side === "bid" ? near - row.price : row.price - near;
      const index = Math.min(
        bandCount - 1,
        Math.max(0, Math.floor(distance / span * bandCount)),
      );
      const bucket = buckets.get(index) ?? { quantity: 0, quote: 0 };
      bucket.quantity += row.quantity;
      bucket.quote += row.price * row.quantity;
      buckets.set(index, bucket);
    }

    return [...buckets.entries()]
      .sort((left, right) => left[0] - right[0])
      .map(([, bucket]) => {
        const price = bucket.quote / Math.max(Number.MIN_VALUE, bucket.quantity);
        return [
          Number(price.toPrecision(15)),
          Number(bucket.quantity.toPrecision(15)),
        ];
      });
  }

  function compactDepthSide(levels, side, options = {}) {
    const ordered = normalizeLevels(levels, side);
    const exactLimit = Math.min(
      ordered.length,
      positiveInteger(options.exactLimit, DEFAULT_EXACT_LIMIT, 1),
    );
    const densityLimit = positiveInteger(
      options.densityLimit,
      DEFAULT_DENSITY_LIMIT,
      0,
    );
    const bandCount = positiveInteger(
      options.bandCount,
      DEFAULT_BAND_COUNT,
      0,
    );

    if (ordered.length <= exactLimit) {
      return {
        levels: ordered.map((row) => [row.price, row.quantity]),
        metadata: {
          compacted: false,
          rawLevels: ordered.length,
          exactLevels: ordered.length,
          densityLevels: 0,
          bandLevels: 0,
          projectedLevels: ordered.length,
        },
      };
    }

    const exact = ordered.slice(0, exactLimit);
    const far = ordered.slice(exactLimit);
    const significantIndexes = far
      .map((row, index) => ({
        index,
        quote: row.price * row.quantity,
        distance: index,
      }))
      .sort((left, right) => right.quote - left.quote || left.distance - right.distance)
      .slice(0, Math.min(densityLimit, far.length))
      .map((item) => item.index);
    const significantIndexSet = new Set(significantIndexes);
    const significant = significantIndexes.map((index) => far[index]);
    const background = aggregateFarBands(far, side, bandCount, significantIndexSet)
      .map(([price, quantity]) => ({ price, quantity }));

    const projected = [...exact, ...significant, ...background]
      .sort(side === "bid"
        ? (left, right) => right.price - left.price
        : (left, right) => left.price - right.price)
      .map((row) => [row.price, row.quantity]);

    return {
      levels: projected,
      metadata: {
        compacted: true,
        rawLevels: ordered.length,
        exactLevels: exact.length,
        densityLevels: significant.length,
        bandLevels: background.length,
        projectedLevels: projected.length,
      },
    };
  }

  function compactDepthView(view, options = {}) {
    const bids = compactDepthSide(view?.bids, "bid", options);
    const asks = compactDepthSide(view?.asks, "ask", options);
    return {
      bids: bids.levels,
      asks: asks.levels,
      metadata: {
        version: 1,
        bids: bids.metadata,
        asks: asks.metadata,
      },
    };
  }

  scope.InPulsOrderBookDepthProjection = Object.freeze({
    DEFAULT_EXACT_LIMIT,
    DEFAULT_DENSITY_LIMIT,
    DEFAULT_BAND_COUNT,
    compactDepthSide,
    compactDepthView,
  });
})(typeof self !== "undefined" ? self : globalThis);
