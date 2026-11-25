"use client";

import { useQuery } from "@tanstack/react-query";
import { Building, CalendarClock, MapPin, MonitorPlay, Scale, User, Video } from "lucide-react";
import { Badge } from "@/components/ui/badge";
import { Dialog, DialogContent, DialogDescription, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { displayTitle, EVENT_KIND_LABELS } from "@/domain/events/types";
import { processLabel } from "@/domain/processes/types";
import { sb } from "@/hooks/supabase";
import { formatDate, formatTime } from "@/lib/utils";
import type { EventRow } from "@/types/db";

/** Texto da descrição sem as marcações de HTML que vêm do Google Agenda. */
function plainText(html: string) {
  const doc = new DOMParser().parseFromString(html.replace(/<br\s*\/?>/gi, "\n").replace(/<\/(p|div|li|h\d)>/gi, "\n"), "text/html");
  return (doc.body.textContent ?? "").replace(/\n{3,}/g, "\n\n").trim();
}

/** Versão web: detalhes do compromisso, só para leitura (os dados vêm do Google Agenda). */
export function EventPreview({ event, onClose }: { event: EventRow | null; onClose: () => void }) {
  const { data: description } = useQuery({
    queryKey: ["event-description", event?.id],
    enabled: !!event,
    queryFn: async () => {
      const { data } = await sb().from("events").select("description, description_text").eq("id", event!.id).maybeSingle();
      const row = data as { description: string | null; description_text: string | null } | null;
      return row?.description_text || (row?.description ? plainText(row.description) : null);
    },
  });
  if (!event) return null;
  const sameDay = formatDate(event.starts_at, { dateStyle: "short" }) === formatDate(event.ends_at, { dateStyle: "short" });
  const when = event.all_day
    ? formatDate(event.starts_at, { weekday: "long", day: "2-digit", month: "long" })
    : `${formatDate(event.starts_at, { weekday: "long", day: "2-digit", month: "long" })}, ${formatTime(event.starts_at)} – ${sameDay ? formatTime(event.ends_at) : formatDate(event.ends_at, { dateStyle: "short", timeStyle: "short" })}`;
  const online = event.hearing_mode === "online";
  const text = description ?? "";

  return (
    <Dialog open onOpenChange={(o) => !o && onClose()}>
      <DialogContent className="max-h-[85dvh] max-w-lg overflow-y-auto">
        <DialogHeader>
          <div className="flex flex-wrap gap-1.5">
            <Badge variant="secondary">{EVENT_KIND_LABELS[event.kind]}</Badge>
            {event.hearing_mode && (
              <Badge variant="outline">
                {online ? <MonitorPlay className="size-3" /> : <Building className="size-3" />} {online ? "On-line" : "Presencial"}
              </Badge>
            )}
          </div>
          <DialogTitle className="text-lg leading-snug">{displayTitle(event.title, event.status)}</DialogTitle>
          <DialogDescription className="flex items-center gap-1.5">
            <CalendarClock className="size-4 shrink-0" /> {when.charAt(0).toUpperCase() + when.slice(1)}
          </DialogDescription>
        </DialogHeader>
        <div className="space-y-2 text-sm">
          {event.location && (
            <p className="flex gap-2"><MapPin className="mt-0.5 size-4 shrink-0 text-muted-foreground" /> {event.location}</p>
          )}
          {event.meeting_url && (
            <a href={event.meeting_url} target="_blank" rel="noreferrer" className="flex items-center gap-2 text-primary hover:underline">
              <Video className="size-4 shrink-0" /> Entrar na sala
            </a>
          )}
          {event.client?.name && <p className="flex gap-2"><User className="mt-0.5 size-4 shrink-0 text-muted-foreground" /> {event.client.name}</p>}
          {event.process && <p className="flex gap-2"><Scale className="mt-0.5 size-4 shrink-0 text-muted-foreground" /> {processLabel(event.process)}</p>}
          {text && <p className="whitespace-pre-line rounded-xl bg-secondary/60 p-3 text-[13px] leading-relaxed">{text}</p>}
          <p className="pt-1 text-xs text-muted-foreground">Somente leitura. Para alterar, use o Lex Calendário no computador ou o Google Agenda.</p>
        </div>
      </DialogContent>
    </Dialog>
  );
}
