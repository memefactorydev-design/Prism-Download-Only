import { roster } from "@/lib/named-agents";

export async function GET() {
  return Response.json({ agents: roster() });
}
