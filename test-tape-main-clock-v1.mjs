import test from "node:test";
import assert from "node:assert/strict";

// One shared UI clock must align Tape and footprint with NOW · LIVE.
import { tapeDisplayTimeFromReceipt } from "./orderbook.js?v=26-115-series-visible-fallback-v1";
import { flowDisplayTimeFromReceipt } from "./orderbook-flow-workspace.js?v=26-115-series-visible-fallback-v1";

test("Tape and footprint share the main Binance clock", () => {
  const localNow = 1_000_000;
  const exchangeNow = 1_010_000;
  const receivedAt = 999_850;
  const executionTime = 999_700;
  const expected = 1_009_850;
  assert.equal(
    tapeDisplayTimeFromReceipt(receivedAt, executionTime, exchangeNow, localNow),
    expected,
  );
  assert.equal(
    flowDisplayTimeFromReceipt(receivedAt, executionTime, exchangeNow, localNow),
    expected,
  );
});

test("receipt alignment never moves before execution", () => {
  assert.equal(tapeDisplayTimeFromReceipt(900, 1_200, 1_000, 1_000), 1_200);
  assert.equal(flowDisplayTimeFromReceipt(900, 1_200, 1_000, 1_000), 1_200);
});
