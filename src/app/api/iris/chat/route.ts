// Iris chat: one member turn in, one streamed reply out (NDJSON, builder-chat
// pattern). Deltas freeze the moment a reply brushes an internal term — the
// final frame carries the scrubbed text that replaces whatever the client has.

import { db } from "@/lib/db";
import { getSessionUser, scopeOf } from "@/lib/auth";
import { meterUsage } from "@/lib/events";
import { containsBanned, runIrisTurn, IRIS_HISTORY_WINDOW } from "@/lib/iris";

export const maxDuration = 300;

const MAX_MESSAGE_CHARS = 4000;
// Light per-user limiter: Iris is helpful, not a token faucet.
const buckets = new Map<string, { count: number; windowStart: number }>();
function allow(userId: string): boolean {
  const now = Date.now();
  const b = buckets.get(userId);
  if (!b || now - b.windowStart > 5 * 60_000) {
    buckets.set(userId, { count: 1, windowStart: now });
    return true;
  }
  b.count++;
  return b.count <= 20;
}

export async function POST(request: Request) {
  const user = await getSessionUser();
  if (!user) return Response.json({ error: "Not signed in." }, { status: 401 });
  const body = (await request.json().catch(() => ({}))) as { message?: string; pathname?: string };
  const message = (body.message ?? "").trim().slice(0, MAX_MESSAGE_CHARS);
  if (!message) return Response.json({ error: "Say something first." }, { status: 400 });
  if (!allow(user.id)) {
    return Response.json({ error: "Iris needs a breather — try again in a few minutes." }, { status: 429 });
  }
  const scope = scopeOf(user);
  const pathname = (body.pathname ?? "/").slice(0, 200);

  const prior = await db.assistMessage.findMany({
    where: { userId: scope },
    orderBy: { createdAt: "desc" },
    take: IRIS_HISTORY_WINDOW,
  });
  const history = [
    ...prior.reverse().map((m) => ({ role: m.role as "user" | "assistant", content: m.content })),
    { role: "user" as const, content: message },
  ];
  await db.assistMessage.create({ data: { userId: scope, role: "user", content: message } });

  const encoder = new TextEncoder();
  const stream = new ReadableStream({
    async start(controller) {
      const send = (obj: Record<string, unknown>) =>
        controller.enqueue(encoder.encode(JSON.stringify(obj) + "\n"));
      let lastSent = 0;
      let frozen = false;
      try {
        const result = await runIrisTurn({
          user,
          pathname,
          history,
          onDelta: (acc) => {
            if (frozen) return;
            if (containsBanned(acc)) {
              frozen = true; // stop leaking; the done-frame replaces everything
              return;
            }
            const now = Date.now();
            if (now - lastSent < 250) return;
            lastSent = now;
            send({ type: "delta", text: acc });
          },
          onTool: (name) => send({ type: "tool", name }),
        });
        await db.assistMessage.create({ data: { userId: scope, role: "assistant", content: result.text } });
        meterUsage(scope, "assist", 1, { scrubbed: result.scrubbed });
        send({ type: "done", text: result.text, ticket: result.ticket ?? null });
      } catch (err) {
        const m = err instanceof Error ? err.message : String(err);
        if (m === "IRIS_UNAVAILABLE") {
          send({ type: "error", error: "Iris is unavailable right now.", fallback: true });
        } else {
          console.error("[iris]", m);
          send({ type: "error", error: "Iris hit a snag — try that again in a moment." });
        }
      } finally {
        controller.close();
      }
    },
  });
  return new Response(stream, { headers: { "Content-Type": "application/x-ndjson" } });
}
