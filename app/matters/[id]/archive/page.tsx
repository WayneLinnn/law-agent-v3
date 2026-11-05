import { notFound } from "next/navigation";

import { ArchiveDesk } from "@/components/archive-desk";
import { MatterFrame } from "@/components/matter-frame";
import { getClosing } from "@/lib/closings";
import { getMatter } from "@/lib/matters";

export const dynamic = "force-dynamic";

export default async function ArchivePage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const matter = await getMatter(id);
  if (!matter) notFound();
  const closing = await getClosing(id);
  if (!closing) notFound();
  const stamp = [
    matter.status,
    closing.closing?.confirmedAt ?? "",
    closing.closing?.archivedAt ?? "",
    String(closing.dossier.length),
    closing.tasks.map((task) => `${task.result}:${task.note}`).join("|"),
  ].join(":");

  return (
    <MatterFrame matter={matter}>
      <ArchiveDesk
        key={stamp}
        matterId={matter.id}
        matterStatus={matter.status}
        closing={closing.closing}
        tasks={closing.tasks}
        dossier={closing.dossier}
      />
    </MatterFrame>
  );
}
