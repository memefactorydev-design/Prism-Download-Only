// Stock search + import (Pexels) for the media library's "Find stock" panel.

import { importStock, searchStock } from "@/lib/pexels";
import { getSessionUser, scopeOf } from "@/lib/auth";

export const maxDuration = 180;

export async function GET(request: Request) {
  const url = new URL(request.url);
  const query = url.searchParams.get("q")?.trim();
  const type = url.searchParams.get("type") === "video" ? "video" : "photo";
  if (!query) return Response.json({ error: "Enter a search term." }, { status: 400 });
  try {
    return Response.json({ results: await searchStock(query, type) });
  } catch (err) {
    return Response.json({ error: err instanceof Error ? err.message : String(err) }, { status: 422 });
  }
}

export async function POST(request: Request) {
  const user = await getSessionUser();
  if (!user) return Response.json({ error: "Not signed in." }, { status: 401 });
  const body = (await request.json().catch(() => null)) as {
    downloadUrl?: string;
    type?: string;
    credit?: string;
  } | null;
  if (!body?.downloadUrl) return Response.json({ error: "downloadUrl is required." }, { status: 400 });
  try {
    const assetId = await importStock(
      body.downloadUrl,
      body.type === "video" ? "video" : "photo",
      body.credit ?? "stock",
      scopeOf(user)
    );
    return Response.json({ assetId });
  } catch (err) {
    return Response.json({ error: err instanceof Error ? err.message : String(err) }, { status: 422 });
  }
}
