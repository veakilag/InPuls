const PATCH_MARKER = Symbol.for("inpuls.structural-extremes.attack-count-v1");

function normalizeExtreme(row) {
  if (!row) return row;
  const retestCount = Math.max(0, Math.round(Number(row.touchCount) || 0));
  const attackCount = retestCount + 1;
  return Object.freeze({
    ...row,
    retestCount,
    attackCount,
    touchCount: attackCount,
  });
}

export function structuralAttackCountFromRetests(retestCount) {
  return Math.max(0, Math.round(Number(retestCount) || 0)) + 1;
}

export function installStructuralAttackCountRuntime(EngineClass) {
  const prototype = EngineClass?.prototype;
  if (!prototype || typeof prototype.snapshot !== "function") {
    throw new TypeError("StructuralExtremeEngine class is required");
  }
  if (prototype[PATCH_MARKER]) return;

  const originalSnapshot = prototype.snapshot;
  Object.defineProperty(prototype, PATCH_MARKER, {
    value: true,
    configurable: false,
    enumerable: false,
    writable: false,
  });

  prototype.snapshot = function snapshotWithAttackOrdinal(options = {}) {
    const snapshot = originalSnapshot.call(this, options);
    const active = Object.freeze((snapshot.active ?? []).map(normalizeExtreme));
    const history = Object.freeze((snapshot.history ?? []).map(normalizeExtreme));
    const previousConfirmedOpposite = normalizeExtreme(snapshot.previousConfirmedOpposite);
    return Object.freeze({
      ...snapshot,
      active,
      history,
      previousConfirmedOpposite,
      attackCountSemantics: "FORMATION_IS_ATTACK_1",
    });
  };
}
