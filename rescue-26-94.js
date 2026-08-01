(() => {
  "use strict";

  const status = document.querySelector("#status");
  const card = document.querySelector("#card");
  const retry = document.querySelector("#retry");
  const scopeUrl = new URL("./", location.href);

  function isInPulsRegistration(registration) {
    try {
      const scope = new URL(registration.scope);
      return scope.origin === scopeUrl.origin && scope.pathname === scopeUrl.pathname;
    } catch {
      return false;
    }
  }

  function clearRecoveryMarkers() {
    try {
      localStorage.removeItem("inpuls-runtime-boot-build-v1");
      localStorage.removeItem("inpuls-runtime-recovery-revision-v1");
    } catch {}

    try {
      for (let index = sessionStorage.length - 1; index >= 0; index -= 1) {
        const key = sessionStorage.key(index);
        if (key?.startsWith("inpuls-runtime-recovery:") || key?.startsWith("inpuls-runtime-watchdog-attempt:")) {
          sessionStorage.removeItem(key);
        }
      }
    } catch {}
  }

  async function rescue() {
    card.classList.remove("error");
    retry.disabled = true;
    status.textContent = "Удаляю только старый Service Worker и кеши InPuls…";

    try {
      const unregister = "serviceWorker" in navigator
        ? navigator.serviceWorker.getRegistrations().then((registrations) => Promise.all(
          registrations.filter(isInPulsRegistration).map((registration) => registration.unregister()),
        ))
        : Promise.resolve([]);

      const clearCaches = "caches" in window
        ? caches.keys().then((keys) => Promise.all(
          keys.filter((key) => key.startsWith("inpuls-")).map((key) => caches.delete(key)),
        ))
        : Promise.resolve([]);

      await Promise.allSettled([unregister, clearCaches]);
      clearRecoveryMarkers();
      status.textContent = "Кеш очищен. Открываю чистую версию InPuls…";
      const target = new URL("./", location.href);
      target.searchParams.set("rescue", "26-94-runtime-rescue-v2");
      target.searchParams.set("fresh", String(Date.now()));
      location.replace(target.href);
    } catch (error) {
      card.classList.add("error");
      retry.disabled = false;
      status.textContent = `Не удалось восстановить автоматически: ${error?.message || error}`;
    }
  }

  retry.addEventListener("click", rescue);
  rescue();
})();
