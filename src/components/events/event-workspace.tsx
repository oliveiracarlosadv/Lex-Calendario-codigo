"use client";

import { useEffect, useState } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import {
  ArrowLeft,
  BriefcaseBusiness,
  Building2,
  CalendarClock,
  CheckCircle2,
  Download,
  Gavel,
  Link2,
  MapPin,
  MoreHorizontal,
  Trash2,
  User,
  UserCheck,
} from "lucide-react";
import { toast } from "sonner";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import { Input } from "@/components/ui/input";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Skeleton } from "@/components/ui/skeleton";
import { Switch } from "@/components/ui/switch";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { RichEditor } from "@/components/editor/rich-editor";
import { isOverdue } from "@/domain/events/rules";
import {
  EVENT_KINDS,
  EVENT_KIND_LABELS,
  PRIORITIES,
  PRIORITY_LABELS,
  STATUSES,
  STATUS_LABELS,
  type EventKind,
  type EventPriority,
  type EventStatus,
} from "@/domain/events/types";
import { useDeleteEvent, useEvent, useRestoreEvent, useUpdateEvent, type EventInput } from "@/hooks/use-events";
import { useCategories, useClients, useMarkNotificationsRead, useProcesses, useUnseenEventChanges } from "@/hooks/use-records";
import { isoToLocalInput, localInputToISO, relativeDays } from "@/lib/utils";
import { ActivityFeed } from "./activity-feed";
import { AttachmentsPanel } from "./attachments-panel";
import { ChecklistPanel } from "./checklist-panel";
import { CommentsPanel } from "./comments-panel";
import { RemindersPanel } from "./reminders-panel";
import { AttendeesInput } from "./attendees-input";
import { CoResponsibles, ResponsibleSelect } from "./responsible-select";
import { HearingModeToggle } from "./hearing-mode";
import { CommunicationDialog } from "@/components/communications/communication-dialog";
import { RelatedTaskSelect } from "./related-task-select";
import { notifyCollaborator } from "@/hooks/use-collaborators";
import { ProcessSummary } from "./process-summary";
import { syncEventNow } from "@/hooks/supabase";
import { Save, Send } from "lucide-react";
import { processLabel } from "@/domain/processes/types";
import { publicEnv } from "@/lib/env";

const NONE = "__none__";

function Field({ icon: Icon, label, children }: { icon: typeof User; label: string; children: React.ReactNode }) {
  return (
    <div className="grid grid-cols-[110px_1fr] items-center gap-2 py-1.5 text-sm">
      <span className="flex items-center gap-2 text-muted-foreground">
        <Icon className="size-4" /> {label}
      </span>
      <div className="min-w-0">{children}</div>
    </div>
  );
}

const ghostInput = "h-8 border-transparent bg-transparent px-2 shadow-none hover:bg-accent/60 focus-visible:bg-background focus-visible:border-input";

