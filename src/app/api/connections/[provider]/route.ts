import {
  connectionScope,
  connectProvider,
  disconnectProvider,
  PER_USER_PROVIDERS,
  PROVIDERS,
  type Provider,
  type SecretsMap,
} from "@/lib/connections";
import { getSessionUser } from "@/lib/auth";
import type { User } from "@prisma/client";

function parseProvider(value: string): Provider | null {
  return (PROVIDERS as string[]).includes(value) ? (value as Provider) : null;
}

// Members may only manage the per-user providers (their own Postiz/Meta) —
// everything else is the shared workspace stack and stays admin-only.
async function guardScope(provider: Provider): Promise<{ user: User; scope: string } | Response> {
  const user = await getSessionUser();
  if (!user) return Response.json({ error: "Not signed in." }, { status: 401 });
  if (user.role !== "admin" && !PER_USER_PROVIDERS.has(provider)) {
    return Response.json(
      { error: "This connection is managed by the workspace admin. You can connect your own Postiz and Meta accounts." },
      { status: 403 }
    );
  }
  return { user, scope: connectionScope(provider, user.id, user.role) };
}

// Validate the submitted credentials against the live API, then store encrypted.
export async function POST(
  request: Request,
  { params }: { params: Promise<{ provider: string }> }
) {
  const provider = parseProvider((await params).provider);
  if (!provider) return Response.json({ error: "Unknown provider." }, { status: 404 });
  const guarded = await guardScope(provider);
  if (guarded instanceof Response) return guarded;

  const secrets = (await request.json().catch(() => null)) as SecretsMap[Provider] | null;
  if (!secrets) return Response.json({ error: "Missing request body." }, { status: 400 });

  try {
    const status = await connectProvider(provider, secrets, guarded.scope);
    return Response.json({ connection: status });
  } catch (err) {
    // Validation failures are user-fixable — return the message, store nothing.
    return Response.json({ error: err instanceof Error ? err.message : String(err) }, { status: 422 });
  }
}

export async function DELETE(
  _request: Request,
  { params }: { params: Promise<{ provider: string }> }
) {
  const provider = parseProvider((await params).provider);
  if (!provider) return Response.json({ error: "Unknown provider." }, { status: 404 });
  const guarded = await guardScope(provider);
  if (guarded instanceof Response) return guarded;
  await disconnectProvider(provider, guarded.scope);
  return Response.json({ ok: true });
}
