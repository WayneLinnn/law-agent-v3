"use client";

import { MaterialDrop, MaterialFileRow } from "@/components/material-drop";
import { materialState } from "@/lib/material-state";
import type { MaterialRecord } from "@/lib/materials";

export function MaterialDesk({
  matterId,
  materials,
  locked,
}: {
  matterId: string;
  materials: MaterialRecord[];
  locked: boolean;
}) {
  const files = materials.map((material) => ({
    id: material.id,
    filename: material.filename,
    kind: material.kind,
    stored: material.stored,
    state: materialState(material),
  }));

  return (
    <div className="flex flex-col gap-4">
      <MaterialDrop matterId={matterId} materials={files} locked={locked} showList={false} />
      {materials.length === 0 ? (
        <p className="text-sm text-muted">本案还没有材料。</p>
      ) : (
        <ul className="flex flex-col gap-3">
          {materials.map((material) => (
            <li key={material.id} id={material.id} className="panel min-w-0 px-4 py-4">
              <MaterialFileRow
                matterId={matterId}
                file={{
                  id: material.id,
                  filename: material.filename,
                  kind: material.kind,
                  stored: material.stored,
                  state: materialState(material),
                }}
              />
              <p className="mt-2 whitespace-pre-wrap break-words text-sm leading-6">
                证明对象：{material.proves || <span className="text-muted">还没写</span>}
              </p>
              {materialBody(material)}
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}

function materialBody(material: MaterialRecord) {
  const text = material.usableText.trim() || material.readText.trim();
  if (!text) return null;
  return (
    <details className="mt-3">
      <summary className="text-xs text-muted">正文</summary>
      <p className="mt-2 whitespace-pre-wrap break-words text-sm leading-6">{text}</p>
    </details>
  );
}
