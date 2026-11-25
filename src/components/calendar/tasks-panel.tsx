"use client";

import { useMemo, useState } from "react";
import Link from "next/link";
import { ChevronDown, Circle, CircleCheck, Gavel, ListChecks, MonitorPlay, Plus, X } from "lucide-react";
import { Input } from "@/components/ui/input";
import { useCreateEvent, useUpcomingEvents, useUpdateEvent } from "@/hooks/use-events";
import { useCategories } from "@/hooks/use-records";
import { daysUntil } from "@/components/dashboard/upcoming-hearings";
import { DEFAULT_KIND_COLORS, displayTitle, type EventStatus } from "@/domain/events/types";
import { cn, TZ } from "@/lib/utils";
import type { EventRow } from "@/types/db";

type Scope = "tarefas" | "tudo";
const KEY = "lex-painel-tarefas-escopo";

const dayKey = (d: Date) => d.toLocaleDateString("en-CA", { timeZone: TZ });

/** "Hoje 14:00", "Amanhã", "seg., 20 out." */
function when(e: EventRow, now: Date) {
  const start = new Date(e.starts_at);
  const today = dayKey(now);
  const tomorrow = dayKey(new Date(now.getTime() + 864e5));
  const yesterday = dayKey(new Date(now.getTime() - 864e5));
  const k = dayKey(start);
  const day =
    k === today ? "Hoje" : k === tomorrow ? "Amanhã" : k === yesterday ? "Ontem" : start.toLocaleDateString("pt-BR", { timeZone: TZ, weekday: "short", day: "2-digit", month: "short" });
  return e.all_day ? day : `${day} ${start.toLocaleTimeString("pt-BR", { timeZone: TZ, hour: "2-digit", minute: "2-digit" })}`;
}

/** "Hoje", "Amanhã", "12 dias" — contagem até a audiência (cor só quando está perto). */
function countdown(e: EventRow, now: Date) {
  const days = daysUntil(e.starts_at, now);
  if (days <= 0) return { text: "Hoje", tone: "bg-red-600 text-white" };
  if (days === 1) return { text: "Amanhã", tone: "bg-orange-500 text-white" };
  return { text: `${days} dias`, tone: days <= 7 ? "bg-amber-400/90 text-amber-950" : "bg-secondary text-muted-foreground" };
}

/** A seção já é de audiências: tira o "Audiência:" do começo do título. */
const hearingTitle = (e: EventRow) => displayTitle(e.title, e.status).replace(/^\s*audi[eê]ncia\s*[:\-–—]\s*/i, "") || "Audiência";

/** Quantas audiências aparecem antes do "Ver todas". */
const HEARINGS_SHOWN = 3;
const HEARINGS_KEY = "lex-painel-tarefas-audiencias";

