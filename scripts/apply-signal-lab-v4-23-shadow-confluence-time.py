from pathlib import Path

path = Path('signal-lab-v7-multi-timeframe-levels.js')
text = path.read_text()

anchor = '''export function filterLocalSameSideShadow(levels, viewTimeframe) {\n'''
helper = '''function structuralLevelTimeOnView(level, viewTimeframe) {\n  const path = Array.isArray(level?.refinementPath) ? level.refinementPath : [];\n  for (let index = path.length - 1; index >= 0; index -= 1) {\n    const step = path[index];\n    if (step?.timeframe !== viewTimeframe) continue;\n    const time = finite(step?.time);\n    if (time !== null) return time;\n  }\n  if (level?.refinedThroughTimeframe === viewTimeframe) {\n    const displayAt = finite(level?.displayAt);\n    if (displayAt !== null) return displayAt;\n  }\n  return finite(level?.nativeExtremeAt ?? level?.extremeAt);\n}\n\nfunction structuralLevelContainsTimeframe(level, timeframe) {\n  if (level?.sourceTimeframe === timeframe) return true;\n  const sources = Array.isArray(level?.sources) ? level.sources : [];\n  return sources.includes(timeframe);\n}\n\n'''
if helper not in text:
    if anchor not in text:
        raise SystemExit('V4.23 shadow helper anchor not found')
    text = text.replace(anchor, helper + anchor, 1)

old_sort = '''  const ordered = source.slice().sort((left, right) => {\n    const leftAt = finite(left?.nativeExtremeAt ?? left?.extremeAt) ?? Infinity;\n    const rightAt = finite(right?.nativeExtremeAt ?? right?.extremeAt) ?? Infinity;\n'''
new_sort = '''  const ordered = source.slice().sort((left, right) => {\n    const leftAt = structuralLevelTimeOnView(left, viewTimeframe) ?? Infinity;\n    const rightAt = structuralLevelTimeOnView(right, viewTimeframe) ?? Infinity;\n'''
if old_sort not in text:
    raise SystemExit('V4.23 sort anchor not found')
text = text.replace(old_sort, new_sort, 1)

old_current_at = '''    const currentAt = finite(current.nativeExtremeAt ?? current.extremeAt);\n'''
new_current_at = '''    const currentAt = structuralLevelTimeOnView(current, viewTimeframe);\n'''
if old_current_at not in text:
    raise SystemExit('V4.23 current time anchor not found')
text = text.replace(old_current_at, new_current_at, 1)

old_prior = '''      const priorAt = finite(prior?.nativeExtremeAt ?? prior?.extremeAt);\n      if (priorAt === null) continue;\n      if (currentAt - priorAt > maximumGapMs) break;\n      if (prior?.active === false) continue;\n      if (prior?.side !== current.side) break;\n      if (prior?.sourceTimeframe !== viewTimeframe) continue;\n\n      const priorPrice = finite(prior?.price);\n'''
new_prior = '''      const priorAt = structuralLevelTimeOnView(prior, viewTimeframe);\n      if (priorAt === null) continue;\n      if (currentAt - priorAt > maximumGapMs) break;\n      if (prior?.active === false) continue;\n      if (prior?.side !== current.side) break;\n      // V4.23: after clustering a valid native 1m pivot may be owned by a\n      // senior primary (for example 15m+1m). It still participates in local\n      // same-side shadow cleanup when the cluster contains this view timeframe.\n      if (!structuralLevelContainsTimeframe(prior, viewTimeframe)) continue;\n\n      const priorPrice = finite(prior?.price);\n'''
if old_prior not in text:
    raise SystemExit('V4.23 prior anchor not found')
text = text.replace(old_prior, new_prior, 1)
path.write_text(text)


test = Path('test/signal-lab-v7-local-same-side-shadow.test.js')
existing = test.read_text()
addition = r'''

test("V4.23 uses the view-time refinement of a senior-owned confluence as the prior native pivot", () => {
  const levels = [
    {
      ...level("senior-low", "LOW", 0.01813, 0),
      sourceTimeframe: "15m",
      sources: ["15m", "1m"],
      refinementPath: [
        { timeframe: "15m", time: 0 },
        { timeframe: "1m", time: 8 * minute },
      ],
      refinedThroughTimeframe: "1m",
      displayAt: 8 * minute,
    },
    level("shadow-low", "LOW", 0.023, 10),
  ];
  const result = filterLocalSameSideShadow(levels, "1m");
  assert.deepEqual(result.map((row) => row.id), ["senior-low"]);
});
'''
if 'V4.23 uses the view-time refinement' not in existing:
    test.write_text(existing + addition)
