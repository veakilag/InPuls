(() => {
  const installButton = document.querySelector("#install-app");
  if (!installButton) return;

  const isStandalone = window.matchMedia("(display-mode: standalone)").matches
    || window.navigator.standalone === true;

  const userAgent = navigator.userAgent.toLowerCase();
  const platform = String(navigator.userAgentData?.platform || navigator.platform || "").toLowerCase();
  const isAppleMobile = /iphone|ipad|ipod/.test(userAgent);
  const isMac = platform.includes("mac") || userAgent.includes("macintosh");
  const isSafari = userAgent.includes("safari")
    && !/(chrome|chromium|crios|edg|opr|yabrowser|firefox|fxios)/.test(userAgent);
  const isFirefox = /firefox|fxios/.test(userAgent);
  const isWindows = platform.includes("win") || userAgent.includes("windows");

  let deferredInstallPrompt = null;
  let installCompleted = false;

  function createInstallDialog() {
    const dialog = document.createElement("dialog");
    dialog.id = "pwa-install-dialog";
    dialog.setAttribute("aria-labelledby", "pwa-install-dialog-title");
    dialog.style.cssText = "width:min(460px,calc(100vw - 32px));padding:0;border:1px solid rgba(79,255,176,.35);border-radius:16px;background:#12171b;color:#eefbf5;box-shadow:0 24px 80px rgba(0,0,0,.58);";

    const card = document.createElement("section");
    card.style.cssText = "padding:24px;display:grid;gap:14px;font-family:system-ui,-apple-system,BlinkMacSystemFont,'Segoe UI',sans-serif;";

    const badge = document.createElement("span");
    badge.dataset.role = "badge";
    badge.style.cssText = "width:max-content;padding:6px 9px;border-radius:999px;background:rgba(46,214,142,.12);border:1px solid rgba(79,255,176,.3);color:#70f5b8;font-size:11px;font-weight:800;letter-spacing:.09em;text-transform:uppercase;";

    const title = document.createElement("h2");
    title.id = "pwa-install-dialog-title";
    title.dataset.role = "title";
    title.style.cssText = "margin:0;font-size:22px;line-height:1.2;";

    const message = document.createElement("p");
    message.dataset.role = "message";
    message.style.cssText = "margin:0;color:#d4dfda;font-size:15px;line-height:1.55;";

    const detail = document.createElement("p");
    detail.dataset.role = "detail";
    detail.style.cssText = "margin:0;padding:12px 14px;border-radius:11px;background:rgba(255,255,255,.035);color:#9eb0a8;font-size:13px;line-height:1.5;";

    const actions = document.createElement("div");
    actions.style.cssText = "display:flex;justify-content:flex-end;padding-top:4px;";

    const closeButton = document.createElement("button");
    closeButton.type = "button";
    closeButton.textContent = "Понятно";
    closeButton.style.cssText = "min-height:40px;padding:0 18px;border:1px solid rgba(79,255,176,.45);border-radius:10px;background:rgba(46,214,142,.15);color:#caffdf;font:700 13px/1 system-ui,sans-serif;cursor:pointer;";
    closeButton.addEventListener("click", () => dialog.close());

    actions.append(closeButton);
    card.append(badge, title, message, detail, actions);
    dialog.append(card);
    dialog.addEventListener("click", (event) => {
      if (event.target === dialog) dialog.close();
    });
    document.body.append(dialog);
    return dialog;
  }

  const installDialog = createInstallDialog();

  function showInstallDialog({ badge, title, message, detail }) {
    installDialog.querySelector('[data-role="badge"]').textContent = badge;
    installDialog.querySelector('[data-role="title"]').textContent = title;
    installDialog.querySelector('[data-role="message"]').textContent = message;
    installDialog.querySelector('[data-role="detail"]').textContent = detail;
    if (!installDialog.open) installDialog.showModal();
  }

  function showInstallSuccess() {
    if (installCompleted) return;
    installCompleted = true;
    deferredInstallPrompt = null;
    installButton.hidden = true;
    showInstallDialog({
      badge: "Готово",
      title: "InPuls установлен",
      message: "Скринер установлен как отдельное приложение и теперь запускается без обычной вкладки браузера.",
      detail: "Ищи InPuls на рабочем столе, в меню «Пуск», на панели задач, в Dock или среди приложений — точное место зависит от браузера и операционной системы.",
    });
  }

  function fallbackInstructions() {
    if (isAppleMobile) {
      return {
        badge: "iPhone / iPad",
        title: "Добавить InPuls на экран",
        message: "Safari не открывает установку сайта программно.",
        detail: "Нажми «Поделиться», затем выбери «На экран Домой» и подтверди добавление.",
      };
    }

    if (isMac && isSafari) {
      return {
        badge: "Safari на Mac",
        title: "Добавить InPuls в Dock",
        message: "Safari устанавливает веб-приложения через собственное меню.",
        detail: "Открой «Файл → Добавить в Dock» или нажми «Поделиться → Добавить в Dock». Требуется macOS Sonoma 14 или новее.",
      };
    }

    if (isFirefox && isWindows) {
      return {
        badge: "Firefox на Windows",
        title: "Установить через адресную строку",
        message: "Firefox управляет установкой через собственную кнопку веб-приложений.",
        detail: "Нажми значок веб-приложения в адресной строке. Если значка нет, обнови Firefox или используй Chrome, Edge либо Яндекс Браузер.",
      };
    }

    if (isFirefox) {
      return {
        badge: "Firefox",
        title: "Установка недоступна из сайта",
        message: "В этой версии Firefox системное окно установки не поддерживается.",
        detail: "Открой InPuls в Chrome, Edge, Яндекс Браузере или Safari на Mac и повтори установку.",
      };
    }

    return {
      badge: "Установка",
      title: "Браузер не открыл установку",
      message: "Скорее всего, InPuls уже установлен либо браузер не выдал сайту системное окно.",
      detail: "Открой меню браузера и выбери «Установить InPuls», «Приложения» или «Открыть в приложении».",
    };
  }

  installButton.hidden = isStandalone;

  window.addEventListener("beforeinstallprompt", (event) => {
    event.preventDefault();
    deferredInstallPrompt = event;
    if (!isStandalone) installButton.hidden = false;
  });

  window.addEventListener("appinstalled", showInstallSuccess);

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

    showInstallDialog(fallbackInstructions());
  }, { capture: true });
})();
