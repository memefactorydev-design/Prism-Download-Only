// Parsers for the two CLI engines, checked against output captured from the
// real binaries (Claude Code 2.1.308, Codex 0.154.0) — see tests/fixtures.
// Run: npm test

import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import path from "node:path";
import { describe, it } from "node:test";
import { handleClaudeLine, parseClaudeStdout, type ClaudeStreamState } from "../src/lib/llm/claude-cli";
import { handleCodexLine, type CodexStreamState } from "../src/lib/llm/codex-cli";
import { USAGE_LIMIT_RE } from "../src/lib/llm/errors";
import { pickActive } from "../src/lib/llm/select";
import { parseJsonLoose, renderTranscript } from "../src/lib/llm/transcript";
import type { EngineStatus } from "../src/lib/llm/types";

const fixture = (name: string) => readFileSync(path.join(__dirname, "fixtures", name), "utf8");

describe("claude -p --output-format json", () => {
  it("reads the result and the validated structured_output", () => {
    const result = parseClaudeStdout(fixture("claude-json.json"));
    assert.ok(result);
    assert.equal(result.is_error, false);
    assert.equal(result.subtype, "success");
    assert.deepEqual(result.structured_output, { ok: true, msg: "Hello" });
    assert.equal(result.result, '{"ok":true,"msg":"Hello"}');
    assert.equal(result.usage?.output_tokens, 76);
    assert.equal(Object.keys(result.modelUsage ?? {})[0], "claude-sonnet-5-5");
  });

  it("returns null for junk", () => {
    assert.equal(parseClaudeStdout("not json at all"), null);
  });
});

describe("claude -p --output-format stream-json", () => {
  it("accumulates text deltas and ends on the result line", () => {
    const state: ClaudeStreamState = { acc: "", result: null };
    const deltas: string[] = [];
    for (const line of fixture("claude-stream.jsonl").split("\n")) {
      if (line.trim()) handleClaudeLine(line, state, (acc) => deltas.push(acc));
    }
    assert.ok(deltas.length > 3, "several partial deltas arrive");
    assert.ok(state.result, "the final result line was seen");
    assert.equal(state.result.subtype, "success");
    assert.equal(state.acc, state.result.result, "deltas add up to the final text");
    assert.match(state.acc, /^Tea is brewed/);
  });
});

describe("codex exec --json", () => {
  it("takes the last agent_message and the turn usage", () => {
    const state: CodexStreamState = { text: "", failure: null };
    for (const line of fixture("codex-exec.jsonl").split("\n")) handleCodexLine(line, state);
    assert.equal(state.text, '{"ok":true,"msg":"Hello"}');
    assert.equal(state.usage?.input_tokens, 18807);
    assert.equal(state.failure, null);
    assert.deepEqual(parseJsonLoose(state.text), { ok: true, msg: "Hello" });
  });

  it("records a turn failure", () => {
    const state: CodexStreamState = { text: "", failure: null };
    handleCodexLine(JSON.stringify({ type: "turn.failed", error: { message: "usage limit reached, resets in 2h" } }), state);
    assert.equal(state.failure, "usage limit reached, resets in 2h");
    assert.match(state.failure!, USAGE_LIMIT_RE);
  });
});

describe("transcript", () => {
  it("passes a single user turn through untouched", () => {
    assert.equal(renderTranscript([{ role: "user", content: "hi <there>" }]), "hi <there>");
  });
  it("labels a multi-turn conversation", () => {
    const t = renderTranscript([
      { role: "user", content: "one" },
      { role: "assistant", content: "two" },
      { role: "user", content: "three" },
    ]);
    assert.match(t, /### User\none/);
    assert.match(t, /### Assistant\ntwo/);
    assert.ok(t.endsWith("### User\nthree"));
  });
  it("parses fenced and prose-wrapped JSON", () => {
    assert.deepEqual(parseJsonLoose('```json\n{"a":1}\n```'), { a: 1 });
    assert.deepEqual(parseJsonLoose('Sure! Here it is: {"a":[1,2]} — done.'), { a: [1, 2] });
    assert.throws(() => parseJsonLoose("no json here"));
  });
});

describe("engine selection", () => {
  const status = (engine: EngineStatus["engine"], ready: boolean): EngineStatus => ({
    engine,
    label: engine,
    installed: ready,
    ready,
    detail: "",
    webSearch: false,
    howTo: [],
  });
  it("auto prefers a key, then Claude Code, then Codex", () => {
    const all = [status("anthropic-api", true), status("claude-cli", true), status("codex-cli", true)];
    assert.equal(pickActive("auto", all), "anthropic-api");
    assert.equal(pickActive("auto", [status("anthropic-api", false), status("claude-cli", true), status("codex-cli", true)]), "claude-cli");
    assert.equal(pickActive("auto", [status("anthropic-api", false), status("claude-cli", false), status("codex-cli", true)]), "codex-cli");
    assert.equal(pickActive("auto", [status("anthropic-api", false), status("claude-cli", false), status("codex-cli", false)]), null);
  });
  it("a forced engine that is not ready yields none rather than a silent fallback", () => {
    assert.equal(pickActive("codex-cli", [status("anthropic-api", true), status("claude-cli", true), status("codex-cli", false)]), null);
    assert.equal(pickActive("claude-cli", [status("anthropic-api", true), status("claude-cli", true), status("codex-cli", false)]), "claude-cli");
  });
});

describe("usage-limit detection", () => {
  it("matches the phrasings the CLIs use", () => {
    for (const m of [
      "You've hit your usage limit. It resets at 3pm.",
      "Rate limit exceeded",
      "HTTP 429 Too Many Requests",
      "insufficient_quota",
    ]) {
      assert.match(m, USAGE_LIMIT_RE);
    }
    assert.doesNotMatch("The page was too large", USAGE_LIMIT_RE);
  });
});
