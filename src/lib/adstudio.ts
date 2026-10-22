// Ad Studio — ported from the original suite: brief → 3 ready-to-paste ad
// variants written by the platform's named agent (optionally with Scout's live
// competitor research first), each with prompts for a Nano Banana image and a
// Veo video. Generated media lands in MediaAsset via the storage driver, so it
// shows up in /media and can be attached to Calendar posts.

import type { MediaAsset } from "@prisma/client";
import { db } from "@/lib/db";
import { getStorage } from "@/lib/storage";
import { systemPrompt } from "@/lib/named-agents";
import { generate } from "@/lib/engine";
import { parseModelJson } from "@/lib/gemini";
import { brandTaskSuffix, getBrandProfile } from "@/lib/brand-profile";
import { journal } from "@/lib/memory";

export const PLATFORM_AGENT: Record<string, string> = {
  houzz: "harriet",
  pinterest: "pia",
  instagram: "isla",
  facebook: "felix",
  youtube: "yara",
  tiktok: "kai",
  linkedin: "lydia",
  viral: "nova",
  gmb: "magnus",
  blog: "otto",
};

export interface AdVariant {
  name: string;
  hook: string;
  primary_text: string;
  headline: string;
  cta: string;
  hashtags: string[];
  image_prompt: string;
  video_prompt: string;
}

export interface AdPack {
  strategy: string;
  variants: AdVariant[];
}

export interface AdPackInput {
  platform?: string;
  objective?: string;
  offer?: string;
  audience?: string;
  notes?: string;
  research?: boolean;
  sourceImageCount?: number; // how many of the owner's real photos will feed generation
}

export async function buildAdPack(input: AdPackInput, scopeUserId = ""): Promise<{
  agent: string;
  intel: string;
  pack: AdPack;
}> {
  const platform = input.platform ?? "instagram";
  const objective = input.objective ?? "lead generation";
  const agentId = PLATFORM_AGENT[platform] ?? "isla";

  // Research and copy target THIS scope's market — the workspace brand or the member's own.
  const profile = await getBrandProfile(scopeUserId);
  const market = profile
    ? `${profile.whatYouSell} brands${profile.region ? ` in ${profile.region}` : ""}`
    : "the advertiser's market";
  const defaultOffer = profile?.offers?.trim() ? profile.offers.split(/[;\n]/)[0].trim() : "your strongest current offer";
  const defaultAudience = profile?.audience ?? "the brand's ideal customers";
  const sceneHint = "photorealistic scene true to the brand described below";

  let intel = "";
  if (input.research) {
    // Live search: Gemini grounding when connected, else Claude Code's web tools.
    const r = await generate({
      system: await systemPrompt("scout", scopeUserId),
      messages: [
        {
          role: "user",
          content: `Search the live web for what is currently working in ${platform} advertising for ${market} (competitor angles, hooks, offers, formats). Summarise the 5 most actionable findings as bullet points for a creative brief. Objective: ${objective}. Offer: ${input.offer || defaultOffer}.`,
        },
      ],
      useSearch: true,
    });
    intel = r.text;
  }

  const brief = `Create a high-converting ad pack for ${platform}.
Objective: ${objective}
Offer / hook: ${input.offer || defaultOffer}
Audience: ${input.audience || defaultAudience}
Notes: ${input.notes || "none"}
${intel ? `\nLive market intelligence from Scout:\n${intel}\n` : ""}
Return STRICT JSON with this exact shape:
{
  "strategy": "2-3 sentence creative strategy",
  "variants": [
    {
      "name": "short variant name",
      "hook": "first line / first 1.5 seconds",
      "primary_text": "full ad copy / caption, ready to paste, with line breaks",
      "headline": "short headline",
      "cta": "call to action button text",
      "hashtags": ["..."],
      "image_prompt": "detailed prompt for an AI image generator — ${sceneHint}, specify style, lighting, camera, composition, no text in image",
      "video_prompt": "detailed prompt for an AI video generator (8 seconds) — scene, camera movement, mood"
    }
  ]
}
Produce exactly 3 variants with genuinely different angles (e.g. transformation, craftsmanship, lifestyle aspiration).${
    input.sourceImageCount
      ? `\nIMPORTANT: the owner has selected ${input.sourceImageCount} real photo(s) of their own work to feed the generators. Write each image_prompt as an EDIT/COMPOSITION instruction applied to those photos (grade, relight, extend, add negative space for a headline — keep the real subject recognisable), and write each video_prompt knowing the video OPENS on the first photo as its first frame.`
      : ""
  }`;

  const result = await generate({
    system: await systemPrompt(agentId, scopeUserId),
    messages: [{ role: "user", content: brief + (await brandTaskSuffix(scopeUserId)) }],
    json: true,
  });
  const pack = parseModelJson<AdPack>(result.text);
  if (!Array.isArray(pack.variants) || !pack.variants.length) {
    throw new Error("The agent returned no ad variants — try again.");
  }

  // Workspace runs only — beta users' ad packs stay out of the named agents' journals.
  if (!scopeUserId) {
    journal(agentId, { kind: "adpack", platform, objective, offer: input.offer ?? "", strategy: pack.strategy });
    if (input.research) {
      journal("scout", { kind: "intel", source: "ad research (live web)", itemCount: 0, excerpt: intel });
    }
  }

  return { agent: agentId, intel, pack };
}

/** Store generated media (image/video bytes) as a MediaAsset, like an upload. */
export async function saveGeneratedAsset(
  buffer: Buffer,
  mime: string,
  name: string,
  scopeUserId = ""
): Promise<MediaAsset> {
  const ext = mime.includes("png") ? ".png" : mime.includes("mp4") ? ".mp4" : mime.includes("webp") ? ".webp" : ".jpg";
  const stored = await getStorage().save(buffer, ext);
  return db.mediaAsset.create({
    data: {
      userId: scopeUserId,
      originalName: name,
      mimeType: mime,
      sizeBytes: buffer.byteLength,
      storageDriver: stored.storageDriver,
      storagePath: stored.storagePath,
    },
  });
}
