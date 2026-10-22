import type { EngineId, EngineMode, EngineStatus } from "./types";

/** Auto order: a connected API key first (explicit choice), then the CLIs. */
export const AUTO_ORDER: readonly EngineId[] = ["anthropic-api", "claude-cli", "codex-cli"];

/** Which engine answers, given the mode and what is ready. Pure. */
export function pickActive(mode: EngineMode, engines: EngineStatus[]): EngineId | null {
  const ready = (id: EngineId) => engines.find((e) => e.engine === id)?.ready === true;
  if (mode !== "auto") return ready(mode) ? mode : null;
  return AUTO_ORDER.find(ready) ?? null;
}
