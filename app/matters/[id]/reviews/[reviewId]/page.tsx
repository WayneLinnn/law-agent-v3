import Link from "next/link";
import { notFound } from "next/navigation";

import { MatterFrame } from "@/components/matter-frame";
import { getMatter } from "@/lib/matters";
import { getReview } from "@/lib/reviews";

export const dynamic = "force-dynamic";

export default async function ReviewPage({
  params,
}: {
  params: Promise<{ id: string; reviewId: string }>;
}) {
  const { id, reviewId } = await params;
  const matter = await getMatter(id);
  if (!matter) notFound();
  const review = await getReview(id, reviewId);
  if (!review) notFound();

  return (
    <MatterFrame matter={matter} wide>
      <div className="space-y-4">
        <p className="text-sm text-ink/70">
          <Link href={`/matters/${matter.id}`} className="underline">
            返回案子
          </Link>
          {" · "}
          {review.kind}
          {review.sourceName ? ` · ${review.sourceName}` : ""}
        </p>
        <h2 className="font-serif text-2xl">{review.title}</h2>
        <pre className="whitespace-pre-wrap break-words font-sans text-sm leading-7 text-ink">
          {review.body}
        </pre>
      </div>
    </MatterFrame>
  );
}
