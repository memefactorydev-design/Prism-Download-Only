import type { LlmMessage } from "./types";

/**
 * The CLIs take one prompt, not a message array. A single user turn is passed
 * verbatim; a longer conversation is rendered as a labelled transcript with an
 * instruction to answer only the last turn.
 */
export function renderTranscript(messages: LlmMessage[]): string {
  if (messages.length === 0) return "";
  if (messages.length === 1 && messages[0].role === "user") return messages[0].content;
  const out: string[] = [
    "Below is the conversation so far, oldest first. Reply to the final user message only, in the assistant's own voice. Do not repeat the labels.",
    "",
  ];
  for (const m of messages) {
    out.push(m.role === "user" ? "### User" : "### Assistant", m.content, "");
  }
  return out.join("\n").trimEnd();
}

/** Strip ```json fences a model may wrap around a JSON reply. */
export function stripCodeFences(text: string): string {
  const t = text.trim();
  const m = t.match(/^```(?:json)?\s*([\s\S]*?)\s*```$/i);
  return m ? m[1].trim() : t;
}

/** Parse a JSON object out of model text, tolerating fences and surrounding prose. */
export function parseJsonLoose(text: string): unknown {
  const stripped = stripCodeFences(text);
  try {
    return JSON.parse(stripped);
  } catch {
    const start = stripped.search(/[[{]/);
    const end = Math.max(stripped.lastIndexOf("}"), stripped.lastIndexOf("]"));
    if (start !== -1 && end > start) {
      return JSON.parse(stripped.slice(start, end + 1));
    }
    throw new Error("The model did not return valid JSON.");
  }
}
