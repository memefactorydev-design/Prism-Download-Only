// Studio render worker — a standalone process (run: `npm run worker`) that drains
// the VideoJob queue. It lives outside Next because rendering 50 clips is minutes-
// to-hours of CPU that would blow request timeouts and starve the web server.
// One worker, single-user app: simple oldest-first polling, no external queue.

import "dotenv/config";
import { db } from "@/lib/db";
import { processJob } from "./process-job";
import { maybeSendNewsletters } from "./send-newsletter";
import { dreamTick } from "@/lib/memory";
import { track, meterUsage } from "../lib/events";
import { dripTick, overnightTick } from "../lib/drip";

const POLL_MS = Number(process.env.WORKER_POLL_MS) || 3000;
const ACTIVE = ["probing", "transcribing", "planning", "rendering"];

const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

// Nightly agent dreams run here — the worker is the app's only persistent
// process. dreamTick is cheap (an fs read) unless it's actually dream o'clock.
let lastDreamCheck = 0;
async function maybeDream() {
  // Dual-instance guard: when a laptop AND a server both run workers, exactly
  // ONE should own the nightly dreams (DREAMS_ENABLED=0 on the other) so agent
  // memories don't evolve in two directions.
  if (process.env.DREAMS_ENABLED === "0") return;
  if (Date.now() - lastDreamCheck < 60_000) return;
  lastDreamCheck = Date.now();
  await dreamTick().catch((err) => console.error("[studio-worker] dreamTick:", err));
}

async function main() {
  console.log(`[studio-worker] started — polling every ${POLL_MS}ms`);

  // Crash recovery: anything left mid-flight by a previous run goes back to the
  // queue. Cached transcripts are kept, so re-processing skips re-transcription.
  const recovered = await db.videoJob.updateMany({
    where: { status: { in: ACTIVE } },
    data: { status: "queued", stage: "Requeued after worker restart", progress: 0 },
  });
  if (recovered.count) console.log(`[studio-worker] requeued ${recovered.count} interrupted job(s)`);

  for (;;) {
    const job = await db.videoJob.findFirst({
      where: { status: "queued" },
      orderBy: { createdAt: "asc" },
    });
    await maybeDream();
    await maybeSendNewsletters().catch((err) => console.error("[studio-worker] newsletter:", err));
    await dripTick().catch((err) => console.error("[studio-worker] drip:", err));
    await overnightTick().catch((err) => console.error("[studio-worker] overnight:", err));
    if (!job) {
      await sleep(POLL_MS);
      continue;
    }
    // Claim it immediately so the next poll doesn't pick it up again.
    await db.videoJob.update({
      where: { id: job.id },
      data: { status: "probing", stage: "Starting", progress: 1 },
    });
    console.log(`[studio-worker] processing ${job.id} (${job.outputKinds})`);
    await processJob(job);
    const after = await db.videoJob.findUnique({ where: { id: job.id } });
    console.log(`[studio-worker] ${job.id} → ${after?.status}`);
    if (after?.status === "failed") {
      track("job_failed", after.userId, { jobId: after.id, mode: after.mode, error: (after.errorMessage ?? "").slice(0, 200) });
    } else if (after) {
      track("job_completed", after.userId, { jobId: after.id, mode: after.mode });
      meterUsage(after.userId, "render", 1, { jobId: after.id, mode: after.mode });
    }
  }
}

main().catch((err) => {
  console.error("[studio-worker] fatal:", err);
  process.exit(1);
});
