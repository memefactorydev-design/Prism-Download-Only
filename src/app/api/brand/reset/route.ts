// "Start again from scratch": the hard brand reset. Deletes the brand profile
// (which IS the onboarding-complete signal — the dashboard layout sends the
// user back to /welcome), clears FUTURE unpublished posts (they were written
// for the old brand, and dripTick would otherwise keep generating copy for
// them), and for a member disconnects their own connections. For the
// workspace it also archives the agents' learned memory (brand-specific by
// nature) under data/archive/ instead of deleting it. Published history,
// media, videos, Director projects, sites, leads and deals all STAY — reset
// means "new direction", not "rewrite history".

import { promises as fs } from "node:fs";
import path from "node:path";
import { db } from "@/lib/db";
import { getSessionUser, scopeOf } from "@/lib/auth";
import { disconnectProvider, getConnectionStatuses, PER_USER_PROVIDERS } from "@/lib/connections";
import { STACK_ALIASES } from "@/lib/brand";
import { track } from "@/lib/events";

// Anything not yet published is "the old brand's future" and goes.
const UNPUBLISHED = ["planned", "generating", "draft", "pending_approval", "approved", "scheduled"];

/** What a reset would remove — powers the honest confirm dialog. */
export async function GET() {
  const user = await getSessionUser();
  if (!user) return Response.json({ error: "Not signed in." }, { status: 401 });
  const scope = scopeOf(user);
  const [upcomingPosts, statuses] = await Promise.all([
    db.post.count({ where: { userId: scope, status: { in: UNPUBLISHED } } }),
    scope ? getConnectionStatuses(scope, "member") : Promise.resolve([]),
  ]);
  // Member-safe names: aliases where they exist, plain-English otherwise
  // (googleads/gsc/smtp have no STACK_ALIASES entry).
  const FALLBACK_LABELS: Record<string, string> = {
    googleads: "Google Ads",
    gsc: "Search Console",
    smtp: "Email sending",
  };
  const connections = statuses
    .filter((s) => PER_USER_PROVIDERS.has(s.provider) && s.status === "connected")
    .map((s) => STACK_ALIASES[s.provider]?.label ?? FALLBACK_LABELS[s.provider] ?? s.provider);
  return Response.json({ upcomingPosts, connections, workspace: scope === "" });
}

/** Move the brand-learned agent memory aside so the next brand starts clean. */
async function archiveWorkspaceMemory(): Promise<string | null> {
  const root = process.cwd();
  const stamp = new Date().toISOString().replace(/[:.]/g, "-");
  const archive = path.join(root, "data", "archive", stamp);
  let moved = 0;
  const move = async (from: string, to: string) => {
    try {
      await fs.access(from);
    } catch {
      return;
    }
    await fs.mkdir(path.dirname(to), { recursive: true });
    await fs.rename(from, to);
    moved++;
  };
  const agentsDir = path.join(root, "agents");
  for (const entry of await fs.readdir(agentsDir, { withFileTypes: true }).catch(() => [])) {
    if (!entry.isDirectory()) continue;
    for (const file of ["MEMORY.md", "LEARNINGS.md"]) {
      await move(path.join(agentsDir, entry.name, file), path.join(archive, "agents", entry.name, file));
    }
  }
  await move(path.join(root, "data", "pipeline-memory"), path.join(archive, "pipeline-memory"));
  await move(path.join(root, "data", "journal"), path.join(archive, "journal"));
  return moved ? archive : null;
}

export async function POST() {
  const user = await getSessionUser();
  if (!user) return Response.json({ error: "Not signed in." }, { status: 401 });
  const scope = scopeOf(user);
  try {
    const doomed = await db.post.findMany({
      where: { userId: scope, status: { in: UNPUBLISHED } },
      select: { id: true },
    });
    const doomedIds = doomed.map((p) => p.id);
    await db.$transaction([
      db.approval.deleteMany({ where: { postId: { in: doomedIds } } }),
      db.post.deleteMany({ where: { id: { in: doomedIds } } }),
      db.brandProfile.deleteMany({ where: { userId: scope } }),
    ]);
    let archived: string | null = null;
    if (scope) {
      // Connections go one by one — a failure here must not fake a half-success.
      for (const provider of PER_USER_PROVIDERS) {
        await disconnectProvider(provider, scope);
      }
    } else {
      archived = await archiveWorkspaceMemory();
    }
    track("brand_reset", scope, { removedPosts: doomedIds.length, archived: Boolean(archived) });
    // Expire the "skip onboarding" cookie so /welcome actually opens again.
    return new Response(JSON.stringify({ ok: true, removedPosts: doomedIds.length, archived }), {
      status: 200,
      headers: {
        "Content-Type": "application/json",
        "Set-Cookie": "prism_onboard_skip=; Path=/; Max-Age=0",
      },
    });
  } catch (err) {
    return Response.json({ error: err instanceof Error ? err.message : String(err) }, { status: 422 });
  }
}
