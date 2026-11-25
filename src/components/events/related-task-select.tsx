"use client";

import Link from "next/link";
import { useQuery } from "@tanstack/react-query";
import { ArrowUpRight } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Select, SelectContent, SelectGroup, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { EVENT_KIND_LABELS, type EventKind } from "@/domain/events/types";
import { sb, unwrap } from "@/hooks/supabase";
import { useWorkspace } from "@/hooks/use-workspace";
import { formatDate } from "@/lib/utils";

const NONE = "__none";

interface Candidate {
  id: string;
  title: string;
  kind: EventKind;
  status: string;
  starts_at: string;
  completed_at: string | null;
  client_id: string | null;
  process_id: string | null;
}

/** Tarefas concluídas que podem ser relacionadas a uma nova (as do mesmo cliente/processo primeiro). */
function useRelatedCandidates(excludeId: string | null) {
  const { organization } = useWorkspace();
  return useQuery({
    queryKey: ["events", "related-candidates", organization.id],
    queryFn: async () =>
      unwrap(
        await sb()
          .from("events")
          .select("id, title, kind, status, starts_at, completed_at, client_id, process_id")
          .eq("organization_id", organization.id)
          .eq("status", "done")
          .is("deleted_at", null)
          .order("starts_at", { ascending: false })
          .limit(400),
      ) as Candidate[],
    select: (rows) => rows.filter((r) => r.id !== excludeId),
  });
}

const doneLabel = (c: Candidate) => `executada em ${formatDate(c.completed_at ?? c.starts_at, { dateStyle: "short" })}`;

export function RelatedTaskSelect({
  value,
  onChange,
  clientId,
  processId,
  excludeId = null,
  className,
}: {
  value: string | null;
  onChange: (id: string | null) => void;
  clientId?: string | null;
  processId?: string | null;
  excludeId?: string | null;
  className?: string;
}) {
  const { data: candidates = [] } = useRelatedCandidates(excludeId);
  const close = candidates.filter((c) => (processId && c.process_id === processId) || (clientId && c.client_id === clientId));
  const others = candidates.filter((c) => !close.includes(c)).slice(0, 80);
  const selected = candidates.find((c) => c.id === value);

  const item = (c: Candidate) => (
    <SelectItem key={c.id} value={c.id}>
      {c.title} — {EVENT_KIND_LABELS[c.kind]}, {doneLabel(c)}
    </SelectItem>
  );

  return (
    <div className="flex items-center gap-1">
      <Select value={value ?? NONE} onValueChange={(v) => onChange(v === NONE ? null : v)}>
        <SelectTrigger className={className}><SelectValue placeholder="Nenhuma" /></SelectTrigger>
        <SelectContent className="max-w-[min(90vw,560px)]">
          <SelectItem value={NONE}>Nenhuma</SelectItem>
          {!!close.length && <SelectGroup>{close.map(item)}</SelectGroup>}
          {!!others.length && <SelectGroup>{others.map(item)}</SelectGroup>}
          {value && !selected && <SelectItem value={value}>Tarefa relacionada</SelectItem>}
        </SelectContent>
      </Select>
      {value && (
        <Button asChild variant="ghost" size="icon-sm">
          <Link href={`/eventos/${value}`} aria-label="Abrir tarefa relacionada"><ArrowUpRight /></Link>
        </Button>
      )}
    </div>
  );
}
