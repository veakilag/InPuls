(() => {
  const slider = document.querySelector("#comfort-slider");
  if (!slider) return;

  const root = document.documentElement;
  const control = slider.closest(".comfort-control");
  const thumb = control?.querySelector(".comfort-thumb-icon") ?? null;
  const sun = thumb?.querySelector(".comfort-sun") ?? null;
  const moon = thumb?.querySelector(".comfort-moon") ?? null;
  const PREVIEW_INTERVAL_MS = 34;
  const PREVIEW_MAX_DEFER_MS = 102;
  let pointerDragging = false;
  let committingTheme = false;
  let pendingValue = Number(slider.value || 55);
  let thumbFrame = null;
  let previewTimer = null;
  let lastPreviewAt = Number.NEGATIVE_INFINITY;
  let previewDeferredAt = 0;

  function normalizedValue() {
    return Math.max(0, Math.min(100, Number(slider.value) || 0));
  }

  function clockNow() {
    return globalThis.performance?.now?.() ?? Date.now();
  }

  function pendingFlowWork() {
    try {
      return Number(globalThis.__INPULS_RENDER_LANES__?.pending?.().flow) || 0;
    } catch {
      return 0;
    }
  }

  function applyThumbVisual() {
    const amount = pendingValue / 100;
    const moonProgress = Math.max(0, Math.min(1, (amount - .2) / .7));
    thumb?.style.setProperty("left", `${pendingValue}%`);
    sun?.style.setProperty("opacity", String(1 - moonProgress));
    sun?.style.setProperty("transform", `scale(${1 - moonProgress}) rotate(${moonProgress * 38}deg)`);
    moon?.style.setProperty("opacity", String(moonProgress));
    moon?.style.setProperty("transform", `scale(${moonProgress}) rotate(${(1 - moonProgress) * -24}deg)`);
  }

  function clearThumbVisual() {
    thumb?.style.removeProperty("left");
    sun?.style.removeProperty("opacity");
    sun?.style.removeProperty("transform");
    moon?.style.removeProperty("opacity");
    moon?.style.removeProperty("transform");
  }

  function flushPalettePreview() {
    previewTimer = null;
    if (!pointerDragging) return;
    const now = clockNow();
    if (pendingFlowWork() > 0 && now - previewDeferredAt < PREVIEW_MAX_DEFER_MS) {
      schedulePalettePreview(16);
      return;
    }
    lastPreviewAt = now;
    previewDeferredAt = now;
    globalThis.dispatchEvent(new CustomEvent("inpuls:comfort-preview", {
      detail: { value: pendingValue },
    }));
  }

  function schedulePalettePreview(delayOverride = null) {
    if (previewTimer !== null) return;
    const elapsed = clockNow() - lastPreviewAt;
    const delay = delayOverride ?? Math.max(0, PREVIEW_INTERVAL_MS - elapsed);
    previewTimer = globalThis.setTimeout(flushPalettePreview, delay);
  }

  function flushThumbPosition() {
    thumbFrame = null;
    applyThumbVisual();
    schedulePalettePreview();
  }

  function scheduleThumbPosition() {
    if (thumbFrame !== null) return;
    thumbFrame = requestAnimationFrame(flushThumbPosition);
  }

  function cancelPendingPreview() {
    if (thumbFrame !== null) {
      cancelAnimationFrame(thumbFrame);
      thumbFrame = null;
    }
    if (previewTimer !== null) {
      globalThis.clearTimeout(previewTimer);
      previewTimer = null;
    }
  }

  function commitThemeOnce() {
    cancelPendingPreview();
    pendingValue = normalizedValue();
    applyThumbVisual();
    committingTheme = true;
    slider.dispatchEvent(new Event("input", { bubbles: true }));
    committingTheme = false;
    clearThumbVisual();
  }

  slider.addEventListener("pointerdown", (event) => {
    pointerDragging = true;
    pendingValue = normalizedValue();
    previewDeferredAt = clockNow();
    root.dataset.comfortDragging = "true";
    thumb?.style.setProperty("transition", "none");
    try { slider.setPointerCapture(event.pointerId); } catch {}
  }, { passive: true });

  slider.addEventListener("input", (event) => {
    if (committingTheme || !pointerDragging) return;
    event.stopImmediatePropagation();
    pendingValue = normalizedValue();
    scheduleThumbPosition();
  });

  function finishPointerDrag(event) {
    if (!pointerDragging) return;
    pointerDragging = false;
    try {
      if (slider.hasPointerCapture?.(event.pointerId)) slider.releasePointerCapture(event.pointerId);
    } catch {}
    commitThemeOnce();
    delete root.dataset.comfortDragging;
    thumb?.style.removeProperty("transition");
  }

  slider.addEventListener("pointerup", finishPointerDrag);
  slider.addEventListener("pointercancel", finishPointerDrag);
  slider.addEventListener("lostpointercapture", finishPointerDrag);
})();

