import { MessageBody } from "@/components/message-body";

export function LiveTurn({
  lawyer,
  answer,
  compact = false,
}: {
  lawyer: string;
  answer: string;
  compact?: boolean;
}) {
  const modelClass = compact
    ? "mr-auto max-w-[92%] border-l-2 border-agent px-3 py-2"
    : "mr-auto max-w-[92%] border-l-2 border-agent pl-3";
  return (
    <li className="msg-in flex flex-col gap-2">
      <div className="ml-auto max-w-[85%] rounded-lg bg-[#F3F5F6] px-3 py-2">
        <p className="text-right text-xs text-muted">你</p>
        <p className="mt-1 whitespace-pre-wrap break-words text-sm leading-6">{lawyer}</p>
      </div>
      <div className={modelClass}>
        <p className="text-xs text-agent">Agent</p>
        <MessageBody text={answer || "正在写"} className="mt-1 whitespace-pre-wrap break-words text-sm leading-6" />
      </div>
    </li>
  );
}
