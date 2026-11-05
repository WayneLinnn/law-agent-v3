"use client";

import { useRouter } from "next/navigation";
import { useRef, useState } from "react";

export type MaterialFile = {
  id: string;
  filename: string;
  kind: string;
  stored: boolean;
  state: string;
};

export function MaterialFileRow({ matterId, file }: { matterId: string; file: MaterialFile }) {
  const [open, setOpen] = useState(false);
  const href = `/api/matters/${matterId}/materials/${file.id}/file`;
  const preview = file.stored && (file.kind === "照片" || file.kind === "PDF");
  return (
    <li className="min-w-0 text-sm text-muted">
      {preview ? (
        <button type="button" className="underline" aria-expanded={open} onClick={() => setOpen((current) => !current)}>
          {file.filename}
        </button>
      ) : file.stored ? (
        <a className="underline" href={href} download={file.filename}>
          {file.filename}
        </a>
      ) : (
        <span>{file.filename}</span>
      )}
      {` · ${file.state}`}
      {open && file.kind === "照片" ? (
        // eslint-disable-next-line @next/next/no-img-element
        <img src={href} alt={file.filename} className="mt-1 max-h-48 max-w-full border border-line bg-surface" />
      ) : null}
      {open && file.kind === "PDF" ? (
        <iframe title={file.filename} src={href} className="mt-1 h-64 w-full border border-line bg-surface" />
      ) : null}
    </li>
  );
}

export function MaterialDrop({
  matterId,
  materials,
  locked = false,
  showList = true,
}: {
  matterId: string;
  materials: MaterialFile[];
  locked?: boolean;
  showList?: boolean;
}) {
  const router = useRouter();
  const fileRef = useRef<HTMLInputElement>(null);
  const [over, setOver] = useState(false);
  const [pending, setPending] = useState(false);
  const [error, setError] = useState("");

  async function takeFiles(list: FileList | File[]) {
    const picked = [...list];
    if (picked.length === 0 || pending) return;
    setPending(true);
    setError("");
    const body = new FormData();
    for (const file of picked) body.append("file", file);
    const response = await fetch(`/api/matters/${matterId}/materials`, { method: "POST", body });
    const payload = (await response.json().catch(() => null)) as { error?: string } | null;
    setPending(false);
    if (!response.ok) {
      setError(payload?.error ?? "没有放进去。");
      return;
    }
    router.refresh();
  }

  return (
    <div>
      {locked ? (
        <p className="text-sm text-muted">归档后只供查阅。</p>
      ) : (
        <>
          <button
            type="button"
            className={`w-full border border-dashed px-3 py-4 text-left text-sm leading-6 ${over ? "border-action bg-aside" : "border-line bg-surface"}`}
            onClick={() => fileRef.current?.click()}
            onDragOver={(event) => {
              event.preventDefault();
              setOver(true);
            }}
            onDragLeave={() => setOver(false)}
            onDrop={(event) => {
              event.preventDefault();
              setOver(false);
              void takeFiles(event.dataTransfer.files);
            }}
            disabled={pending}
          >
            {pending
              ? "正在放入"
              : "把文件拖到这里，或点此选择。txt、md、Word、PDF、Excel、照片。原件留在这件案子里，点开可预览。"}
          </button>
          <input
            ref={fileRef}
            type="file"
            className="hidden"
            multiple
            accept=".txt,.md,.csv,.doc,.docx,.pdf,.xls,.xlsx,.png,.jpg,.jpeg,.webp,.gif,.bmp"
            onChange={(event) => {
              const list = event.target.files;
              if (list) void takeFiles(list);
              event.target.value = "";
            }}
          />
        </>
      )}
      {error ? <p className="mt-2 text-sm text-seal">{error}</p> : null}
      {showList && materials.length === 0 ? (
        <p className="mt-2 text-sm text-muted">本案还没有材料。</p>
      ) : null}
      {showList && materials.length > 0 ? (
        <ul className="mt-3 flex flex-col gap-2">
          {materials.map((file) => (
            <MaterialFileRow key={file.id} matterId={matterId} file={file} />
          ))}
        </ul>
      ) : null}
    </div>
  );
}
