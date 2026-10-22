import { intelStatus } from "@/lib/intel";
import { getSecrets } from "@/lib/connections";

export async function GET() {
  const apify = await getSecrets("apify");
  return Response.json({ enabled: Boolean(apify?.apiToken), sources: intelStatus() });
}