export function EventWorkspace({ id }: { id: string }) {
  const router = useRouter();
  const { data: event, isLoading, error } = useEvent(id);
  const update = useUpdateEvent();
  const [communicate, setCommunicate] = useState(false);
  // Abrir o compromisso marca como vistas as alterações feitas por convidados (some a bolinha do calendário)
  const unseen = useUnseenEventChanges();
  const markSeen = useMarkNotificationsRead();
  const unseenIds = (unseen.get(id) ?? []).join(",");
  useEffect(() => {
    if (unseenIds) markSeen.mutate(unseenIds.split(","));
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [unseenIds]);
  const del = useDeleteEvent();
  const restore = useRestoreEvent();
  const { data: categories } = useCategories();
  const { data: clients } = useClients();
  const { data: processes } = useProcesses();

  if (isLoading)
    return (
      <div className="mx-auto max-w-6xl space-y-4 p-8">
        <Skeleton className="h-8 w-2/3" />
        <Skeleton className="h-64 w-full" />
      </div>
    );
  if (error || !event)
    return (
      <div className="p-10 text-center">
        <p className="text-lg font-medium">Compromisso não encontrado</p>
        <Button asChild variant="link">
          <Link href="/calendario">Voltar ao calendário</Link>
        </Button>
      </div>
    );

  const save = (patch: EventInput) => update.mutate({ id, ...patch });
  const color = event.color ?? categories?.find((c) => c.id === event.category_id)?.color ?? "#8E8E93";
  const overdue = isOverdue({ endsAt: event.ends_at, status: event.status, kind: event.kind });
  const process = event.process ?? null;

  function setTimes(field: "starts_at" | "ends_at", value: string) {
    if (!value) return;
    const iso = event!.all_day ? localInputToISO(`${value}T00:00`) : localInputToISO(value);
    const patch: EventInput = field === "starts_at" ? { starts_at: iso } : { ends_at: iso };
    if (field === "starts_at" && iso > event!.ends_at) {
      const duration = new Date(event!.ends_at).getTime() - new Date(event!.starts_at).getTime();
      patch.ends_at = new Date(new Date(iso).getTime() + Math.max(duration, 0)).toISOString();
    }
    save(patch);
  }

  return (
    <div className="mx-auto max-w-6xl px-4 pb-16 md:px-8">
      {/* Cabeçalho */}
      <div className="sticky top-0 z-20 -mx-4 flex flex-wrap items-center gap-2 border-b bg-background/85 px-4 py-2.5 backdrop-blur md:-mx-8 md:px-8">
        <Button variant="ghost" size="sm" onClick={() => router.back()}>
          <ArrowLeft /> <span className="hidden sm:inline">Voltar</span>
        </Button>
        <div className="flex-1" />
        {!event.deleted_at && (
          <Button size="sm" variant="outline" onClick={() => setCommunicate(true)} title="E-mail, ofício ou WhatsApp ao cliente, com modelo ou IA">
            <Send /> <span className="hidden sm:inline">Comunicar ao cliente</span>
          </Button>
        )}
        {event.shared_origin && (
          <span
            className="rounded-full bg-amber-500/15 px-2.5 py-1 text-xs font-medium text-amber-700 dark:text-amber-400"
            title={event.shared_readonly ? "O organizador não permite alterações; você pode comentar." : "Suas alterações de nome, data, hora e local vão para o organizador."}
          >
            Convidado de {event.shared_origin}
            {event.shared_readonly ? " · somente leitura" : ""}
          </span>
        )}
        {communicate && (
          <CommunicationDialog
            open
            onOpenChange={setCommunicate}
            initial={{
              client_id: event.client_id,
              process_id: event.process_id,
              event_id: id,
              deadline_at: event.kind === "deadline" || event.kind === "task" ? event.ends_at.slice(0, 10) : null,
            }}
          />
        )}
        {!event.deleted_at && (
          <Button
            size="sm"
            variant="outline"
            onClick={async () => {
              // Grava o campo em edição (salvamento ao sair do campo) e o editor, e sincroniza já
              (document.activeElement as HTMLElement | null)?.blur();
              await new Promise((r) => setTimeout(r, 1000));
              await syncEventNow(id);
              toast.success("Alterações salvas", { description: "Agendas conectadas atualizadas." });
            }}
          >
            <Save /> Salvar
          </Button>
        )}
        {event.deleted_at ? (
          <Button size="sm" variant="outline" onClick={() => restore.mutate(id)}>
            Restaurar da lixeira
          </Button>
        ) : (
          <Button
            size="sm"
            variant={event.status === "done" ? "secondary" : "default"}
            onClick={() => save({ status: event.status === "done" ? "scheduled" : "done" })}
          >
            <CheckCircle2 /> {event.status === "done" ? "Reabrir" : "Concluir"}
          </Button>
        )}
        <DropdownMenu>
          <DropdownMenuTrigger asChild>
            <Button variant="ghost" size="icon-sm" aria-label="Mais ações">
              <MoreHorizontal />
            </Button>
          </DropdownMenuTrigger>
          <DropdownMenuContent align="end">
            {!publicEnv.webMode && (
              <DropdownMenuItem asChild>
                <a href={`/api/ics/export?event=${id}`}>
                  <Download /> Exportar (.ics)
                </a>
              </DropdownMenuItem>
            )}
            <DropdownMenuItem
              onSelect={() => {
                void navigator.clipboard.writeText(window.location.href);
                toast.success("Link copiado");
              }}
            >
              <Link2 /> Copiar link
            </DropdownMenuItem>
            <DropdownMenuSeparator />
            <DropdownMenuItem
              destructive
              onSelect={() =>
                del.mutate(id, {
                  onSuccess: () => {
                    toast.success("Compromisso movido para a lixeira", { action: { label: "Desfazer", onClick: () => restore.mutate(id) } });
                    router.push("/calendario");
                  },
                })
              }
            >
              <Trash2 /> Excluir
            </DropdownMenuItem>
          </DropdownMenuContent>
        </DropdownMenu>
      </div>

      {/* Título */}
      <div className="pt-8">
        <div className="mb-2 flex flex-wrap items-center gap-2">
          <span className="size-3 rounded-full" style={{ background: color }} />
          <Badge variant="secondary">{EVENT_KIND_LABELS[event.kind]}</Badge>
          <Badge variant={event.status === "done" ? "success" : "outline"}>{STATUS_LABELS[event.status]}</Badge>
          {event.priority === "critical" && <Badge variant="destructive">Crítico</Badge>}
          {overdue && <Badge variant="destructive">Atrasado</Badge>}
          <span className="text-xs text-muted-foreground">{relativeDays(event.starts_at)}</span>
          {event.source !== "lex" && <Badge variant="outline">Origem: {event.source}</Badge>}
        </div>
        <textarea
          key={event.updated_at}
          rows={2}
          defaultValue={event.title}
          onBlur={(e) => e.target.value.trim() && e.target.value !== event.title && save({ title: e.target.value.trim() })}
          onKeyDown={(e) => {
            if (e.key !== "Enter") return;
            e.preventDefault();
            (e.target as HTMLTextAreaElement).blur();
          }}
          className="w-full resize-none bg-transparent text-[22px] font-semibold leading-tight tracking-tight outline-none [field-sizing:content] md:text-[32px]"
        />
      </div>

      <div className="mt-6 grid gap-10 lg:grid-cols-[1fr_340px]">
        {/* Coluna principal */}
        <div className="min-w-0 space-y-10">
          <div className="rounded-2xl border bg-card p-4">
            <Field icon={CalendarClock} label="Início">
              <Input
                key={`s-${event.starts_at}-${event.all_day}`}
                type={event.all_day ? "date" : "datetime-local"}
                defaultValue={event.all_day ? isoToLocalInput(event.starts_at).slice(0, 10) : isoToLocalInput(event.starts_at)}
                onBlur={(e) => setTimes("starts_at", e.target.value)}
                className={ghostInput}
              />
            </Field>
            <Field icon={CalendarClock} label="Término">
              <Input
                key={`e-${event.ends_at}-${event.all_day}`}
                type={event.all_day ? "date" : "datetime-local"}
                defaultValue={event.all_day ? isoToLocalInput(event.ends_at).slice(0, 10) : isoToLocalInput(event.ends_at)}
                onBlur={(e) => setTimes("ends_at", e.target.value)}
                className={ghostInput}
              />
            </Field>
            <Field icon={CalendarClock} label="Dia inteiro">
              <Switch checked={event.all_day} onCheckedChange={(v) => save({ all_day: v })} className="ml-2" />
            </Field>
            {event.kind === "hearing" && (
              <Field icon={Gavel} label="Audiência">
                <HearingModeToggle value={event.hearing_mode} onChange={(v) => save({ hearing_mode: v })} className="w-full" />
              </Field>
            )}
            <Field icon={MapPin} label="Local">
              <Input key={`l-${event.location}`} defaultValue={event.location ?? ""} placeholder="Fórum, sala, endereço…" onBlur={(e) => e.target.value !== (event.location ?? "") && save({ location: e.target.value || null })} className={ghostInput} />
            </Field>
            <Field icon={Link2} label="Link">
              <Input key={`m-${event.meeting_url}`} defaultValue={event.meeting_url ?? ""} placeholder="Videoconferência (Teams, Zoom, Meet)" onBlur={(e) => e.target.value !== (event.meeting_url ?? "") && save({ meeting_url: e.target.value || null })} className={ghostInput} />
            </Field>
          </div>

          {event.process_id && <ProcessSummary processId={event.process_id} />}

          <section className="space-y-2">
            <h2 className="text-[15px] font-semibold">Descrição</h2>
            <RichEditor
              content={event.description}
              placeholder="Estratégia, pontos de atenção, perguntas para testemunhas, minutas…"
              onChange={(doc, text) => save({ description: doc, description_text: text })}
            />
          </section>

          <ChecklistPanel eventId={id} />

          <Tabs defaultValue="comments">
            <TabsList>
              <TabsTrigger value="comments">Comentários</TabsTrigger>
              <TabsTrigger value="history">Histórico</TabsTrigger>
            </TabsList>
            <TabsContent value="comments">
              <CommentsPanel eventId={id} />
            </TabsContent>
            <TabsContent value="history">
              <ActivityFeed type="event" id={id} />
            </TabsContent>
          </Tabs>
        </div>

        {/* Coluna lateral */}
        <aside className="space-y-8">
          <section className="space-y-3 rounded-2xl border bg-card p-4">
            <div className="grid grid-cols-2 gap-2">
              <div className="space-y-1">
                <span className="text-xs text-muted-foreground">Tipo</span>
                <Select
                  value={event.kind}
                  onValueChange={(v) => save({ kind: v as EventKind, category_id: categories?.find((c) => c.kind === v)?.id ?? null })}
                >
                  <SelectTrigger className="h-8"><SelectValue /></SelectTrigger>
                  <SelectContent>
                    {EVENT_KINDS.map((k) => <SelectItem key={k} value={k}>{EVENT_KIND_LABELS[k]}</SelectItem>)}
                  </SelectContent>
                </Select>
              </div>
              <div className="space-y-1">
                <span className="text-xs text-muted-foreground">Status</span>
                <Select value={event.status} onValueChange={(v) => save({ status: v as EventStatus })}>
                  <SelectTrigger className="h-8"><SelectValue /></SelectTrigger>
                  <SelectContent>
                    {STATUSES.map((s) => <SelectItem key={s} value={s}>{STATUS_LABELS[s]}</SelectItem>)}
                  </SelectContent>
                </Select>
              </div>
              <div className="space-y-1">
                <span className="text-xs text-muted-foreground">Prioridade</span>
                <Select value={event.priority} onValueChange={(v) => save({ priority: v as EventPriority })}>
                  <SelectTrigger className="h-8"><SelectValue /></SelectTrigger>
                  <SelectContent>
                    {PRIORITIES.map((p) => <SelectItem key={p} value={p}>{PRIORITY_LABELS[p]}</SelectItem>)}
                  </SelectContent>
                </Select>
              </div>
              <div className="space-y-1">
                <span className="text-xs text-muted-foreground">Cor</span>
                <input type="color" value={color} onChange={(e) => save({ color: e.target.value })} className="h-8 w-full cursor-pointer rounded-lg border bg-transparent p-1" aria-label="Cor do compromisso" />
              </div>
            </div>

            <Field icon={UserCheck} label="Responsável">
              <ResponsibleSelect
                allowNone
                className="h-8"
                value={{ responsibleId: event.responsible_id, collaboratorId: event.collaborator_id ?? null, partnerId: event.partner_id ?? null }}
                onChange={(v, c) => {
                  const attendees = event.attendees ?? [];
                  const invite = c?.email && !attendees.some((a) => a.email.toLowerCase() === c.email!.toLowerCase());
                  update.mutate(
                    {
                      id,
                      responsible_id: v.responsibleId,
                      collaborator_id: v.collaboratorId,
                      partner_id: v.partnerId ?? null,
                      ...(invite ? { attendees: [...attendees, { email: c!.email!, name: c!.name }] } : {}),
                    },
                    {
                      onSuccess: () => {
                        const changed = (v.collaboratorId && v.collaboratorId !== event.collaborator_id) || (v.partnerId && v.partnerId !== event.partner_id);
                        if (!changed) return;
                        void notifyCollaborator(id).then((r) => {
                          if (r === "sent") toast.success(`${c?.name ?? "Responsável"} avisado(a) por e-mail`);
                        });
                      },
                    },
                  );
                }}
              />
            </Field>
            <Field icon={UserCheck} label="Outros responsáveis">
              <CoResponsibles
                value={event.co_responsibles ?? []}
                exclude={[
                  ...(event.responsible_id ? [{ type: "member" as const, id: event.responsible_id }] : []),
                  ...(event.collaborator_id ? [{ type: "collaborator" as const, id: event.collaborator_id }] : []),
                  ...(event.partner_id ? [{ type: "partner" as const, id: event.partner_id }] : []),
                ]}
                onChange={(list, added) => {
                  const attendees = event.attendees ?? [];
                  const invite = added?.email && !attendees.some((a) => a.email.toLowerCase() === added.email!.toLowerCase());
                  update.mutate(
                    { id, co_responsibles: list, ...(invite ? { attendees: [...attendees, { email: added!.email!, name: added!.name }] } : {}) },
                    {
                      onSuccess: () => {
                        if (!added) return;
                        void notifyCollaborator(id, added.ref).then((r) => {
                          if (r === "sent") toast.success(`${added.name} avisado(a) por e-mail`);
                        });
                      },
                    },
                  );
                }}
              />
            </Field>
            <Field icon={User} label="Cliente">
              <div className="flex items-center gap-1">
                <Select
                  value={event.client_id ?? NONE}
                  onValueChange={(v) => {
                    if (v === NONE) return save({ client_id: null });
                    // Busca os processos do cliente: um só → vincula; processo de outro cliente → desvincula
                    const own = (processes ?? []).filter((p) => p.client_id === v);
                    const current = (processes ?? []).find((p) => p.id === event.process_id);
                    const pick = own.length === 1 ? own[0] : current && current.client_id && current.client_id !== v ? null : undefined;
                    save({
                      client_id: v,
                      ...(pick ? { process_id: pick.id, tribunal: pick.tribunal, court_division: pick.court_division } : pick === null ? { process_id: null } : {}),
                    });
                    if (own.length > 1) toast.info(`${own.length} processos deste cliente`, { description: "Escolha o processo no campo Processo." });
                  }}
                >
                  <SelectTrigger className="h-8"><SelectValue /></SelectTrigger>
                  <SelectContent>
                    <SelectItem value={NONE}>Nenhum</SelectItem>
                    {clients?.map((c) => <SelectItem key={c.id} value={c.id}>{c.name}</SelectItem>)}
                  </SelectContent>
                </Select>
                {event.client_id && (
                  <Button asChild variant="ghost" size="icon-sm"><Link href={`/clientes/${event.client_id}`} aria-label="Abrir cliente"><ArrowLeft className="rotate-180" /></Link></Button>
                )}
              </div>
            </Field>
            <Field icon={BriefcaseBusiness} label="Processo">
              <div className="flex items-center gap-1">
                <Select
                  value={event.process_id ?? NONE}
                  onValueChange={(v) => {
                    const p = processes?.find((x) => x.id === v);
                    save({
                      process_id: v === NONE ? null : v,
                      ...(p ? { tribunal: p.tribunal, court_division: p.court_division, client_id: event.client_id ?? p.client_id } : {}),
                    });
                  }}
                >
                  <SelectTrigger className="h-8"><SelectValue /></SelectTrigger>
                  <SelectContent>
                    <SelectItem value={NONE}>Nenhum</SelectItem>
                    {(event.client_id && processes?.some((p) => p.client_id === event.client_id)
                      ? processes.filter((p) => p.client_id === event.client_id || p.id === event.process_id)
                      : (processes ?? [])
                    ).map((p) => (
                      <SelectItem key={p.id} value={p.id}>
                        {processLabel(p)}
                        {p.procedural_class ? ` — ${p.procedural_class}` : ""}
                      </SelectItem>
                    ))}
                  </SelectContent>
                </Select>
                {process && (
                  <Button asChild variant="ghost" size="icon-sm"><Link href={`/processos/${process.id}`} aria-label="Abrir processo"><ArrowLeft className="rotate-180" /></Link></Button>
                )}
              </div>
            </Field>
            <Field icon={Link2} label="Relacionada a">
              <RelatedTaskSelect
                className="h-8"
                value={event.related_event_id ?? null}
                excludeId={id}
                clientId={event.client_id}
                processId={event.process_id}
                onChange={(v) => save({ related_event_id: v })}
              />
            </Field>
            <Field icon={Building2} label="Tribunal">
              <Input key={`t-${event.tribunal}`} defaultValue={event.tribunal ?? ""} placeholder="TJPA, TRT8…" onBlur={(e) => e.target.value !== (event.tribunal ?? "") && save({ tribunal: e.target.value || null })} className={ghostInput} />
            </Field>
            <Field icon={Gavel} label="Vara">
              <Input key={`v-${event.court_division}`} defaultValue={event.court_division ?? ""} placeholder="Órgão julgador" onBlur={(e) => e.target.value !== (event.court_division ?? "") && save({ court_division: e.target.value || null })} className={ghostInput} />
            </Field>
            <label className="flex items-center justify-between pt-1 text-sm">
              Privado (só você e o responsável)
              <Switch checked={event.is_private} onCheckedChange={(v) => save({ is_private: v })} />
            </label>
          </section>

          <section className="space-y-2">
            <h2 className="text-[15px] font-semibold">Convidados</h2>
            <AttendeesInput compact value={event.attendees ?? []} onChange={(attendees) => save({ attendees })} />
            {!!event.attendees?.length && !event.shared_origin && (
              <label className="flex items-start justify-between gap-3 rounded-xl bg-secondary/50 px-3 py-2 text-xs">
                <span>
                  <span className="block font-medium text-foreground">Convidados só podem ler (e comentar)</span>
                  <span className="block text-muted-foreground">
                    Desligado, os convidados que aceitarem podem alterar nome, data, hora e local — a mudança volta para o Lex e aparece no sino e no calendário.
                    Ligado, eles apenas leem; os comentários continuam permitidos.
                  </span>
                </span>
                <Switch checked={event.guests_can_modify === false} onCheckedChange={(v) => save({ guests_can_modify: !v })} />
              </label>
            )}
          </section>

          <RemindersPanel eventId={id} />
          <AttachmentsPanel eventId={id} />
        </aside>
      </div>
    </div>
  );
}
