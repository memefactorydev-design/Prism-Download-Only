import { NextResponse, type NextRequest } from "next/server";
import {
  createSessionToken,
  isOpenAccess,
  OPEN_USER_ID,
  SESSION_COOKIE,
  SESSION_MAX_AGE_SECS,
  verifySessionToken,
} from "@/lib/session";

// Session gate + role gate.
// - No valid session → pages redirect to /login, APIs get 401.
// - "member" role → admin-only areas (credentials, financials, user admin)
//   redirect home / 403. Route handlers re-check the DB via src/lib/auth.ts —
//   this proxy check is the fast first fence, not the only one.

const PUBLIC_PREFIXES = [
  "/login",
  "/api/auth/login",
  "/api/deals/webhook", // n8n/CRM push — protected by its own shared secret
  "/api/leads/webhook", // site forms / n8n → leads — protected by its own shared secret
  "/api/newsletter/unsubscribe", // one-click unsubscribe — HMAC-signed per lead
  "/s/", // published in-app sites are public by design
  "/status", // public health page — launch hygiene
  "/api/health",
  "/terms",
  "/privacy",
];

// Admin-only surfaces: reports and user management. Since the beta opened,
// Connections, /ads and publish/spend decisions are PER-USER — members manage
// their own Postiz/Meta accounts and decide their own sandboxed posts/budgets.
// The route guards enforce ownership; a member never touches the workspace scope.
// /reports is per-user now (the live dashboard shows each scope its own
// numbers; weekly supervisor briefings stay admin-gated in-page).
const ADMIN_PREFIXES = ["/users", "/api/users"];
const ADMIN_PATTERNS: RegExp[] = [];

export async function proxy(request: NextRequest) {
  const { pathname } = request.nextUrl;
  const openAccess = isOpenAccess();

  // Open access: the login screen has nothing to do — send it home.
  if (openAccess && pathname === "/login") {
    const home = request.nextUrl.clone();
    home.pathname = "/";
    home.search = "";
    return NextResponse.redirect(home);
  }

  if (PUBLIC_PREFIXES.some((p) => pathname === p || pathname.startsWith(p))) {
    return NextResponse.next();
  }

  const token = request.cookies.get(SESSION_COOKIE)?.value;
  const claims = token ? await verifySessionToken(token, Date.now()) : null;

  // Open access: no (valid) session → mint one for the built-in owner, hand it
  // to THIS request (so route handlers and layouts see it immediately) and set
  // the cookie for the next ones. src/lib/auth.ts creates the owner row lazily.
  if (!claims && openAccess) {
    const minted = await createSessionToken(OPEN_USER_ID, "admin", Date.now());
    const headers = new Headers(request.headers);
    const others = (headers.get("cookie") ?? "")
      .split(";")
      .map((c) => c.trim())
      .filter((c) => c && !c.startsWith(`${SESSION_COOKIE}=`));
    headers.set("cookie", [...others, `${SESSION_COOKIE}=${minted}`].join("; "));
    const res = NextResponse.next({ request: { headers } });
    res.cookies.set(SESSION_COOKIE, minted, {
      httpOnly: true,
      sameSite: "lax",
      secure: process.env.NODE_ENV === "production" && request.nextUrl.protocol === "https:",
      path: "/",
      maxAge: SESSION_MAX_AGE_SECS,
    });
    return res;
  }

  if (!claims) {
    if (pathname.startsWith("/api/")) {
      return NextResponse.json({ error: "Not signed in." }, { status: 401 });
    }
    const login = request.nextUrl.clone();
    login.pathname = "/login";
    login.search = "";
    return NextResponse.redirect(login);
  }

  const needsAdmin =
    ADMIN_PREFIXES.some((p) => pathname === p || pathname.startsWith(`${p}/`)) ||
    ADMIN_PATTERNS.some((re) => re.test(pathname));
  if (needsAdmin && claims.role !== "admin") {
    if (pathname.startsWith("/api/")) {
      return NextResponse.json({ error: "This area needs an admin account." }, { status: 403 });
    }
    const home = request.nextUrl.clone();
    home.pathname = "/";
    home.search = "";
    return NextResponse.redirect(home);
  }
  return NextResponse.next();
}

export const config = {
  // Skip Next.js internals and static assets.
  // IMPORTANT: /api/studio/upload is excluded because when the proxy matches a
  // route, Next clones and buffers the request body in memory (capped ~10MB,
  // truncating silently — proxyClientMaxBodySize). That would corrupt large raw
  // video uploads; that route enforces the session itself via requireUser().
  // api/media$ (the upload/list collection route) is excluded for the same
  // body-buffering reason as the studio upload; it enforces auth in-route.
  // The api/media/[id] subroutes remain behind the proxy.
  matcher: [
    "/((?!_next/static|_next/image|favicon.ico|api/studio/upload|api/media$|.*\\.(?:svg|png|jpg|jpeg|ico|webp|mp4)$).*)",
  ],
};
