// Create one montage job from several already-uploaded sources (staged via
// /api/studio/upload?defer=1). The worker mixes the best moments across them.

import { enqueueMontage } from "@/lib/studio";
import { assertAssetsInScope } from "@/lib/media";
import { getSessionUser, scopeOf } from "@/lib/auth";

export async function POST(request: Request): Promise<Response> {
  const user = await getSessionUser();
  if (!user) return Response.json({ error: "Not signed in." }, { status: 401 });
  const body = (await request.json().catch(() => ({}))) as {
    assetIds?: unknown;
    captionStyle?: string;
    captions?: boolean;
    musicAssetId?: string;
    beatSync?: boolean;
    beatCadence?: number;
    morphs?: boolean;
  };
  const assetIds = Array.isArray(body.assetIds) ? body.assetIds.filter((x): x is string => typeof x === "string") : [];
  if (assetIds.length < 2) {
    return Response.json({ error: "Select at least 2 videos to mix into a montage." }, { status: 400 });
  }
  try {
    await assertAssetsInScope([...assetIds, ...(body.musicAssetId ? [body.musicAssetId] : [])], user);
    const job = await enqueueMontage(
      assetIds,
      {
        captionStyle: body.captionStyle,
        captions: body.captions,
        beatSync: body.beatSync,
        beatCadence: body.beatCadence,
        morphs: body.morphs,
      },
      body.musicAssetId,
      scopeOf(user)
    );
    return Response.json({ jobId: job.id });
  } catch (err) {
    return Response.json({ error: err instanceof Error ? err.message : String(err) }, { status: 422 });
  }
}
