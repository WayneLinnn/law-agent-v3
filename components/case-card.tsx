"use client";

import Link from "next/link";

import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Separator } from "@/components/ui/separator";
import type { CaseCard } from "@/lib/case-board";

function blank(value: string) {
  return value.trim() || "还没写";
}

function statusVariant(status: string): "default" | "secondary" | "outline" | "warn" {
  if (status === "办理中" || status === "结案中") return "default";
  if (status === "已终止") return "warn";
  if (status === "草稿" || status === "待立案") return "secondary";
  return "outline";
}

function role(label: string, value: string) {
  return `${label} ${value.trim() || "—"}`;
}

export function CaseDetail({ matter }: { matter: CaseCard }) {
  return (
    <div className="border-t border-line bg-aside/60 px-4 py-4">
      <div className="flex items-start justify-between gap-3">
        <div className="min-w-0">
          <p className="break-words text-base font-medium leading-6">{matter.name}</p>
          {matter.caseNumber ? <p className="mt-1 text-xs text-muted">{matter.caseNumber}</p> : null}
          <div className="mt-2 flex flex-wrap gap-1.5">
            {matter.category ? <Badge>{matter.category}</Badge> : null}
            {matter.instance ? <Badge variant="outline">{matter.instance}</Badge> : null}
            <Badge variant={statusVariant(matter.status)}>{matter.status}</Badge>
          </div>
        </div>
        <p className="shrink-0 text-right text-xs leading-5 text-muted">
          律师费
          <br />
          已收 {matter.feeReceived ? `¥${matter.feeReceived}` : "还没记"}
        </p>
      </div>
      <dl className="mt-4 grid grid-cols-1 gap-x-6 gap-y-3 text-sm sm:grid-cols-2 xl:grid-cols-4">
        <div>
          <dt className="text-xs text-muted">承办机关</dt>
          <dd className="break-words">{blank(matter.organs.join("、"))}</dd>
        </div>
        <div>
          <dt className="text-xs text-muted">案由</dt>
          <dd className="break-words">{blank(matter.cause)}</dd>
        </div>
        <div>
          <dt className="text-xs text-muted">我方当事人</dt>
          <dd className="break-words">{blank(matter.clients.join("、"))}</dd>
        </div>
        <div>
          <dt className="text-xs text-muted">对方当事人</dt>
          <dd className="break-words">{blank(matter.opposing.join("、"))}</dd>
        </div>
        <div>
          <dt className="text-xs text-muted">立卡日期</dt>
          <dd>{blank(matter.openedOn)}</dd>
        </div>
      </dl>
      <Separator className="my-4" />
      <p className="text-xs text-muted">待办节点</p>
      {matter.tasks.length === 0 ? (
        <p className="mt-1 text-sm text-muted">暂无待办节点。</p>
      ) : (
        <ul className="mt-1 flex flex-col gap-1 text-sm">
          {matter.tasks.map((task) => (
            <li key={`${task.dueOn}-${task.name}`} className="break-words">
              {task.dueOn} · {task.name}
              {task.overdue ? (
                <Badge variant="warn" className="ml-2">
                  已过期
                </Badge>
              ) : null}
            </li>
          ))}
        </ul>
      )}
      <p className="mt-4 text-xs text-muted">承办人员</p>
      <p className="mt-1 flex flex-wrap items-center gap-x-3 gap-y-1 text-sm">
        {matter.instance ? <Badge variant="default">{matter.instance}</Badge> : null}
        <span>{role("承办法官", matter.judge)}</span>
        <span>{role("法官助理", matter.assistant)}</span>
        <span>{role("书记员", matter.clerk)}</span>
        <span>{role("庭室", matter.division)}</span>
      </p>
      {matter.node ? (
        <p className="mt-4 text-sm break-words text-muted">
          {matter.node.happenedOn} · {matter.node.title}
          {matter.node.detail ? ` · ${matter.node.detail}` : ""}
        </p>
      ) : null}
      <Button asChild variant="outline" size="sm" className="mt-4 w-fit">
        <Link href={`/matters/${matter.id}`}>打开案子</Link>
      </Button>
    </div>
  );
}
