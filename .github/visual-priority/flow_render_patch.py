from pathlib import Path
import re

path = Path("orderbook-flow-workspace.js")
source = path.read_text(encoding="utf-8")

pattern = re.compile(
    r'''      for \(const cluster of clusters\) \{.*?      \}\n\n      state\.context\.strokeStyle = "rgba\(133, 151, 160, \.24\)";\n      state\.context\.lineWidth = \.7;\n      state\.context\.beginPath\(\);\n      state\.context\.moveTo\(centerX, 0\);\n      state\.context\.lineTo\(centerX, height\);\n      state\.context\.stroke\(\);''',
    re.S,
)

replacement = '''      for (const cluster of clusters) {
        const sellLabel = cluster.sellQuote > 0 ? formatUsd(cluster.sellQuote) : "";
        const buyLabel = cluster.buyQuote > 0 ? formatUsd(cluster.buyQuote) : "";
        const sellStrength = footprintCellIntensity(cluster.sellQuote, maximumSide);
        const buyStrength = footprintCellIntensity(cluster.buyQuote, maximumSide);
        const cellHeight = Math.max(3, Math.min(cluster.row.height * .92, 14));
        const cellTop = cluster.row.y - cellHeight / 2;
        const halfWidth = Math.max(1, columnWidth / 2 - 1.5);

        state.context.fillStyle = `rgba(226, 58, 78, ${.08 + sellStrength * .82})`;
        state.context.fillRect(columnLeft + 1, cellTop, halfWidth, cellHeight);
        state.context.fillStyle = `rgba(71, 210, 39, ${.08 + buyStrength * .82})`;
        state.context.fillRect(centerX + .5, cellTop, halfWidth, cellHeight);

        state.context.strokeStyle = "rgba(225, 233, 238, .18)";
        state.context.lineWidth = .5;
        state.context.strokeRect(columnLeft + 1, cellTop, Math.max(1, columnWidth - 2), cellHeight);

        state.context.textAlign = "center";
        state.context.fillStyle = sellStrength > .52
          ? "rgba(255,255,255,.98)"
          : "rgba(255,174,183,.98)";
        state.context.fillText(sellLabel, columnLeft + columnWidth * .25, cluster.row.y);
        state.context.fillStyle = buyStrength > .52
          ? "rgba(255,255,255,.98)"
          : "rgba(154,246,132,.98)";
        state.context.fillText(buyLabel, columnLeft + columnWidth * .75, cluster.row.y);
      }

      const highRow = nearestRow(rows, interval.highPrice);
      const lowRow = nearestRow(rows, interval.lowPrice);
      const openRow = nearestRow(rows, interval.openPrice);
      const closeRow = nearestRow(rows, interval.closePrice);
      if (highRow && lowRow && openRow && closeRow) {
        const rising = Number(interval.closePrice) >= Number(interval.openPrice);
        state.context.strokeStyle = rising
          ? "rgba(122, 255, 74, .98)"
          : "rgba(255, 68, 83, .98)";
        state.context.fillStyle = rising
          ? "rgba(79, 224, 50, .94)"
          : "rgba(239, 54, 72, .94)";
        state.context.lineWidth = 1;
        state.context.beginPath();
        state.context.moveTo(centerX, highRow.y);
        state.context.lineTo(centerX, lowRow.y);
        state.context.stroke();
        const bodyTop = Math.min(openRow.y, closeRow.y);
        const bodyHeight = Math.max(2, Math.abs(closeRow.y - openRow.y));
        state.context.fillRect(centerX - 2, bodyTop, 4, bodyHeight);
        state.context.strokeRect(centerX - 2, bodyTop, 4, bodyHeight);
      }

      state.context.strokeStyle = "rgba(222, 231, 236, .28)";
      state.context.lineWidth = .65;
      state.context.beginPath();
      state.context.moveTo(centerX, 0);
      state.context.lineTo(centerX, height);
      state.context.stroke();'''

source, count = pattern.subn(replacement, source, count=1)
if count != 1:
    raise RuntimeError(f"Expected one footprint render block, got {count}")

path.write_text(source, encoding="utf-8")
