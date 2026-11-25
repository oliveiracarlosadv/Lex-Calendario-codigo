"use client";

import Link from "next/link";
import { Bell } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Popover, PopoverContent, PopoverTrigger } from "@/components/ui/popover";
import { useMarkNotificationsRead, useNotifications } from "@/hooks/use-records";
import { cn, formatDateTime } from "@/lib/utils";

export function NotificationsBell() {
  const { data } = useNotifications();
  const markRead = useMarkNotificationsRead();
  const unread = (data ?? []).filter((n) => !n.read_at);

  return (
    <Popover>
      <PopoverTrigger asChild>
        <Button variant="ghost" size="icon-sm" className="relative" aria-label="Notificações">
          <Bell className={cn(unread.length > 0 && "animate-wiggle")} />
          {unread.length > 0 && (
            <span className="absolute right-1 top-1 flex size-4 items-center justify-center rounded-full bg-[hsl(var(--today))] text-[9.5px] font-bold text-white">
              {unread.length > 9 ? "9+" : unread.length}
            </span>
          )}
        </Button>
      </PopoverTrigger>
      <PopoverContent align="end" className="w-[360px] p-0">
        <div className="flex items-center justify-between border-b px-4 py-3">
          <p className="text-sm font-semibold">Notificações</p>
          {unread.length > 0 && (
            <button className="text-xs text-primary hover:underline" onClick={() => markRead.mutate(undefined)}>
              Marcar todas como lidas
            </button>
          )}
        </div>
        <div className="scrollbar-thin max-h-[420px] overflow-y-auto">
          {(data ?? []).slice(0, 20).map((n) => (
            <Link
              key={n.id}
              href={n.link ?? "/notificacoes"}
              onClick={() => !n.read_at && markRead.mutate([n.id])}
              className={cn("flex gap-3 border-b px-4 py-3 text-sm transition hover:bg-accent/50", !n.read_at && "bg-primary/[0.04]")}
            >
              <span className={cn("mt-1.5 size-2 shrink-0 rounded-full", n.read_at ? "bg-transparent" : "bg-[hsl(var(--today))]")} />
              <span className="min-w-0">
                <span className="block font-medium">{n.title}</span>
                {n.body && <span className="block text-[13px] text-muted-foreground">{n.body}</span>}
                <span className="mt-0.5 block text-[11px] text-muted-foreground">{formatDateTime(n.created_at)}</span>
                {n.kind === "event_change" && (
                  <span className="mt-1.5 inline-flex rounded-full bg-amber-500/15 px-2.5 py-0.5 text-[11.5px] font-medium text-amber-700 dark:text-amber-400">
                    Ver alteração no compromisso
                  </span>
                )}
                {n.kind === "intimation" && (
                  <span className="mt-1.5 inline-flex rounded-full bg-primary px-2.5 py-0.5 text-[11.5px] font-medium text-primary-foreground">
                    Abrir e cadastrar processo e cliente
                  </span>
                )}
              </span>
            </Link>
          ))}
          {!data?.length && <p className="px-4 py-10 text-center text-sm text-muted-foreground">Nenhuma notificação por aqui.</p>}
        </div>
        <Link href="/notificacoes" className="block px-4 py-2.5 text-center text-xs text-primary hover:underline">
          Ver todas
        </Link>
      </PopoverContent>
    </Popover>
  );
}
