// User management (admin only — proxy blocks members, and we re-check here).

import { hashPassword, requireAdmin } from "@/lib/auth";
import { db } from "@/lib/db";

export async function GET() {
  const guard = await requireAdmin();
  if (guard) return guard;
  const users = await db.user.findMany({ orderBy: { createdAt: "asc" } });
  return Response.json({
    users: users.map((u) => ({ id: u.id, email: u.email, name: u.name, role: u.role, createdAt: u.createdAt.toISOString() })),
  });
}

export async function POST(request: Request) {
  const guard = await requireAdmin();
  if (guard) return guard;
  const body = (await request.json().catch(() => ({}))) as {
    email?: string;
    name?: string;
    password?: string;
    role?: string;
  };
  const email = body.email?.trim().toLowerCase();
  if (!email || !/^[^@\s]+@[^@\s]+\.[^@\s]+$/.test(email)) {
    return Response.json({ error: "Enter a valid email." }, { status: 400 });
  }
  if (!body.name?.trim()) return Response.json({ error: "Enter a name." }, { status: 400 });
  if (!body.password || body.password.length < 8) {
    return Response.json({ error: "Password needs at least 8 characters." }, { status: 400 });
  }
  const existing = await db.user.findUnique({ where: { email } });
  if (existing) return Response.json({ error: "That email already has an account." }, { status: 409 });
  const user = await db.user.create({
    data: {
      email,
      name: body.name.trim().slice(0, 100),
      passwordHash: hashPassword(body.password),
      role: body.role === "admin" ? "admin" : "member",
    },
  });
  return Response.json({ id: user.id });
}
