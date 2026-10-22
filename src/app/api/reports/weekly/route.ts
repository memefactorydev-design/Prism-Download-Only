import { runWeeklyReport } from "@/lib/supervisor";

// Aggregate the week's data and have marketing-supervisor write the report.
export const maxDuration = 300;

export async function POST() {
  try {
    const { report } = await runWeeklyReport();
    return Response.json({ reportId: report.id });
  } catch (err) {
    return Response.json({ error: err instanceof Error ? err.message : String(err) }, { status: 422 });
  }
}
