"use client";

import { useEffect, useState } from "react";
import Link from "next/link";
import { Building, Gavel, LayoutGrid, List, MapPin, MonitorPlay, Video } from "lucide-react";
import { Card, CardContent, CardHeader } from "@/components/ui/card";
import { Skeleton } from "@/components/ui/skeleton";
import { LinkClientButton } from "@/components/processes/link-client-button";
import { displayTitle } from "@/domain/events/types";
import { processLabel } from "@/domain/processes/types";
import { useUpcomingHearings } from "@/hooks/use-events";
import { cn, formatDate, formatTime, TZ } from "@/lib/utils";
import type { EventRow } from "@/types/db";

/** Dias de calendário (fuso de Brasília) entre hoje e a data da audiência. */
export function daysUntil(iso: string, now = new Date()): number {
  const day = (d: Date) => new Date(`${d.toLocaleDateString("en-CA", { timeZone: TZ })}T12:00:00Z`).getTime();
  return Math.round((day(new Date(iso)) - day(now)) / 864e5);
}

type Layout = "grade" | "lista";
const KEY = "lex-audiencias-exibicao";

/** "Hoje", "Amanhã", "em 12 dias" — com cor só quando está perto. */
function countdown(e: EventRow, now: Date) {
  const days = daysUntil(e.starts_at, now);
  if (days <= 0) {
    const started = !e.all_day && new Date(e.starts_at).getTime() <= now.getTime();
    return { text: started ? "Agora" : "Hoje", tone: "bg-red-600 text-white" };
  }
  if (days === 1) return { text: "Amanhã", tone: "bg-orange-500 text-white" };
  return { text: `em ${days} dias`, tone: days <= 7 ? "bg-amber-400/90 text-amber-950" : "bg-secondary text-muted-foreground" };
}

/** O título já está numa seção de audiências: tira o "Audiência:" do começo. */
function cleanTitle(e: EventRow) {
  return displayTitle(e.title, e.status).replace(/^\s*audi[eê]ncia\s*[:\-–—]\s*/i, "") || "Audiência";
}

/** Bloco de data, como uma folhinha: mês abreviado e dia grande. */
function DateBlock({ e, className }: { e: EventRow; className?: string }) {
  return (
    <div className={cn("flex w-12 shrink-0 flex-col items-center justify-center rounded-xl border bg-background py-1.5 leading-none", className)}>
      <span className="text-[10px] font-semibold uppercase tracking-wide text-red-600">{formatDate(e.starts_at, { month: "short" }).replace(".", "")}</span>
      <span className="mt-1 text-xl font-semibold tabular-nums">{formatDate(e.starts_at, { day: "2-digit" })}</span>
    </div>
  );
}

/** Dia da semana e hora, e se é on-line ou presencial. */
function When({ e }: { e: EventRow }) {
  const online = e.hearing_mode === "online";
  return (
    <span className="flex min-w-0 shrink-0 flex-wrap items-center gap-x-1.5 text-xs text-muted-foreground">
      <span className="capitalize">{formatDate(e.starts_at, { weekday: "short" }).replace(".", "")}</span>
      {!e.all_day && <span>· {formatTime(e.starts_at)}</span>}
      {e.hearing_mode && (
        <span className="inline-flex items-center gap-1">
          · {online ? <MonitorPlay className="size-3" /> : <Building className="size-3" />} {online ? "On-line" : "Presencial"}
        </span>
      )}
    </span>
  );
}

function subtitle(e: EventRow) {
  return [e.client?.name, e.process && processLabel(e.process)].filter(Boolean).join(" · ");
}

