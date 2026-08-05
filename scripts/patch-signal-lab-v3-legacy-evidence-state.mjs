import { readFile, writeFile } from "node:fs/promises";

const path = "signal-lab-v3-replay-ui.js";
const source = await readFile(path, "utf8");
const search = `  const timeframeButtons = [...card.querySelectorAll("[data-timeframe]")];
  if (!pack || !canvas || !book || !slider) return;

  let intervalMs = TIMEFRAMES["5s"];`;
const replacement = `  const timeframeButtons = [...card.querySelectorAll("[data-timeframe]")];
  if (!canvas || !book || !slider) return;
  if (!pack) {
    const { context, width, height } = resizeCanvas(canvas);
    drawEmpty(context, width, height, "Эпизод собран до V3.1 — исторического графика Replay нет");
    book.replaceChildren();
    const empty = document.createElement("div");
    empty.className = "book-empty";
    empty.textContent = "Эпизод создан до включения записи depth20. Стакан задним числом восстановить нельзя.";
    book.append(empty);
    coverage.textContent = "Исторический evidence-пакет отсутствует. Новые эпизоды сохраняются с графиком и стаканом.";
    replayTime.textContent = "—";
    play.disabled = true;
    slider.disabled = true;
    timeframeButtons.forEach((button) => { button.disabled = true; });
    renderExplanation(card, null);
    card.querySelector('[data-field="explanation-headline"]').textContent = "Этот эпизод был собран старой версией лаборатории. Моё объяснение появится у новых эпизодов после записи полного контекста.";
    card.querySelector('[data-field="explanation-missing"]').textContent = "Не хватает исторических price points, flow samples и depth20; они не восстанавливаются задним числом.";
    renderOutcomes(outcomes, null);
    return;
  }

  let intervalMs = TIMEFRAMES["5s"];`;
const count = source.split(search).length - 1;
if (count !== 1) throw new Error(`legacy evidence state: expected one match, got ${count}`);
await writeFile(path, source.replace(search, replacement));

const testPath = "test/signal-lab-v3-evidence.test.js";
const tests = await readFile(testPath, "utf8");
if (!tests.includes("legacy episodes show an explicit no-evidence state")) {
  await writeFile(testPath, `${tests.trimEnd()}\n\ntest("legacy episodes show an explicit no-evidence state", async () => {\n  const source = await readFile(new URL("../signal-lab-v3-replay-ui.js", import.meta.url), "utf8");\n  assert.match(source, /Эпизод собран до V3\\.1/);\n  assert.match(source, /Стакан задним числом восстановить нельзя/);\n  assert.match(source, /historical price points|исторических price points/i);\n});\n`);
}

console.log("Legacy evidence empty state applied");
