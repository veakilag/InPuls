from pathlib import Path

path = Path(__file__).with_name("apply-tape-series-stage1-v1.py")
text = path.read_text(encoding="utf-8")
old = '''reset_anchor = (
    "          state.aggSourceBuckets = [];\\n"
    "          state.aggSnapshots?.clear?.();\\n"
)
reset_replacement = (
    "          state.aggSourceBuckets = [];\\n"
    "          state.aggSnapshots?.clear?.();\\n"
    "          state.sweepSourceBuckets = [];\\n"
    "          state.sweepSnapshots?.clear?.();\\n"
)
reset_count = text.count(reset_anchor)
if reset_count != 2:
    raise RuntimeError(f"series reset: expected two anchors, got {reset_count}")
text = text.replace(reset_anchor, reset_replacement)
'''
new = '''reset_pattern = re.compile(
    r"(?m)^(?P<indent>\\s*)state\\.aggSourceBuckets = \\[\\];\\n"
    r"\\s*state\\.aggSnapshots\\?\\.clear\\?\\.\\(\\);\\n"
)

def expand_series_reset(match):
    indent = match.group("indent")
    return (
        f"{indent}state.aggSourceBuckets = [];\\n"
        f"{indent}state.aggSnapshots?.clear?.();\\n"
        f"{indent}state.sweepSourceBuckets = [];\\n"
        f"{indent}state.sweepSnapshots?.clear?.();\\n"
    )

text, reset_count = reset_pattern.subn(expand_series_reset, text)
if reset_count != 2:
    raise RuntimeError(f"series reset: expected two anchors, got {reset_count}")
'''
if old not in text:
    raise RuntimeError("old reset migration block was not found")
path.write_text(text.replace(old, new, 1), encoding="utf-8")
