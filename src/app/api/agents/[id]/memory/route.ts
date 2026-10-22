import { readMemory, writeMemory, lastDream } from "@/lib/memory";
import { getAgent } from "@/lib/named-agents";

export async function GET(_request: Request, { params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  try {
    getAgent(id);
    return Response.json({ ...readMemory(id), lastDream: lastDream(id) });
  } catch (err) {
    return Response.json({ error: err instanceof Error ? err.message : String(err) }, { status: 404 });
  }
}

export async function PUT(request: Request, { params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const body = (await request.json().catch(() => null)) as { memory?: string; learnings?: string } | null;
  if (!body) return Response.json({ error: "Missing request body." }, { status: 400 });
  try {
    getAgent(id);
    writeMemory(id, body);
    return Response.json({ ok: true });
  } catch (err) {
    return Response.json({ error: err instanceof Error ? err.message : String(err) }, { status: 422 });
  }
}
