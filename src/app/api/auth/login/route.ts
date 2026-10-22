// Email + password login. First run bootstraps the admin account from
// ADMIN_EMAIL / DASHBOARD_PASSWORD (src/lib/auth.ts seedAdminIfEmpty).

import { NextResponse } from "next/server";
import { db } from "@/lib/db";
import { seedAdminIfEmpty, verifyPassword } from "@/lib/auth";
import { track } from "@/lib/events";
import { checkLoginAllowed, clientIp, recordLoginFailure, recordLoginSuccess } from "@/lib/rate-limit";
import { createSessionToken, SESSION_COOKIE, SESSION_MAX_AGE_SECS } from "@/lib/session";

export async function POST(request: Request) {
  const body = (await request.json().catch(() => ({}))) as { email?: string; password?: string };
  const email = body.email?.trim().toLowerCase();
  const password = body.password ?? "";
  if (!email || !password) {
    return NextResponse.json({ error: "Enter your email and password." }, { status: 400 });
  }

  // Brute-force gate: locked emails/IPs are refused BEFORE any password work.
  const ip = clientIp(request);
  const refusal = checkLoginAllowed(email, ip);
  if (refusal) return NextResponse.json({ error: refusal }, { status: 429 });

  await seedAdminIfEmpty();
  const user = await db.user.findUnique({ where: { email } });
  if (!user || !verifyPassword(password, user.passwordHash)) {
    recordLoginFailure(email, ip);
    return NextResponse.json({ error: "Wrong email or password." }, { status: 401 });
  }
  recordLoginSuccess(email);

  const token = await createSessionToken(user.id, user.role as "admin" | "member", Date.now());
  track("user_logged_in", user.id);
  const res = NextResponse.json({ ok: true, role: user.role });
  // Secure cookies only when the request really arrived over HTTPS — a VPS
  // reached over plain http://ip:port would otherwise never store the cookie.
  const https =
    request.headers.get("x-forwarded-proto")?.split(",")[0].trim() === "https" ||
    new URL(request.url).protocol === "https:";
  res.cookies.set(SESSION_COOKIE, token, {
    httpOnly: true,
    sameSite: "lax",
    secure: process.env.NODE_ENV === "production" && https,
    path: "/",
    maxAge: SESSION_MAX_AGE_SECS,
  });
  return res;
}
