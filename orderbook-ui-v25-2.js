const STYLE_ID = "inpuls-book-tape-sync-v25-2";

function installStyles() {
  if (document.getElementById(STYLE_ID)) return;
  const style = document.createElement("style");
  style.id = STYLE_ID;
  style.textContent = `
    .orderbook-card .trade-price-axis,
    .orderbook-card .trade-time-axis,
    .orderbook-card .trade-flow-grid,
    .orderbook-card .trade-flow-line,
    .orderbook-card .trade-flow-hint,
    .orderbook-card [data-trade-window],
    .orderbook-card [data-book-clusters] {
      display: none !important;
    }
    .orderbook-card .trade-flow-node {
      transition: none !important;
    }
    .orderbook-card .trade-flow-nodes {
      inset: 0 !important;
    }
  `;
  document.head.append(style);
}

function parseNumber(text) {
  const normalized = String(text ?? "")
    .replace(/\s/g, "")
    .replace(",", ".")
    .replace(/[^0-9.+-]/g, "");
  const value = Number(normalized);
  return Number.isFinite(value) ? value : null;
}

function tradePriceFromKey(key) {
  const value = String(key ?? "");
  if (!value.startsWith("raw:")) return null;
  const separator = value.lastIndexOf(":");
  return separator >= 0 ? parseNumber(value.slice(separator + 1)) : null;
}

function forceRawTradeMode(card) {
  const clusterButton = card.querySelector("[data-book-clusters]");
  if (clusterButton?.getAttribute("aria-pressed") === "true") clusterButton.click();
}

function alignTradeNodes(card) {
  forceRawTradeMode(card);
  const flow = card.querySelector(".trade-flow");
  const rows = [...card.querySelectorAll(".orderbook-rows .book-ladder-row")];
  if (!flow || !rows.length) return;

  const flowRect = flow.getBoundingClientRect();
  if (flowRect.height <= 0 || flowRect.width <= 0) return;

  const levels = rows.map((row, index) => {
    const rect = row.getBoundingClientRect();
    return {
      index,
      price: parseNumber(row.querySelector("strong")?.textContent),
      y: ((rect.top + rect.height / 2 - flowRect.top) / flowRect.height) * 100,
    };
  }).filter((row) => Number.isFinite(row.price));
  if (!levels.length) return;

  for (const node of card.querySelectorAll(".trade-flow-node[data-trade-path-key]")) {
    const price = tradePriceFromKey(node.dataset.tradePathKey);
    if (!Number.isFinite(price)) continue;
    let closest = levels[0];
    let distance = Math.abs(price - closest.price);
    for (let index = 1; index < levels.length; index += 1) {
      const candidateDistance = Math.abs(price - levels[index].price);
      if (candidateDistance < distance) {
        closest = levels[index];
        distance = candidateDistance;
      }
    }
    node.style.setProperty("--y", `${Math.max(0.5, Math.min(99.5, closest.y)).toFixed(3)}%`);

    // После удаления правой оси времени используем всю ширину ленты.
    const savedX = parseNumber(node.dataset.inpulsRawX);
    const sourceX = Number.isFinite(savedX)
      ? savedX
      : parseNumber(node.style.getPropertyValue("--x"));
    if (Number.isFinite(sourceX)) {
      node.dataset.inpulsRawX = String(sourceX);
      const expandedX = 2 + ((sourceX - 3) / 82) * 96;
      node.style.setProperty("--x", `${Math.max(1, Math.min(99, expandedX)).toFixed(3)}%`);
    }
  }
}

let alignmentFrame = 0;
function scheduleAlignment() {
  if (alignmentFrame) return;
  alignmentFrame = requestAnimationFrame(() => {
    alignmentFrame = 0;
    document.querySelectorAll(".orderbook-card").forEach(alignTradeNodes);
  });
}

function installObservers() {
  const observer = new MutationObserver(scheduleAlignment);
  observer.observe(document.documentElement, { childList: true, subtree: true });
  window.addEventListener("resize", scheduleAlignment, { passive: true });

  // FULL BOOK не разрешает обычному колесу увести книгу в пустой ценовой диапазон.
  document.addEventListener("wheel", (event) => {
    const ladder = event.target.closest?.(".orderbook-card .orderbook-ladder");
    if (!ladder || event.ctrlKey || event.metaKey) return;
    event.preventDefault();
    event.stopImmediatePropagation();
    scheduleAlignment();
  }, { capture: true, passive: false });
}

if (typeof document !== "undefined") {
  installStyles();
  if (document.readyState === "loading") {
    document.addEventListener("DOMContentLoaded", () => {
      installObservers();
      scheduleAlignment();
    }, { once: true });
  } else {
    installObservers();
    scheduleAlignment();
  }
}
