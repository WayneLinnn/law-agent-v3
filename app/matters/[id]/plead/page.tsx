import { notFound } from "next/navigation";

import { MatterFrame } from "@/components/matter-frame";
import { PleadDesk } from "@/components/plead-desk";
import { listMaterials } from "@/lib/materials";
import { getMatter } from "@/lib/matters";
import { PLEAD_KINDS, type PleadKind } from "@/lib/plead-fields";
import { pleadingHistory } from "@/lib/pleadings";

export const dynamic = "force-dynamic";

export default async function PleadPage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const matter = await getMatter(id);
  if (!matter) notFound();
  const [history, materials] = await Promise.all([pleadingHistory(id), listMaterials(id)]);
  const usable = materials.filter((material) => material.textStatus === "可用文字" && material.usableText.trim());
  const initial = Object.fromEntries(
    PLEAD_KINDS.map((kind) => [
      kind,
      history[kind].map((row) => ({
        id: row.id,
        version: row.version,
        createdAt: row.createdAt,
        body: row.body,
        warnings: row.warnings,
        slots: row.slots,
        status: row.status,
      })),
    ]),
  ) as Record<
    PleadKind,
    Array<{
      id: string;
      version: number;
      createdAt: string;
      body: string;
      warnings: string;
      slots: Record<string, string>;
      status: "缺槽位" | "已成文";
    }>
  >;

  return (
    <MatterFrame matter={matter} wide>
      <PleadDesk
        matterId={matter.id}
        materials={usable.map((material) => ({ id: material.id, filename: material.filename }))}
        facts={matter.facts}
        initial={initial}
      />
    </MatterFrame>
  );
}
