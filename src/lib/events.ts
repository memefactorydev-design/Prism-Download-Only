// P0.1 — the event funnel. One tiny fire-and-forget tracker: never throws,
// never blocks the caller, stores props as a JSON string (SQLite). The funnel
// vocabulary lives here so names stay consistent everywhere they're fired.
//
// Funnel (in order): user_signed_up → connection_added → media_uploaded →
// job_started → job_completed | job_failed → draft_created → post_approved →
// post_published. Money/compute moments: usage_metered (every metered unit of
// heavy work: renders, agent runs, generations), deal_logged, lead_created,
// newsletter_sent.

import { db } from "@/lib/db";

export type FunnelEvent =
  | "user_signed_up"
  | "user_logged_in"
  | "connection_added"
  | "media_uploaded"
  | "job_started"
  | "job_completed"
  | "job_failed"
  | "draft_created"
  | "post_approved"
  | "post_rejected"
  | "post_published"
  | "lead_created"
  | "lead_sold"
  | "newsletter_sent"
  | "site_published"
  | "seo_fix_applied"
  | "ad_action_decided"
  | "overnight_run"
  | "onboarding_screen"
  | "onboarding_inferred"
  | "onboarding_completed"
  | "brand_refreshed"
  | "brand_reset"
  | "ticket_raised"
  | "ticket_resolved"
  | "assist_guardrail"
  | "usage_metered";

export function track(name: FunnelEvent, userId = "", props: Record<string, unknown> = {}): void {
  // Fire-and-forget on purpose: analytics must never break or slow the product.
  db.event
    .create({ data: { name, userId, props: JSON.stringify(props) } })
    .catch(() => {});
}

/** Metered usage: the unit vocabulary for margin math (P5.2 reads this). */
export function meterUsage(
  userId: string,
  unit: "render" | "agent_run" | "image_gen" | "video_gen" | "music_gen" | "tts" | "scrape" | "email" | "assist",
  qty = 1,
  detail: Record<string, unknown> = {}
): void {
  track("usage_metered", userId, { unit, qty, ...detail });
}
