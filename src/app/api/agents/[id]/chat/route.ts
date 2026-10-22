import { getSessionUser, scopeOf } from "@/lib/auth";
import { systemPrompt } from "@/lib/named-agents";
import { generate, type EngineMessage } from "@/lib/engine";
import { journal } from "@/lib/memory";

export const maxDuration = 300;

interface ChatBody {
  messages: EngineMessage[];
  useSearch?: boolean;
  useIntel?: boolean;
}

export async function POST(request: Request, { params }: { params: Promise<{ id: string }> }) {
  const user = await getSessionUser();
  if (!user) return Response.json({ error: "Not signed in." }, { status: 401 });
  const scope = scopeOf(user);
  const { id } = await params;
  const body = (await request.json().catch(() => null)) as ChatBody | null;
  if (!body?.messages?.length) return Response.json({ error: "Missing messages." }, { status: 400 });

  try {
    // Briefed on THIS scope's brand (the workspace's, or the member's own).
    let system = await systemPrompt(id, scope);
    // Platform intel: prepend this agent's fresh scraped briefs when asked.
    if (body.useIntel) {
      const { briefsFor } = await import("@/lib/intel");
      const briefs = briefsFor([id]);
      if (briefs) system += `\n\n---\n\n${briefs}`;
    }
    const result = await generate({
      system,
      messages: body.messages,
      useSearch: body.useSearch,
    });
    const lastUser = [...body.messages].reverse().find((m) => m.role === "user");
    // Only workspace conversations train the agents' memory.
    if (scope === "") {
      journal(id, { kind: "chat", useSearch: Boolean(body.useSearch), user: lastUser?.content ?? "", reply: result.text });
    }
    return Response.json(result);
  } catch (err) {
    return Response.json({ error: err instanceof Error ? err.message : String(err) }, { status: 422 });
  }
}
