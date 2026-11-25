"use client";

import { useCallback, useEffect, useMemo, useRef, useState, type CSSProperties } from "react";
import { useRouter } from "next/navigation";
import FullCalendar from "@fullcalendar/react";
import type { DatesSetArg, EventClickArg, EventContentArg, EventDropArg, EventInput, DayHeaderContentArg } from "@fullcalendar/core";
import ptBrLocale from "@fullcalendar/core/locales/pt-br";
import dayGridPlugin from "@fullcalendar/daygrid";
import timeGridPlugin from "@fullcalendar/timegrid";
import interactionPlugin, { type DateClickArg, type EventResizeDoneArg } from "@fullcalendar/interaction";
import multiMonthPlugin from "@fullcalendar/multimonth";
import listPlugin from "@fullcalendar/list";
import "@fullcalendar/resource";
import resourceTimeGridPlugin from "@fullcalendar/resource-timegrid";
import { ChevronLeft, ChevronRight, Gavel, ListChecks, Plus } from "lucide-react";
import { Button } from "@/components/ui/button";
import { TopActions } from "@/components/layout/app-shell";
import { DEFAULT_KIND_COLORS, displayTitle } from "@/domain/events/types";
import { checklistProgress } from "@/domain/events/rules";
import { useEventsInRange, useUpdateEvent } from "@/hooks/use-events";
import { useCategories, useUnseenEventChanges } from "@/hooks/use-records";
import { useWorkspace } from "@/hooks/use-workspace";
import { publicEnv } from "@/lib/env";
import { cn, readableOn, TZ } from "@/lib/utils";
import { useCalendarStore, VIEW_LABELS, type CalendarView as ViewName } from "@/stores/calendar-store";
import { useUiStore } from "@/stores/ui-store";
import { processLabel } from "@/domain/processes/types";
import type { EventRow } from "@/types/db";
import { EventPreview } from "./event-preview";
import { GoogleSignInBanner } from "./google-sign-in-banner";
import { TasksPanel } from "./tasks-panel";

/** Versão web: cliente de leitura do Google Agenda (sem criar, mover nem editar). */
const readOnly = publicEnv.webMode;

const dayKey = (iso: string) => new Date(iso).toLocaleDateString("en-CA", { timeZone: TZ });
const addDayKey = (key: string, n: number) => {
  const d = new Date(`${key}T12:00:00Z`);
  d.setUTCDate(d.getUTCDate() + n);
  return d.toISOString().slice(0, 10);
};
/** Data local (meia-noite) → ISO, para eventos de dia inteiro. */
const midnightISO = (d: Date) => new Date(d.getFullYear(), d.getMonth(), d.getDate()).toISOString();

/** Cor dos compromissos concluídos na agenda. */
const DONE_COLOR = "#16a34a";

/** Audiência ainda por acontecer (não concluída nem cancelada): sempre em destaque. */
const isOpenHearing = (e: { kind: string; status: string }) => e.kind === "hearing" && e.status !== "done" && e.status !== "cancelled";
/** Dia da célula do calendário (hora local) no formato AAAA-MM-DD. */
const cellKey = (d: Date) => `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-${String(d.getDate()).padStart(2, "0")}`;

// A visão Ano não cabe em tela de celular e trava ao reabrir nessa largura: abre em Mês
if (typeof window !== "undefined" && window.innerWidth < 640 && useCalendarStore.getState().view === "multiMonthYear") {
  useCalendarStore.getState().setView("dayGridMonth");
}

