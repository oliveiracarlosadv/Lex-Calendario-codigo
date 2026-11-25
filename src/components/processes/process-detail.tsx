"use client";

import { useState } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { ArrowLeft, CalendarPlus, ExternalLink, Pencil, Plus, Radar, RefreshCw, Trash2 } from "lucide-react";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Dialog, DialogContent, DialogFooter, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Skeleton } from "@/components/ui/skeleton";
import { Textarea } from "@/components/ui/textarea";
import { ActivityFeed } from "@/components/events/activity-feed";
import { AttachmentsPanel } from "@/components/events/attachments-panel";
import { SuggestionCard } from "@/components/monitoring/suggestion-card";
import { describeSegment, parseCnjNumber } from "@/domain/processes/cnj-number";
import { COURT_SYSTEM_LABELS, PROCESS_STATUS_LABELS } from "@/domain/processes/types";
import { EVENT_KIND_LABELS, STATUS_LABELS } from "@/domain/events/types";
import { useAddMovement, useCheckProcess, useDeleteProcess, useMovements, useProcess, useProcessEvents, useSuggestions } from "@/hooks/use-records";
import { useCan, useMemberName } from "@/hooks/use-workspace";
import { formatCurrency, formatDate, formatDateTime, localInputToISO, relativeDays } from "@/lib/utils";
import { useUiStore } from "@/stores/ui-store";
import { ProcessFormDialog } from "./process-form";
import { publicEnv } from "@/lib/env";
import { ProcessClientDialog, useProcessParties } from "@/components/intimations/register-from-intimation";
import { UserPlus, Users } from "lucide-react";
import { usePartners } from "@/hooks/use-partners";
import { ProcessNotes } from "./process-notes";

function Info({ label, value }: { label: string; value: React.ReactNode }) {
  return (
    <div>
      <p className="text-xs text-muted-foreground">{label}</p>
      <p className="text-sm font-medium">{value || "—"}</p>
    </div>
  );
}

