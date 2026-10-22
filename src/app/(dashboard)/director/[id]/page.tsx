import { notFound } from "next/navigation";
import { db } from "@/lib/db";
import { DirectorEditor } from "@/components/DirectorEditor";

export const dynamic = "force-dynamic";

export default async function DirectorProjectPage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const project = await db.fableProject.findUnique({ where: { id }, select: { id: true, title: true } });
  if (!project) notFound();
  return <DirectorEditor projectId={project.id} initialTitle={project.title} />;
}
