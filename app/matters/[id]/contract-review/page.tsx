import { notFound } from "next/navigation";

import { ContractReviewDesk } from "@/components/contract-review-desk";
import { MatterFrame } from "@/components/matter-frame";
import { latestContractReview } from "@/lib/contract-review";
import { isContractScale } from "@/lib/contract-scales";
import { listMaterials } from "@/lib/materials";
import { getMatter } from "@/lib/matters";

export const dynamic = "force-dynamic";

export default async function ContractReviewPage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const matter = await getMatter(id);
  if (!matter) notFound();
  const [review, materials] = await Promise.all([latestContractReview(id), listMaterials(id)]);
  const usable = materials.filter((material) => material.textStatus === "可用文字" && material.usableText.trim());

  return (
    <MatterFrame matter={matter} wide>
      <ContractReviewDesk
        matterId={matter.id}
        materials={usable.map((material) => ({ id: material.id, filename: material.filename }))}
        initial={
          review
            ? {
                stance: review.stance,
                scale: isContractScale(review.scale) ? review.scale : "",
                cards: review.cards,
              }
            : null
        }
      />
    </MatterFrame>
  );
}
