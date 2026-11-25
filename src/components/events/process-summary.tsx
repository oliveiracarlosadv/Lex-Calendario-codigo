"use client";

import Link from "next/link";
import { Scale, UserPlus } from "lucide-react";
import { Button } from "@/components/ui/button";
import { ProcessClientDialog, useProcessParties } from "@/components/intimations/register-from-intimation";
import { splitParties } from "@/domain/processes/parties";
import { useProcess } from "@/hooks/use-records";
import { useState } from "react";

/** Dados do processo vinculado ao compromisso: número, polos, vara e tribunal. */
export function ProcessSummary({ processId }: { processId: string }) {
  const { data: p } = useProcess(processId);
  const { data: parties = [] } = useProcessParties(processId);
  const [clientOpen, setClientOpen] = useState(false);
  if (!p) return null;
  const polos = splitParties({ parties, clientName: p.client?.name, clientRole: p.client_role, opposingParty: p.opposing_party });
  const row = (label: string, value: string | null | undefined) =>
    value ? (
      <div className="grid grid-cols-[110px_1fr] gap-2 py-1 text-sm">
        <span className="text-muted-foreground">{label}</span>
        <span className="min-w-0">{value}</span>
      </div>
    ) : null;

  return (
    <section className="space-y-2 rounded-2xl border bg-card p-4">
      <div className="flex items-center justify-between gap-2">
        <h2 className="flex items-center gap-2 text-[15px] font-semibold"><Scale className="size-4" /> Dados do processo</h2>
        <Link href={`/processos/${p.id}`} className="text-xs text-primary hover:underline">Abrir processo</Link>
      </div>
      {row("Processo", p.title)}
      {row("Número", p.number)}
      {row("Polo ativo", polos.active.join("; ") || "—")}
      {row("Polo passivo", polos.passive.join("; ") || "—")}
      {row("Vara / Órgão", p.court_division)}
      {row("Tribunal", p.tribunal)}
      {!p.client && (
        <Button size="sm" onClick={() => setClientOpen(true)}>
          <UserPlus /> Vincular ao cliente
        </Button>
      )}
      <p className="text-[11.5px] text-muted-foreground">Estas informações também vão para a descrição do evento no Google Agenda.</p>
      {clientOpen && (
        <ProcessClientDialog
          open={clientOpen}
          onOpenChange={setClientOpen}
          source={{ processId: p.id, number: p.number ?? "", tribunal: p.tribunal, organ: p.court_division, className: p.procedural_class, parties }}
        />
      )}
    </section>
  );
}
