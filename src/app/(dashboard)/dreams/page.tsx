import { listDreams, pipelineAgentNames, pipelineDisplayName } from "@/lib/memory";
import { roster, type NamedAgent } from "@/lib/named-agents";
import { DreamsBoard } from "@/components/DreamsBoard";
import { PageHeader } from "@/components/ui/PageHeader";

export const dynamic = "force-dynamic";

export default async function DreamsPage() {
  // Everyone who dreams: the named team plus the pipeline agents (video editor,
  // trend researchers, SEO, supervisor…), presented with a neutral pipeline look.
  const agents: NamedAgent[] = [
    ...roster(),
    ...pipelineAgentNames().map((id) => ({
      id,
      name: pipelineDisplayName(id),
      title: "Pipeline agent",
      platform: "pipeline",
      emoji: "⚙️",
      color: "#8b93a8",
      tagline: "",
    })),
  ];
  return (
    <div>
      <PageHeader
        eyebrow="The team"
        title="Dreams"
        subtitle="Nightly consolidation for every agent — the named team and the pipeline specialists. Each replays its day — chats, runs, your decisions, scraped intel — rewrites its own memory, and wakes sharper."
      />
      <DreamsBoard dreams={listDreams()} agents={agents} />
    </div>
  );
}
