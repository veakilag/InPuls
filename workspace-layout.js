export const WORKSPACE_COLS = 48;
export const WORKSPACE_ROWS = 24;

export function panelsOverlap(left, right) {
  return left.x < right.x + right.w
    && left.x + left.w > right.x
    && left.y < right.y + right.h
    && left.y + left.h > right.y;
}

function rangesOverlap(leftStart, leftSize, rightStart, rightSize) {
  return leftStart < rightStart + rightSize && leftStart + leftSize > rightStart;
}

function validLayout(panels, minimumSize, cols, rows) {
  for (const panel of panels) {
    const minimum = minimumSize(panel);
    if (panel.x < 0 || panel.y < 0 || panel.w < minimum.w || panel.h < minimum.h) return false;
    if (panel.x + panel.w > cols || panel.y + panel.h > rows) return false;
  }
  return panels.every((panel, index) => panels.slice(index + 1).every((other) => !panelsOverlap(panel, other)));
}

/**
 * Moves one panel edge. Panels touching that edge move with it, so a tiled seam
 * behaves like the divider between snapped windows instead of creating overlap.
 */
export function resizeTiledWorkspace(
  sourcePanels,
  panelId,
  edge,
  rawDelta,
  minimumSize = () => ({ w: 1, h: 1 }),
  { cols = WORKSPACE_COLS, rows = WORKSPACE_ROWS } = {},
) {
  const delta = Math.round(Number(rawDelta) || 0);
  const panels = sourcePanels.filter(Boolean).map((panel) => ({ ...panel }));
  const active = panels.find((panel) => panel.id === panelId);
  if (!active || !["n", "e", "s", "w"].includes(edge)) return null;
  if (!delta) return panels;

  const original = sourcePanels.find((panel) => panel?.id === panelId);
  const neighbors = panels.filter((panel) => {
    if (panel.id === panelId) return false;
    if (edge === "e") return panel.x === original.x + original.w && rangesOverlap(panel.y, panel.h, original.y, original.h);
    if (edge === "w") return panel.x + panel.w === original.x && rangesOverlap(panel.y, panel.h, original.y, original.h);
    if (edge === "s") return panel.y === original.y + original.h && rangesOverlap(panel.x, panel.w, original.x, original.w);
    return panel.y + panel.h === original.y && rangesOverlap(panel.x, panel.w, original.x, original.w);
  });

  if (edge === "e") {
    active.w += delta;
    for (const neighbor of neighbors) {
      neighbor.x += delta;
      neighbor.w -= delta;
    }
  } else if (edge === "w") {
    active.x += delta;
    active.w -= delta;
    for (const neighbor of neighbors) neighbor.w += delta;
  } else if (edge === "s") {
    active.h += delta;
    for (const neighbor of neighbors) {
      neighbor.y += delta;
      neighbor.h -= delta;
    }
  } else {
    active.y += delta;
    active.h -= delta;
    for (const neighbor of neighbors) neighbor.h += delta;
  }

  return validLayout(panels, minimumSize, cols, rows) ? panels : null;
}
