"use client";

import { useMemo, useState } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { BriefcaseBusiness, Loader2, NotebookPen, Plus, Radar, RefreshCw, Search, Sparkles, UserPlus, X } from "lucide-react";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card } from "@/components/ui/card";
import { EmptyState } from "@/components/ui/empty-state";
import { Input } from "@/components/ui/input";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Skeleton } from "@/components/ui/skeleton";
import { PageHeader } from "@/components/layout/app-shell";
import { SuggestionCard } from "@/components/monitoring/suggestion-card";
import { PROCESS_STATUSES, PROCESS_STATUS_LABELS } from "@/domain/processes/types";
import { matchesProcess, useCheckProcess, useClients, useProcessPartyNames, useProcesses, useSuggestions } from "@/hooks/use-records";
import { useCan, useMemberName, useWorkspace } from "@/hooks/use-workspace";
import { cn, formatDate, relativeDays } from "@/lib/utils";
import { ProcessFormDialog } from "./process-form";
import { processLabel } from "@/domain/processes/types";
import { ProcessNotesDialog, useProcessNoteCounts } from "./process-notes";
import { publicEnv } from "@/lib/env";
import { ProcessClientDialog } from "@/components/intimations/register-from-intimation";
import type { ProcessRow } from "@/types/db";

const ALL = "all";

