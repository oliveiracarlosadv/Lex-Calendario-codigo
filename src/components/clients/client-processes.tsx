"use client";

import Link from "next/link";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { useState } from "react";
import { BriefcaseBusiness, CalendarClock, Gavel, Link2, NotebookPen, Plus } from "lucide-react";
import { toast } from "sonner";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Skeleton } from "@/components/ui/skeleton";
import { PROCESS_STATUS_LABELS } from "@/domain/processes/types";
import { sb, unwrap } from "@/hooks/supabase";
import { useCan } from "@/hooks/use-workspace";
import type { ProcessRow } from "@/types/db";
import { formatDate, formatDateTime } from "@/lib/utils";
import { ProcessNotesDialog, useProcessNoteCounts } from "@/components/processes/process-notes";

interface LinkedProcess extends ProcessRow {
  /** true quando o vínculo vem só das tarefas/compromissos (o processo não está cadastrado neste cliente) */
  viaTasks: boolean;
  entries: number;
  openEntries: number;
  lastEntryAt: string | null;
  nextEntryAt: string | null;
}

/**
 * Processos do cliente: os cadastrados com ele e também os que já foram relacionados
 * a ele em tarefas e compromissos do calendário.
 */
function useClientProcesses(clientId: string) {
  return useQuery({
    queryKey: ["processes", "client-linked", clientId],
    queryFn: async (): Promise<LinkedProcess[]> => {
      const direct = unwrap(
        await sb().from("processes").select("*, client:clients(id, name)").eq("client_id", clientId).order("created_at"),
      ) as ProcessRow[];
      const events = unwrap(
        await sb()
          .from("events")
          .select("process_id, status, starts_at")
          .eq("client_id", clientId)
          .not("process_id", "is", null)
          .is("deleted_at", null)
          .limit(5000),
      ) as { process_id: string; status: string; starts_at: string }[];

      const directIds = new Set(direct.map((p) => p.id));
      const extraIds = [...new Set(events.map((e) => e.process_id))].filter((pid) => !directIds.has(pid));
      const extra = extraIds.length
        ? (unwrap(await sb().from("processes").select("*, client:clients(id, name)").in("id", extraIds)) as ProcessRow[])
        : [];

      const now = new Date().toISOString();
      const enrich = (p: ProcessRow, viaTasks: boolean): LinkedProcess => {
        const own = events.filter((e) => e.process_id === p.id);
        const open = own.filter((e) => e.status !== "done" && e.status !== "cancelled");
        const past = own.map((e) => e.starts_at).filter((d) => d < now).sort();
        const next = open.map((e) => e.starts_at).filter((d) => d >= now).sort();
        return {
          ...p,
          viaTasks,
          entries: own.length,
          openEntries: open.length,
          lastEntryAt: past.at(-1) ?? null,
          nextEntryAt: next[0] ?? null,
        };
      };
      return [...direct.map((p) => enrich(p, false)), ...extra.map((p) => enrich(p, true)).sort((a, b) => b.entries - a.entries)];
    },
  });
}

