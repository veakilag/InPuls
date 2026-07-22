console.info("InPuls v35 local entry: start");

const statusText = document.querySelector("#connection-text");
const clock = document.querySelector("#clock");

function showStartError(error) {
  const message = error?.stack || error?.message || String(error);
  console.error("InPuls v35 start failed:", error);

  if (statusText) statusText.textContent = "Ошибка запуска";
  if (clock) {
    clock.textContent = "ОШИБКА";
    clock.title = message;
  }

  let panel = document.querySelector("#inpuls-v35-error");
  if (!panel) {
    panel = document.createElement("pre");
    panel.id = "inpuls-v35-error";
    panel.style.cssText = [
      "position:fixed",
      "z-index:999999",
      "left:16px",
      "right:16px",
      "bottom:16px",
      "max-height:42vh",
      "overflow:auto",
      "padding:14px",
      "border:1px solid #ff5d6c",
      "border-radius:10px",
      "background:#180b0f",
      "color:#ffb8c0",
      "font:12px/1.45 ui-monospace,monospace",
      "white-space:pre-wrap",
    ].join(";");
    document.body.append(panel);
  }
  panel.textContent = message;
}

try {
  if (statusText) statusText.textContent = "Запуск локального ядра v35…";

  // Исправляем только два устаревших адреса основного рыночного потока.
  const NativeWebSocket = globalThis.WebSocket;

  function PatchedWebSocket(url, protocols) {
    let nextUrl = String(url);

    if (nextUrl === "wss://fstream.binance.com/market/stream") {
      nextUrl = "wss://fstream.binance.com/ws";
    } else if (nextUrl === "wss://stream.binancefuture.com/market/stream") {
      nextUrl = "wss://stream.binancefuture.com/ws";
    }

    return protocols === undefined
      ? new NativeWebSocket(nextUrl)
      : new NativeWebSocket(nextUrl, protocols);
  }

  Object.setPrototypeOf(PatchedWebSocket, NativeWebSocket);
  PatchedWebSocket.prototype = NativeWebSocket.prototype;

  for (const key of ["CONNECTING", "OPEN", "CLOSING", "CLOSED"]) {
    Object.defineProperty(PatchedWebSocket, key, {
      value: NativeWebSocket[key],
      enumerable: true,
    });
  }

  globalThis.WebSocket = PatchedWebSocket;

  // Это обычный статический import: браузер сам загружает app.js как модуль.
  await import("./app.js?v=23&entry=v35");

  console.info("InPuls v35 local entry: app started");
} catch (error) {
  showStartError(error);
}
