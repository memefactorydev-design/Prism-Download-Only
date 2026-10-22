import { readMediaFile } from "@/lib/media";
import { canTouch, getSessionUser } from "@/lib/auth";

// Streams the stored file to the (authenticated) dashboard for previews.
// Scope-checked: members can only fetch files in their own library.
// HTTP Range requests are honoured — Safari refuses to play <video> from a
// server that answers a range probe with a plain 200 (Chrome tolerates it,
// which is how this hid). 206 slices keep seeking cheap too.
export async function GET(request: Request, { params }: { params: Promise<{ id: string }> }) {
  const user = await getSessionUser();
  if (!user) return Response.json({ error: "Not signed in." }, { status: 401 });
  const result = await readMediaFile((await params).id);
  if (!result || !canTouch(result.asset, user)) return Response.json({ error: "Not found." }, { status: 404 });

  const size = result.buffer.length;
  const base = {
    "Content-Type": result.asset.mimeType,
    "Accept-Ranges": "bytes",
    "Cache-Control": "private, max-age=3600",
  };

  const range = request.headers.get("range");
  if (range) {
    const m = /^bytes=(\d*)-(\d*)$/.exec(range.trim());
    const start = m?.[1] ? parseInt(m[1], 10) : 0;
    const end = m?.[2] ? Math.min(parseInt(m[2], 10), size - 1) : size - 1;
    if (!m || Number.isNaN(start) || start > end || start >= size) {
      return new Response(null, { status: 416, headers: { ...base, "Content-Range": `bytes */${size}` } });
    }
    return new Response(new Uint8Array(result.buffer.subarray(start, end + 1)), {
      status: 206,
      headers: {
        ...base,
        "Content-Range": `bytes ${start}-${end}/${size}`,
        "Content-Length": String(end - start + 1),
      },
    });
  }

  return new Response(new Uint8Array(result.buffer), {
    headers: { ...base, "Content-Length": String(size) },
  });
}
