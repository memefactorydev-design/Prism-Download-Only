// Turn one GBP action from the SEO audit into a ready-to-approve Google
// Business post: channel-copy-agent writes the post, it lands as a normal
// calendar draft behind the usual approval gate.

import { runAgent } from "@/lib/agents/run-agent";
import { CHANNEL_SPECS, clampCaption, createDraft, resolveFormat } from "@/lib/posts";
import { getSessionUser, scopeOf } from "@/lib/auth";

export const maxDuration = 120;

const DRAFT_SCHEMA = {
  type: "object",
  properties: {
    caption: { type: "string", description: "The Google Business post text, ready to publish — no hashtags." },
    title: { type: "string", description: "A short internal title for the draft." },
  },
  required: ["caption", "title"],
  additionalProperties: false,
};

export async function POST(request: Request) {
  const user = await getSessionUser();
  if (!user) return Response.json({ error: "Not signed in." }, { status: 401 });
  const body = (await request.json().catch(() => ({}))) as { action?: string };
  if (!body.action?.trim()) return Response.json({ error: "Pass the GBP action to draft from." }, { status: 400 });

  const task = [
    "Turn this Google Business Profile action item into ONE ready-to-post GBP update (a 'What's New' post).",
    `HARD LIMIT: under ${CHANNEL_SPECS.gbp.maxChars} characters. Local, concrete, with a clear next step for the reader.`,
    "",
    "## The action item",
    body.action.trim().slice(0, 600),
  ].join("\n");

  try {
    const { data } = await runAgent<{ caption: string; title: string }>("channel-copy-agent", task, {
      schema: DRAFT_SCHEMA,
      maxTokens: 4000,
      reportKind: "channel_copy",
      reportTitle: `GBP post from audit action`,
      scopeUserId: scopeOf(user),
    });
    if (!data) throw new Error("channel-copy-agent returned no copy.");
    const post = await createDraft(
      {
        channel: "gbp",
        format: resolveFormat("gbp", undefined),
        title: data.title?.trim() || undefined,
        body: clampCaption("gbp", data.caption),
      },
      user
    );
    return Response.json({ postId: post.id });
  } catch (err) {
    return Response.json({ error: err instanceof Error ? err.message : String(err) }, { status: 422 });
  }
}
