from pathlib import Path

needle = "Flow Workspace redraw observer cannot trigger itself"
for candidate in [*Path('.').rglob('*.js'), *Path('.').rglob('*.mjs')]:
    if '.git' in candidate.parts or '.github' in candidate.parts:
        continue
    text = candidate.read_text(encoding='utf-8')
    index = text.find(needle)
    if index < 0:
        continue
    start = max(0, text.rfind('\ntest(', 0, index))
    end = text.find('\ntest(', index + len(needle))
    if end < 0:
        end = min(len(text), index + 4000)
    block = text[start:end]
    raise RuntimeError(f"FILE={candidate}\n---BLOCK---\n{block}\n---END---")
raise RuntimeError('Redraw observer test not found')
