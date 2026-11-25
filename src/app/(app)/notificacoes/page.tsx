"use client";

import Link from "next/link";
import { BellOff, CheckCheck } from "lucide-react";
import { Button } from "@/components/ui/button";
import { EmptyState } from "@/components/ui/empty-state";
import { PageHeader } from "@/components/layout/app-shell";
import { useMarkNotificationsRead, useNotifications } from "@/hooks/use-records";
import { cn, formatDateTime } from "@/lib/utils";

export default function NotificationsPage() {
  const { data = [] } = useNotifications();
  const mark = useMarkNotificationsRead();
  return (
    <div>
      <PageHeader title="Notificações" actions={<Button variant="outline" onClick={() => mark.mutate(undefined)}><CheckCheck /> Marcar todas como lidas</Button>} />
      <div className="mx-auto max-w-3xl p-4 md:p-8">
        {!data.length ? (
          <EmptyState icon={BellOff} title="Sem notificações" description="Lembretes e alertas da plataforma aparecem aqui." />
        ) : (
          <ul className="divide-y overflow-hidden rounded-2xl border">
            {data.map((n) => (
              <li key={n.id}>
                <Link href={n.link ?? "#"} onClick={() => !n.read_at && mark.mutate([n.id])} className={cn("flex gap-3 px-4 py-3 transition hover:bg-accent/40", !n.read_at && "bg-primary/[0.04]")}>
                  <span className={cn("mt-2 size-2 shrink-0 rounded-full", n.read_at ? "bg-transparent" : "bg-[hsl(var(--today))]")} />
                  <span className="min-w-0 flex-1">
                    <span className="block text-sm font-medium">{n.title}</span>
                    {n.body && <span className="block text-sm text-muted-foreground">{n.body}</span>}
                    {n.kind === "intimation" && (
                      <span className="mt-1.5 inline-flex rounded-full bg-primary px-2.5 py-0.5 text-xs font-medium text-primary-foreground">
                        Abrir e cadastrar processo e cliente
                      </span>
                    )}
                  </span>
                  <span className="shrink-0 text-xs text-muted-foreground">{formatDateTime(n.created_at)}</span>
                </Link>
              </li>
            ))}
          </ul>
        )}
      </div>
    </div>
  );
}
