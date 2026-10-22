import { db } from "@/lib/db";
import { saveUpload } from "@/lib/media";
import { getSessionUser, scopeOf, scopeWhere } from "@/lib/auth";

export async function GET() {
  // Proxy-exempt (multipart bodies get buffered/truncated by the proxy) —
  // so the session is enforced HERE.
  const user = await getSessionUser();
  if (!user) return Response.json({ error: "Not signed in." }, { status: 401 });
  const media = await db.mediaAsset.findMany({ where: scopeWhere(user), orderBy: { createdAt: "desc" } });
  return Response.json({ media });
}

// Multipart upload (supports multiple files in one request).
export async function POST(request: Request) {
  // Proxy-exempt (multipart bodies get buffered/truncated by the proxy) —
  // so the session is enforced HERE.
  const user = await getSessionUser();
  if (!user) return Response.json({ error: "Not signed in." }, { status: 401 });
  const form = await request.formData().catch(() => null);
  if (!form) return Response.json({ error: "Expected multipart form data." }, { status: 400 });
  const files = form.getAll("file").filter((f): f is File => f instanceof File);
  if (files.length === 0) return Response.json({ error: "No files in the upload." }, { status: 400 });

  const saved = [];
  const errors: string[] = [];
  for (const file of files) {
    try {
      saved.push(await saveUpload(file, scopeOf(user)));
    } catch (err) {
      errors.push(err instanceof Error ? err.message : String(err));
    }
  }
  return Response.json(
    { media: saved, errors },
    { status: saved.length > 0 ? 200 : 422 }
  );
}
