import { redirect } from "next/navigation";
import { cookies } from "next/headers";
import { getSessionUser, scopeOf } from "@/lib/auth";
import { db } from "@/lib/db";
import { GenerateOnlyBanner } from "@/components/GenerateOnlyBanner";
import { Sidebar } from "@/components/ui/Sidebar";
import { Topbar } from "@/components/ui/Topbar";
import { PageTransition } from "@/components/ui/PageTransition";
import { HelpLauncher } from "@/components/help/HelpLauncher";

export default async function DashboardLayout({ children }: { children: React.ReactNode }) {
  const user = await getSessionUser();
  if (!user) redirect("/login"); // proxy is the first fence; this is the second
  const isAdmin = user.role === "admin";

  // First Light: a scope with no brand profile goes through onboarding once —
  // the workspace (admin) and each member alike. Skippable: the skip cookie
  // ends the redirect, and /brand covers them later.
  const jar = await cookies();
  const scope = scopeOf(user);
  const [profile, postiz] = await Promise.all([
    db.brandProfile.findUnique({ where: { userId: scope }, select: { id: true } }),
    isAdmin
      ? Promise.resolve(null)
      : db.connection.findFirst({ where: { provider: "postiz", userId: user.id, status: "connected" }, select: { id: true } }),
  ]);
  const postizConnected = isAdmin ? true : Boolean(postiz);
  if (!profile && jar.get("prism_onboard_skip")?.value !== "1") redirect("/welcome");
  return (
    <div className="flex min-h-screen">
      <Sidebar isAdmin={isAdmin} />
      <main className="flex-1 overflow-x-hidden">
        <Topbar isAdmin={isAdmin} />
        <div className="mx-auto max-w-5xl px-6 py-8 sm:px-10">
          {!postizConnected && <GenerateOnlyBanner />}
          <PageTransition>{children}</PageTransition>
        </div>
      </main>
      <HelpLauncher />
    </div>
  );
}
