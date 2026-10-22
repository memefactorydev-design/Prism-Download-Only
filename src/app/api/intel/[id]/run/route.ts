import { runIntel } from "@/lib/intel";

export const maxDuration = 300;

export async function POST(request: Request, { params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const body = (await request.json().catch(() => null)) as { params?: Record<string, string> } | null;
  try {
    const record = await runIntel(id, body?.params ?? {});
    return Response.json({
      fetchedAt: record.fetchedAt,
      itemCount: record.itemCount,
      brief: record.brief,
      failures: record.failures,
    });
  } catch (err) {
    return Response.json({ error: err instanceof Error ? err.message : String(err) }, { status: 422 });
  }
}