/** Barra lateral de tarefas (estilo Google Tasks): atrasadas, agendadas e concluídas, em ordem. */
export function TasksPanel({ onClose }: { onClose: () => void }) {
  const { data: events } = useUpcomingEvents(120, 90);
  const { data: categories } = useCategories();
  const update = useUpdateEvent();
  const create = useCreateEvent();
  const [scope, setScope] = useState<Scope>(() => {
    try {
      return (window.localStorage.getItem(KEY) as Scope) || "tarefas";
    } catch {
      return "tarefas";
    }
  });
  const [showDone, setShowDone] = useState(false);
  const [allHearings, setAllHearings] = useState(false);
  // Seção de audiências aberta ou recolhida (lembra a escolha neste computador)
  const [hearingsOpen, setHearingsOpen] = useState(() => {
    try {
      return window.localStorage.getItem(HEARINGS_KEY) !== "0";
    } catch {
      return true;
    }
  });
  function toggleHearings() {
    setHearingsOpen((v) => {
      try {
        window.localStorage.setItem(HEARINGS_KEY, v ? "0" : "1");
      } catch {
        // sem armazenamento local
      }
      return !v;
    });
  }
  const [newTitle, setNewTitle] = useState("");

  const groups = useMemo(() => {
    const now = new Date();
    const all = (events ?? []).filter((e) => e.status !== "cancelled");
    // Audiências por acontecer ficam sempre no topo, em destaque, qualquer que seja o filtro
    const hearings = all
      .filter((e) => e.kind === "hearing" && e.status !== "done" && new Date(e.ends_at) >= now)
      .sort((a, b) => a.starts_at.localeCompare(b.starts_at));
    const hearingIds = new Set(hearings.map((e) => e.id));
    const list = all.filter((e) => !hearingIds.has(e.id) && (scope === "tudo" || e.kind === "task" || e.kind === "deadline"));
    const open = list.filter((e) => e.status !== "done");
    const overdue = open.filter((e) => new Date(e.ends_at) < now).sort((a, b) => a.starts_at.localeCompare(b.starts_at));
    const scheduled = open.filter((e) => new Date(e.ends_at) >= now).sort((a, b) => a.starts_at.localeCompare(b.starts_at));
    const done = list
      .filter((e) => e.status === "done")
      .sort((a, b) => (b.completed_at ?? b.starts_at).localeCompare(a.completed_at ?? a.starts_at));
    return { hearings, overdue, scheduled, done, now };
  }, [events, scope]);

  function changeScope(s: Scope) {
    setScope(s);
    try {
      window.localStorage.setItem(KEY, s);
    } catch {
      // sem armazenamento local: vale só nesta sessão
    }
  }

  function toggle(e: EventRow) {
    const status: EventStatus = e.status === "done" ? "scheduled" : "done";
    update.mutate({ id: e.id, status });
  }

  async function add() {
    const title = newTitle.trim();
    if (!title) return;
    const today = new Date(`${dayKey(new Date())}T00:00:00-03:00`);
    setNewTitle("");
    await create.mutateAsync({
      title,
      kind: "task",
      category_id: categories?.find((c) => c.kind === "task")?.id ?? null,
      starts_at: today.toISOString(),
      ends_at: new Date(today.getTime() + 864e5).toISOString(),
      all_day: true,
    });
  }

  const hearingColor = (e: EventRow) =>
    e.color ?? categories?.find((c) => c.id === e.category_id)?.color ?? categories?.find((c) => c.kind === "hearing")?.color ?? DEFAULT_KIND_COLORS.hearing;

  // Uma linha por audiência, como as tarefas: não empurra a lista do dia para baixo
  const hearingRow = (e: EventRow) => {
    const color = hearingColor(e);
    const c = countdown(e, groups.now);
    return (
      <li key={e.id} className="group flex items-center gap-2 rounded-lg px-2 py-1.5 hover:bg-accent/60">
        <span className="h-7 w-1 shrink-0 rounded-full" style={{ background: color }} aria-hidden />
        <Link href={`/eventos/${e.id}`} className="min-w-0 flex-1" title={displayTitle(e.title, e.status)}>
          <span className="block truncate text-[13px] font-medium">{hearingTitle(e)}</span>
          <span className="flex items-center gap-1 truncate text-[11px] text-muted-foreground">
            {when(e, groups.now)}
            {e.hearing_mode === "online" && <MonitorPlay className="size-3 shrink-0" aria-label="On-line" />}
          </span>
        </Link>
        <span className={cn("shrink-0 rounded-full px-1.5 py-px text-[10.5px] font-semibold", c.tone)}>{c.text}</span>
      </li>
    );
  };

  const row = (e: EventRow, tone?: "late") => (
    <li key={e.id} className="group flex items-start gap-2 rounded-lg px-2 py-1.5 hover:bg-accent/60">
      <button
        type="button"
        onClick={() => toggle(e)}
        className={cn("mt-0.5 shrink-0 text-muted-foreground hover:text-primary", e.status === "done" && "text-emerald-600")}
        aria-label={e.status === "done" ? "Reabrir" : "Marcar como concluída"}
        title={e.status === "done" ? "Reabrir" : "Concluir"}
      >
        {e.status === "done" ? <CircleCheck className="size-[18px]" /> : <Circle className="size-[18px]" />}
      </button>
      <Link href={`/eventos/${e.id}`} className="min-w-0 flex-1">
        <span className={cn("block truncate text-[13px]", e.status === "done" && "text-muted-foreground line-through")}>{displayTitle(e.title, e.status)}</span>
        <span className={cn("block truncate text-[11px] text-muted-foreground", tone === "late" && "text-destructive")}>
          {when(e, groups.now)}
          {e.status === "in_progress" ? " · em andamento" : ""}
          {e.client?.name ? ` · ${e.client.name}` : ""}
        </span>
      </Link>
    </li>
  );

  return (
    <aside className="hidden w-[300px] shrink-0 flex-col border-l bg-background lg:flex">
      <div className="flex items-center gap-2 border-b px-3 py-2.5">
        <ListChecks className="size-4 text-primary" />
        <span className="flex-1 text-sm font-semibold">Tarefas</span>
        <button type="button" onClick={onClose} className="rounded-md p-1 text-muted-foreground hover:bg-accent" aria-label="Fechar tarefas">
          <X className="size-4" />
        </button>
      </div>
      <div className="flex gap-1 px-3 pt-2.5">
        {(["tarefas", "tudo"] as const).map((s) => (
          <button
            key={s}
            type="button"
            onClick={() => changeScope(s)}
            className={cn("rounded-full px-2.5 py-0.5 text-[11.5px] transition", scope === s ? "bg-primary text-primary-foreground" : "bg-secondary hover:bg-accent")}
          >
            {s === "tarefas" ? "Tarefas e prazos" : "Todos os compromissos"}
          </button>
        ))}
      </div>
      <form
        className="flex items-center gap-1.5 px-3 py-2.5"
        onSubmit={(ev) => {
          ev.preventDefault();
          void add();
        }}
      >
        <Plus className="size-4 shrink-0 text-primary" />
        <Input value={newTitle} onChange={(ev) => setNewTitle(ev.target.value)} placeholder="Adicionar tarefa para hoje" className="h-8 text-[13px]" />
      </form>
      <div className="min-h-0 flex-1 space-y-4 overflow-y-auto px-1 pb-4">
        {groups.hearings.length > 0 && (
          <section>
            <button type="button" onClick={toggleHearings} className="flex w-full items-center gap-1 px-3 pb-1 text-[11px] font-semibold uppercase tracking-wide text-muted-foreground">
              <ChevronDown className={cn("size-3.5 transition", !hearingsOpen && "-rotate-90")} />
              <Gavel className="size-3.5 text-red-600" /> Audiências ({groups.hearings.length})
            </button>
            {hearingsOpen && (
              <>
                <ul>{(allHearings ? groups.hearings : groups.hearings.slice(0, HEARINGS_SHOWN)).map(hearingRow)}</ul>
                {groups.hearings.length > HEARINGS_SHOWN && (
                  <button type="button" onClick={() => setAllHearings((v) => !v)} className="px-3 pt-0.5 text-[11.5px] text-primary hover:underline">
                    {allHearings ? "Mostrar menos" : `Ver todas (${groups.hearings.length})`}
                  </button>
                )}
              </>
            )}
          </section>
        )}
        {groups.overdue.length > 0 && (
          <section>
            <p className="px-3 pb-1 text-[11px] font-semibold uppercase tracking-wide text-destructive">Atrasadas ({groups.overdue.length})</p>
            <ul>{groups.overdue.map((e) => row(e, "late"))}</ul>
          </section>
        )}
        <section>
          <p className="px-3 pb-1 text-[11px] font-semibold uppercase tracking-wide text-muted-foreground">Agendadas ({groups.scheduled.length})</p>
          {groups.scheduled.length ? <ul>{groups.scheduled.map((e) => row(e))}</ul> : <p className="px-3 text-xs text-muted-foreground">Nada agendado.</p>}
        </section>
        <section>
          <button type="button" onClick={() => setShowDone((v) => !v)} className="flex w-full items-center gap-1 px-3 pb-1 text-[11px] font-semibold uppercase tracking-wide text-muted-foreground">
            <ChevronDown className={cn("size-3.5 transition", !showDone && "-rotate-90")} /> Concluídas ({groups.done.length})
          </button>
          {showDone && <ul>{groups.done.map((e) => row(e))}</ul>}
        </section>
      </div>
    </aside>
  );
}
