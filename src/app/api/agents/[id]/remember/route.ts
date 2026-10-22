import { remember } from "@/lib/memory";
import { getAgent } from "@/lib/named-agents";

export async function POST(request: Request, { params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const body = (await request.json().catch(() => null)) as { text?: string } | null;
  if (!body?.text?.trim()) return Response.json({ error: "text is required" }, { status: 400 });
  try {
    getAgent(id);
    remember(id, body.text.trim());
    return Response.json({ ok: true });
  } catch (err) {
    return Response.json({ error: err instanceof Error ? err.message : String(err) }, { status: 422 });
  }
}
