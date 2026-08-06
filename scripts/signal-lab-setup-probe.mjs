import { spawn } from "node:child_process";

const mode = process.argv[2];
const targetUrl = process.argv[3];
if (!["levels", "cascade"].includes(mode) || !targetUrl) {
  throw new Error("Usage: node scripts/signal-lab-setup-probe.mjs <levels|cascade> <url>");
}

const child = spawn(process.execPath, [
  "scripts/signal-lab-runtime-smoke.mjs",
  targetUrl,
], {
  env: process.env,
  stdio: ["ignore", "pipe", "pipe"],
});

let stdout = "";
let stderr = "";
child.stdout.on("data", (chunk) => { stdout += chunk.toString(); });
child.stderr.on("data", (chunk) => { stderr += chunk.toString(); });

const exitCode = await new Promise((resolve) => child.on("close", resolve));
if (stderr.trim()) process.stderr.write(stderr);
if (exitCode !== 0) {
  process.stdout.write(stdout);
  process.exit(exitCode || 1);
}

let report;
try {
  report = JSON.parse(stdout);
} catch (error) {
  process.stdout.write(stdout);
  throw new Error(`Cannot parse Signal Lab smoke report: ${error.message}`);
}

const statusText = String(report?.finalState?.statusText ?? "");
const zonesMatch = statusText.match(/зоны\s+(\d+)\/(\d+)/i);
const cascadesMatch = statusText.match(/каскады\s+(\d+)\/(\d+)\/(\d+)/i);
const levelMaps = Number(zonesMatch?.[1] ?? 0);
const breakoutEvents = Number(zonesMatch?.[2] ?? 0);
const cascadeSetups = Number(cascadesMatch?.[1] ?? 0);
const cascadeTriggered = Number(cascadesMatch?.[2] ?? 0);
const cascadeConfirmed = Number(cascadesMatch?.[3] ?? 0);

const summary = {
  mode,
  targetUrl,
  activeExtremes: report?.finalState?.activeExtremes ?? 0,
  extremeMaps: report?.finalState?.extremeMaps ?? 0,
  levelMaps,
  breakoutEvents,
  cascadeSetups,
  cascadeTriggered,
  cascadeConfirmed,
  statusText,
};
console.log(JSON.stringify(summary, null, 2));

if (mode === "levels" && levelMaps <= 0) {
  throw new Error("Signal Lab has active extrema but produced zero active level maps");
}
if (mode === "cascade" && cascadeSetups + cascadeTriggered + cascadeConfirmed <= 0) {
  throw new Error("Signal Lab has active levels but produced zero cascade SETUP/TRIGGERED/CONFIRMED events");
}