/** Destaque do painel: próximas audiências e quantos dias faltam, em grade ou em lista. */
export function UpcomingHearings() {
  const { data: hearings, isLoading } = useUpcomingHearings(6);
  const now = new Date();
  const [layout, setLayout] = useState<Layout>("grade");
  useEffect(() => {
    try {
      if (window.localStorage.getItem(KEY) === "lista") setLayout("lista");
    } catch {
      // sem armazenamento local
    }
  }, []);
  function choose(l: Layout) {
    setLayout(l);
    try {
      window.localStorage.setItem(KEY, l);
    } catch {
      // sem armazenamento local: vale só nesta sessão
    }
  }

  return (
    <Card>
      <CardHeader className="flex-row flex-wrap items-center gap-x-3 gap-y-2 space-y-0 pb-3">
        <h2 className="flex min-w-0 flex-1 basis-full items-center gap-2 whitespace-nowrap text-[15px] font-semibold sm:basis-auto">
          <Gavel className="size-4 text-red-600" /> Próximas audiências
          {!!hearings?.length && <span className="text-sm font-normal text-muted-foreground">{hearings.length}</span>}
        </h2>
        <div className="flex rounded-lg bg-secondary p-0.5" role="group" aria-label="Exibição">
          {(["grade", "lista"] as const).map((l) => {
            const Icon = l === "grade" ? LayoutGrid : List;
            return (
              <button
                key={l}
                type="button"
                onClick={() => choose(l)}
                aria-pressed={layout === l}
                title={l === "grade" ? "Exibir em grade" : "Exibir em lista"}
                className={cn(
                  "flex items-center gap-1 rounded-md px-2 py-1 text-xs transition",
                  layout === l ? "bg-background text-foreground shadow-soft" : "text-muted-foreground hover:text-foreground",
                )}
              >
                <Icon className="size-3.5" /> <span className="hidden sm:inline">{l === "grade" ? "Grade" : "Lista"}</span>
              </button>
            );
          })}
        </div>
        <Link href="/lista?filtro=futuros" className="text-xs text-primary hover:underline">Ver agenda</Link>
      </CardHeader>
      <CardContent>
        {isLoading ? (
          <div className="grid gap-3 md:grid-cols-2 xl:grid-cols-3">{Array.from({ length: 3 }).map((_, i) => <Skeleton key={i} className="h-24" />)}</div>
        ) : !hearings?.length ? (
          <p className="py-6 text-center text-sm text-muted-foreground">Nenhuma audiência agendada.</p>
        ) : layout === "grade" ? (
          <div className="grid grid-cols-1 gap-3 md:grid-cols-2 xl:grid-cols-3">
            {hearings.map((e) => {
              const c = countdown(e, now);
              const sub = subtitle(e);
              const place = e.location && e.hearing_mode !== "online" ? e.location : null;
              return (
                <div key={e.id} className="flex min-w-0 flex-col rounded-2xl border bg-card p-3 transition hover:border-foreground/20 hover:shadow-soft">
                  <Link href={`/eventos/${e.id}`} className="flex flex-1 gap-3">
                    <DateBlock e={e} />
                    <div className="min-w-0 flex-1 space-y-1">
                      <p className="line-clamp-2 text-sm font-medium leading-snug" title={displayTitle(e.title, e.status)}>{cleanTitle(e)}</p>
                      <When e={e} />
                      {sub && <p className="truncate text-xs text-muted-foreground" title={sub}>{sub}</p>}
                    </div>
                  </Link>
                  <div className="mt-2.5 flex items-center gap-2 pl-[60px]">
                    <span className={cn("rounded-full px-2 py-0.5 text-[11px] font-semibold", c.tone)}>{c.text}</span>
                    {e.meeting_url && (
                      <a href={e.meeting_url} target="_blank" rel="noreferrer" className="inline-flex items-center gap-1 text-[11px] text-primary hover:underline">
                        <Video className="size-3" /> Entrar na sala
                      </a>
                    )}
                    <span className="flex-1" />
                    {place && (
                      <span className="text-muted-foreground" title={place}>
                        <MapPin className="size-3.5" />
                      </span>
                    )}
                    <LinkClientButton processId={e.process_id} size="xs" variant="ghost" />
                  </div>
                </div>
              );
            })}
          </div>
        ) : (
          <ul className="divide-y rounded-2xl border">
            {hearings.map((e) => {
              const c = countdown(e, now);
              const sub = subtitle(e);
              return (
                <li key={e.id} className="flex items-center gap-3 px-3 py-2.5 transition first:rounded-t-2xl last:rounded-b-2xl hover:bg-accent/40">
                  <Link href={`/eventos/${e.id}`} className="flex min-w-0 flex-1 items-center gap-3">
                    <DateBlock e={e} className="w-11 py-1" />
                    <div className="min-w-0 flex-1">
                      <p className="truncate text-sm font-medium" title={displayTitle(e.title, e.status)}>{cleanTitle(e)}</p>
                      <p className="flex min-w-0 items-center gap-1.5 text-xs text-muted-foreground">
                        <When e={e} />
                        {sub && <span className="hidden min-w-0 truncate md:inline">· {sub}</span>}
                      </p>
                    </div>
                  </Link>
                  {e.meeting_url && (
                    <a href={e.meeting_url} target="_blank" rel="noreferrer" title="Entrar na sala" className="hidden text-primary sm:block">
                      <Video className="size-4" />
                    </a>
                  )}
                  <span className="hidden sm:inline-flex"><LinkClientButton processId={e.process_id} size="xs" variant="ghost" /></span>
                  <span className={cn("w-[76px] sm:w-[84px] shrink-0 rounded-full px-2 py-0.5 text-center text-[11px] font-semibold", c.tone)}>{c.text}</span>
                </li>
              );
            })}
          </ul>
        )}
      </CardContent>
    </Card>
  );
}
