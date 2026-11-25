"use client";

import Link from "next/link";
import { AlarmClock, AlertTriangle, CalendarCheck2, CalendarClock, Flame, Gavel, ListTodo, Sparkles, type LucideIcon } from "lucide-react";
import { Badge } from "@/components/ui/badge";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Progress } from "@/components/ui/progress";
import { Skeleton } from "@/components/ui/skeleton";
import { PageHeader } from "@/components/layout/app-shell";
import { isCritical, isOverdue } from "@/domain/events/rules";
import { DEFAULT_KIND_COLORS, EVENT_KIND_LABELS, displayTitle } from "@/domain/events/types";
import { useUpcomingEvents } from "@/hooks/use-events";
import { useIntimations } from "@/hooks/use-intimations";
import { useCategories, useDashboardMetrics } from "@/hooks/use-records";
import { useWorkspace } from "@/hooks/use-workspace";
import { cn, formatDate, formatTime, relativeDays, TZ } from "@/lib/utils";
import { processLabel } from "@/domain/processes/types";
import { LinkClientButton } from "@/components/processes/link-client-button";
import { UpcomingHearings } from "./upcoming-hearings";
import type { EventRow } from "@/types/db";

function Stat({ icon: Icon, label, value, tone, href }: { icon: LucideIcon; label: string; value: number | undefined; tone: string; href?: string }) {
  const body = (
    <Card className={cn("p-4 transition", href && "cursor-pointer hover:-translate-y-0.5 hover:shadow-float")}>
      <div className="flex items-center justify-between">
        <span className={cn("flex size-8 items-center justify-center rounded-full", tone)}>
          <Icon className="size-4" />
        </span>
        {value === undefined ? <Skeleton className="h-7 w-10" /> : <span className="text-[26px] font-semibold tracking-tight">{value}</span>}
      </div>
      <p className="mt-2 text-[13px] text-muted-foreground">{label}</p>
    </Card>
  );
  return href ? <Link href={href}>{body}</Link> : body;
}

function EventLine({ e, color }: { e: EventRow; color: string }) {
  return (
    <div className="flex items-center gap-1">
    <Link href={`/eventos/${e.id}`} className="flex min-w-0 flex-1 items-center gap-3 rounded-xl px-2 py-2 transition hover:bg-accent/60">
      <span className="h-9 w-1 shrink-0 rounded-full" style={{ background: color }} />
      <div className="min-w-0 flex-1">
        <p className={cn("truncate text-sm font-medium", e.status === "done" && "text-muted-foreground line-through")}>{displayTitle(e.title, e.status)}</p>
        <p className="truncate text-xs text-muted-foreground">
          {EVENT_KIND_LABELS[e.kind]}
          {e.process ? ` · ${processLabel(e.process)}` : ""}
          {e.client?.name ? ` · ${e.client.name}` : ""}
        </p>
      </div>
      <div className="shrink-0 text-right text-xs">
        <p className="font-medium">{relativeDays(e.starts_at)}</p>
        <p className="text-muted-foreground">{e.all_day ? formatDate(e.starts_at, { day: "2-digit", month: "short" }) : formatTime(e.starts_at)}</p>
      </div>
    </Link>
    <LinkClientButton processId={e.process_id} size="xs" />
    </div>
  );
}

function EventList({ title, description, events, colorOf, empty }: { title: string; description?: string; events: EventRow[]; colorOf: (e: EventRow) => string; empty: string }) {
  return (
    <Card>
      <CardHeader>
        <CardTitle>{title}</CardTitle>
        {description && <CardDescription>{description}</CardDescription>}
      </CardHeader>
      <CardContent className="space-y-0.5">
        {events.length ? events.map((e) => <EventLine key={e.id} e={e} color={colorOf(e)} />) : <p className="py-6 text-center text-sm text-muted-foreground">{empty}</p>}
      </CardContent>
    </Card>
  );
}

