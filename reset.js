import { clearInPulsRuntime } from "./pwa-reset.js";

const BUILD = "26-80-sweep-tape-clock-v1";
const WORKER_URL = `./sw.js?v=${BUILD}`;
const APP_URL = `./?build=${BUILD}`;
const button = document.getElementById("reset");
const status = document.getElementById("status");

const expectedController = () => (
  navigator.serviceWorker.controller?.scriptURL.includes(BUILD)
);

const waitForExpectedController = async (registration) => {
  const startedAt = Date.now();
  while (Date.now() - startedAt < 8_000) {
    if (registration.active?.scriptURL.includes(BUILD) && expectedController()) return true;
    await new Promise((resolve) => setTimeout(resolve, 100));
  }
  return false;
};

button.addEventListener("click", async () => {
  button.disabled = true;
  try {
    status.textContent = "Удаляю кеши и Service Worker InPuls…";
    await clearInPulsRuntime();

    if ("serviceWorker" in navigator) {
      status.textContent = "Подключаю защищённую сборку…";
      const registration = await navigator.serviceWorker.register(
        WORKER_URL,
        { scope: "./", updateViaCache: "none" },
      );
      await registration.update();

      if (!expectedController()) {
        await new Promise((resolve) => {
          const timeout = setTimeout(resolve, 8_000);
          navigator.serviceWorker.addEventListener("controllerchange", () => {
            clearTimeout(timeout);
            resolve();
          }, { once: true });
        });
      }

      const ready = await waitForExpectedController(registration);
      if (!ready) {
        status.textContent = "Активирую новую сборку повторной загрузкой…";
        sessionStorage.setItem("inpuls-runtime-reset", BUILD);
        location.reload();
        return;
      }
    }

    status.textContent = "Готово. Открываю InPuls…";
    location.replace(`${APP_URL}&t=${Date.now()}`);
  } catch (error) {
    status.textContent = `Не удалось очистить автоматически: ${error?.message || error}`;
    button.disabled = false;
  }
});

if (sessionStorage.getItem("inpuls-runtime-reset") === BUILD && expectedController()) {
  sessionStorage.removeItem("inpuls-runtime-reset");
  location.replace(`${APP_URL}&t=${Date.now()}`);
}
