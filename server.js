import { createReadStream, existsSync, statSync } from "node:fs";
import { createServer } from "node:http";
import { dirname, extname, resolve, sep } from "node:path";
import { fileURLToPath } from "node:url";

const APP_ROOT = dirname(fileURLToPath(import.meta.url));
const DEFAULT_PORT = 4173;

export const CONTENT_SECURITY_POLICY = [
  "default-src 'self'",
  "base-uri 'none'",
  "object-src 'none'",
  "frame-ancestors 'none'",
  "form-action 'self'",
  "script-src 'self'",
  "style-src 'self' 'unsafe-inline'",
  "img-src 'self' data:",
  "font-src 'self'",
  "manifest-src 'self'",
  "worker-src 'self'",
  "connect-src 'self' https://fapi.binance.com https://fapi1.binance.com https://fapi2.binance.com wss://fstream.binance.com",
].join("; ");

export const SECURITY_HEADERS = Object.freeze({
  "content-security-policy": CONTENT_SECURITY_POLICY,
  "cross-origin-opener-policy": "same-origin",
  "cross-origin-resource-policy": "same-origin",
  "permissions-policy": "camera=(), geolocation=(), microphone=(), payment=(), usb=()",
  "referrer-policy": "no-referrer",
  "x-content-type-options": "nosniff",
  "x-frame-options": "DENY",
  "x-permitted-cross-domain-policies": "none",
});

const CONTENT_TYPES = Object.freeze({
  ".css": "text/css; charset=utf-8",
  ".html": "text/html; charset=utf-8",
  ".js": "text/javascript; charset=utf-8",
  ".png": "image/png",
  ".svg": "image/svg+xml",
  ".txt": "text/plain; charset=utf-8",
  ".webmanifest": "application/manifest+json",
});

const DENIED_PREFIXES = ["/.github/", "/docs/", "/node_modules/", "/test/"];
const DENIED_FILES = new Set(["/package.json", "/server.js"]);

function sendText(response, status, message, extraHeaders = {}) {
  const body = `${message}\n`;
  response.writeHead(status, {
    ...SECURITY_HEADERS,
    "cache-control": "no-store",
    "content-length": Buffer.byteLength(body),
    "content-type": "text/plain; charset=utf-8",
    ...extraHeaders,
  });
  response.end(body);
}

function safeRequestPath(rawUrl) {
  let pathname;
  try {
    pathname = decodeURIComponent(new URL(rawUrl || "/", "http://127.0.0.1").pathname);
  } catch {
    return { error: 400 };
  }
  pathname = pathname.replaceAll("\\", "/");
  if (pathname.includes("\0")) return { error: 400 };
  const segments = pathname.split("/").filter(Boolean);
  if (segments.some((segment) => segment.startsWith("."))) return { error: 404 };
  if (DENIED_FILES.has(pathname) || DENIED_PREFIXES.some((prefix) => pathname.startsWith(prefix)) || /^\/test-.+/.test(pathname)) {
    return { error: 404 };
  }
  return { pathname };
}

function resolveStaticFile(root, pathname) {
  const filePath = resolve(root, `.${pathname === "/" ? "/index.html" : pathname}`);
  if (filePath !== root && !filePath.startsWith(`${root}${sep}`)) return { error: 403 };
  const extension = extname(filePath);
  if (extension && !CONTENT_TYPES[extension]) return { error: 404 };
  try {
    if (existsSync(filePath) && statSync(filePath).isFile()) return { filePath, extension };
  } catch {
    return { error: 404 };
  }
  if (extension || pathname === "/") return { error: 404 };
  return { filePath: resolve(root, "index.html"), extension: ".html" };
}

export function createStaticServer({ root = APP_ROOT } = {}) {
  const documentRoot = resolve(root);
  return createServer((request, response) => {
    if (!["GET", "HEAD"].includes(request.method || "")) {
      sendText(response, 405, "Method Not Allowed", { allow: "GET, HEAD" });
      return;
    }

    const parsed = safeRequestPath(request.url);
    if (parsed.error) {
      sendText(response, parsed.error, parsed.error === 400 ? "Bad Request" : "Not Found");
      return;
    }

    const resolved = resolveStaticFile(documentRoot, parsed.pathname);
    if (resolved.error) {
      sendText(response, resolved.error, resolved.error === 403 ? "Forbidden" : "Not Found");
      return;
    }

    const size = statSync(resolved.filePath).size;
    response.writeHead(200, {
      ...SECURITY_HEADERS,
      "cache-control": "no-cache",
      "content-length": size,
      "content-type": CONTENT_TYPES[resolved.extension],
    });
    if (request.method === "HEAD") {
      response.end();
      return;
    }
    const stream = createReadStream(resolved.filePath);
    stream.on("error", (error) => response.destroy(error));
    stream.pipe(response);
  });
}

const isEntryPoint = process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url);
if (isEntryPoint) {
  const configuredPort = Number(process.env.PORT);
  const port = Number.isInteger(configuredPort) && configuredPort > 0 && configuredPort <= 65_535
    ? configuredPort
    : DEFAULT_PORT;
  createStaticServer().listen(port, "127.0.0.1", () => {
    console.log(`InPuls: http://127.0.0.1:${port}`);
  });
}
