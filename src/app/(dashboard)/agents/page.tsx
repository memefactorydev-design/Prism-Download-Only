import { roster } from "@/lib/named-agents";
import { intelStatus } from "@/lib/intel";
import { AgentsBoard } from "@/components/AgentsBoard";
import { PageHeader } from "@/components/ui/PageHeader";

export const dynamic = "force-dynamic";

const FRESH_MS = 7 * 24 * 3600 * 1000; // matches the intel cache freshness window

// Agents with a fresh scraped intel brief get the "platform intel" toggle in chat.
function freshIntelAgents(): string[] {
  const now = Date.now();
  return [
    ...new Set(
      intelStatus()
        .filter((s) => s.cache && now - new Date(s.cache.fetchedAt).getTime() < FRESH_MS)
        .map((s) => s.agent)
    ),
  ];
}

export default async function AgentsPage() {
  const agents = roster();
  const intelAgents = freshIntelAgents();

  return (
    <div>
      <PageHeader
        eyebrow="The team"
        title="Agents"
        subtitle="Eleven specialist marketers, each with their own remit, voice and memory. Chat to brief them — every conversation is journalled and consolidated into memory while they dream."
      />
      <AgentsBoard agents={agents} intelAgents={intelAgents} />
    </div>
  );
}
