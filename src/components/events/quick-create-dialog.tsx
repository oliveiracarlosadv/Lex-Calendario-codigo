"use client";

import { useEffect, useState } from "react";
import { useRouter } from "next/navigation";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Switch } from "@/components/ui/switch";
import { Textarea } from "@/components/ui/textarea";
import { defaultRemindersFor, suggestPriority, validateEventDraft } from "@/domain/events/rules";
import { EVENT_KINDS, EVENT_KIND_LABELS, PRIORITIES, PRIORITY_LABELS, REMINDER_PRESETS, type EventKind, type EventPriority } from "@/domain/events/types";
import { useCreateEvent } from "@/hooks/use-events";
import { useCategories, useClients, useProcesses } from "@/hooks/use-records";
import { useWorkspace } from "@/hooks/use-workspace";
import { isoToLocalInput, localInputToISO } from "@/lib/utils";
import { useUiStore } from "@/stores/ui-store";
import type { Attendee } from "@/types/db";
import { AttendeesInput } from "./attendees-input";
import { CoResponsibles, ResponsibleSelect, type CoResponsible } from "./responsible-select";
import { HearingModeToggle, type HearingMode } from "./hearing-mode";
import { RelatedTaskSelect } from "./related-task-select";
import { notifyCollaborator } from "@/hooks/use-collaborators";
import { processLabel } from "@/domain/processes/types";

const NONE = "__none__";

