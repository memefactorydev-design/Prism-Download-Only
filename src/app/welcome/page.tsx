import { redirect } from "next/navigation";
import { getSessionUser } from "@/lib/auth";
import { FirstLight } from "@/components/FirstLight";
import { Logo } from "@/components/ui/Logo";

export const dynamic = "force-dynamic";

export default async function WelcomePage() {
  const user = await getSessionUser();
  if (!user) redirect("/login");
  return (
    <main className="min-h-screen">
      <div className="mx-auto flex max-w-4xl items-center px-6 pt-8">
        <Logo />
      </div>
      <FirstLight />
    </main>
  );
}
