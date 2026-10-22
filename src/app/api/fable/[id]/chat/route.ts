// The Director's refinement loop (mirrors /api/sites/[id]/chat): persist the
// user message, have fable-director-agent produce/amend the COMPLETE FablePlan
// (structured output — the plan is the state, not the chat history), sanitize,
// persist, reply with the plan + the director's conversational summary.

import { runAgent } from "@/lib/agents/run-agent";
import { db } from "@/lib/db";
import {
  buildDirectorTask,
  FABLE_PLAN_SCHEMA,
  sanitizeFablePlan,
  type FablePlan,
} from "@/lib/fable";
import { listVoices } from "@/lib/elevenlabs";
import { falConnected } from "@/lib/fal";
import { relevantTrendInsights } from "@/lib/trends";
import { canTouch, getSessionUser } from "@/lib/auth";

export const maxDuration = 300;

export async function POST(request: Request, { params }: { params: Promise<{ id: string }> }) {
  const user = await getSessionUser();
  if (!user) return Response.json({ error: "Not signed in." }, { status: 401 });
  const { id } = await params;
  const body = (await request.json().catch(() => ({}))) as { message?: string };
  const message = body.message?.trim();
  if (!message) return Response.json({ error: "Say what you'd like the Director to do." }, { status: 400 });

  const project = await db.fableProject.findUnique({
    where: { id },
    include: { sources: { orderBy: { index: "asc" } } },
  });
  if (!project || !canTouch(project, user)) return Response.json({ error: "Project not found." }, { status: 404 });
  if (project.status !== "ready") {
    return Response.json(
      { error: project.status === "preparing" ? "Still reading your footage — a moment." : `Project is ${project.status}: ${project.errorMessage ?? ""}` },
      { status: 409 }
    );
  }

  await db.fableMessage.create({ data: { projectId: id, role: "user", content: message } });

  try {
    const assetIds = project.sources.map((s) => s.assetId);
    const assets = await db.mediaAsset.findMany({ where: { id: { in: assetIds } } });
    const nameById = new Map(assets.map((a) => [a.id, a.originalName]));
    const photoAssetIds = new Set(assets.filter((a) => a.mimeType.startsWith("image/")).map((a) => a.id));
    const photoIndices = new Set(project.sources.filter((s) => photoAssetIds.has(s.assetId)).map((s) => s.index));
    const currentPlan = project.plan ? (JSON.parse(project.plan) as FablePlan) : null;

    const transcriptText = project.sources
      .map((s) => {
        try {
          return s.transcript ? (JSON.parse(s.transcript) as { text?: string }).text ?? "" : "";
        } catch {
          return "";
        }
      })
      .join(" ");
    // Context comes from the PROJECT's scope: a member's Director sees their own
    // research, never the workspace's (and vice versa).
    const [trends, ideas, templates, voices, morphAvailable] = await Promise.all([
      relevantTrendInsights(`${message} ${transcriptText}`.trim(), 6, project.userId),
      db.adIdea.findMany({ where: { status: { not: "archived" }, userId: project.userId }, orderBy: { rank: "asc" }, take: 8 }),
      db.contentTemplate.findMany({ where: { status: { not: "archived" }, userId: project.userId }, orderBy: { createdAt: "desc" }, take: 3 }),
      listVoices().catch(() => []),
      falConnected().catch(() => false),
    ]);

    const task = buildDirectorTask({
      projectTitle: project.title,
      instruction: message,
      currentPlan,
      sources: project.sources.map((s) => ({ ...s, originalName: nameById.get(s.assetId) ?? "footage", isPhoto: photoIndices.has(s.index) })),
      trends,
      ideas,
      templates,
      voices: voices.map((v) => ({ id: v.id, name: v.name })),
      morphAvailable,
    });

    const { data } = await runAgent<FablePlan>("fable-director-agent", task, {
      schema: FABLE_PLAN_SCHEMA,
      maxTokens: 16000,
      reportKind: "fable_plan",
      reportTitle: `Director: ${project.title}`,
      scopeUserId: project.userId,
    });
    if (!data) throw new Error("The Director returned no plan.");
    const plan = sanitizeFablePlan(data, project.sources, photoIndices);
    const planJson = JSON.stringify(plan);

    await db.fableProject.update({
      where: { id },
      data: { plan: planJson, planVersion: { increment: 1 }, title: plan.title.slice(0, 120) },
    });
    await db.fableMessage.create({
      data: { projectId: id, role: "assistant", content: plan.summary, planSnapshot: planJson },
    });
    return Response.json({ plan, summary: plan.summary });
  } catch (err) {
    const m = err instanceof Error ? err.message : String(err);
    await db.fableMessage
      .create({ data: { projectId: id, role: "assistant", content: `⚠️ ${m}` } })
      .catch(() => {});
    return Response.json({ error: m }, { status: 422 });
  }
}
