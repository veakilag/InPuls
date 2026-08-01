(() => {
  "use strict";

  const BUILD = "26-91-runtime-boot-cache-feed-v1";
  const STORAGE_KEY = "inpuls-runtime-boot-build-v1";
  const SESSION_KEY = `inpuls-runtime-recovery:${BUILD}`;
  const url = new URL(window.location.href);
  const appScope = new URL("./", url);

  function read(storage, key) {
    try { return storage.getItem(key); } catch { return null; }
  }

  function write(storage, key, value) {
    try { storage.setItem(key, value); } catch {}
  }

  function isInPulsRegistration(registration) {
    try {
      const scope = new URL(registration.scope);
      return scope.origin === appScope.origin && scope.pathname === appScope.pathname;
    } catch {
      return false;
    }
  }

  function cleanRecoveryQuery() {
    const hadRecovery = url.searchParams.has("_inpuls_recovery")
      || url.searchParams.has("_inpuls_reload");
    if (!hadRecovery) return;
    url.searchParams.delete("_inpuls_recovery");
    url.searchParams.delete("_inpuls_reload");
    history.replaceState(history.state, "", url);
  }

  if (read(localStorage, STORAGE_KEY) === BUILD || read(sessionStorage, SESSION_KEY) === "done") {
    write(localStorage, STORAGE_KEY, BUILD);
    cleanRecoveryQuery();
    return;
  }

  write(sessionStorage, SESSION_KEY, "running");

  const unregister = "serviceWorker" in navigator
    ? navigator.serviceWorker.getRegistrations()
      .then((registrations) => Promise.all(
        registrations
          .filter(isInPulsRegistration)
          .map((registration) => registration.unregister()),
      ))
      .catch(() => [])
    : Promise.resolve([]);

  const clearCaches = "caches" in window
    ? caches.keys()
      .then((keys) => Promise.all(
        keys.filter((key) => key.startsWith("inpuls-")).map((key) => caches.delete(key)),
      ))
      .catch(() => [])
    : Promise.resolve([]);

  Promise.allSettled([unregister, clearCaches]).finally(() => {
    write(localStorage, STORAGE_KEY, BUILD);
    write(sessionStorage, SESSION_KEY, "done");
    url.searchParams.set("_inpuls_recovery", BUILD);
    url.searchParams.set("_inpuls_reload", String(Date.now()));
    window.location.replace(url.href);
  });
})();