export function CalendarView() {
  const router = useRouter();
  const ref = useRef<FullCalendar>(null);
  const { view, setView, date, setDate, hiddenCategories, onlyMine } = useCalendarStore();
  const openQuickCreate = useUiStore((s) => s.openQuickCreate);
  const { userId, members } = useWorkspace();
  const { data: categories } = useCategories();
  const updateEvent = useUpdateEvent();
  const [range, setRange] = useState<{ start: string; end: string } | null>(null);
  const [title, setTitle] = useState("");
  const { data: rows } = useEventsInRange(range?.start ?? null, range?.end ?? null);
  const [preview, setPreview] = useState<EventRow | null>(null);
  const hasLicense = !!publicEnv.fullCalendarLicense;

  // Telas pequenas começam na visão Dia
  useEffect(() => {
    if (window.innerWidth < 768 && view === "timeGridWeek") setView("timeGridDay");
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const api = () => ref.current?.getApi();

  useEffect(() => {
    const a = api();
    if (a && a.view.type !== view) a.changeView(view);
  }, [view]);

  useEffect(() => {
    const a = api();
    if (a && dayKey(a.getDate().toISOString()) !== dayKey(date)) a.gotoDate(new Date(date));
  }, [date]);

  const colorOf = useCallback(
    (categoryId: string | null, kind: keyof typeof DEFAULT_KIND_COLORS, override: string | null) =>
      override ?? categories?.find((c) => c.id === categoryId)?.color ?? DEFAULT_KIND_COLORS[kind],
    [categories],
  );

  // Cor das audiências (a da agenda "Audiência"), usada para destacar o dia
  const hearingColor = colorOf(categories?.find((c) => c.kind === "hearing")?.id ?? null, "hearing", null);

  const unseen = useUnseenEventChanges();
  const visible = useMemo(
    () =>
      (rows ?? [])
        .filter((e) => !e.category_id || !hiddenCategories.includes(e.category_id))
        .filter((e) => !onlyMine || e.responsible_id === userId || e.created_by === userId),
    [rows, hiddenCategories, onlyMine, userId],
  );

  // Quantas audiências há em cada dia: o dia ganha fundo e etiqueta "Audiência"
  const hearingDays = useMemo(() => {
    const map = new Map<string, number>();
    for (const e of visible) {
      if (!isOpenHearing(e)) continue;
      const k = dayKey(e.starts_at);
      map.set(k, (map.get(k) ?? 0) + 1);
    }
    return map;
  }, [visible]);

  const events: EventInput[] = useMemo(
    () =>
      visible.map((e) => {
        const hearing = isOpenHearing(e);
        // Concluído fica sempre verde, qualquer que seja a categoria
        const color = e.status === "done" ? DONE_COLOR : colorOf(e.category_id, e.kind, e.color);
        const start = e.all_day ? dayKey(e.starts_at) : e.starts_at;
        let end: string = e.ends_at;
        if (e.all_day) {
          const endKey = dayKey(e.ends_at);
          end = endKey > start ? endKey : addDayKey(start, 1);
        }
        return {
          id: e.id,
          title: displayTitle(e.title, e.status),
          start,
          end,
          allDay: e.all_day,
          resourceId: e.responsible_id ?? undefined,
          // Audiência: faixa cheia (não só bolinha), sempre a primeira do dia
          display: hearing ? "block" : undefined,
          classNames: [e.status === "done" ? "lex-done" : "", e.priority === "critical" ? "lex-critical" : "", hearing ? "lex-hearing" : ""].filter(Boolean),
          extendedProps: {
            rank: hearing ? 0 : 1,
            hearing,
            hearingMode: e.hearing_mode ?? null,
            color,
            textColor: readableOn(color),
            kind: e.kind,
            priority: e.priority,
            location: e.location,
            process: e.process ? processLabel(e.process) : undefined,
            client: e.client?.name,
            progress: e.checklist?.length ? checklistProgress(e.checklist.map((c) => ({ isDone: c.is_done }))) : null,
            changed: unseen.has(e.id),
          },
        };
      }),
    [visible, colorOf, unseen],
  );

  const onDatesSet = (arg: DatesSetArg) => {
    setRange({ start: arg.start.toISOString(), end: arg.end.toISOString() });
    setTitle(arg.view.title);
    const current = arg.view.calendar.getDate();
    if (dayKey(current.toISOString()) !== dayKey(useCalendarStore.getState().date)) setDate(current);
  };

  const persistMove = (info: EventDropArg | EventResizeDoneArg) => {
    const ev = info.event;
    const start = ev.start!;
    const end = ev.end ?? new Date(start.getTime() + (ev.allDay ? 864e5 : 3600e3));
    const responsible = (info as { newResource?: { id: string } | null }).newResource?.id;
    updateEvent.mutate(
      {
        id: ev.id,
        all_day: ev.allDay,
        starts_at: ev.allDay ? midnightISO(start) : start.toISOString(),
        ends_at: ev.allDay ? midnightISO(end) : end.toISOString(),
        ...(responsible ? { responsible_id: responsible } : {}),
      },
      { onError: () => info.revert() },
    );
  };

  const renderEvent = (arg: EventContentArg) => {
    const p = arg.event.extendedProps as {
      location?: string;
      process?: string;
      progress: number | null;
      priority?: string;
      changed?: boolean;
      hearing?: boolean;
      hearingMode?: "online" | "presencial" | null;
    };
    const gavel = p.hearing ? <Gavel className="lex-hearing-icon mr-1 size-3 shrink-0" aria-label="Audiência" /> : null;
    // Alterado por um convidado (ou no calendário) e ainda não visto: bolinha azul pulsando
    const changedDot = p.changed ? (
      <span className="relative mr-1 inline-flex size-2.5 shrink-0" aria-label="Alterado por convidado — ainda não visto" title="Alterado por convidado — ainda não visto">
        <span className="absolute inline-flex size-full animate-ping rounded-full bg-sky-400 opacity-75" />
        <span className="relative inline-flex size-2.5 rounded-full bg-sky-500 ring-1 ring-white" />
      </span>
    ) : null;
    const isTimeGrid = arg.view.type.startsWith("timeGrid") || arg.view.type.startsWith("resourceTimeGrid");
    // Prioridade alta ou crítica: bolinha vermelha antes do nome
    const urgent = p.priority === "high" || p.priority === "critical";
    const dot = urgent ? (
      <span className="mr-1 inline-block size-2 shrink-0 rounded-full bg-[#FF3B30] ring-1 ring-white/80" aria-label="Prioridade alta" />
    ) : null;
    if (arg.view.type === "multiMonthYear") {
      return p.changed ? (
        <span className="mx-auto block size-2 rounded-full bg-sky-500 ring-2 ring-sky-300" title="Alterado por convidado — ainda não visto" />
      ) : p.hearing ? (
        <span className="mx-auto block size-2.5 rounded-full ring-2 ring-[var(--ev-color)] ring-offset-1" style={{ background: "var(--ev-color)" }} title="Audiência" />
      ) : (
        <span className="mx-auto block size-1.5 rounded-full" style={{ background: urgent ? "#FF3B30" : "var(--ev-color)" }} />
      );
    }
    if (!isTimeGrid || arg.event.allDay) {
      const isDotEvent = !arg.event.allDay && !p.hearing && arg.view.type === "dayGridMonth";
      return (
        <span className="flex min-w-0 items-center overflow-hidden">
          {isDotEvent && <span className="fc-daygrid-event-dot" />}
          {changedDot}
          {dot}
          {gavel}
          {arg.timeText && !arg.event.allDay && <span className="fc-event-time mr-1 shrink-0">{arg.timeText}</span>}
          <span className="fc-event-title truncate">{arg.event.title}</span>
        </span>
      );
    }
    return (
      <div className="flex h-full flex-col overflow-hidden leading-tight">
        <span className="flex min-w-0 items-center truncate text-[12px] font-semibold">{changedDot}{dot}{gavel}<span className="truncate">{arg.event.title}</span></span>
        <span className="truncate text-[11px] opacity-80">
          {arg.timeText}
          {p.hearingMode ? ` · ${p.hearingMode === "online" ? "on-line" : "presencial"}` : ""}
        </span>
        {p.location && <span className="truncate text-[11px] opacity-70">{p.location}</span>}
        {p.process && <span className="truncate text-[10.5px] opacity-60">{p.process}</span>}
        {p.progress !== null && (
          <span className="mt-auto h-[3px] w-full overflow-hidden rounded-full bg-black/10 dark:bg-white/10">
            <span className="block h-full" style={{ width: `${p.progress}%`, background: "var(--ev-color)" }} />
          </span>
        )}
      </div>
    );
  };

  const dayHeader = (arg: DayHeaderContentArg) => {
    if (!arg.view.type.includes("timeGrid") && !arg.view.type.includes("resourceTimeGrid")) return arg.text;
    const weekday = arg.date.toLocaleDateString("pt-BR", { weekday: "short" }).replace(".", "");
    return (
      <span className="lex-dayhead">
        <span className="capitalize">{weekday}</span>
        <span className="lex-dayhead-num">{arg.date.getDate()}</span>
      </span>
    );
  };

  // Barra de tarefas à direita (lembra a escolha neste computador)
  const [tasksOpen, setTasksOpen] = useState(false);
  useEffect(() => {
    try {
      setTasksOpen(window.localStorage.getItem("lex-painel-tarefas") !== "0");
    } catch {
      setTasksOpen(true);
    }
  }, []);
  const showTasks = (open: boolean) => {
    setTasksOpen(open);
    try {
      window.localStorage.setItem("lex-painel-tarefas", open ? "1" : "0");
    } catch {
      // sem armazenamento local
    }
    // o calendário recalcula a largura
    window.setTimeout(() => api()?.updateSize(), 50);
  };

  const views: ViewName[] = ["timeGridDay", "timeGridWeek", "dayGridMonth", "multiMonthYear", ...(hasLicense ? (["resourceTimeGridDay"] as ViewName[]) : [])];

  return (
    <div className="flex h-full flex-col">
      {/* Barra de ferramentas no estilo Apple Calendar */}
      <div className="flex flex-wrap items-center gap-2 border-b px-3 py-2.5 md:px-5">
        <h1 className="order-1 mr-2 min-w-0 flex-1 basis-[60%] truncate text-base font-semibold capitalize tracking-tight sm:order-none sm:flex-none sm:basis-auto sm:text-lg md:text-xl">{title}</h1>
        <div className="order-3 flex items-center sm:order-none">
          <Button variant="ghost" size="icon-sm" onClick={() => api()?.prev()} aria-label="Anterior">
            <ChevronLeft />
          </Button>
          <Button variant="outline" size="sm" onClick={() => api()?.today()}>
            Hoje
          </Button>
          <Button variant="ghost" size="icon-sm" onClick={() => api()?.next()} aria-label="Próximo">
            <ChevronRight />
          </Button>
        </div>
        <div className="hidden flex-1 sm:block" />
        <div className="order-4 flex min-w-0 flex-1 basis-[50%] rounded-lg bg-secondary p-[3px] sm:order-none sm:w-auto sm:flex-none sm:basis-auto">
          {views.map((v) => (
            <button
              key={v}
              onClick={() => setView(v)}
              className={cn(
                "flex-1 rounded-md px-1.5 py-1 text-[13px] font-medium transition sm:flex-none sm:px-3",
                v === "multiMonthYear" && "hidden sm:block",
                view === v ? "bg-background text-foreground shadow-soft" : "text-muted-foreground hover:text-foreground",
              )}
            >
              {VIEW_LABELS[v]}
            </button>
          ))}
        </div>
        {!readOnly && (
        <Button
          size="sm"
          className="order-2 sm:order-none"
          onClick={() => {
            const start = new Date(date);
            const now = new Date();
            start.setHours(now.getHours() + 1, 0, 0, 0);
            openQuickCreate({ start: start.toISOString(), end: new Date(start.getTime() + 3600e3).toISOString(), allDay: false });
          }}
        >
          <Plus /> <span className="hidden sm:inline">Novo</span>
        </Button>
        )}
        {!readOnly && (
          <Button
            size="sm"
            variant={tasksOpen ? "secondary" : "outline"}
            className="hidden lg:inline-flex"
            onClick={() => showTasks(!tasksOpen)}
            title="Mostrar ou esconder a barra de tarefas"
          >
            <ListChecks /> Tarefas
          </Button>
        )}
        <TopActions />
      </div>

      <GoogleSignInBanner />
      <div className="flex min-h-0 flex-1">
      <div
        className="lex-calendar min-h-0 min-w-0 flex-1 px-1 md:px-3"
        style={{ "--hearing-color": hearingColor, "--hearing-text": readableOn(hearingColor) } as CSSProperties}
      >
        <FullCalendar
          ref={ref}
          plugins={[dayGridPlugin, timeGridPlugin, interactionPlugin, multiMonthPlugin, listPlugin, resourceTimeGridPlugin]}
          schedulerLicenseKey={publicEnv.fullCalendarLicense || "CC-Attribution-NonCommercial-NoDerivatives"}
          initialView={view}
          initialDate={date}
          locale={ptBrLocale}
          headerToolbar={false}
          height="100%"
          firstDay={0}
          nowIndicator
          selectable={!readOnly}
          selectMirror
          editable={!readOnly}
          eventResizableFromStart
          dayMaxEventRows={4}
          eventOrder="rank,start,-duration,allDay,title"
          weekNumbers={false}
          scrollTime="07:30:00"
          slotDuration="00:30:00"
          slotLabelFormat={{ hour: "2-digit", minute: "2-digit", hour12: false }}
          eventTimeFormat={{ hour: "2-digit", minute: "2-digit", hour12: false }}
          businessHours={{ daysOfWeek: [1, 2, 3, 4, 5], startTime: "08:00", endTime: "18:00" }}
          allDayText="dia todo"
          multiMonthMaxColumns={4}
          multiMonthMinWidth={220}
          views={{
            multiMonthYear: { dayMaxEventRows: 1 },
            resourceTimeGridDay: { datesAboveResources: true },
          }}
          resources={members.map((m) => ({ id: m.user_id, title: m.profile?.full_name ?? "Membro" }))}
          events={events}
          datesSet={onDatesSet}
          select={(info) => {
            openQuickCreate({
              start: info.allDay ? midnightISO(info.start) : info.start.toISOString(),
              end: info.allDay ? midnightISO(info.end) : info.end.toISOString(),
              allDay: info.allDay,
            });
            api()?.unselect();
          }}
          dateClick={(info: DateClickArg) => {
            if (info.view.type === "multiMonthYear") {
              setDate(info.date);
              setView("timeGridDay");
            }
          }}
          eventClick={(info: EventClickArg) => {
            info.jsEvent.preventDefault();
            if (readOnly) setPreview((rows ?? []).find((e) => e.id === info.event.id) ?? null);
            else router.push(`/eventos/${info.event.id}`);
          }}
          eventDrop={persistMove}
          eventResize={persistMove}
          eventDidMount={(info) => {
            const p = info.event.extendedProps as { color: string; textColor: string; client?: string; process?: string };
            info.el.style.setProperty("--ev-color", p.color);
            info.el.style.setProperty("--ev-text", p.textColor);
            info.el.title = [info.event.title, p.client, p.process].filter(Boolean).join(" · ");
          }}
          eventContent={renderEvent}
          dayHeaderContent={dayHeader}
          dayCellClassNames={(arg) => {
            const n = hearingDays.get(cellKey(arg.date)) ?? 0;
            return n ? ["lex-hearing-day", n > 1 ? "lex-hearing-many" : ""].filter(Boolean) : [];
          }}
          navLinks
          navLinkDayClick={(d) => {
            setDate(d);
            setView("timeGridDay");
          }}
        />
      </div>
      {tasksOpen && !readOnly && <TasksPanel onClose={() => showTasks(false)} />}
      <EventPreview event={preview} onClose={() => setPreview(null)} />
      </div>
    </div>
  );
}
