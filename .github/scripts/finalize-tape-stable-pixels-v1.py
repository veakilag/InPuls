from pathlib import Path


def replace_once(text, old, new, label):
    count = text.count(old)
    if count != 1:
        raise SystemExit(f"{label}: expected 1 match, got {count}")
    return text.replace(old, new, 1)


path = Path("orderbook.js")
text = path.read_text(encoding="utf-8")
text = replace_once(
    text,
    "function buildContinuousTapeWindow(width, latestTime, requestedEndTime = null) {",
    "function buildContinuousTapeWindow(width, latestTime, requestedEndTime = null, dpr = 1) {",
    "Tape window DPR argument",
)
text = replace_once(
    text,
    "  // The camera advances only by complete CSS pixels. Historical dots preserve\n  // their fractional pixel phase instead of shimmering on every execution.\n  const endTime = snapTapeWindowEnd(targetEndTime, duration, safeWidth);",
    "  // The camera advances only by complete physical pixels. Historical dots\n  // preserve their raster phase instead of shimmering on every execution.\n  const physicalWidth = safeWidth * Math.max(1, Number(dpr) || 1);\n  const endTime = snapTapeWindowEnd(targetEndTime, duration, physicalWidth);",
    "physical-pixel Tape window",
)
text = replace_once(
    text,
    "  const window = buildContinuousTapeWindow(rect.width, latestTime, endTime);",
    "  const window = buildContinuousTapeWindow(rect.width, latestTime, endTime, dpr);",
    "pass DPR to Tape window",
)
path.write_text(text, encoding="utf-8")

path = Path("orderbook-flow-workspace.js")
text = path.read_text(encoding="utf-8")
text = replace_once(
    text,
    '''        state.context.textAlign = "left";
        state.context.fillStyle = theme.text;
        state.context.font = "800 6.5px Inter, system-ui, sans-serif";
        state.context.fillText(
          `${formatSignedQuoteDelta(cluster.buyQuote - cluster.sellQuote)} · ${formatQuoteVolume(cluster.quote)}`,
          dataLeft + 2,
          cluster.row.y,
          Math.max(1, dataWidth - 4),
        );
        state.context.font = "800 7px Inter, system-ui, sans-serif";''',
    '''        const deltaText = formatSignedQuoteDelta(cluster.buyQuote - cluster.sellQuote);
        const volumeText = formatQuoteVolume(cluster.quote);
        const valueWidth = Math.max(1, dataWidth * .47);
        state.context.fillStyle = theme.text;
        state.context.font = "800 6.2px Inter, system-ui, sans-serif";
        state.context.textAlign = "left";
        state.context.fillText(deltaText, dataLeft + 2, cluster.row.y, valueWidth);
        state.context.textAlign = "right";
        state.context.fillText(
          volumeText,
          dataLeft + dataWidth - 2,
          cluster.row.y,
          valueWidth,
        );
        state.context.textAlign = "center";
        state.context.font = "800 7px Inter, system-ui, sans-serif";''',
    "separate footprint delta and volume",
)
path.write_text(text, encoding="utf-8")

path = Path("test-tape-stability-followup-v1.mjs")
text = path.read_text(encoding="utf-8")
text = replace_once(
    text,
    '''  assert.equal(snapTapeWindowEnd(10_019, duration, width), 10_020);
});''',
    '''  assert.equal(snapTapeWindowEnd(10_019, duration, width), 10_020);
  assert.equal(tapeWindowPixelQuantum(duration, width * 1.5), 40 / 3);
});''',
    "physical pixel quantum test",
)
text = replace_once(
    text,
    '''  assert.match(footprint, /formatSignedQuoteDelta\(cluster\.buyQuote - cluster\.sellQuote\)/);''',
    '''  assert.match(footprint, /const deltaText = formatSignedQuoteDelta\(cluster\.buyQuote - cluster\.sellQuote\)/);
  assert.match(footprint, /const volumeText = formatQuoteVolume\(cluster\.quote\)/);''',
    "separate footprint values test",
)
text += '''\n\ntest("runtime passes DPR into the Tape camera", () => {\n  assert.match(orderbook, /buildContinuousTapeWindow\(rect\.width, latestTime, endTime, dpr\)/);\n  assert.match(orderbook, /const physicalWidth = safeWidth \* Math\.max\(1, Number\(dpr\) \|\| 1\)/);\n});\n'''
path.write_text(text, encoding="utf-8")