export function ProcessDetail({ id }: { id: string }) {
  const router = useRouter();
  const { data: p, isLoading } = useProcess(id);
  const { data: movements = [] } = useMovements(id);
  const { data: events = [] } = useProcessEvents(id);
  const { data: suggestions = [] } = useSuggestions(id);
  const check = useCheckProcess();
  const del = useDeleteProcess();
  const addMovement = useAddMovement(id);
  const nameOf = useMemberName();
  const openQuickCreate = useUiStore((s) => s.openQuickCreate);
  const [editing, setEditing] = useState(false);
  const [movementOpen, setMovementOpen] = useState(false);
  const [clientOpen, setClientOpen] = useState(false);
  const { data: parties = [] } = useProcessParties(id);
  const [mv, setMv] = useState({ date: "", title: "", description: "" });
  const canEdit = useCan("processes:update");
  const canDelete = useCan("processes:delete");
  const { data: partners } = usePartners();

  const partner = p?.partner_id ? partners?.find((x) => x.id === p.partner_id) : null;
  if (isLoading || !p) return <div className="space-y-3 p-8"><Skeleton className="h-10 w-1/2" /><Skeleton className="h-60" /></div>;
  const cnj = p.number ? parseCnjNumber(p.number) : null;

  return (
    <div className="mx-auto max-w-6xl space-y-6 px-4 py-6 md:px-8">
      <Button variant="ghost" size="sm" asChild><Link href="/processos"><ArrowLeft /> Central de Processos</Link></Button>

      <div className="flex flex-wrap items-start gap-3">
        <div className="min-w-0 flex-1">
          <div className="mb-1 flex flex-wrap items-center gap-2">
            <Badge variant="outline">{PROCESS_STATUS_LABELS[p.status]}</Badge>
            <Badge variant="secondary">{COURT_SYSTEM_LABELS[p.court_system]}</Badge>
            {p.is_monitored && <Badge><Radar className="size-3" /> Monitorado</Badge>}
            {p.is_confidential && <Badge variant="warning">Segredo de justiça</Badge>}
          </div>
          <h1 className="text-2xl font-semibold tracking-tight">{p.title || p.number || "Processo sem nome"}</h1>
          {p.title && <p className="font-mono text-sm text-muted-foreground">{p.number ?? "Sem número — ainda não ajuizado"}</p>}
          <p className="text-sm text-muted-foreground">{[p.procedural_class, p.subject].filter(Boolean).join(" · ")}</p>
        </div>
        <div className="flex flex-wrap gap-2">
          {!publicEnv.webMode && (
            <Button variant="outline" onClick={() => check.mutate(id)} disabled={check.isPending || !p.number} title={p.number ? undefined : "Informe o número do processo para consultar o tribunal"}>
              <RefreshCw className={check.isPending ? "animate-spin" : ""} /> Consultar tribunal
            </Button>
          )}
          <Button
            variant="outline"
            onClick={() => {
              const start = new Date();
              start.setDate(start.getDate() + 1);
              start.setHours(9, 0, 0, 0);
              openQuickCreate({ start: start.toISOString(), end: new Date(start.getTime() + 3600e3).toISOString(), allDay: false });
            }}
          >
            <CalendarPlus /> Compromisso
          </Button>
          {canEdit && <Button variant="ghost" size="icon" onClick={() => setEditing(true)} aria-label="Editar"><Pencil /></Button>}
          {canDelete && (
            <Button variant="ghost" size="icon" aria-label="Excluir" onClick={() => confirm("Excluir este processo? Compromissos vinculados serão mantidos.") && del.mutate(id, { onSuccess: () => router.push("/processos") })}>
              <Trash2 />
            </Button>
          )}
        </div>
      </div>

      <Card>
        <CardContent className="grid grid-cols-2 gap-4 p-5 md:grid-cols-4">
          <Info label="Cliente" value={p.client ? <Link className="hover:underline" href={`/clientes/${p.client.id}`}>{p.client.name}</Link> : null} />
          <Info label="Polo do cliente" value={p.client_role} />
          <Info label="Parte contrária" value={p.opposing_party} />
          <Info label="Advogado responsável" value={nameOf(p.responsible_id)} />
          <Info
            label="Parceiro"
            value={partner ? <Link className="hover:underline" href="/parceiros">{partner.name}{p.partner_fee_percent != null ? ` · ${p.partner_fee_percent}%` : ""}</Link> : null}
          />
          <Info label="Tribunal" value={p.tribunal} />
          <Info label="Vara / Órgão julgador" value={p.court_division} />
          <Info label="Segmento" value={cnj ? describeSegment(cnj.segment) : null} />
          <Info label="Valor da causa" value={formatCurrency(p.claim_value)} />
          <Info label="Próxima audiência" value={p.next_hearing_at ? `${formatDateTime(p.next_hearing_at)} (${relativeDays(p.next_hearing_at)})` : null} />
          <Info label="Próximo prazo" value={p.next_deadline_at ? `${formatDate(p.next_deadline_at)} (${relativeDays(p.next_deadline_at)})` : null} />
          <Info label="Última movimentação" value={p.last_movement_at ? formatDate(p.last_movement_at) : null} />
          <Info label="Última consulta ao tribunal" value={p.monitoring_checked_at ? formatDateTime(p.monitoring_checked_at) : "Nunca"} />
        </CardContent>
      </Card>

      <ProcessNotes processId={id} />

      <Card>
        <CardHeader className="flex-row items-center justify-between">
          <CardTitle className="flex items-center gap-2"><Users className="size-4" /> Partes do processo</CardTitle>
          <Button size="sm" variant={p.client ? "outline" : "default"} onClick={() => setClientOpen(true)}>
            <UserPlus /> {p.client ? "Editar cliente e partes" : "Vincular ao cliente"}
          </Button>
        </CardHeader>
        <CardContent className="grid gap-4 sm:grid-cols-2">
          {(["A", "P"] as const).map((polo) => {
            const list = parties.filter((x) => x.polo === polo).map((x) => x.nome);
            return (
              <div key={polo} className="rounded-xl bg-secondary/50 p-3">
                <p className="mb-1 text-xs font-semibold uppercase tracking-wide text-muted-foreground">{polo === "A" ? "Polo ativo" : "Polo passivo"}</p>
                {list.length ? (
                  <ul className="space-y-0.5 text-sm">
                    {list.map((n) => (
                      <li key={n} className={p.client?.name && n.toLowerCase() === p.client.name.toLowerCase() ? "font-semibold text-primary" : ""}>
                        {n}
                        {p.client?.name && n.toLowerCase() === p.client.name.toLowerCase() && " (cliente)"}
                      </li>
                    ))}
                  </ul>
                ) : (
                  <p className="text-sm text-muted-foreground">
                    {polo === "A" && p.client_role && /autor|reclamante|requerente|exequente|apelante/i.test(p.client_role) && p.client
                      ? `${p.client.name} (cliente)`
                      : polo === "P" && p.opposing_party && !/autor|reclamante|requerente/i.test(p.client_role ?? "")
                        ? p.opposing_party
                        : "Sem publicação com as partes"}
                  </p>
                )}
              </div>
            );
          })}
          <p className="text-xs text-muted-foreground sm:col-span-2">
            {p.client ? <>Cliente: <strong>{p.client.name}</strong>{p.client_role ? ` · ${p.client_role}` : ""}</> : "Nenhum cliente vinculado a este processo."} As partes vêm das publicações no Diário de Justiça Eletrônico.
          </p>
        </CardContent>
      </Card>

      {suggestions.length > 0 && (
        <section className="space-y-3">
          <h2 className="text-[15px] font-semibold">Sugestões da IA</h2>
          <div className="grid gap-3 lg:grid-cols-2">{suggestions.map((s) => <SuggestionCard key={s.id} s={s} />)}</div>
        </section>
      )}

      <div className="grid gap-6 lg:grid-cols-[1fr_340px]">
        <div className="space-y-6">
          <Card>
            <CardHeader className="flex-row items-center justify-between">
              <CardTitle>Movimentações</CardTitle>
              <Button size="sm" variant="ghost" onClick={() => setMovementOpen(true)}><Plus /> Registrar</Button>
            </CardHeader>
            <CardContent>
              <ol className="relative space-y-4 border-l pl-5">
                {movements.map((m) => (
                  <li key={m.id}>
                    <span className="absolute -left-[5px] mt-1.5 size-2.5 rounded-full border-2 border-background bg-primary" />
                    <p className="text-xs text-muted-foreground">{formatDateTime(m.occurred_at)} · {m.source === "manual" ? "registro manual" : m.source.toUpperCase()}</p>
                    <p className="text-sm font-medium">{m.title}</p>
                    {m.description && <p className="text-[13px] text-muted-foreground">{m.description}</p>}
                  </li>
                ))}
                {!movements.length && <li className="text-sm text-muted-foreground">Nenhuma movimentação. Use “Consultar tribunal” ou registre manualmente.</li>}
              </ol>
            </CardContent>
          </Card>
          <ActivityFeed type="process" id={id} />
        </div>
        <aside className="space-y-6">
          <Card>
            <CardHeader><CardTitle>Agenda do processo</CardTitle></CardHeader>
            <CardContent className="space-y-1">
              {events.map((e) => (
                <Link key={e.id} href={`/eventos/${e.id}`} className="block rounded-xl px-2 py-2 hover:bg-accent/60">
                  <p className="truncate text-sm font-medium">{e.title}</p>
                  <p className="text-xs text-muted-foreground">{EVENT_KIND_LABELS[e.kind]} · {formatDateTime(e.starts_at, e.all_day)} · {STATUS_LABELS[e.status]}</p>
                </Link>
              ))}
              {!events.length && <p className="py-3 text-center text-sm text-muted-foreground">Sem compromissos vinculados.</p>}
            </CardContent>
          </Card>
          <AttachmentsPanel processId={id} />
          {p.notes && <Card><CardContent className="whitespace-pre-wrap p-4 text-sm">{p.notes}</CardContent></Card>}
          {p.tribunal === "TJPA" && (
            <a href="https://consultas.tjpa.jus.br/consultaunificada/consulta/principal" target="_blank" rel="noreferrer" className="flex items-center gap-2 text-sm text-primary hover:underline">
              <ExternalLink className="size-4" /> Consulta unificada do TJPA
            </a>
          )}
        </aside>
      </div>

      {editing && <ProcessFormDialog open={editing} onOpenChange={setEditing} initial={p} />}
      {clientOpen && (
        <ProcessClientDialog
          open={clientOpen}
          onOpenChange={setClientOpen}
          source={{ processId: p.id, number: p.number ?? "", tribunal: p.tribunal, organ: p.court_division, className: p.procedural_class, parties }}
        />
      )}
      <Dialog open={movementOpen} onOpenChange={setMovementOpen}>
        <DialogContent>
          <DialogHeader><DialogTitle>Registrar movimentação</DialogTitle></DialogHeader>
          <div className="grid gap-3">
            <div className="grid gap-1.5"><Label>Data e hora</Label><Input type="datetime-local" value={mv.date} onChange={(e) => setMv({ ...mv, date: e.target.value })} /></div>
            <div className="grid gap-1.5"><Label>Movimentação</Label><Input value={mv.title} onChange={(e) => setMv({ ...mv, title: e.target.value })} placeholder="Ex.: Audiência de conciliação designada" /></div>
            <div className="grid gap-1.5"><Label>Teor / complemento</Label><Textarea value={mv.description} onChange={(e) => setMv({ ...mv, description: e.target.value })} placeholder="Cole aqui o texto do despacho ou da intimação — a IA vai sugerir prazos e audiências." className="min-h-[120px]" /></div>
          </div>
          <DialogFooter>
            <Button
              disabled={!mv.date || !mv.title || addMovement.isPending}
              onClick={() =>
                addMovement.mutate(
                  { occurred_at: localInputToISO(mv.date), title: mv.title, description: mv.description || undefined },
                  { onSuccess: () => { setMovementOpen(false); setMv({ date: "", title: "", description: "" }); } },
                )
              }
            >
              Registrar e analisar
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  );
}
