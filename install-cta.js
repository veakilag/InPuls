(() => {
  const installButton = document.querySelector("#install-app");
  if (!installButton) return;

  const isStandalone = window.matchMedia("(display-mode: standalone)").matches
    || window.navigator.standalone === true;

  let deferredInstallPrompt = null;

  installButton.hidden = isStandalone;

  window.addEventListener("beforeinstallprompt", (event) => {
    event.preventDefault();
    deferredInstallPrompt = event;
    if (!isStandalone) installButton.hidden = false;
  });

  window.addEventListener("appinstalled", () => {
    deferredInstallPrompt = null;
    installButton.hidden = true;
  });

  installButton.addEventListener("click", async (event) => {
    event.preventDefault();
    event.stopImmediatePropagation();

    if (deferredInstallPrompt) {
      deferredInstallPrompt.prompt();
      const choice = await deferredInstallPrompt.userChoice;
      deferredInstallPrompt = null;
      if (choice?.outcome === "accepted") installButton.hidden = true;
      return;
    }

    const isAppleMobile = /iphone|ipad|ipod/i.test(navigator.userAgent);
    const message = isAppleMobile
      ? "Чтобы установить InPuls: нажми «Поделиться» в Safari, затем «На экран Домой»."
      : "Браузер не показал системное окно установки. Возможно, InPuls уже установлен. Открой меню браузера ⋮ и выбери «Установить InPuls» или «Открыть в приложении».";

    window.alert(message);
  }, { capture: true });
})();