export function Dashboard() {
  const { profile } = useWorkspace();
  const { data: m } = useDashboardMetrics();
  const { data: events = [] } = useUpcomingEvents(30, 90);
  const { data: categories } = useCategories();
  const { data: unreadIntimations = [] } = useIntimations("unread");
  const colorOf = (e: EventRow) => e.color ?? categories?.find((c) => c.id === e.category_id)?.color ?? DEFAULT_KIND_COLORS[e.kind];

  const now = new Date();
  const todayKey = now.toLocaleDateString("en-CA", { timeZone: TZ });
  const isToday = (iso: string) => new Date(iso).toLocaleDateString("en-CA", { timeZone: TZ }) === todayKey;
  const active = events.filter((e) => e.status !== "cancelled");

  const today = active.filter((e) => isToday(e.starts_at));
  const hearingsToday = today.filter((e) => e.kind === "hearing");
  const deadlines = active.filter((e) => e.kind === "deadline" && e.status !== "done" && new Date(e.ends_at) >= now).slice(0, 8);
  const upcoming = active.filter((e) => new Date(e.starts_at) > now && !isToday(e.starts_at)).slice(0, 8);
  const overdue = active.filter((e) => isOverdue({ endsAt: e.ends_at, status: e.status, kind: e.kind, source: e.source }));
  const critical = active.filter((e) => isCritical({ priority: e.priority, kind: e.kind, startsAt: e.starts_at, status: e.status })).slice(0, 6);
  const pending = active.filter((e) => (e.status === "scheduled" || e.status === "in_progress") && e.checklist?.some((c) => !c.is_done)).slice(0, 6);

  const onTimeRate = m && m.deadlinesTotalMonth ? Math.round((m.deadlinesMetOnTime / m.deadlinesTotalMonth) * 100) : null;
  const maxWeek = Math.max(1, ...(m?.weekly ?? []).map((w) => w.total));
  const hour = Number(now.toLocaleTimeString("en-GB", { timeZone: TZ, hour: "2-digit" }));
  const greeting = hour < 12 ? "Bom dia" : hour < 18 ? "Boa tarde" : "Boa noite";

  return (
    <div>
      <PageHeader
        title={`${greeting}, ${profile.full_name?.split(" ").find((p) => !/^dra?\.?$/i.test(p)) ?? ""}`}
        description={new Intl.DateTimeFormat("pt-BR", { timeZone: TZ, dateStyle: "full" }).format(now)}
      />
      <div className="space-y-6 p-4 md:p-8">
        <div className="grid grid-cols-2 gap-3 md:grid-cols-3 xl:grid-cols-6">
          <Stat icon={Gavel} label="Audiências hoje" value={m?.hearingsToday} tone="bg-red-500/10 text-red-600" href="/lista?filtro=audiencias-hoje" />
          <Stat icon={AlarmClock} label="Prazos em 7 dias" value={m?.deadlinesNext7} tone="bg-orange-500/10 text-orange-600" href="/lista?filtro=prazos" />
          <Stat icon={CalendarClock} label="Compromissos futuros" value={m?.upcoming} tone="bg-blue-500/10 text-blue-600" href="/lista?filtro=futuros" />
          <Stat icon={ListTodo} label="Tarefas pendentes (7 dias)" value={m?.pending} tone="bg-amber-500/10 text-amber-600" href="/lista?filtro=pendentes" />
          <Stat icon={AlertTriangle} label="Atrasados" value={m?.overdue} tone="bg-rose-500/10 text-rose-600" href="/lista?filtro=atrasados" />
          <Stat icon={Flame} label="Eventos críticos" value={m?.critical} tone="bg-fuchsia-500/10 text-fuchsia-600" href="/lista?filtro=criticos" />
        </div>

        <UpcomingHearings />

        {unreadIntimations.length > 0 && (
          <Link href="/intimacoes" className="flex items-center gap-3 rounded-2xl border border-red-500/30 bg-red-500/5 p-4 transition hover:bg-red-500/10">
            <AlertTriangle className="size-5 text-red-600" />
            <p className="flex-1 text-sm">
              Você tem <strong>{unreadIntimations.length}</strong> intimação(ões) nova(s) publicada(s) no Diário de Justiça Eletrônico.
            </p>
            <Badge variant="destructive">Ver intimações</Badge>
          </Link>
        )}

        {!!m?.pendingSuggestions && (
          <Link href="/monitoramento" className="flex items-center gap-3 rounded-2xl border border-primary/30 bg-primary/5 p-4 transition hover:bg-primary/10">
            <Sparkles className="size-5 text-primary" />
            <p className="flex-1 text-sm">
              A IA identificou <strong>{m.pendingSuggestions}</strong> possível(is) audiência(s), prazo(s) ou lembrete(s) nas movimentações processuais.
            </p>
            <Badge>Revisar</Badge>
          </Link>
        )}

        <div className="grid gap-6 xl:grid-cols-3">
          <EventList title="Hoje" description={`${hearingsToday.length} audiência(s) · ${today.length} compromisso(s)`} events={today} colorOf={colorOf} empty="Agenda livre hoje." />
          <EventList title="Prazos próximos" events={deadlines} colorOf={colorOf} empty="Nenhum prazo pendente nos próximos 30 dias." />
          <EventList title="Próximos compromissos" events={upcoming} colorOf={colorOf} empty="Nada agendado." />
        </div>

        <div className="grid gap-6 xl:grid-cols-3">
          <EventList title="Atrasados" description="Prazos e tarefas vencidos sem conclusão" events={overdue.slice(0, 8)} colorOf={colorOf} empty="Nenhum atraso. 👏" />
          <EventList title="Críticos" events={critical} colorOf={colorOf} empty="Nenhum evento crítico." />
          <EventList title="Com checklist pendente" events={pending} colorOf={colorOf} empty="Todos os checklists em dia." />
        </div>

        <Card>
          <CardHeader>
            <CardTitle>Indicadores de produtividade</CardTitle>
            <CardDescription>Mês corrente e últimas 8 semanas</CardDescription>
          </CardHeader>
          <CardContent className="grid gap-8 md:grid-cols-[280px_1fr]">
            <div className="space-y-5">
              <div>
                <div className="mb-1 flex justify-between text-sm"><span>Prazos cumpridos no prazo</span><span className="font-semibold">{onTimeRate === null ? "—" : `${onTimeRate}%`}</span></div>
                <Progress value={onTimeRate ?? 0} />
              </div>
              <div>
                <div className="mb-1 flex justify-between text-sm"><span>Checklists concluídos (30 dias)</span><span className="font-semibold">{m?.checklistProgress ?? 0}%</span></div>
                <Progress value={m?.checklistProgress ?? 0} indicatorClassName="bg-blue-500" />
              </div>
              <div className="grid grid-cols-2 gap-3 text-sm">
                <div className="rounded-xl bg-secondary/60 p-3"><p className="text-xl font-semibold">{m?.completedThisMonth ?? "—"}</p><p className="text-xs text-muted-foreground">concluídos no mês</p></div>
                <div className="rounded-xl bg-secondary/60 p-3"><p className="text-xl font-semibold">{m?.createdThisMonth ?? "—"}</p><p className="text-xs text-muted-foreground">criados no mês</p></div>
                <div className="rounded-xl bg-secondary/60 p-3"><p className="text-xl font-semibold">{m?.activeProcesses ?? "—"}</p><p className="text-xs text-muted-foreground">processos ativos</p></div>
                <div className="rounded-xl bg-secondary/60 p-3"><p className="text-xl font-semibold">{m?.clients ?? "—"}</p><p className="text-xs text-muted-foreground">clientes</p></div>
              </div>
            </div>
            <div>
              <p className="mb-3 flex items-center gap-4 text-xs text-muted-foreground">
                <span className="flex items-center gap-1.5"><span className="size-2.5 rounded-sm bg-primary" /> concluídos</span>
                <span className="flex items-center gap-1.5"><span className="size-2.5 rounded-sm bg-primary/20" /> total</span>
              </p>
              <div className="flex h-44 items-end gap-2" role="img" aria-label="Compromissos por semana">
                {(m?.weekly ?? []).map((w) => (
                  <div key={w.week} className="flex flex-1 flex-col items-center gap-1.5" title={`${w.done} de ${w.total}`}>
                    <div className="relative w-full max-w-[42px] overflow-hidden rounded-t-md bg-primary/20" style={{ height: `${(w.total / maxWeek) * 150}px` }}>
                      <div className="absolute bottom-0 w-full bg-primary" style={{ height: `${w.total ? (w.done / w.total) * 100 : 0}%` }} />
                    </div>
                    <span className="text-[10.5px] text-muted-foreground">{formatDate(`${w.week}T12:00:00Z`, { day: "2-digit", month: "2-digit" })}</span>
                  </div>
                ))}
                {!m?.weekly?.length && <p className="m-auto flex items-center gap-2 text-sm text-muted-foreground"><CalendarCheck2 className="size-4" /> Os indicadores aparecem conforme a agenda é usada.</p>}
              </div>
            </div>
          </CardContent>
        </Card>
      </div>
    </div>
  );
}
