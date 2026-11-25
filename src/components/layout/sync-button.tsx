"use client";

import { useState } from "react";
import { useQueryClient } from "@tanstack/react-query";
import { RefreshCw } from "lucide-react";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import { Tooltip } from "@/components/ui/tooltip";
import { useConnections } from "@/hooks/use-records";
import { openOAuthWindow } from "@/lib/oauth-popup";
import { publicEnv } from "@/lib/env";
import { cn, formatDateTime } from "@/lib/utils";

/** Botão "Sincronizar" do topo: envia e recebe as alterações do Google Agenda na hora. */
export function SyncButton({ compact }: { compact?: boolean }) {
  const qc = useQueryClient();
  const { data: connections = [] } = useConnections();
  const [busy, setBusy] = useState(false);
  const last = connections
    .map((c) => c.last_synced_at)
    .filter(Boolean)
    .sort()
    .at(-1);
  const hasProblem = connections.some((c) => c.last_error || c.last_push_error);

  async function sync() {
    if (!connections.length) {
      toast.info("Nenhuma agenda conectada", {
        description: "Entre com sua conta Google para sincronizar o Lex com o Google Agenda.",
        action: { label: "Entrar com Google", onClick: () => openOAuthWindow("google") },
      });
      return;
    }
    setBusy(true);
    try {
      const res = await fetch("/api/integrations/sincronizar", { method: "POST" });
      const r = (await res.json().catch(() => ({}))) as { sent?: number; received?: number; deleted?: number; errors?: string[]; error?: string };
      if (!res.ok) throw new Error(r.error ?? "Falha na sincronização");
      const parts = [
        ...(publicEnv.webMode ? [] : [`${r.sent ?? 0} enviado(s) ao Google`]),
        `${r.received ?? 0} recebido(s)`,
        ...(r.deleted ? [`${r.deleted} removido(s)`] : []),
      ];
      if (r.errors?.length) toast.warning("Sincronizado com avisos", { description: `${parts.join(" · ")}. ${r.errors.join(" · ")}`, duration: 12_000 });
      else toast.success("Sincronizado com o Google Agenda", { description: parts.join(" · ") });
    } catch (e) {
      toast.error("Não foi possível sincronizar", { description: (e as Error).message });
    } finally {
      setBusy(false);
      void qc.invalidateQueries({ queryKey: ["events"] });
      void qc.invalidateQueries({ queryKey: ["connections"] });
      void qc.invalidateQueries({ queryKey: ["dashboard"] });
    }
  }

  const hint = connections.length
    ? last
      ? `Última sincronização: ${formatDateTime(last)}. Sincroniza sozinho a cada ${publicEnv.webMode ? "minuto" : "30 s"}.`
      : "Sincronizar com o Google Agenda"
    : "Conecte o Google para sincronizar";

  return (
    <Tooltip content={hint}>
      <Button variant="ghost" size={compact ? "icon-sm" : "sm"} onClick={() => void sync()} disabled={busy} aria-label="Sincronizar com o Google Agenda" className="relative">
        <RefreshCw className={cn(busy && "animate-spin")} />
        {!compact && <span>{busy ? "Sincronizando…" : "Sincronizar"}</span>}
        {hasProblem && !busy && <span className="absolute right-1 top-1 size-2 rounded-full bg-amber-500" aria-label="Há avisos de sincronização" />}
      </Button>
    </Tooltip>
  );
}
