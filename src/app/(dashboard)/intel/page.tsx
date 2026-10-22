import { intelStatus } from "@/lib/intel";
import { roster } from "@/lib/named-agents";
import { getConnectionStatuses } from "@/lib/connections";
import { IntelBoard } from "@/components/IntelBoard";
import { PageHeader } from "@/components/ui/PageHeader";

export const dynamic = "force-dynamic";

export default async function IntelPage() {
  const sources = intelStatus();
  const agents = roster();
  const connections = await getConnectionStatuses();
  const apifyConnected = connections.some((c) => c.provider === "apify" && c.status === "connected");

  return (
    <div>
      <PageHeader
        eyebrow="Research"
        title="Market Pulse"
        subtitle="Ten live listening posts across your market — competitor ads, reviews, rankings, conversations — each owned by a specialist on your AI team. A run reads what's happening right now and distils it into a sharp brief your team remembers. Uses public data only; runs use research credits."
      />
      <IntelBoard sources={sources} agents={agents} enabled={apifyConnected} />
    </div>
  );
}
