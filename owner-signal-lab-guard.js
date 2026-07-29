const OWNER_SIGNAL_LAB_STARTED_EVENT = "inpuls:owner-signal-lab-started";
const OWNER_SIGNAL_LAB_GUARD_TIMEOUT_MS = 15_000;

const guardTimer = setTimeout(() => {
  const status = document.querySelector("#storage-state");
  const refresh = document.querySelector("#refresh-report");
  const empty = document.querySelector("#owner-empty");
  const emptyTitle = document.querySelector("#owner-empty-title");
  const emptyMessage = document.querySelector("#owner-empty-message");

  if (status) {
    status.dataset.state = "error";
    status.textContent = "Не удалось запустить Signal Lab";
    status.title = "owner-signal-lab-module-did-not-settle";
  }
  if (refresh) {
    refresh.disabled = false;
    refresh.dataset.bootFallback = "true";
    refresh.textContent = "Перезагрузить";
  }
  if (empty) empty.hidden = false;
  if (emptyTitle) emptyTitle.textContent = "Дашборд не загрузился";
  if (emptyMessage) {
    emptyMessage.textContent = "Нажми «Перезагрузить». Локальная история останется на устройстве.";
  }
}, OWNER_SIGNAL_LAB_GUARD_TIMEOUT_MS);

window.addEventListener(OWNER_SIGNAL_LAB_STARTED_EVENT, () => {
  clearTimeout(guardTimer);
}, { once: true });

document.querySelector("#refresh-report")?.addEventListener("click", (event) => {
  if (event.currentTarget?.dataset.bootFallback === "true") window.location.reload();
});
