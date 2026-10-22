#!/usr/bin/env node
// First-run setup for a fresh checkout. Idempotent — safe to run again.
//
//   npm install
//   npm run setup      ← this file
//   npm run dev        (and `npm run worker` in a second terminal for video renders)
//
// What it does:
//   1. Creates .env from .env.example (only if .env does not exist yet) with a
//      freshly generated TOKEN_ENCRYPTION_KEY and DASHBOARD_PASSWORD, and
//      OPEN_ACCESS=1 so the app opens without a login screen.
//   2. Creates the runtime folders (uploads/, data/, .cache/).
//   3. Generates the Prisma client and applies all migrations to the SQLite DB.
//
// Nothing here talks to the network. Service API keys (Anthropic, Gemini, fal,
// ElevenLabs, Postiz, Meta, …) are added later — in .env or on /connections.

import { randomBytes } from "node:crypto";
import { existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { spawnSync } from "node:child_process";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const root = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const envPath = resolve(root, ".env");

function setVar(text, key, value) {
  const line = `${key}="${value}"`;
  const re = new RegExp(`^${key}=.*$`, "m");
  return re.test(text) ? text.replace(re, line) : `${text.trimEnd()}\n${line}\n`;
}

function run(cmd, args) {
  const res = spawnSync(cmd, args, { cwd: root, stdio: "inherit", shell: process.platform === "win32" });
  if (res.status !== 0) {
    console.error(`\n✖ ${cmd} ${args.join(" ")} failed (exit ${res.status ?? "?"})`);
    process.exit(res.status ?? 1);
  }
}

console.log("Prism AI — first-run setup\n");

if (existsSync(envPath)) {
  console.log("• .env already exists — leaving it untouched.");
} else {
  let env = readFileSync(resolve(root, ".env.example"), "utf8");
  env = setVar(env, "DATABASE_URL", "file:./dev.db");
  env = setVar(env, "TOKEN_ENCRYPTION_KEY", randomBytes(32).toString("hex"));
  env = setVar(env, "DASHBOARD_PASSWORD", randomBytes(12).toString("base64url"));
  env = setVar(env, "OPEN_ACCESS", "1");
  env = setVar(env, "APP_BASE_URL", "http://localhost:3000");
  env = setVar(env, "DREAMS_ENABLED", "1");
  env = setVar(env, "LLM_ENGINE", "auto");
  writeFileSync(envPath, env);
  console.log("• Wrote .env with a generated TOKEN_ENCRYPTION_KEY (OPEN_ACCESS=1 — no login needed).");
}

for (const dir of ["uploads", "data", ".cache"]) {
  mkdirSync(resolve(root, dir), { recursive: true });
}
console.log("• Runtime folders ready (uploads/, data/, .cache/).");

// Which AI engines this machine already has. Nothing is installed or changed
// here — the app just needs one of these signed in (or an API key) to think.
function probe(cmd, args) {
  const res = spawnSync(cmd, args, { encoding: "utf8", shell: process.platform === "win32" });
  return res.error ? null : { code: res.status, out: `${res.stdout ?? ""}${res.stderr ?? ""}`.trim() };
}
console.log("\n• AI engines on this machine:");
const claude = probe("claude", ["auth", "status"]);
if (!claude) console.log("  – Claude Code: not installed   (npm i -g @anthropic-ai/claude-code && claude auth login)");
else if (claude.code === 0) console.log("  ✓ Claude Code: signed in — agents will bill your Claude plan");
else console.log("  – Claude Code: installed, not signed in   (claude auth login)");
const codex = probe("codex", ["login", "status"]);
if (!codex) console.log("  – Codex: not installed   (npm i -g @openai/codex && codex login)");
else if (codex.code === 0) console.log("  ✓ Codex: signed in — agents will bill your ChatGPT plan");
else console.log("  – Codex: installed, not signed in   (codex login)");
if (!(claude && claude.code === 0) && !(codex && codex.code === 0)) {
  console.log("  (Sign in to one of them, or add ANTHROPIC_API_KEY to .env — the /connections page will guide you.)");
}

console.log("\n• Generating the Prisma client…");
run("npx", ["prisma", "generate"]);
console.log("\n• Applying database migrations…");
run("npx", ["prisma", "migrate", "deploy"]);

console.log(`
✔ Done.

  Start the app:      npm run dev          → http://localhost:3000
  Video renders:      npm run worker       (second terminal; optional until you use Studio/Director)
  Production build:   npm run build && npm run start

  The AI engine is whichever CLI is signed in above (Claude Code or Codex) —
  no API credits needed. Optional services (publishing, images, video, voice)
  take their keys in .env or on /connections. To turn the login screen back
  on, set OPEN_ACCESS="0" in .env.
`);
