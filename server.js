import { createReadStream, existsSync, statSync } from "node:fs";
import { createServer } from "node:http";
import { extname, join, normalize } from "node:path";

const port = Number(process.env.PORT) || 4173;
const types = { ".html": "text/html; charset=utf-8", ".js": "text/javascript; charset=utf-8", ".css": "text/css; charset=utf-8", ".svg": "image/svg+xml", ".webmanifest": "application/manifest+json" };

createServer((request, response) => {
  const urlPath = decodeURIComponent(new URL(request.url, `http://${request.headers.host}`).pathname);
  const safePath = normalize(urlPath).replace(/^(\.\.[/\\])+/, "");
  let filePath = join(process.cwd(), safePath === "/" ? "index.html" : safePath);
  if (!existsSync(filePath) || statSync(filePath).isDirectory()) filePath = join(process.cwd(), "index.html");
  response.writeHead(200, { "content-type": types[extname(filePath)] || "application/octet-stream", "cache-control": "no-cache" });
  createReadStream(filePath).pipe(response);
}).listen(port, "127.0.0.1", () => {
  console.log(`InPuls: http://127.0.0.1:${port}`);
});
