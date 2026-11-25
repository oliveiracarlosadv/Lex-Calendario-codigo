"use client";

import { Bell, Mail, Monitor, Smartphone, X } from "lucide-react";
import { Button } from "@/components/ui/button";
import { DropdownMenu, DropdownMenuContent, DropdownMenuItem, DropdownMenuTrigger } from "@/components/ui/dropdown-menu";
import { Tooltip } from "@/components/ui/tooltip";
import { REMINDER_PRESETS, type NotificationChannel } from "@/domain/events/types";
import { useReminderMutations, useReminders } from "@/hooks/use-event-workspace";
import { cn, formatDateTime } from "@/lib/utils";

const CHANNELS: { id: NotificationChannel; label: string; icon: typeof Bell }[] = [
  { id: "in_app", label: "Na plataforma", icon: Monitor },
  { id: "push", label: "Push (celular e navegador)", icon: Smartphone },
  { id: "email", label: "E-mail", icon: Mail },
];

const labelFor = (m: number) => REMINDER_PRESETS.find((r) => r.minutes === m)?.label ?? `${m} min antes`;

export function RemindersPanel({ eventId }: { eventId: string }) {
  const { data: reminders = [] } = useReminders(eventId);
  const { add, updateChannels, remove } = useReminderMutations(eventId);
  const available = REMINDER_PRESETS.filter((p) => !reminders.some((r) => r.offset_minutes === p.minutes));

  return (
    <section className="space-y-2">
      <div className="flex items-center justify-between">
        <h2 className="text-[15px] font-semibold">Lembretes</h2>
        <DropdownMenu>
          <DropdownMenuTrigger asChild>
            <Button variant="ghost" size="sm" disabled={!available.length}>
              <Bell /> Adicionar
            </Button>
          </DropdownMenuTrigger>
          <DropdownMenuContent align="end">
            {available.map((p) => (
              <DropdownMenuItem key={p.minutes} onSelect={() => add.mutate({ minutes: p.minutes, channels: ["in_app", "push", "email"] })}>
                {p.label}
              </DropdownMenuItem>
            ))}
          </DropdownMenuContent>
        </DropdownMenu>
      </div>
      {!reminders.length && <p className="text-sm text-muted-foreground">Nenhum lembrete. Adicione quantos quiser.</p>}
      <ul className="space-y-1.5">
        {reminders.map((r) => (
          <li key={r.id} className="flex items-center gap-2 rounded-xl border px-3 py-2">
            <div className="min-w-0 flex-1">
              <p className="text-sm font-medium">{labelFor(r.offset_minutes)}</p>
              <p className="text-[11.5px] text-muted-foreground">
                {r.sent_at ? `Enviado em ${formatDateTime(r.sent_at)}` : `Dispara em ${formatDateTime(r.remind_at)}`}
              </p>
            </div>
            {CHANNELS.map((c) => {
              const on = r.channels.includes(c.id);
              return (
                <Tooltip key={c.id} content={`${c.label}: ${on ? "ativado" : "desativado"}`}>
                  <button
                    onClick={() =>
                      updateChannels.mutate({ id: r.id, channels: on ? r.channels.filter((x) => x !== c.id) : [...r.channels, c.id] })
                    }
                    className={cn("rounded-md p-1.5 transition", on ? "bg-primary/10 text-primary" : "text-muted-foreground/50 hover:bg-accent")}
                  >
                    <c.icon className="size-3.5" />
                  </button>
                </Tooltip>
              );
            })}
            <button onClick={() => remove.mutate(r.id)} className="rounded p-1 text-muted-foreground hover:text-destructive" aria-label="Remover lembrete">
              <X className="size-4" />
            </button>
          </li>
        ))}
      </ul>
    </section>
  );
}
