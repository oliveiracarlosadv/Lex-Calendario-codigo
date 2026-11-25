"use client";

import { History } from "lucide-react";
import { EVENT_KIND_LABELS, PRIORITY_LABELS, STATUS_LABELS, type EventKind, type EventPriority, type EventStatus } from "@/domain/events/types";
import { useActivity } from "@/hooks/use-event-workspace";
import { useMemberName } from "@/hooks/use-workspace";
import { formatDateTime } from "@/lib/utils";
import type { ActivityRow } from "@/types/db";

const FIELD_LABELS: Record<string, string> = {
  title: "título", starts_at: "início", ends_at: "término", location: "local", status: "status", priority: "prioridade",
  kind: "tipo", responsible_id: "responsável", client_id: "cliente", process_id: "processo", description: "descrição",
  all_day: "dia inteiro", tribunal: "tribunal", court_division: "vara", name: "nome", number: "número",
  next_hearing_at: "próxima audiência", next_deadline_at: "próximo prazo", last_movement_at: "última movimentação",
  email: "e-mail", phone: "telefone", document: "CPF/CNPJ", category_id: "categoria", meeting_url: "link",
};

function describeValue(field: string, v: unknown): string {
  if (v == null || v === "") return "vazio";
  if (field === "status") return STATUS_LABELS[v as EventStatus] ?? String(v);
  if (field === "priority") return PRIORITY_LABELS[v as EventPriority] ?? String(v);
  if (field === "kind") return EVENT_KIND_LABELS[v as EventKind] ?? String(v);
  if (typeof v === "string" && /^\d{4}-\d{2}-\d{2}T/.test(v)) return formatDateTime(v);
  if (typeof v === "boolean") return v ? "sim" : "não";
  return String(v);
}

function describe(a: ActivityRow): string {
  const subject: Record<string, string> = {
    event: "o compromisso", client: "o cliente", process: "o processo", checklist: "uma etapa do checklist",
    attachment: "um anexo", comment: "um comentário",
  };
  switch (a.action) {
    case "inserted":
      return `adicionou ${subject[a.entity_type] ?? a.entity_type}`;
    case "deleted":
      return `removeu ${subject[a.entity_type] ?? a.entity_type}`;
    case "completed":
      return "concluiu uma etapa do checklist";
    case "reopened":
      return "reabriu uma etapa do checklist";
    case "trashed":
      return "moveu o compromisso para a lixeira";
    case "restored":
      return "restaurou o compromisso";
    default: {
      const fields = Object.entries(a.changes ?? {})
        .filter(([k]) => FIELD_LABELS[k])
        .map(([k, v]) => (v.changed ? `alterou ${FIELD_LABELS[k]}` : `alterou ${FIELD_LABELS[k]} de “${describeValue(k, v.from)}” para “${describeValue(k, v.to)}”`));
      return fields.length ? fields.join("; ") : `atualizou ${subject[a.entity_type] ?? a.entity_type}`;
    }
  }
}

export function ActivityFeed({ type, id }: { type: "event" | "client" | "process"; id: string }) {
  const { data = [] } = useActivity({ type, id });
  const nameOf = useMemberName();
  return (
    <section className="space-y-3">
      <h2 className="flex items-center gap-2 text-[15px] font-semibold">
        <History className="size-4 text-muted-foreground" /> Histórico
      </h2>
      <ol className="relative space-y-3 border-l pl-4">
        {data.map((a) => (
          <li key={a.id} className="text-[13px]">
            <span className="absolute -left-[4.5px] mt-1.5 size-2 rounded-full bg-border" />
            <span className="font-medium">{a.actor_id ? nameOf(a.actor_id) : "Sistema"}</span>{" "}
            <span className="text-muted-foreground">{describe(a)}</span>
            <span className="block text-[11px] text-muted-foreground">{formatDateTime(a.created_at)}</span>
          </li>
        ))}
        {!data.length && <li className="text-sm text-muted-foreground">Sem alterações registradas.</li>}
      </ol>
    </section>
  );
}
