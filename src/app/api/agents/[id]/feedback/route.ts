import { journal } from "@/lib/memory";
import { getAgent } from "@/lib/named-agents";

// 👍/👎 on a chat reply — journalled, then folded into LEARNINGS.md while dreaming.
export async function POST(request: Request, { params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const body = (await request.json().catch(() => null)) as {
    rating?: string;
    note?: string;
    question?: string;
    answer?: string;
  } | null;
  if (!body || !["up", "down"].includes(body.rating ?? "")) {
    return Response.json({ error: "rating must be up or down" }, { status: 400 });
  }
  try {
    getAgent(id);
    journal(id, {
      kind: "feedback",
      rating: body.rating,
      note: body.note ?? "",
      question: body.question ?? "",
      answer: body.answer ?? "",
    });
    return Response.json({ ok: true });
  } catch (err) {
    return Response.json({ error: err instanceof Error ? err.message : String(err) }, { status: 422 });
  }
}
