"use client";

import { useMemo, useState } from "react";
import Link from "next/link";
import { useQuery } from "@tanstack/react-query";
import { CheckCircle2, Circle, Download, FileSpreadsheet, FileText, History, Inbox, Mail, Printer } from "lucide-react";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { DropdownMenu, DropdownMenuContent, DropdownMenuItem, DropdownMenuLabel, DropdownMenuSeparator, DropdownMenuTrigger } from "@/components/ui/dropdown-menu";
import { Skeleton } from "@/components/ui/skeleton";
import { COMMUNICATION_KIND_LABELS, COMMUNICATION_STATUS_LABELS, type CommunicationKind, type CommunicationStatus } from "@/domain/communications/types";
import { EVENT_KIND_LABELS, STATUS_LABELS, displayTitle, type EventKind, type EventStatus } from "@/domain/events/types";
import { cn, formatDay, formatDateTime } from "@/lib/utils";

interface HistoryEvent {
  id: string;
  title: string;
  kind: EventKind;
  status: EventStatus;
  priority: string;
  starts_at: string;
  ends_at: string;
  all_day: boolean;
  process_number: string | null;
  responsible: string | null;
  checklist: { title: string; is_done: boolean }[];
}
interface HistoryCommunication {
  id: string;
  kind: CommunicationKind;
  status: CommunicationStatus;
  subject: string;
  deadline_at: string | null;
  send_at: string | null;
  sent_at: string | null;
  created_at: string;
  to_email: string | null;
  to_phone: string | null;
}
interface HistoryIntimation {
  id: string;
  process_number: string;
  tribunal: string | null;
  communication_type: string | null;
  document_type: string | null;
  available_at: string | null;
  published_at: string | null;
}
interface ClientHistoryData {
  events: HistoryEvent[];
  communications: HistoryCommunication[];
  intimations: HistoryIntimation[];
  summary: { total: number; tasks: number; done: number; pending: number; overdue: number; upcoming: number; communications: number };
}

export function useClientHistory(clientId: string) {
  return useQuery({
    queryKey: ["client-history", clientId],
    queryFn: async () => {
      const res = await fetch(`/api/clientes/${clientId}/historico`);
      if (!res.ok) throw new Error("Não foi possível carregar o histórico.");
      return (await res.json()) as ClientHistoryData;
    },
  });
}

/** Botão "Exportar histórico" do cliente: planilha, relatório para imprimir/PDF ou JSON. */
export function ClientHistoryExport({ clientId }: { clientId: string }) {
  const base = `/api/clientes/${clientId}/historico`;
  return (
    <DropdownMenu>
      <DropdownMenuTrigger asChild>
        <Button variant="outline"><Download /> Exportar histórico</Button>
      </DropdownMenuTrigger>
      <DropdownMenuContent align="end" className="w-64">
        <DropdownMenuLabel>Histórico deste cliente</DropdownMenuLabel>
        <DropdownMenuItem asChild>
          <a href={`${base}?formato=csv`} download><FileSpreadsheet /> Planilha (Excel/CSV)</a>
        </DropdownMenuItem>
        <DropdownMenuItem asChild>
          <a href={`${base}?formato=html&imprimir=1`} target="_blank" rel="noreferrer"><FileText /> PDF</a>
        </DropdownMenuItem>
        <DropdownMenuItem asChild>
          <a href={`${base}?formato=html`} target="_blank" rel="noreferrer"><Printer /> Relatório para imprimir</a>
        </DropdownMenuItem>
        <DropdownMenuSeparator />
        <DropdownMenuItem asChild>
          <a href={`${base}?formato=json&download=1`} download><FileText /> Dados completos (JSON)</a>
        </DropdownMenuItem>
      </DropdownMenuContent>
    </DropdownMenu>
  );
}

type Filter = "all" | "tasks" | "open" | "done" | "communications" | "intimations";

const FILTERS: { id: Filter; label: string }[] = [
  { id: "all", label: "Tudo" },
  { id: "tasks", label: "Tarefas" },
  { id: "open", label: "Pendentes" },
  { id: "done", label: "Concluídos" },
  { id: "communications", label: "Comunicações" },
  { id: "intimations", label: "Intimações" },
];

interface Entry {
  key: string;
  when: string;
  href: string | null;
  icon: "event" | "done" | "mail" | "intimation";
  tag: string;
  title: string;
  meta: string;
  overdue: boolean;
  type: "event" | "communication" | "intimation";
  isTask: boolean;
  isOpen: boolean;
  checklist?: { done: number; total: number };
}

