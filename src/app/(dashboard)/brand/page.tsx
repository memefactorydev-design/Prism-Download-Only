import { redirect } from "next/navigation";
import { getSessionUser, scopeOf } from "@/lib/auth";
import { getBrandProfile } from "@/lib/brand-profile";
import { BrandForm, EMPTY_BRAND_VALUES, type BrandFormValues } from "@/components/BrandForm";
import { BrandRefresh } from "@/components/BrandRefresh";
import { ResetBrandCard } from "@/components/ResetBrandCard";
import { PageHeader } from "@/components/ui/PageHeader";

export const dynamic = "force-dynamic";

export default async function BrandPage() {
  const user = await getSessionUser();
  if (!user) redirect("/login");

  // The workspace brand (admins) and each member's own brand use the same page.
  const profile = await getBrandProfile(scopeOf(user));
  const current: BrandFormValues = { ...EMPTY_BRAND_VALUES };
  if (profile) {
    for (const key of Object.keys(EMPTY_BRAND_VALUES) as (keyof BrandFormValues)[]) {
      current[key] = (profile[key] as string | null | undefined) ?? "";
    }
  }
  return (
    <div>
      <PageHeader
        title="Your brand"
        subtitle="Tell your AI team who they're working for. Everything they research, write and edit — trends, templates, captions, ads, sites, videos — is tailored to this brand. You can refine it any time."
      />
      {!profile && (
        <div className="card mb-6 border-accent/40 p-5 text-sm">
          <p className="font-medium text-foreground">No brand yet.</p>
          <p className="mt-1 text-muted">
            The quickest way is the guided setup: your website address, a two-minute quiz, done.{" "}
            <a href="/welcome" className="text-accent underline underline-offset-2">
              Run the guided setup
            </a>{" "}
            — or fill in the form below by hand.
          </p>
        </div>
      )}
      <BrandRefresh
        current={{
          businessName: current.businessName,
          whatYouSell: current.whatYouSell,
          audience: current.audience,
          voice: current.voice,
          region: current.region,
          goals: current.goals,
        }}
        initialUrl={profile?.siteUrl ?? ""}
      />
      <div className="mb-2 text-xs font-semibold uppercase tracking-[0.12em] text-faint">Or edit it by hand</div>
      <BrandForm initial={current} />
      <ResetBrandCard />
    </div>
  );
}
