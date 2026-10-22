import type { EngineId } from "./types";

/** No engine can take the call: nothing installed/signed in and no API key. */
export class EngineNotReadyError extends Error {
  readonly code = "ENGINE_NOT_READY";
  constructor(message: string) {
    super(message);
    this.name = "EngineNotReadyError";
  }
}

/** The user's plan (or API account) refused the call for quota/rate reasons. */
export class UsageLimitError extends Error {
  readonly code = "USAGE_LIMIT";
  readonly engine: EngineId;
  readonly resetsAt?: Date;
  constructor(engine: EngineId, message: string, resetsAt?: Date) {
    super(message);
    this.name = "UsageLimitError";
    this.engine = engine;
    this.resetsAt = resetsAt;
  }
}

export function isEngineNotReady(err: unknown): err is EngineNotReadyError {
  return err instanceof EngineNotReadyError || (err as { code?: string })?.code === "ENGINE_NOT_READY";
}

export function isUsageLimit(err: unknown): err is UsageLimitError {
  return err instanceof UsageLimitError || (err as { code?: string })?.code === "USAGE_LIMIT";
}

/** Text that smells like a plan / rate limit in a CLI's error output. */
export const USAGE_LIMIT_RE =
  /usage limit|rate limit|rate-limit|limit reached|quota|too many requests|resets? (at|in)|\b429\b|out of credits|insufficient[_ ]quota/i;

/** Human message for a limit, with the reset time when the engine told us. */
export function usageLimitMessage(engine: EngineId, resetsAt?: Date): string {
  const who =
    engine === "claude-cli"
      ? "your Claude plan"
      : engine === "codex-cli"
        ? "your ChatGPT plan"
        : "your Anthropic API account";
  const when = resetsAt ? ` It resets at ${resetsAt.toLocaleString("en-GB")}.` : "";
  return `${who[0].toUpperCase()}${who.slice(1)} has hit its usage limit, so the AI engine is paused.${when} Try again later or switch engine on Connections.`;
}
