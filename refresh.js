import { clearInPulsRuntime } from "./pwa-reset.js";

const BUILD = "26-87-market-feed-footprint-series-v1";
const button = document.getElementById("refresh");
const status = document.getElementById("status");

button.addEventListener("click", async () => {
  button.disabled = true;
  try {
    status.textContent = "Удаляю кеши и Service Worker InPuls…";
    await clearInPulsRuntime();
    localStorage.setItem("inpuls-last-refresh", String(Date.now()));
    status.textContent = "Готово. Открываю InPuls…";
    location.replace(`./?build=${BUILD}&fresh=${Date.now()}`);
  } catch (error) {
    status.textContent = `Не удалось очистить автоматически: ${error?.message || error}`;
    button.disabled = false;
  }
});
