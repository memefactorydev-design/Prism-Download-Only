import { getConnectionStatuses } from "@/lib/connections";
import { engineReady } from "@/lib/llm";
import { AdStudioBoard } from "@/components/AdStudioBoard";
import { PageHeader } from "@/components/ui/PageHeader";

export const dynamic = "force-dynamic";

export default async function AdStudioPage() {
  const [statuses, mindReady] = await Promise.all([getConnectionStatuses(), engineReady()]);
  const connected = (provider: string) =>
    statuses.some((s) => s.provider === provider && s.status === "connected");

  return (
    <div>
      <PageHeader
        eyebrow="Creative"
        title="Ad Maker"
        subtitle="Brief in, ready-to-run ads out. You get three distinct ad concepts — hook, copy and hashtags — each one click from a finished image or video built from your own photos, and one more click from the Calendar."
      />
      <AdStudioBoard geminiConnected={connected("gemini")} engineReady={mindReady} falConnected={connected("fal")} />
    </div>
  );
}
