from pathlib import Path

ROOT = Path(__file__).resolve().parents[1]


def replace_once(path: str, old: str, new: str) -> None:
    target = ROOT / path
    text = target.read_text(encoding="utf-8")
    count = text.count(old)
    if count != 1:
        raise RuntimeError(f"{path}: expected one occurrence, found {count}: {old[:120]!r}")
    target.write_text(text.replace(old, new, 1), encoding="utf-8")


# Fresh calibration storage namespace: preserve old browser feedback but do not
# auto-overlay it on V4.1 screenshots.
replace_once(
    "owner-signal-lab-structural-extremes-review.js",
    'const REVIEW_STORAGE_PREFIX = "inpuls-structural-extremes-review-v3";',
    'const REVIEW_STORAGE_PREFIX = "inpuls-structural-extremes-review-v4-1";',
)

# Expose the current hierarchical map to the review UI. This is review-only
# metadata and does not change detector/replay behavior.
replace_once(
    "signal-lab-v7-multi-timeframe-review-runtime.js",
    '''  const overlays = levelMap.map(annotationForLevel);\n  addContextStatus(state, levelMap);\n  return [...keptBase, ...overlays];''',
    '''  const overlays = levelMap.map(annotationForLevel);\n  state.levelMap = levelMap;\n  addContextStatus(state, levelMap);\n  return [...keptBase, ...overlays];''',
)

replace_once(
    "signal-lab-v7-multi-timeframe-review-runtime.js",
    '''    return originalSetAnnotations.call(this, combineAnnotations(state));''',
    '''    const combined = combineAnnotations(state);\n    this.structuralLevelMap = state.levelMap ?? Object.freeze([]);\n    return originalSetAnnotations.call(this, combined);''',
)

replace_once(
    "signal-lab-v7-multi-timeframe-review-runtime.js",
    '''        originalSetAnnotations.call(this, combineAnnotations(latest));\n        this.render?.();''',
    '''        const combined = combineAnnotations(latest);\n        this.structuralLevelMap = latest.levelMap ?? Object.freeze([]);\n        originalSetAnnotations.call(this, combined);\n        this.render?.();''',
)

# Junior manual annotations should not duplicate an already inherited senior
# structural level. A lower TF can still add a genuinely new local level.
anchor = '''function correctionBase(type) {\n  return {\n    id: `review-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`,\n    type,\n    symbol: current?.symbol,\n    timeframe: current?.timeframe,\n    createdAt: Date.now(),\n    comment: reviewUi.comment.value.trim() || undefined,\n  };\n}\n\nfunction addCorrection(correction) {'''
replacement = '''function correctionBase(type) {\n  return {\n    id: `review-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`,\n    type,\n    symbol: current?.symbol,\n    timeframe: current?.timeframe,\n    createdAt: Date.now(),\n    comment: reviewUi.comment.value.trim() || undefined,\n  };\n}\n\nconst REVIEW_TF_RANK = Object.freeze({\n  "1m": 1,\n  "5m": 2,\n  "15m": 3,\n  "1h": 4,\n  "4h": 5,\n  "1d": 6,\n});\n\nfunction inheritedSeniorLevelNear(side, price) {\n  const currentTimeframe = current?.timeframe ?? timeframe;\n  const currentRank = REVIEW_TF_RANK[currentTimeframe] ?? 0;\n  const tick = Math.max(0, finite(current?.tickSize) ?? 0);\n  const levels = Array.isArray(chart.structuralLevelMap) ? chart.structuralLevelMap : [];\n  let best = null;\n  for (const level of levels) {\n    if (!level || level.side !== side) continue;\n    const sourceRank = REVIEW_TF_RANK[level.sourceTimeframe] ?? 0;\n    if (sourceRank <= currentRank) continue;\n    const levelPrice = finite(level.price);\n    if (!(levelPrice > 0)) continue;\n    const tolerance = Math.max(tick * 3, levelPrice * 0.03 / 100);\n    const distance = Math.abs(levelPrice - price);\n    if (distance > tolerance) continue;\n    if (!best || sourceRank > best.sourceRank || (sourceRank === best.sourceRank && distance < best.distance)) {\n      best = { level, sourceRank, distance };\n    }\n  }\n  return best?.level ?? null;\n}\n\nfunction addCorrection(correction) {'''
replace_once("owner-signal-lab-structural-extremes-review.js", anchor, replacement)

replace_once(
    "owner-signal-lab-structural-extremes-review.js",
    '''  if (reviewTool === "add-high" || reviewTool === "add-low") {\n    const side = reviewTool === "add-high" ? "HIGH" : "LOW";\n    addCorrection({\n      ...correctionBase("ADD_EXTREME"),\n      side,\n      time: point.candle.time,\n      closeTime: point.candle.closeTime,\n      price: side === "HIGH" ? point.candle.high : point.candle.low,\n    });\n    return;\n  }''',
    '''  if (reviewTool === "add-high" || reviewTool === "add-low") {\n    const side = reviewTool === "add-high" ? "HIGH" : "LOW";\n    const price = side === "HIGH" ? point.candle.high : point.candle.low;\n    const inherited = inheritedSeniorLevelNear(side, price);\n    if (inherited) {\n      elements.status.dataset.state = "complete";\n      elements.status.textContent = `Уровень уже принадлежит ${inherited.sourceTimeframe}: отдельный ${current?.timeframe ?? timeframe} экстремум не нужен. Это confluence/refinement старшего уровня.`;\n      return;\n    }\n    addCorrection({\n      ...correctionBase("ADD_EXTREME"),\n      side,\n      time: point.candle.time,\n      closeTime: point.candle.closeTime,\n      price,\n    });\n    return;\n  }''',
)

# Make the ownership rule visible in the review UI.
replace_once(
    "owner-signal-lab-structural-extremes-review.js",
    '''          <span>Эталонные уровни сами считают атаки и заканчиваются на пробое</span>''',
    '''          <span>Размечай только новые уровни своего TF: совпадение со старшим TF считается confluence и не дублируется</span>''',
)

print("Applied Signal Lab V4.1 clean calibration + senior ownership guard")