export function ProcessesPage() {
  const router = useRouter();
  const { members } = useWorkspace();
  const nameOf = useMemberName();
  const [search, setSearch] = useState("");
  const [status, setStatus] = useState<string>(ALL);
  const [responsible, setResponsible] = useState<string>(ALL);
  const [client, setClient] = useState<string>(ALL);
  const { data: clients = [] } = useClients();
  const check = useCheckProcess();
  const [open, setOpen] = useState(false);
  const [clientFor, setClientFor] = useState<ProcessRow | null>(null);
  const [notesFor, setNotesFor] = useState<ProcessRow | null>(null);
  const { data: noteCounts } = useProcessNoteCounts();
  const { data: all, isLoading } = useProcesses({ status, responsibleId: responsible === ALL ? undefined : responsible, clientId: client === ALL ? undefined : client });
  const { data: partyNames } = useProcessPartyNames();
  // Busca por nome da parte (cliente, parte contrária e todas as partes das intimações) ou número
  const processes = useMemo(
    () => (search.trim() ? (all ?? []).filter((p) => matchesProcess(p, search, partyNames?.get(p.id))) : all),
    [all, search, partyNames],
  );
  const { data: suggestions = [] } = useSuggestions();
  const canCreate = useCan("processes:create");

  const stats = useMemo(() => {
    const list = processes ?? [];
    const week = Date.now() + 7 * 864e5;
    return {
      total: list.length,
      monitored: list.filter((p) => p.is_monitored).length,
      hearings: list.filter((p) => p.next_hearing_at && new Date(p.next_hearing_at).getTime() < week).length,
      deadlines: list.filter((p) => p.next_deadline_at && new Date(p.next_deadline_at).getTime() < week).length,
    };
  }, [processes]);

  return (
    <div>
      <PageHeader
        title="Central de Processos"
        description="Visão consolidada de todos os processos, prazos e audiências"
        actions={canCreate && <Button onClick={() => setOpen(true)}><Plus /> Novo processo</Button>}
      />
      <div className="space-y-6 p-4 md:p-8">
        <div className="grid grid-cols-2 gap-3 lg:grid-cols-4">
          {[
            { label: "Processos", value: stats.total },
            { label: "Monitorados", value: stats.monitored },
            { label: "Audiências em 7 dias", value: stats.hearings },
            { label: "Prazos em 7 dias", value: stats.deadlines },
          ].map((s) => (
            <Card key={s.label} className="p-4">
              <p className="text-[26px] font-semibold tracking-tight">{s.value}</p>
              <p className="text-[13px] text-muted-foreground">{s.label}</p>
            </Card>
          ))}
        </div>

        {suggestions.length > 0 && (
          <section className="space-y-3">
            <h2 className="flex items-center gap-2 text-[15px] font-semibold"><Sparkles className="size-4 text-primary" /> Sugestões da IA ({suggestions.length})</h2>
            <div className="grid gap-3 xl:grid-cols-2">
              {suggestions.slice(0, 4).map((s) => <SuggestionCard key={s.id} s={s} />)}
            </div>
            {suggestions.length > 4 && <Link href="/monitoramento" className="text-sm text-primary hover:underline">Ver todas as sugestões</Link>}
          </section>
        )}

        <div className="space-y-1">
          <label className="text-sm font-medium">Buscar processos</label>
          <p className="text-xs text-muted-foreground">Por nome da parte (cliente, parte contrária ou qualquer parte das intimações), número do processo (com ou sem pontuação) ou nome do processo.</p>
        </div>
        <div className="-mt-3 flex flex-wrap gap-2">
          <div className="relative min-w-[240px] flex-1">
            <Search className="absolute left-3 top-1/2 size-4 -translate-y-1/2 text-muted-foreground" />
            <Input
              value={search}
              onChange={(e) => setSearch(e.target.value)}
              placeholder="Buscar processos por nome da parte ou número do processo…"
              aria-label="Buscar processos por nome da parte ou número do processo"
              className="pl-9 pr-9"
              autoFocus
            />
            {search && (
              <button className="absolute right-2 top-1/2 -translate-y-1/2 rounded p-1 text-muted-foreground hover:bg-accent" onClick={() => setSearch("")} aria-label="Limpar busca">
                <X className="size-4" />
              </button>
            )}
          </div>
          <Select value={client} onValueChange={setClient}>
            <SelectTrigger className="w-52"><SelectValue /></SelectTrigger>
            <SelectContent>
              <SelectItem value={ALL}>Todos os clientes</SelectItem>
              {clients.map((c) => <SelectItem key={c.id} value={c.id}>{c.name}</SelectItem>)}
            </SelectContent>
          </Select>
          <Select value={status} onValueChange={setStatus}>
            <SelectTrigger className="w-44"><SelectValue /></SelectTrigger>
            <SelectContent>
              <SelectItem value={ALL}>Todos os status</SelectItem>
              {PROCESS_STATUSES.map((s) => <SelectItem key={s} value={s}>{PROCESS_STATUS_LABELS[s]}</SelectItem>)}
            </SelectContent>
          </Select>
          <Select value={responsible} onValueChange={setResponsible}>
            <SelectTrigger className="w-48"><SelectValue /></SelectTrigger>
            <SelectContent>
              <SelectItem value={ALL}>Todos os advogados</SelectItem>
              {members.map((m) => <SelectItem key={m.user_id} value={m.user_id}>{m.profile?.full_name ?? "Membro"}</SelectItem>)}
            </SelectContent>
          </Select>
        </div>

        {isLoading ? (
          <div className="space-y-2">{Array.from({ length: 6 }).map((_, i) => <Skeleton key={i} className="h-14" />)}</div>
        ) : !processes?.length && (search || client !== ALL || status !== ALL || responsible !== ALL) ? (
          <EmptyState icon={Search} title="Nenhum processo encontrado" description="Tente outro nome, parte do número ou limpe os filtros." action={<Button variant="outline" onClick={() => { setSearch(""); setClient(ALL); setStatus(ALL); setResponsible(ALL); }}>Limpar filtros</Button>} />
        ) : !processes?.length ? (
          <EmptyState icon={BriefcaseBusiness} title="Nenhum processo" description="Cadastre processos para monitorar movimentações e receber sugestões de prazos e audiências." action={canCreate && <Button onClick={() => setOpen(true)}><Plus /> Cadastrar processo</Button>} />
        ) : (
          <div className="overflow-x-auto rounded-2xl border">
            <table className="w-full text-sm md:min-w-[860px]">
              <thead className="bg-surface text-left text-xs text-muted-foreground">
                <tr>
                  <th className="px-4 py-2.5 font-medium">Processo</th>
                  <th className="px-4 py-2.5 font-medium">Cliente</th>
                  <th className="hidden px-4 py-2.5 font-medium md:table-cell">Responsável</th>
                  <th className="hidden px-4 py-2.5 font-medium md:table-cell">Última movimentação</th>
                  <th className="hidden px-4 py-2.5 font-medium md:table-cell">Próxima audiência</th>
                  <th className="hidden px-4 py-2.5 font-medium md:table-cell">Próximo prazo</th>
                  <th className="hidden px-4 py-2.5 font-medium md:table-cell">Status</th>
                  <th className="hidden px-4 py-2.5 md:table-cell" />
                </tr>
              </thead>
              <tbody>
                {processes.map((p) => {
                  const soon = (iso: string | null) => iso && new Date(iso).getTime() - Date.now() < 3 * 864e5;
                  return (
                    <tr key={p.id} className="cursor-pointer border-t align-top transition hover:bg-accent/40" onClick={() => router.push(`/processos/${p.id}`)}>
                      <td className="px-4 py-3">
                        <p className="flex items-center gap-1.5 font-medium">
                          {p.is_monitored && p.number && <Radar className="size-3.5 shrink-0 text-primary" aria-label="Monitorado" />}
                          {p.title || p.number || "Processo sem nome"}
                        </p>
                        {p.title && <p className="font-mono text-xs text-muted-foreground">{p.number ?? "sem número (não ajuizado)"}</p>}
                        <p className="text-xs text-muted-foreground">{[p.procedural_class, p.tribunal, p.court_division].filter(Boolean).join(" · ")}</p>
                      </td>
                      <td className="px-4 py-3">
                        {p.client?.name ?? (
                          <Button
                            size="sm"
                            variant="outline"
                            className="h-7 text-xs"
                            onClick={(e) => {
                              e.stopPropagation();
                              setClientFor(p);
                            }}
                          >
                            <UserPlus /> Vincular ao cliente
                          </Button>
                        )}
                      </td>
                      <td className="hidden px-4 py-3 text-muted-foreground md:table-cell">{nameOf(p.responsible_id)}</td>
                      <td className="hidden max-w-[240px] px-4 py-3 md:table-cell">
                        <p className="truncate">{p.last_movement_summary ?? "—"}</p>
                        {p.last_movement_at && <p className="text-xs text-muted-foreground">{formatDate(p.last_movement_at)}</p>}
                      </td>
                      <td className={cn("hidden px-4 py-3 md:table-cell", soon(p.next_hearing_at) && "font-medium text-red-600")}>
                        {p.next_hearing_at ? <>{formatDate(p.next_hearing_at, { dateStyle: "short", timeStyle: "short" })}<span className="block text-xs text-muted-foreground">{relativeDays(p.next_hearing_at)}</span></> : "—"}
                      </td>
                      <td className={cn("hidden px-4 py-3 md:table-cell", soon(p.next_deadline_at) && "font-medium text-orange-600")}>
                        {p.next_deadline_at ? <>{formatDate(p.next_deadline_at, { dateStyle: "short" })}<span className="block text-xs text-muted-foreground">{relativeDays(p.next_deadline_at)}</span></> : "—"}
                      </td>
                      <td className="hidden px-4 py-3 md:table-cell"><Badge variant="outline">{PROCESS_STATUS_LABELS[p.status]}</Badge></td>
                      <td className="hidden whitespace-nowrap px-4 py-3 text-right md:table-cell">
                        <Button
                          size="sm"
                          variant="ghost"
                          className="h-7"
                          title="Anotações do processo"
                          onClick={(e) => {
                            e.stopPropagation();
                            setNotesFor(p);
                          }}
                        >
                          <NotebookPen /> {noteCounts?.get(p.id) ?? ""}
                        </Button>
                        {p.number && !publicEnv.webMode && (
                          <Button
                            size="sm"
                            variant="ghost"
                            className="h-7"
                            title="Consultar o andamento no tribunal"
                            disabled={check.isPending && check.variables === p.id}
                            onClick={(e) => {
                              e.stopPropagation();
                              check.mutate(p.id);
                            }}
                          >
                            {check.isPending && check.variables === p.id ? <Loader2 className="animate-spin" /> : <RefreshCw />} Consultar
                          </Button>
                        )}
                        <Button size="sm" variant="ghost" className="h-7" asChild onClick={(e) => e.stopPropagation()}>
                          <Link href={`/processos/${p.id}`}>Abrir</Link>
                        </Button>
                      </td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
        )}
      </div>
      {open && <ProcessFormDialog open={open} onOpenChange={setOpen} onSaved={(id) => router.push(`/processos/${id}`)} />}
      {notesFor && <ProcessNotesDialog processId={notesFor.id} title={processLabel(notesFor)} onClose={() => setNotesFor(null)} />}
      {clientFor && (
        <ProcessClientDialog
          open={!!clientFor}
          onOpenChange={(o) => !o && setClientFor(null)}
          source={{ processId: clientFor.id, number: clientFor.number ?? clientFor.title ?? "", tribunal: clientFor.tribunal, organ: clientFor.court_division, className: clientFor.procedural_class }}
        />
      )}
    </div>
  );
}
