# Smooth chart first

Build: `26-97-smooth-chart-first-v1`.

## Problem

A fixed `render()` of the whole application was running on every exact second. At the same time each live kline packet copied the complete candle history and immediately emitted another chart update. The combination produced a visible periodic stall in every open chart.

## Changes

- Remove the fixed one-second full application render.
- Do not rebuild the market DOM for tracked `bookTicker` and `aggTrade` packets.
- Schedule market-table refreshes during an idle browser slot.
- Update the current live candle in place.
- Coalesce live chart notifications to one callback per animation frame.
- Copy the candle cache no more than once per 250 ms.
- Cache clock formatters and skip timezone-map scans while the dialog is closed.
- Keep the price in each additional chart header updated directly from its own feed.

## Startup invariant

The lightweight clock stores its state on the clock functions rather than in late module-level `let` bindings. This keeps `applySelectedTimeZone()` safe when it calls the clock during the initial event-binding phase.

## Safety boundary

The change does not alter candle values, Binance streams, signal formulas, order-book sequencing, Tape data, workspace storage, or Signal Lab history. It changes only UI scheduling and allocation on the live chart path.
