"use client";

import Link from "next/link";
import { AlarmClock, Bell, Check, Gavel, X } from "lucide-react";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { useDecideSuggestion } from "@/hooks/use-records";
import { useCan } from "@/hooks/use-workspace";
import { formatDateTime } from "@/lib/utils";
import type { SuggestionRow } from "@/types/db";
import { processLabel } from "@/domain/processes/types";
import { LinkClientButton } from "@/components/processes/link-client-button";

const META = {
  hearing: { label: "Audiência", icon: Gavel, tone: "text-red-600 bg-red-500/10" },
  deadline: { label: "Prazo", icon: AlarmClock, tone: "text-orange-600 bg-orange-500/10" },
  reminder: { label: "Lembrete", icon: Bell, tone: "text-amber-600 bg-amber-500/10" },
};

export function SuggestionCard({ s }: { s: SuggestionRow }) {
  const decide = useDecideSuggestion();
  const canDecide = useCan("suggestions:decide");
  const m = META[s.kind];
  return (
    <div className="flex gap-3 rounded-2xl border bg-card p-4">
      <span className={`flex size-9 shrink-0 items-center justify-center rounded-full ${m.tone}`}>
        <m.icon className="size-4" />
      </span>
      <div className="min-w-0 flex-1 space-y-1">
        <div className="flex flex-wrap items-center gap-2">
          <Badge variant="secondary">{m.label}</Badge>
          <Badge variant={s.confidence >= 0.8 ? "success" : s.confidence >= 0.6 ? "warning" : "outline"}>Confiança {Math.round(s.confidence * 100)}%</Badge>
          <span className="text-[11px] text-muted-foreground">{s.analyzer === "llm" ? "IA (modelo de linguagem)" : "IA (regras)"}</span>
        </div>
        <p className="font-medium">{s.title}</p>
        <p className="text-sm text-muted-foreground">{s.starts_at ? formatDateTime(s.starts_at, s.kind === "deadline") : "Data a confirmar"}</p>
        {s.rationale && <p className="text-[13px] text-muted-foreground">{s.rationale}</p>}
        {s.process && (
          <Link href={`/processos/${s.process.id}`} className="inline-block font-mono text-xs text-primary hover:underline">
            {processLabel(s.process)}
          </Link>
        )}
      </div>
      {canDecide && (
        <div className="flex shrink-0 flex-col gap-1.5">
          <Button size="sm" onClick={() => decide.mutate({ id: s.id, accept: true })} disabled={decide.isPending}>
            <Check /> Agendar
          </Button>
          <Button size="sm" variant="ghost" onClick={() => decide.mutate({ id: s.id, accept: false })} disabled={decide.isPending}>
            <X /> Ignorar
          </Button>
          <LinkClientButton processId={s.process_id} />
        </div>
      )}
      {!canDecide && <LinkClientButton processId={s.process_id} className="shrink-0" />}
    </div>
  );
}
