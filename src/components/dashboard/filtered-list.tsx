"use client";

import Link from "next/link";
import { ArrowLeft, ListChecks } from "lucide-react";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { EmptyState } from "@/components/ui/empty-state";
import { PageHeader } from "@/components/layout/app-shell";
import { checklistProgress, isCritical, isOverdue } from "@/domain/events/rules";
import { DEFAULT_KIND_COLORS, EVENT_KIND_LABELS, PRIORITY_LABELS, STATUS_LABELS, displayTitle } from "@/domain/events/types";
import { useUpcomingEvents } from "@/hooks/use-events";
import { useCategories } from "@/hooks/use-records";
import { formatDateTime, relativeDays, TZ } from "@/lib/utils";
import type { EventRow } from "@/types/db";
import { processLabel } from "@/domain/processes/types";
import { LinkClientButton } from "@/components/processes/link-client-button";

const FILTERS: Record<string, { title: string; description: string; test: (e: EventRow, now: Date) => boolean }> = {
  "audiencias-hoje": {
    title: "Audiências de hoje",
    description: "Audiências marcadas para hoje",
    test: (e, now) => e.kind === "hearing" && e.status !== "cancelled" && new Date(e.starts_at).toLocaleDateString("en-CA", { timeZone: TZ }) === now.toLocaleDateString("en-CA", { timeZone: TZ }),
  },
  prazos: {
    title: "Prazos nos próximos 7 dias",
    description: "Prazos em aberto que vencem em até 7 dias",
    test: (e, now) => e.kind === "deadline" && !["done", "cancelled"].includes(e.status) && new Date(e.ends_at) >= now && new Date(e.starts_at).getTime() <= now.getTime() + 7 * 864e5,
  },
  futuros: {
    title: "Compromissos futuros",
    description: "Tudo o que está agendado a partir de agora (próximos 30 dias)",
    test: (e, now) => new Date(e.starts_at) > now && ["scheduled", "in_progress"].includes(e.status),
  },
  pendentes: {
    title: "Tarefas pendentes",
    description: "Compromissos criados no Lex, em aberto, nos próximos 7 dias",
    test: (e, now) =>
      ["lex", "ai"].includes(e.source) && ["scheduled", "in_progress"].includes(e.status) && new Date(e.ends_at) >= now && new Date(e.starts_at).getTime() <= now.getTime() + 7 * 864e5,
  },
  atrasados: {
    title: "Atrasados",
    description: "Prazos, tarefas, diligências e lembretes vencidos sem conclusão (últimos 90 dias)",
    test: (e, now) => isOverdue({ endsAt: e.ends_at, status: e.status, kind: e.kind, source: e.source }, now),
  },
  criticos: {
    title: "Eventos críticos",
    description: "Prioridade crítica ou prazos que vencem em até 48 horas",
    test: (e, now) => new Date(e.ends_at) >= now && isCritical({ priority: e.priority, kind: e.kind, startsAt: e.starts_at, status: e.status }, now),
  },
};

export function FilteredList({ filterKey }: { filterKey: string }) {
  const key = filterKey;
  const filter = FILTERS[key] ?? FILTERS.futuros;
  const { data: events = [], isLoading } = useUpcomingEvents(30, 90);
  const { data: categories } = useCategories();
  const now = new Date();
  const list = events.filter((e) => filter.test(e, now));
  const colorOf = (e: EventRow) => e.color ?? categories?.find((c) => c.id === e.category_id)?.color ?? DEFAULT_KIND_COLORS[e.kind];

  return (
    <div>
      <PageHeader title={filter.title} description={`${filter.description} · ${list.length} item(ns)`} actions={<Button variant="outline" asChild><Link href="/painel"><ArrowLeft /> Painel</Link></Button>} />
      <div className="mx-auto max-w-4xl space-y-2 p-4 md:p-8">
        <div className="flex flex-wrap gap-1.5 pb-2">
          {Object.entries(FILTERS).map(([k, f]) => (
            <Link key={k} href={`/lista?filtro=${k}`} className="rounded-full border px-3 py-1 text-[13px] transition data-[on=true]:border-transparent data-[on=true]:bg-foreground data-[on=true]:text-background" data-on={k === key}>
              {f.title}
            </Link>
          ))}
        </div>
        {!isLoading && !list.length && <EmptyState icon={ListChecks} title="Nada por aqui" description="Nenhum compromisso nesta lista." />}
        {list.map((e) => (
          <div key={e.id} className="flex items-center gap-2">
          <Link href={`/eventos/${e.id}`} className="flex min-w-0 flex-1 items-center gap-3 rounded-2xl border bg-card px-4 py-3 transition hover:bg-accent/40">
            <span className="h-10 w-1 shrink-0 rounded-full" style={{ background: colorOf(e) }} />
            <div className="min-w-0 flex-1">
              <p className="truncate font-medium">{displayTitle(e.title, e.status)}</p>
              <p className="truncate text-xs text-muted-foreground">
                {EVENT_KIND_LABELS[e.kind]} · {STATUS_LABELS[e.status]} · Prioridade {PRIORITY_LABELS[e.priority]}
                {e.process ? ` · ${processLabel(e.process)}` : ""}
                {e.client?.name ? ` · ${e.client.name}` : ""}
              </p>
            </div>
            {!!e.checklist?.length && <Badge variant="outline">{checklistProgress(e.checklist.map((c) => ({ isDone: c.is_done })))}%</Badge>}
            <div className="shrink-0 text-right text-xs">
              <p className="font-medium">{relativeDays(e.starts_at)}</p>
              <p className="text-muted-foreground">{formatDateTime(e.starts_at, e.all_day)}</p>
            </div>
          </Link>
          <LinkClientButton processId={e.process_id} size="xs" />
          </div>
        ))}
      </div>
    </div>
  );
}