export function ClientProcesses({ clientId, onNewProcess }: { clientId: string; onNewProcess?: () => void }) {
  const qc = useQueryClient();
  const { data: processes = [], isLoading } = useClientProcesses(clientId);
  const canEditProcess = useCan("processes:update");
  const link = useMutation({
    mutationFn: async (processId: string) => unwrap(await sb().from("processes").update({ client_id: clientId }).eq("id", processId).select("id")),
    onSuccess: () => {
      toast.success("Processo vinculado ao cliente");
      void qc.invalidateQueries({ queryKey: ["processes"] });
      void qc.invalidateQueries({ queryKey: ["client-history", clientId] });
    },
    onError: (e: Error) => toast.error(e.message),
  });
  const viaTasks = processes.filter((p) => p.viaTasks).length;
  const [notesFor, setNotesFor] = useState<LinkedProcess | null>(null);
  const { data: noteCounts } = useProcessNoteCounts();

  return (
    <Card>
      <CardHeader className="flex-row items-center justify-between">
        <div>
          <CardTitle>Processos vinculados</CardTitle>
          {!!viaTasks && <p className="mt-0.5 text-xs text-muted-foreground">{viaTasks} relacionado(s) ao cliente por tarefas ou compromissos</p>}
        </div>
        {onNewProcess && <Button size="sm" variant="ghost" onClick={onNewProcess}><Plus /> Processo</Button>}
      </CardHeader>
      <CardContent className="space-y-2">
        {isLoading && <Skeleton className="h-20" />}
        {processes.map((p) => (
          <div key={p.id} className="rounded-xl border px-3 py-2.5">
            <div className="flex flex-wrap items-start gap-3">
              <BriefcaseBusiness className="mt-0.5 size-4 shrink-0 text-muted-foreground" />
              <div className="min-w-0 flex-1">
                <div className="flex flex-wrap items-center gap-2">
                  <Link href={`/processos/${p.id}`} className="text-[13px] font-medium hover:underline">{p.title || p.number}</Link>
                  {p.title && <span className="font-mono text-xs text-muted-foreground">{p.number ?? "sem número"}</span>}
                  <Badge variant="outline">{PROCESS_STATUS_LABELS[p.status]}</Badge>
                  {p.viaTasks && <Badge variant="secondary">via tarefa</Badge>}
                </div>
                <p className="text-xs text-muted-foreground">
                  {[p.procedural_class, p.subject].filter(Boolean).join(" — ") || "Classe não informada"}
                </p>
                <p className="flex items-center gap-1 text-xs text-muted-foreground">
                  <Gavel className="size-3" /> {[p.tribunal, p.court_division].filter(Boolean).join(" · ") || "Tribunal/vara não informados"}
                </p>
                {(p.client_role || p.opposing_party) && (
                  <p className="text-xs text-muted-foreground">
                    {p.client_role && <>Cliente como <b className="font-medium text-foreground/80">{p.client_role}</b></>}
                    {p.client_role && p.opposing_party && " · "}
                    {p.opposing_party && <>Parte contrária: {p.opposing_party}</>}
                  </p>
                )}
                {p.last_movement_summary && (
                  <p className="mt-1 line-clamp-2 text-xs">
                    <span className="text-muted-foreground">Última movimentação{p.last_movement_at ? ` (${formatDate(p.last_movement_at)})` : ""}: </span>
                    {p.last_movement_summary}
                  </p>
                )}
                <p className="mt-1 flex flex-wrap gap-x-3 gap-y-0.5 text-xs text-muted-foreground">
                  {p.next_hearing_at && <span>Próxima audiência: {formatDateTime(p.next_hearing_at)}</span>}
                  {p.next_deadline_at && <span>Próximo prazo: {formatDate(p.next_deadline_at)}</span>}
                  {!!p.entries && (
                    <span className="flex items-center gap-1">
                      <CalendarClock className="size-3" />
                      {p.entries} no calendário com este cliente{p.openEntries ? ` (${p.openEntries} pendente${p.openEntries > 1 ? "s" : ""})` : ""}
                      {p.nextEntryAt ? ` · próxima ${formatDateTime(p.nextEntryAt)}` : p.lastEntryAt ? ` · última ${formatDate(p.lastEntryAt)}` : ""}
                    </span>
                  )}
                </p>
                {p.viaTasks && p.client && <p className="text-xs text-amber-700 dark:text-amber-400">Cadastrado no cliente {p.client.name}.</p>}
              </div>
              <Button size="sm" variant="ghost" onClick={() => setNotesFor(p)} title="Anotações do processo">
                <NotebookPen /> Anotações{noteCounts?.get(p.id) ? ` (${noteCounts.get(p.id)})` : ""}
              </Button>
              {p.viaTasks && !p.client_id && canEditProcess && (
                <Button size="sm" variant="outline" disabled={link.isPending} onClick={() => link.mutate(p.id)}>
                  <Link2 /> Vincular ao cliente
                </Button>
              )}
            </div>
          </div>
        ))}
        {!isLoading && !processes.length && (
          <p className="py-4 text-center text-sm text-muted-foreground">
            Nenhum processo. Ao informar este cliente numa tarefa com processo, ele aparece aqui.
          </p>
        )}
      </CardContent>
      {notesFor && <ProcessNotesDialog processId={notesFor.id} title={[notesFor.title, notesFor.number].filter(Boolean).join(" · ")} onClose={() => setNotesFor(null)} />}
    </Card>
  );
}
