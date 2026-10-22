import { listDreams } from "@/lib/memory";

export async function GET() {
  return Response.json({ dreams: listDreams() });
}
