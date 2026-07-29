from pathlib import Path

path = Path("orderbook.js")
source = path.read_text(encoding="utf-8")
marker = "inpuls-orderbook-visual-priority-v1"
if marker in source:
    raise RuntimeError("Visual priority styles already exist")

styles = r'''

function installOrderbookVisualPriorityStyles() {
  if (typeof document === "undefined" || document.getElementById("inpuls-orderbook-visual-priority-v1")) return;
  const style = document.createElement("style");
  style.id = "inpuls-orderbook-visual-priority-v1";
  style.textContent = `
    .orderbook-card .book-ladder-row {
      grid-template-columns: minmax(0, 1fr) minmax(76px, var(--book-price-width, 8.8ch)) !important;
      column-gap: 0 !important;
      align-items: stretch !important;
      position: relative;
    }
    .orderbook-card .book-ladder-row strong {
      width: 100% !important;
      min-width: 0 !important;
      overflow: hidden !important;
      padding: 0 8px 0 4px !important;
      border-left: 1px solid color-mix(in srgb, var(--line) 72%, transparent);
      justify-self: stretch !important;
      justify-content: flex-end !important;
      text-align: right !important;
      white-space: nowrap;
      box-sizing: border-box;
    }
    .orderbook-card .book-ladder-row .book-size::before,
    .orderbook-card .book-ladder-row.is-bid .book-size::before,
    .orderbook-card .book-ladder-row.is-ask .book-size::before {
      background: linear-gradient(90deg, rgba(232, 237, 240, .88), rgba(151, 161, 169, .48)) !important;
      opacity: .84 !important;
    }
    .orderbook-card .book-ladder-row.is-market {
      z-index: 5;
      background: linear-gradient(90deg, rgba(83, 222, 255, .07), rgba(149, 101, 255, .17)) !important;
      box-shadow: inset 0 1px rgba(118, 232, 255, .36), inset 0 -1px rgba(174, 129, 255, .32);
    }
    .orderbook-card .book-ladder-row.is-market strong {
      width: calc(100% - 4px) !important;
      margin-right: 4px;
      padding-right: 9px !important;
      border: 1px solid rgba(113, 228, 255, .72) !important;
      border-right: 3px solid #66e4ff !important;
      border-radius: 3px 0 0 3px;
      color: #fff !important;
      background: linear-gradient(90deg, rgba(91, 73, 157, .72), rgba(22, 119, 148, .86)) !important;
      box-shadow: 0 0 9px rgba(88, 220, 255, .32), inset 0 0 0 1px rgba(255, 255, 255, .08);
      text-shadow: 0 1px 2px rgba(0, 0, 0, .9);
      font-weight: 950 !important;
    }
    .orderbook-card .book-ladder-row.is-anomaly .book-size,
    .orderbook-card .book-ladder-row.is-market .book-size {
      color: #071014 !important;
      text-shadow: none !important;
      font-weight: 950 !important;
    }
    .orderbook-card .book-ladder-row.is-anomaly .book-size::before {
      opacity: .98 !important;
    }
    .orderbook-card .book-ladder-row.is-anomaly-tier-1 .book-size::before {
      background: linear-gradient(90deg, #82e4ff, #3ab6e8) !important;
      box-shadow: inset 2px 0 #e3faff, 0 0 5px rgba(72, 196, 239, .34);
    }
    .orderbook-card .book-ladder-row.is-anomaly-tier-2 .book-size::before {
      background: linear-gradient(90deg, #d0a8ff, #8c5df3) !important;
      box-shadow: inset 3px 0 #f0e2ff, 0 0 8px rgba(157, 105, 255, .5);
    }
    .orderbook-card .book-ladder-row.is-anomaly-tier-3 .book-size::before {
      background: linear-gradient(90deg, #fff49c, #ffb43f 64%, #ff685d) !important;
      box-shadow: inset 4px 0 #fffbd7, 0 0 11px rgba(255, 177, 65, .68);
    }
    .orderbook-card .book-ladder-row.is-anomaly-tier-2,
    .orderbook-card .book-ladder-row.is-anomaly-tier-3 {
      box-shadow: inset 0 1px rgba(255, 255, 255, .13), inset 0 -1px rgba(255, 255, 255, .09);
    }
  `;
  document.head.append(style);
}

if (typeof document !== "undefined") {
  if (document.readyState === "loading") {
    document.addEventListener("DOMContentLoaded", installOrderbookVisualPriorityStyles, { once: true });
  } else {
    installOrderbookVisualPriorityStyles();
  }
}
'''

path.write_text(source.rstrip() + styles + "\n", encoding="utf-8")