(() => {
  const installButton = document.querySelector("#install-app");
  if (!installButton) return;

  const isStandalone = window.matchMedia("(display-mode: standalone)").matches
    || window.navigator.standalone === true;

  const userAgent = navigator.userAgent.toLowerCase();
  const platform = String(navigator.userAgentData?.platform || navigator.platform || "").toLowerCase();
  const isAppleMobile = /iphone|ipad|ipod/.test(userAgent);
  const isAndroid = userAgent.includes("android");
  const isMac = platform.includes("mac") || userAgent.includes("macintosh");
  const isWindows = platform.includes("win") || userAgent.includes("windows");
  const isYandex = userAgent.includes("yabrowser");
  const isEdge = userAgent.includes("edg/");
  const isFirefox = /firefox|fxios/.test(userAgent);
  const isChrome = /(chrome|chromium|crios)/.test(userAgent)
    && !isYandex
    && !isEdge
    && !userAgent.includes("opr/");
  const isSafari = userAgent.includes("safari")
    && !/(chrome|chromium|crios|edg|opr|yabrowser|firefox|fxios)/.test(userAgent);

  let deferredInstallPrompt = null;
  let installCompleted = false;

  function createInstallDialog() {
    const dialog = document.createElement("dialog");
    dialog.id = "pwa-install-dialog";
    dialog.setAttribute("aria-labelledby", "pwa-install-dialog-title");
    dialog.style.cssText = "width:min(480px,calc(100vw - 32px));padding:0;border:1px solid rgba(124,131,255,.42);border-radius:0;background:#12151c;color:#eef0f7;box-shadow:0 24px 80px rgba(0,0,0,.58);";

    const card = document.createElement("section");
    card.style.cssText = "padding:24px;display:grid;gap:14px;font-family:system-ui,-apple-system,BlinkMacSystemFont,'Segoe UI',sans-serif;";

    const badge = document.createElement("span");
    badge.dataset.role = "badge";
    badge.style.cssText = "width:max-content;padding:6px 9px;border-radius:0;background:rgba(124,131,255,.12);border:1px solid rgba(124,131,255,.34);color:#b7bcff;font-size:11px;font-weight:800;letter-spacing:.09em;text-transform:uppercase;";

    const title = document.createElement("h2");
    title.id = "pwa-install-dialog-title";
    title.dataset.role = "title";
    title.style.cssText = "margin:0;font-size:22px;line-height:1.2;";

    const message = document.createElement("p");
    message.dataset.role = "message";
    message.style.cssText = "margin:0;color:#d7dbea;font-size:15px;line-height:1.55;";

    const detail = document.createElement("p");
    detail.dataset.role = "detail";
    detail.style.cssText = "margin:0;padding:12px 14px;border-radius:0;background:rgba(255,255,255,.035);color:#969eb3;font-size:13px;line-height:1.5;";

    const actions = document.createElement("div");
    actions.style.cssText = "display:flex;justify-content:flex-end;padding-top:4px;";

    const closeButton = document.createElement("button");
    closeButton.type = "button";
    closeButton.textContent = "Понятно";
    closeButton.style.cssText = "min-height:40px;padding:0 18px;border:1px solid rgba(124,131,255,.5);border-radius:0;background:rgba(124,131,255,.15);color:#eef0ff;font:700 13px/1 system-ui,sans-serif;cursor:pointer;";
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

  function successInstructions() {
    if (isAppleMobile) {
      return {
        badge: "Готово",
        title: "InPuls добавлен на экран Домой",
        message: "Скринер установлен как отдельное приложение.",
        detail: "Открывай InPuls по новой иконке на экране Домой — обычная вкладка Safari больше не нужна.",
      };
    }

    if (isAndroid) {
      return {
        badge: "Готово",
        title: "InPuls добавлен на главный экран",
        message: "Скринер установлен как отдельное приложение.",
        detail: "Открывай InPuls по иконке на главном экране или в списке приложений.",
      };
    }

    if (isMac && isSafari) {
      return {
        badge: "Готово",
        title: "InPuls добавлен в Dock",
        message: "Скринер установлен как отдельное приложение на Mac.",
        detail: "Открывай InPuls из Dock, Launchpad, Spotlight или папки «Программы».",
      };
    }

    if (isMac) {
      return {
        badge: "Готово",
        title: "InPuls установлен на Mac",
        message: "Скринер установлен как отдельное приложение.",
        detail: "Открывай InPuls из Launchpad, Spotlight или папки «Программы». При закреплении иконка также будет в Dock.",
      };
    }

    if (isWindows && isFirefox) {
      return {
        badge: "Готово",
        title: "InPuls установлен на компьютер",
        message: "Скринер установлен как отдельное приложение.",
        detail: "Открывай InPuls через меню «Пуск». Firefox добавляет туда ярлык веб-приложения.",
      };
    }

    if (isWindows && isEdge) {
      return {
        badge: "Готово",
        title: "InPuls установлен — ищи на рабочем столе",
        message: "Скринер установлен как отдельное приложение на компьютер.",
        detail: "Edge может предложить создать ярлык, закрепить InPuls в меню «Пуск» или на панели задач. Если ярлыка на рабочем столе нет, открывай приложение из меню «Пуск».",
      };
    }

    if (isWindows && isYandex) {
      return {
        badge: "Готово",
        title: "InPuls установлен — ищи на рабочем столе",
        message: "Скринер установлен как отдельное приложение на компьютер.",
        detail: "Открывай InPuls по ярлыку на рабочем столе. Если браузер не создал его автоматически, найди InPuls в меню «Пуск» или разделе приложений Яндекс Браузера.",
      };
    }

    if (isWindows && isChrome) {
      return {
        badge: "Готово",
        title: "InPuls установлен — ищи на рабочем столе",
        message: "Скринер установлен как отдельное приложение на компьютер.",
        detail: "Ищи ярлык InPuls на рабочем столе или в меню «Пуск». Точное место зависит от настроек Chrome.",
      };
    }

    if (isWindows) {
      return {
        badge: "Готово",
        title: "InPuls установлен на компьютер",
        message: "Скринер установлен как отдельное приложение.",
        detail: "Ищи InPuls на рабочем столе, в меню «Пуск» или в списке приложений.",
      };
    }

    return {
      badge: "Готово",
      title: "InPuls установлен",
      message: "Скринер установлен как отдельное приложение.",
      detail: "Открывай InPuls по новой иконке среди приложений устройства.",
    };
  }

  function showInstallSuccess() {
    if (installCompleted) return;
    installCompleted = true;
    deferredInstallPrompt = null;
    installButton.hidden = true;
    showInstallDialog(successInstructions());
  }

  function fallbackInstructions() {
    if (isAppleMobile) {
      return {
        badge: "iPhone / iPad",
        title: "Добавить InPuls на экран Домой",
        message: "Safari не открывает установку сайта программно.",
        detail: "Нажми «Поделиться», затем выбери «На экран Домой» и подтверди добавление.",
      };
    }

    if (isAndroid) {
      return {
        badge: "Android",
        title: "Установить InPuls",
        message: "Браузер не открыл системное окно установки.",
        detail: "Открой меню браузера и выбери «Установить приложение» или «Добавить на главный экран».",
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
        detail: "Нажми значок веб-приложения в адресной строке. После установки открывай InPuls через меню «Пуск».",
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

    if (isEdge) {
      return {
        badge: "Microsoft Edge",
        title: "Установить InPuls через Edge",
        message: "Edge не выдал сайту системное окно установки.",
        detail: "Открой меню «… → Приложения → Установить InPuls». После установки Edge предложит варианты ярлыка и закрепления.",
      };
    }

    if (isYandex) {
      return {
        badge: "Яндекс Браузер",
        title: "Установить InPuls через браузер",
        message: "Яндекс Браузер не выдал сайту системное окно установки.",
        detail: "Открой меню браузера и выбери «Установить приложение» или раздел «Приложения». Возможно, InPuls уже установлен.",
      };
    }

    if (isChrome) {
      return {
        badge: "Google Chrome",
        title: "Установить InPuls через Chrome",
        message: "Chrome не выдал сайту системное окно установки.",
        detail: "Нажми значок установки в адресной строке или открой меню Chrome и выбери «Установить InPuls». Возможно, приложение уже установлено.",
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
