// Users + passwords + route guards (server-only; uses node:crypto + Prisma —
// never import from proxy.ts, which must stay Web-Crypto-only via session.ts).
//
// Roles: "admin" = everything. "member" = creation features only — the proxy
// blocks admin PAGES by token role, and the guards here re-check the DB for
// sensitive APIs (credentials, financials, publish/spend approvals).

import { randomBytes, scryptSync, timingSafeEqual } from "node:crypto";
import { cookies } from "next/headers";
import type { User } from "@prisma/client";
import { db } from "@/lib/db";
import { isOpenAccess, OPEN_USER_ID, SESSION_COOKIE, verifySessionToken } from "@/lib/session";

export function hashPassword(password: string): string {
  const salt = randomBytes(16).toString("hex");
  const hash = scryptSync(password, salt, 64).toString("hex");
  return `scrypt.${salt}.${hash}`;
}

export function verifyPassword(password: string, stored: string): boolean {
  const [scheme, salt, hash] = stored.split(".");
  if (scheme !== "scrypt" || !salt || !hash) return false;
  const candidate = scryptSync(password, salt, 64);
  const expected = Buffer.from(hash, "hex");
  return candidate.length === expected.length && timingSafeEqual(candidate, expected);
}

/**
 * First-run bootstrap: when no users exist, create the admin account from
 * ADMIN_EMAIL / ADMIN_NAME / DASHBOARD_PASSWORD so the owner can log in.
 */
export async function seedAdminIfEmpty(): Promise<void> {
  const count = await db.user.count();
  if (count > 0) return;
  const password = process.env.DASHBOARD_PASSWORD;
  if (!password) throw new Error("Set DASHBOARD_PASSWORD in .env — it becomes the first admin's password.");
  await db.user.create({
    data: {
      email: (process.env.ADMIN_EMAIL ?? "admin@prism.local").toLowerCase(),
      name: process.env.ADMIN_NAME ?? "Owner",
      passwordHash: hashPassword(password),
      role: "admin",
    },
  });
}

/** The logged-in user for server components / route handlers, or null. */
export async function getSessionUser(): Promise<User | null> {
  const store = await cookies();
  const token = store.get(SESSION_COOKIE)?.value;
  if (!token) return null;
  const claims = await verifySessionToken(token, Date.now());
  if (!claims) return null;
  // DB re-check: deleted/demoted users lose access immediately, token or not.
  const user = await db.user.findUnique({ where: { id: claims.userId } });
  if (!user && isOpenAccess() && claims.userId === OPEN_USER_ID) return ensureOpenAccessOwner();
  return user;
}

/**
 * OPEN_ACCESS=1: the proxy signs every visitor in as this built-in admin. The
 * row is created on first use (fresh database, zero setup); its password is
 * random and unusable, so the account cannot be logged into if OPEN_ACCESS is
 * later switched off.
 */
async function ensureOpenAccessOwner(): Promise<User> {
  return db.user.upsert({
    where: { id: OPEN_USER_ID },
    update: {},
    create: {
      id: OPEN_USER_ID,
      email: "owner@prism.local",
      name: process.env.ADMIN_NAME ?? "Owner",
      passwordHash: hashPassword(randomBytes(32).toString("hex")),
      role: "admin",
    },
  });
}

/** Guard for sensitive routes. Returns an error Response, or null when allowed. */
export async function requireAdmin(): Promise<Response | null> {
  const user = await getSessionUser();
  if (!user) return Response.json({ error: "Not signed in." }, { status: 401 });
  if (user.role !== "admin") {
    return Response.json({ error: "This action needs an admin account." }, { status: 403 });
  }
  return null;
}

/** Guard for any authenticated route (e.g. the proxy-exempt upload route). */
export async function requireUser(): Promise<Response | null> {
  const user = await getSessionUser();
  if (!user) return Response.json({ error: "Not signed in." }, { status: 401 });
  return null;
}

// ─── Per-user data scoping (the beta sandbox model) ──────────────────────────
// Rows carry a userId: "" is the workspace (the owner's data; all admins share
// it), anything else is that member's sandbox. Members see only their rows;
// admins see everything.

type ScopedUser = Pick<User, "id" | "role">;

/** The scope a user CREATES in: admins write to the workspace, members to their own. */
export function scopeOf(user: ScopedUser): string {
  return user.role === "admin" ? "" : user.id;
}

/** Prisma where-fragment for LISTS: members are filtered to their rows, admins see all. */
export function scopeWhere(user: ScopedUser): { userId: string } | undefined {
  return user.role === "admin" ? undefined : { userId: user.id };
}

/** Ownership check for single rows: true when the user may touch this row. */
export function canTouch(row: { userId: string }, user: ScopedUser): boolean {
  return user.role === "admin" || row.userId === user.id;
}