/** Linha do tempo com todas as entradas do calendário, comunicações e intimações do cliente. */
export function ClientHistory({ clientId }: { clientId: string }) {
  const { data, isLoading, isError } = useClientHistory(clientId);
  const [filter, setFilter] = useState<Filter>("all");
  const [limit, setLimit] = useState(30);

  const entries = useMemo<Entry[]>(() => {
    if (!data) return [];
    const now = new Date().toISOString();
    const list: Entry[] = [
      ...data.events.map((e) => {
        const isOpen = e.status !== "done" && e.status !== "cancelled";
        return {
          key: `e-${e.id}`,
          when: e.starts_at,
          href: `/eventos/${e.id}`,
          icon: e.status === "done" ? ("done" as const) : ("event" as const),
          tag: EVENT_KIND_LABELS[e.kind] ?? e.kind,
          title: displayTitle(e.title, e.status),
          meta: [formatDateTime(e.starts_at, e.all_day), STATUS_LABELS[e.status], e.process_number, e.responsible].filter(Boolean).join(" · "),
          overdue: isOpen && e.ends_at < now,
          type: "event" as const,
          isTask: e.kind === "task",
          isOpen,
          checklist: e.checklist.length ? { done: e.checklist.filter((c) => c.is_done).length, total: e.checklist.length } : undefined,
        };
      }),
      ...data.communications.map((c) => ({
        key: `c-${c.id}`,
        when: c.sent_at ?? c.send_at ?? c.created_at,
        href: `/comunicacoes?abrir=${c.id}`,
        icon: "mail" as const,
        tag: COMMUNICATION_KIND_LABELS[c.kind],
        title: c.subject || "(sem assunto)",
        meta: [
          formatDateTime(c.sent_at ?? c.send_at ?? c.created_at),
          COMMUNICATION_STATUS_LABELS[c.status],
          c.deadline_at && `prazo ${formatDay(c.deadline_at)}`,
        ]
          .filter(Boolean)
          .join(" · "),
        overdue: false,
        type: "communication" as const,
        isTask: false,
        isOpen: c.status === "draft" || c.status === "scheduled",
      })),
      ...data.intimations.map((i) => ({
        key: `i-${i.id}`,
        when: i.published_at ?? i.available_at ?? "",
        href: `/intimacoes?abrir=${i.id}`,
        icon: "intimation" as const,
        tag: "Intimação",
        title: [i.communication_type, i.document_type].filter(Boolean).join(" — ") || "Intimação",
        meta: [i.published_at && formatDay(i.published_at), i.process_number, i.tribunal].filter(Boolean).join(" · "),
        overdue: false,
        type: "intimation" as const,
        isTask: false,
        isOpen: false,
      })),
    ];
    return list.sort((a, b) => b.when.localeCompare(a.when));
  }, [data]);

  const visible = entries.filter((e) => {
    switch (filter) {
      case "tasks":
        return e.isTask;
      case "open":
        return e.type === "event" && e.isOpen;
      case "done":
        return e.type === "event" && !e.isOpen;
      case "communications":
        return e.type === "communication";
      case "intimations":
        return e.type === "intimation";
      default:
        return true;
    }
  });

  return (
    <Card>
      <CardHeader className="space-y-3">
        <div className="flex flex-wrap items-center justify-between gap-2">
          <CardTitle className="flex items-center gap-2"><History className="size-4" /> Histórico do cliente</CardTitle>
        </div>
        {data && (
          <div className="flex flex-wrap gap-2 text-xs">
            <Badge variant="secondary">{data.summary.total} no calendário</Badge>
            <Badge variant="secondary">{data.summary.tasks} tarefas</Badge>
            <Badge variant="success">{data.summary.done} concluídas</Badge>
            <Badge variant="warning">{data.summary.pending} pendentes</Badge>
            {!!data.summary.overdue && <Badge variant="destructive">{data.summary.overdue} atrasadas</Badge>}
            <Badge variant="outline">{data.summary.communications} comunicações</Badge>
          </div>
        )}
        <div className="flex flex-wrap gap-1">
          {FILTERS.map((f) => (
            <button
              key={f.id}
              onClick={() => setFilter(f.id)}
              className={cn("rounded-full px-3 py-1 text-xs transition", filter === f.id ? "bg-primary text-primary-foreground" : "bg-secondary hover:bg-accent")}
            >
              {f.label}
            </button>
          ))}
        </div>
      </CardHeader>
      <CardContent>
        {isLoading ? (
          <div className="space-y-2">{Array.from({ length: 4 }).map((_, i) => <Skeleton key={i} className="h-12" />)}</div>
        ) : isError ? (
          <p className="py-4 text-center text-sm text-destructive">Não foi possível carregar o histórico.</p>
        ) : !visible.length ? (
          <p className="py-6 text-center text-sm text-muted-foreground">Nenhuma entrada. Ao vincular este cliente a uma tarefa ou compromisso no calendário, ela aparece aqui.</p>
        ) : (
          <ol className="relative space-y-1 border-l pl-4">
            {visible.slice(0, limit).map((e) => {
              const Icon = e.icon === "done" ? CheckCircle2 : e.icon === "mail" ? Mail : e.icon === "intimation" ? Inbox : Circle;
              const body = (
                <>
                  <span className="absolute -left-[23px] top-3 grid size-[14px] place-items-center rounded-full bg-background">
                    <Icon className={cn("size-[14px]", e.icon === "done" ? "text-emerald-500" : e.overdue ? "text-destructive" : "text-muted-foreground")} />
                  </span>
                  <span className="flex flex-wrap items-center gap-2">
                    <Badge variant="outline" className="text-[11px]">{e.tag}</Badge>
                    <span className={cn("text-sm font-medium", e.icon === "done" && "text-muted-foreground line-through")}>{e.title}</span>
                    {e.overdue && <Badge variant="destructive" className="text-[11px]">atrasada</Badge>}
                    {e.checklist && (
                      <span className="text-[11px] text-muted-foreground">
                        checklist {e.checklist.done}/{e.checklist.total}
                      </span>
                    )}
                  </span>
                  <span className="block text-xs text-muted-foreground">{e.meta}</span>
                </>
              );
              return (
                <li key={e.key} className="relative">
                  {e.href ? (
                    <Link href={e.href} className="block rounded-xl px-2 py-2 hover:bg-accent/60">{body}</Link>
                  ) : (
                    <div className="px-2 py-2">{body}</div>
                  )}
                </li>
              );
            })}
          </ol>
        )}
        {visible.length > limit && (
          <Button variant="ghost" size="sm" className="mt-2 w-full" onClick={() => setLimit((l) => l + 50)}>
            Mostrar mais ({visible.length - limit})
          </Button>
        )}
      </CardContent>
    </Card>
  );
}
