from pathlib import Path


def replace_once(path, old, new, label):
    source = Path(path).read_text()
    count = source.count(old)
    if count != 1:
        raise RuntimeError(f"{label}: expected one match, got {count}")
    Path(path).write_text(source.replace(old, new, 1))


replace_once(
    "test/signal-lab-v3-collector.test.js",
    '  assert.equal(ownerHtml.includes("signal-lab-v3-four-patterns-v1"), true);',
    '  assert.equal(ownerHtml.includes("signal-lab-v3-full-chart-review-v1"), true);',
    "collector cache-key contract",
)

replace_once(
    "test/signal-lab-v3-evidence.test.js",
    '''test("owner Signal Lab V3 exposes chart, book, replay and explanation controls", async () => {
  const html = await readFile(new URL("../owner-signal-lab-v3.html", import.meta.url), "utf8");
  assert.match(html, /data-field="chart"/);
  assert.match(html, /data-field="book"/);
  assert.match(html, /data-field="replay-slider"/);
  assert.match(html, /Почему я выбрал гипотезу/);
  assert.match(html, /sampled depth20/i);
});''',
    '''test("owner Signal Lab V3 exposes full chart, book replay and explanation controls", async () => {
  const html = await readFile(new URL("../owner-signal-lab-v3.html", import.meta.url), "utf8");
  assert.match(html, /data-field="full-chart"/);
  assert.match(html, /data-field="chart-toggle"/);
  assert.match(html, /data-chart-timeframe="1s"/);
  assert.match(html, /data-chart-timeframe="1h"/);
  assert.match(html, /data-field="chart-annotations-toggle"/);
  assert.match(html, /data-field="book"/);
  assert.match(html, /data-field="replay-slider"/);
  assert.match(html, /Почему я выбрал гипотезу/);
  assert.match(html, /sampled depth20/i);
});''',
    "full-chart owner contract",
)

replace_once(
    "test/signal-lab-v3-evidence.test.js",
    '''test("legacy episodes show an explicit no-evidence state", async () => {
  const source = await readFile(new URL("../signal-lab-v3-replay-ui.js", import.meta.url), "utf8");
  assert.match(source, /Эпизод собран до V3\\.1/);
  assert.match(source, /Стакан задним числом восстановить нельзя/);
  assert.match(source, /historical price points|исторических price points/i);
});''',
    '''test("legacy episodes show an explicit no-evidence state", async () => {
  const source = await readFile(new URL("../signal-lab-v3-replay-ui.js", import.meta.url), "utf8");
  assert.match(source, /Эпизод создан до включения записи depth20/);
  assert.match(source, /Стакан задним числом восстановить нельзя/);
  assert.match(source, /исторических price points/i);
  assert.match(source, /не восстанавливаются задним числом/i);
});''',
    "legacy evidence warning contract",
)

print("Signal Lab V3.3 regression contracts updated")
