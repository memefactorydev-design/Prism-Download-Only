// P4.5 — the content trinity: a blog piece isn't a dead end, it's a source
// beam. One tap refracts it into native social teasers (carousel-shaped on
// Instagram) that drive readers to the piece — drafts, behind the usual gate.

import { db } from "@/lib/db";
import { refractDraft } from "@/lib/refract";
import { getBrandProfile } from "@/lib/brand-profile";
import { canTouch, getSessionUser, scopeOf } from "@/lib/auth";

export const maxDuration = 300;

export async function POST(_request: Request, { params }: { params: Promise<{ id: string }> }) {
  const user = await getSessionUser();
  if (!user) return Response.json({ error: "Not signed in." }, { status: 401 });
  const { id } = await params;
  const draft = await db.contentDraft.findUnique({ where: { id } });
  if (!draft || !canTouch(draft, user)) return Response.json({ error: "Draft not found." }, { status: 404 });

  const scope = scopeOf(user);
  const profile = await getBrandProfile(scope);
  const channels = (profile?.channels?.split(",").filter(Boolean) ?? []).slice(0, 7);
  const targets = channels.length >= 2 ? channels : ["instagram", "facebook", "linkedin"];

  try {
    const posts = await refractDraft(
      {
        title: draft.title,
        body: [
          `These are social teasers for a long-form ${draft.kind === "faq" ? "FAQ page" : "blog post"} titled "${draft.title}".`,
          "Each variant should tease the piece's value and invite readers to it. The Instagram variant should read as a carousel concept (numbered beats work well).",
          "",
          "## The piece (summary)",
          draft.excerpt || draft.seoDescription || draft.title,
        ].join("\n"),
      },
      targets,
      user,
      scope
    );
    return Response.json({ ok: true, channels: posts.map((p) => p.channel) });
  } catch (err) {
    return Response.json({ error: err instanceof Error ? err.message : String(err) }, { status: 422 });
  }
}