export function QuickCreateDialog() {
  const router = useRouter();
  const { quickCreate, closeQuickCreate } = useUiStore();
  const { userId } = useWorkspace();
  const { data: categories } = useCategories();
  const { data: clients } = useClients();
  const { data: processes } = useProcesses();
  const create = useCreateEvent();

  const [title, setTitle] = useState("");
  const [kind, setKind] = useState<EventKind>("meeting");
  const [allDay, setAllDay] = useState(false);
  const [start, setStart] = useState("");
  const [end, setEnd] = useState("");
  const [location, setLocation] = useState("");
  const [description, setDescription] = useState("");
  const [hearingMode, setHearingMode] = useState<HearingMode | null>(null);
  const [meetingUrl, setMeetingUrl] = useState("");
  const [clientId, setClientId] = useState(NONE);
  const [processId, setProcessId] = useState(NONE);
  const [responsibleId, setResponsibleId] = useState<string | null>(userId);
  const [collaboratorId, setCollaboratorId] = useState<string | null>(null);
  const [partnerId, setPartnerId] = useState<string | null>(null);
  const [coResponsibles, setCoResponsibles] = useState<CoResponsible[]>([]);
  const [relatedId, setRelatedId] = useState<string | null>(null);
  const [guestsReadOnly, setGuestsReadOnly] = useState(false);
  const [priority, setPriority] = useState<EventPriority>("medium");
  const [reminders, setReminders] = useState<number[]>(defaultRemindersFor("meeting"));
  const [attendees, setAttendees] = useState<Attendee[]>([]);

  useEffect(() => {
    if (!quickCreate) return;
    setTitle("");
    setKind("meeting");
    // Padrão: "Dia inteiro" desmarcado e início/fim no mesmo dia (o usuário altera o fim se quiser)
    setAllDay(false);
    if (quickCreate.allDay) {
      const day = isoToLocalInput(quickCreate.start).slice(0, 10);
      setStart(`${day}T09:00`);
      setEnd(`${day}T10:00`);
    } else {
      const s = isoToLocalInput(quickCreate.start);
      const e = isoToLocalInput(quickCreate.end);
      setStart(s);
      setEnd(e.slice(0, 10) === s.slice(0, 10) ? e : `${s.slice(0, 10)}T${e.slice(11, 16) > s.slice(11, 16) ? e.slice(11, 16) : s.slice(11, 16)}`);
    }
    setLocation("");
    setDescription("");
    setHearingMode(null);
    setMeetingUrl("");
    setClientId(NONE);
    setProcessId(NONE);
    setResponsibleId(userId);
    setCollaboratorId(null);
    setPartnerId(null);
    setCoResponsibles([]);
    setRelatedId(null);
    setGuestsReadOnly(false);
    setPriority("medium");
    setReminders(defaultRemindersFor("meeting"));
    setAttendees([]);
  }, [quickCreate, userId]);

  function onKindChange(k: EventKind) {
    setKind(k);
    setReminders(defaultRemindersFor(k));
    if (start) setPriority(suggestPriority(k, new Date(localInputToISO(start))));
  }

  // Processos do cliente escolhido (com o cliente definido, a lista mostra só os dele)
  const clientProcesses = clientId === NONE ? (processes ?? []) : (processes ?? []).filter((p) => p.client_id === clientId);
  const processOptions = clientId !== NONE && clientProcesses.length ? clientProcesses : (processes ?? []);

  function onClientChange(id: string) {
    setClientId(id);
    if (id === NONE) return;
    const own = (processes ?? []).filter((p) => p.client_id === id);
    const current = (processes ?? []).find((p) => p.id === processId);
    if (own.length === 1) setProcessId(own[0].id);
    else if (current && current.client_id && current.client_id !== id) setProcessId(NONE);
    if (own.length > 1) toast.info(`${own.length} processos deste cliente`, { description: "Escolha o processo no campo ao lado." });
  }

  function onProcessChange(id: string) {
    setProcessId(id);
    const p = processes?.find((x) => x.id === id);
    if (p?.client_id) setClientId(p.client_id);
  }

  async function submit(openAfter: boolean) {
    const startsAt = allDay ? localInputToISO(`${start.slice(0, 10)}T00:00`) : localInputToISO(start);
    let endsAt = allDay ? localInputToISO(`${end.slice(0, 10)}T00:00`) : localInputToISO(end);
    if (allDay && endsAt <= startsAt) endsAt = new Date(new Date(startsAt).getTime() + 864e5).toISOString();
    const check = validateEventDraft({ title, kind, startsAt: new Date(startsAt), endsAt: new Date(endsAt), allDay });
    if (!check.ok) return toast.error(check.error.message);

    const process = processes?.find((p) => p.id === processId);
    const row = await create.mutateAsync({
      title: check.value.title,
      kind,
      category_id: categories?.find((c) => c.kind === kind)?.id ?? null,
      starts_at: startsAt,
      ends_at: endsAt,
      all_day: allDay,
      location: location || null,
      // Descrição: texto simples aqui; na página do compromisso continua editável com formatação
      ...(description.trim()
        ? {
            description_text: description.trim(),
            description: {
              type: "doc",
              content: description
                .trim()
                .split(/\n/)
                .map((line) => (line ? { type: "paragraph", content: [{ type: "text", text: line }] } : { type: "paragraph" })),
            },
          }
        : {}),
      hearing_mode: kind === "hearing" ? hearingMode : null,
      meeting_url: meetingUrl.trim() || null,
      client_id: clientId === NONE ? null : clientId,
      process_id: processId === NONE ? null : processId,
      tribunal: process?.tribunal ?? null,
      court_division: process?.court_division ?? null,
      responsible_id: responsibleId,
      collaborator_id: collaboratorId,
      partner_id: partnerId,
      co_responsibles: coResponsibles,
      related_event_id: relatedId,
      guests_can_modify: !guestsReadOnly,
      priority,
      reminders,
      attendees,
    });
    closeQuickCreate();
    for (const ref of coResponsibles) void notifyCollaborator(row.id, ref);
    if (collaboratorId || partnerId) {
      void notifyCollaborator(row.id).then((r) => {
        if (r === "sent") toast.success("Responsável avisado por e-mail");
        else if (r === "no-account") toast.info("Responsável definido", { description: "Para avisá-lo por e-mail automaticamente, configure Configurações → E-mail de envio (ou conecte o Google para enviar o convite)." });
      });
    }
    if (openAfter) router.push(`/eventos/${row.id}`);
    else toast.success("Compromisso criado", { action: { label: "Abrir", onClick: () => router.push(`/eventos/${row.id}`) } });
  }

  return (
    <Dialog open={!!quickCreate} onOpenChange={(o) => !o && closeQuickCreate()}>
      <DialogContent className="max-w-xl">
        <DialogHeader>
          <DialogTitle>Novo compromisso</DialogTitle>
          <DialogDescription>Crie rapidamente; detalhes, checklist e anexos ficam na página do compromisso.</DialogDescription>
        </DialogHeader>

        <form
          className="grid gap-4"
          onSubmit={(e) => {
            e.preventDefault();
            void submit(false);
          }}
        >
          <Input autoFocus placeholder="Título (ex.: Audiência de instrução — Cliente X)" value={title} onChange={(e) => setTitle(e.target.value)} className="h-11 text-[15px]" />
          {kind === "hearing" && title.trim() && !/^\s*audi[eê]ncia\s*:/i.test(title) && (
            <p className="-mt-2 text-xs text-muted-foreground">Será salvo na agenda como “AUDIÊNCIA: {title.trim()}”.</p>
          )}

          <div className="flex flex-wrap gap-1.5">
            {EVENT_KINDS.map((k) => {
              const color = categories?.find((c) => c.kind === k)?.color;
              return (
                <button
                  type="button"
                  key={k}
                  onClick={() => onKindChange(k)}
                  className="flex items-center gap-1.5 rounded-full border px-2.5 py-1 text-[12.5px] transition data-[on=true]:border-transparent data-[on=true]:bg-foreground data-[on=true]:text-background"
                  data-on={kind === k}
                >
                  <span className="size-2 rounded-full" style={{ background: color }} />
                  {EVENT_KIND_LABELS[k]}
                </button>
              );
            })}
          </div>

          <div className="grid gap-3 sm:grid-cols-2">
            <div className="grid gap-1.5">
              <Label>Início</Label>
              <Input
                type={allDay ? "date" : "datetime-local"}
                value={allDay ? start.slice(0, 10) : start}
                onChange={(e) => {
                  const next = allDay ? `${e.target.value}T00:00` : e.target.value;
                  // O término acompanha o início (mesma data, mesma duração)
                  if (start && end && next) {
                    const duration = new Date(localInputToISO(end)).getTime() - new Date(localInputToISO(start)).getTime();
                    const moved = new Date(new Date(localInputToISO(next)).getTime() + Math.max(duration, 0));
                    setEnd(isoToLocalInput(moved.toISOString()));
                  }
                  setStart(next);
                }}
              />
            </div>
            <div className="grid gap-1.5">
              <Label>Término</Label>
              <Input type={allDay ? "date" : "datetime-local"} value={allDay ? end.slice(0, 10) : end} onChange={(e) => setEnd(allDay ? `${e.target.value}T00:00` : e.target.value)} />
            </div>
          </div>
          <label className="flex items-center justify-between text-sm">
            Dia inteiro
            <Switch checked={allDay} onCheckedChange={setAllDay} />
          </label>

          <div className="grid gap-3 sm:grid-cols-2">
            <div className="grid gap-1.5">
              <Label>Cliente</Label>
              <Select value={clientId} onValueChange={onClientChange}>
                <SelectTrigger><SelectValue /></SelectTrigger>
                <SelectContent>
                  <SelectItem value={NONE}>Nenhum</SelectItem>
                  {clients?.map((c) => (
                    <SelectItem key={c.id} value={c.id}>{c.name}</SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>
            <div className="grid gap-1.5">
              <Label>
                Processo
                {clientId !== NONE && (
                  <span className="ml-1 font-normal text-muted-foreground">
                    {clientProcesses.length ? `· ${clientProcesses.length} do cliente` : "· cliente sem processos"}
                  </span>
                )}
              </Label>
              <Select value={processId} onValueChange={onProcessChange}>
                <SelectTrigger><SelectValue /></SelectTrigger>
                <SelectContent>
                  <SelectItem value={NONE}>Nenhum</SelectItem>
                  {processOptions.map((p) => (
                    <SelectItem key={p.id} value={p.id}>
                      {processLabel(p)}
                      {[p.procedural_class, p.tribunal].filter(Boolean).length ? ` — ${[p.procedural_class, p.tribunal].filter(Boolean).join(" · ")}` : ""}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>
            <div className="grid gap-1.5 sm:col-span-2">
              <Label>Relacionada a uma tarefa concluída (opcional)</Label>
              <RelatedTaskSelect
                value={relatedId}
                onChange={setRelatedId}
                clientId={clientId === NONE ? null : clientId}
                processId={processId === NONE ? null : processId}
              />
            </div>
            <div className="grid gap-1.5">
              <Label>Responsável</Label>
              <ResponsibleSelect
                value={{ responsibleId, collaboratorId, partnerId }}
                onChange={(v, c) => {
                  setResponsibleId(v.responsibleId);
                  setCollaboratorId(v.collaboratorId);
                  setPartnerId(v.partnerId ?? null);
                  if (c?.email && !attendees.some((a) => a.email.toLowerCase() === c.email!.toLowerCase())) {
                    setAttendees((list) => [...list, { email: c.email!, name: c.name }]);
                  }
                }}
              />
              <CoResponsibles
                value={coResponsibles}
                exclude={[
                  ...(responsibleId ? [{ type: "member" as const, id: responsibleId }] : []),
                  ...(collaboratorId ? [{ type: "collaborator" as const, id: collaboratorId }] : []),
                  ...(partnerId ? [{ type: "partner" as const, id: partnerId }] : []),
                ]}
                onChange={(list, added) => {
                  setCoResponsibles(list);
                  if (added?.email && !attendees.some((a) => a.email.toLowerCase() === added.email!.toLowerCase())) {
                    setAttendees((l) => [...l, { email: added.email!, name: added.name }]);
                  }
                }}
              />
            </div>
            <div className="grid gap-1.5">
              <Label>Prioridade</Label>
              <Select value={priority} onValueChange={(v) => setPriority(v as EventPriority)}>
                <SelectTrigger><SelectValue /></SelectTrigger>
                <SelectContent>
                  {PRIORITIES.map((p) => (
                    <SelectItem key={p} value={p}>{PRIORITY_LABELS[p]}</SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>
          </div>

          {kind === "hearing" && (
            <div className="grid gap-1.5">
              <Label>A audiência será</Label>
              <HearingModeToggle value={hearingMode} onChange={setHearingMode} />
            </div>
          )}
          {kind === "hearing" && hearingMode === "online" ? (
            <Input placeholder="Link da sala virtual (Teams, Zoom, Google Meet, Balcão Virtual…)" value={meetingUrl} onChange={(e) => setMeetingUrl(e.target.value)} />
          ) : (
            <Input
              placeholder={kind === "hearing" ? "Local (fórum, vara, sala)" : "Local (fórum, sala, link da videoconferência…)"}
              value={location}
              onChange={(e) => setLocation(e.target.value)}
            />
          )}

          <div className="grid gap-1.5">
            <Label>Descrição</Label>
            <Textarea rows={3} value={description} onChange={(e) => setDescription(e.target.value)} placeholder="Detalhes, pontos de atenção, o que levar, o que precisa ser feito…" />
          </div>

          <div className="grid gap-1.5">
            <Label>Convidados</Label>
            <AttendeesInput value={attendees} onChange={setAttendees} />
            {attendees.length > 0 && (
              <>
                <p className="text-xs text-muted-foreground">Com o Google conectado (botão Entrar), o convite é enviado por e-mail automaticamente.</p>
                <label className="flex items-start gap-2 rounded-xl bg-secondary/50 px-3 py-2 text-xs">
                  <input type="checkbox" checked={guestsReadOnly} onChange={(e) => setGuestsReadOnly(e.target.checked)} className="mt-0.5 size-3.5 accent-[hsl(var(--primary))]" />
                  <span>
                    <span className="block font-medium text-foreground">Convidados só podem ler (e comentar)</span>
                    <span className="block text-muted-foreground">Desmarcado, quem aceitar o convite pode alterar nome, data, hora e local. Os comentários são sempre permitidos.</span>
                  </span>
                </label>
              </>
            )}
          </div>

          <div className="grid gap-1.5">
            <Label>Lembretes</Label>
            <div className="flex flex-wrap gap-1.5">
              {REMINDER_PRESETS.map((r) => {
                const on = reminders.includes(r.minutes);
                return (
                  <button
                    type="button"
                    key={r.minutes}
                    onClick={() => setReminders(on ? reminders.filter((m) => m !== r.minutes) : [...reminders, r.minutes])}
                    className="rounded-full border px-2.5 py-1 text-[12px] transition data-[on=true]:border-primary data-[on=true]:bg-primary/10 data-[on=true]:text-primary"
                    data-on={on}
                  >
                    {r.label}
                  </button>
                );
              })}
            </div>
          </div>

          <DialogFooter className="pt-2">
            <Button type="button" variant="ghost" onClick={closeQuickCreate}>Cancelar</Button>
            <Button type="button" variant="outline" disabled={create.isPending} onClick={() => void submit(true)}>Criar e abrir</Button>
            <Button type="submit" disabled={create.isPending}>Criar</Button>
          </DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
  );
}
