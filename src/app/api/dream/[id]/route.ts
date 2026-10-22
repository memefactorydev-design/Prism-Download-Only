import { allDreamSubjects, dream, type DreamOutcome } from "@/lib/memory";

export const maxDuration = 300;

// Run a dream cycle now — one agent (named team or pipeline), or 'all'
// (sequential, to be gentle on quotas).
export async function POST(_request: Request, { params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const subjects = allDreamSubjects();
  const targets = id === "all" ? subjects : subjects.filter((a) => a.id === id);
  if (!targets.length) return Response.json({ error: `Unknown agent: ${id}` }, { status: 404 });

  const results: (DreamOutcome | { agentId: string; error: string })[] = [];
  for (const agent of targets) {
    try {
      results.push(await dream(agent));
    } catch (err) {
      results.push({ agentId: agent.id, error: err instanceof Error ? err.message : String(err) });
    }
  }
  return Response.json({ results });
}
