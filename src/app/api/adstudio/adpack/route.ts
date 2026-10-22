import { buildAdPack, type AdPackInput } from "@/lib/adstudio";
import { getSessionUser, scopeOf } from "@/lib/auth";

export const maxDuration = 300;

export async function POST(request: Request) {
  const user = await getSessionUser();
  if (!user) return Response.json({ error: "Not signed in." }, { status: 401 });
  const input = (await request.json().catch(() => null)) as AdPackInput | null;
  if (!input) return Response.json({ error: "Missing request body." }, { status: 400 });
  try {
    return Response.json(await buildAdPack(input, scopeOf(user)));
  } catch (err) {
    return Response.json({ error: err instanceof Error ? err.message : String(err) }, { status: 422 });
  }
}
