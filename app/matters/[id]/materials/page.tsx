import { notFound } from "next/navigation";

import { MaterialDesk } from "@/components/material-desk";
import { MatterFrame } from "@/components/matter-frame";
import { listMaterials } from "@/lib/materials";
import { getMatter } from "@/lib/matters";

export const dynamic = "force-dynamic";

export default async function MaterialsPage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const matter = await getMatter(id);
  if (!matter) notFound();
  const materials = await listMaterials(id);

  return (
    <MatterFrame matter={matter}>
      <MaterialDesk
        matterId={matter.id}
        materials={materials}
        locked={matter.status === "已归档"}
      />
    </MatterFrame>
  );
}
