"use client";

import { useEffect, useRef, useState } from "react";
import Link from "next/link";
import { CalendarClock, FileText, Loader2, Mail, MessageCircle, Paperclip, Send, Sparkles, X } from "lucide-react";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import { Dialog, DialogContent, DialogDescription, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Textarea } from "@/components/ui/textarea";
import {
  COMMUNICATION_KIND_LABELS,
  TEMPLATE_VARIABLES,
  fillTemplate,
  mailtoLink,
  unfilledPlaceholders,
  whatsappLink,
  type CommunicationAttachment,
  type CommunicationKind,
} from "@/domain/communications/types";
import {
  mailSenderLabel,
  sendEmailNow,
  uploadCommunicationFile,
  useMailAccount,
  useSaveCommunication,
  useTemplates,
  useUpdateCommunicationStatus,
  type CommunicationRow,
} from "@/hooks/use-communications";
import { useClients, useProcesses } from "@/hooks/use-records";
import { useWorkspace } from "@/hooks/use-workspace";
import { cn, formatBytes, isoToLocalInput, localInputToISO } from "@/lib/utils";
import { AiSetupDialog, aiReady, useAiStatus } from "./ai-setup";
import { useClientContacts } from "@/components/clients/client-contacts";
import { openOAuthWindow } from "@/lib/oauth-popup";
import { processLabel } from "@/domain/processes/types";

const NONE = "__none";
type SendMode = "now" | "schedule" | "draft";

const KIND_ICON = { email: Mail, oficio: FileText, whatsapp: MessageCircle } as const;

export interface CommunicationDialogProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  initial?: Partial<CommunicationRow> & { event_id?: string | null };
}

export function CommunicationDialog({ open, onOpenChange, initial }: CommunicationDialogProps) {
  const { organization } = useWorkspace();
  const { data: clients } = useClients();
  const { data: processes } = useProcesses();
  const { data: templates } = useTemplates();
  const { data: mailSetup } = useMailAccount();
  const account = mailSenderLabel(mailSetup);
  const save = useSaveCommunication();
  const setStatus = useUpdateCommunicationStatus();

  const [kind, setKind] = useState<CommunicationKind>(initial?.kind ?? "email");
  const [clientId, setClientId] = useState(initial?.client_id ?? NONE);
  const [processId, setProcessId] = useState(initial?.process_id ?? NONE);
  const [recipientName, setRecipientName] = useState(initial?.recipient_name ?? "");
  const [toEmail, setToEmail] = useState(initial?.to_email ?? "");
  const [toPhone, setToPhone] = useState(initial?.to_phone ?? "");
  const [subject, setSubject] = useState(initial?.subject ?? "");
  const [body, setBody] = useState(initial?.body ?? "");
  const [templateId, setTemplateId] = useState(initial?.template_id ?? NONE);
  const [deadline, setDeadline] = useState(initial?.deadline_at ?? "");
  const [mode, setMode] = useState<SendMode>(initial?.send_at && initial.status === "scheduled" ? "schedule" : "now");
  const [sendAt, setSendAt] = useState(initial?.send_at ? isoToLocalInput(initial.send_at) : "");
  const [attachments, setAttachments] = useState<CommunicationAttachment[]>(initial?.attachments ?? []);
  const [aiPrompt, setAiPrompt] = useState("");
  const [aiBusy, setAiBusy] = useState(false);
  const [aiUsed, setAiUsed] = useState(!!initial?.generated_by_ai);
  const [uploading, setUploading] = useState(false);
  const [busy, setBusy] = useState(false);
  const fileInput = useRef<HTMLInputElement>(null);
  const [aiSetup, setAiSetup] = useState(false);
  const { data: aiStatus } = useAiStatus();

  const client = clients?.find((c) => c.id === clientId);
  const { data: contacts = [] } = useClientContacts(clientId === NONE ? null : clientId);
  const [contactId, setContactId] = useState<string | null>(initial?.contact_id ?? null);

  // Destinatário: o cliente ou um contato dele (familiar, secretária, contador…)
  function chooseRecipient(id: string | null) {
    setContactId(id);
    const c = contacts.find((x) => x.id === id);
    if (c) {
      setRecipientName(c.name);
      setToEmail(c.email ?? "");
      setToPhone(c.phone ?? "");
    } else if (client) {
      setRecipientName(client.name);
      setToEmail(client.email ?? "");
      setToPhone(client.phone ?? "");
    }
  }
  const clientProcesses = (processes ?? []).filter((p) => clientId !== NONE && p.client_id === clientId);
  const processOptions = clientProcesses.length ? clientProcesses : (processes ?? []);
  const kindTemplates = (templates ?? []).filter((t) => t.kind === kind);
  const placeholders = unfilledPlaceholders(`${subject}\n${body}`);

  // Ao escolher o cliente: preenche destinatário e busca os processos dele
  useEffect(() => {
    if (!client || initial?.id) return;
    setContactId(null);
    setRecipientName(client.name);
    if (client.email) setToEmail(client.email);
    if (client.phone) setToPhone(client.phone);
    const own = (processes ?? []).filter((p) => p.client_id === client.id);
    if (own.length === 1) setProcessId(own[0].id);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [clientId]);

  const refs = () => ({
    clientId: clientId === NONE ? null : clientId,
    processId: processId === NONE ? null : processId,
    eventId: initial?.event_id ?? null,
    deadline: deadline || null,
  });

  async function applyTemplate(id: string) {
    setTemplateId(id);
    const t = templates?.find((x) => x.id === id);
    if (!t) return;
    if (body.trim() && !confirm("Substituir o texto atual pelo modelo?")) return;
    const res = await fetch("/api/comunicacoes/variaveis", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify(refs()) });
    const vars = res.ok ? ((await res.json()) as Record<string, string | null>) : {};
    setSubject(fillTemplate(t.subject, vars));
    setBody(fillTemplate(t.body, vars));
  }

  async function generate() {
    setAiBusy(true);
    try {
      const res = await fetch("/api/comunicacoes/gerar", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ kind, instructions: aiPrompt, currentSubject: subject, currentBody: body, ...refs() }),
      });
      const data = (await res.json().catch(() => ({}))) as { subject?: string; body?: string; error?: string; model?: string };
      if (!res.ok) throw new Error(data.error ?? "A IA não respondeu.");
      if (data.subject) setSubject(data.subject);
      if (data.body) setBody(data.body);
      setAiUsed(true);
      toast.success("Texto gerado pela IA", { description: `Modelo ${data.model ?? ""}. Revise antes de enviar.` });
    } catch (e) {
      toast.error("Não foi possível gerar", {
        description: (e as Error).message,
        duration: 12_000,
        action: { label: "Instalar IA gratuita", onClick: () => setAiSetup(true) },
      });
    } finally {
      setAiBusy(false);
    }
  }

  async function addFiles(files: File[]) {
    setUploading(true);
    try {
      for (const f of files) {
        if (f.size > 20 * 1024 * 1024) {
          toast.error(`${f.name}: arquivo maior que 20 MB`);
          continue;
        }
        const a = await uploadCommunicationFile(organization.id, f);
        setAttachments((list) => [...list, a]);
      }
    } catch (e) {
      toast.error("Falha ao anexar", { description: (e as Error).message });
    } finally {
      setUploading(false);
    }
  }

  async function persist(status: CommunicationRow["status"]) {
    return save.mutateAsync({
      id: initial?.id,
      kind,
      status,
      client_id: clientId === NONE ? null : clientId,
      contact_id: clientId === NONE ? null : contactId,
      process_id: processId === NONE ? null : processId,
      template_id: templateId === NONE ? null : templateId,
      recipient_name: recipientName,
      to_email: toEmail,
      to_phone: toPhone,
      subject,
      body,
      deadline_at: deadline || null,
      send_at: mode === "schedule" && sendAt ? localInputToISO(sendAt) : null,
      attachments,
      generated_by_ai: aiUsed,
    });
  }

  function validate(): string | null {
    if (!body.trim()) return "Escreva a mensagem, use um modelo ou gere com a IA.";
    if (kind === "email" && mode !== "draft" && !/^\S+@\S+\.\S+$/.test(toEmail.trim())) return "Informe o e-mail do destinatário.";
    if (kind === "whatsapp" && mode !== "draft" && toPhone.replace(/\D/g, "").length < 10) return "Informe o celular do destinatário com DDD.";
    if (mode === "schedule") {
      if (!sendAt) return "Informe a data e a hora do envio.";
      if (new Date(localInputToISO(sendAt)).getTime() < Date.now() - 60_000) return "A data de envio já passou.";
    }
    return null;
  }

  async function submit() {
    const error = validate();
    if (error) return toast.error(error);
    if (mode !== "draft" && placeholders.length && !confirm(`Ainda há campos para completar: ${placeholders.slice(0, 5).map((p) => `[${p}]`).join(", ")}. Continuar mesmo assim?`)) return;
    setBusy(true);
    try {
      if (mode === "draft") {
        await persist("draft");
        toast.success("Rascunho salvo");
      } else if (mode === "schedule") {
        await persist("scheduled");
        toast.success("Envio agendado", {
          description: kind === "email" ? "O Lex envia o e-mail no horário, mesmo com a janela fechada." : "No horário, o Lex avisa para você enviar.",
        });
      } else if (kind === "email") {
        const saved = await persist("draft");
        if (account) {
          await sendEmailNow(saved.id);
          toast.success("E-mail enviado", { description: `Para ${toEmail}` });
        } else {
          window.location.href = mailtoLink(toEmail, subject, body);
          await setStatus.mutateAsync({ id: saved.id, status: "sent" });
          toast.success("E-mail aberto no seu programa de e-mail", {
            description: attachments.length ? "Anexe os arquivos manualmente — ou configure o envio automático em Configurações → E-mail de envio." : undefined,
          });
        }
      } else if (kind === "whatsapp") {
        const saved = await persist("draft");
        window.open(whatsappLink(toPhone, `${subject && subject !== "Lembrete de reunião" ? `*${subject}*\n\n` : ""}${body}`), "_blank", "noopener");
        await setStatus.mutateAsync({ id: saved.id, status: "sent" });
        toast.success("Mensagem aberta no WhatsApp", { description: "Confira e toque em enviar no WhatsApp." });
      } else {
        const saved = await persist("draft");
        window.open(`/api/comunicacoes/${saved.id}/documento`, "_blank", "noopener");
        toast.success("Ofício salvo", { description: "O documento abriu para imprimir ou salvar em PDF. Marque como entregue na lista quando protocolar." });
      }
      onOpenChange(false);
    } catch (e) {
      toast.error("Não foi possível concluir", { description: (e as Error).message, duration: 10_000 });
    } finally {
      setBusy(false);
    }
  }

  const primaryLabel =
    mode === "draft"
      ? "Salvar rascunho"
      : mode === "schedule"
        ? kind === "email"
          ? "Agendar envio"
          : "Agendar lembrete de envio"
        : kind === "email"
          ? account
            ? "Enviar agora"
            : "Abrir no meu e-mail"
          : kind === "whatsapp"
            ? "Abrir no WhatsApp"
            : "Salvar e gerar documento";

  const row = "flex items-center gap-2 border-b px-4 py-1.5 text-sm";
  const bare = "h-8 flex-1 border-0 bg-transparent px-0 shadow-none focus-visible:ring-0";
  const QUICK = body.trim()
    ? ["Mais formal", "Mais curto", "Mais cordial", "Corrigir português", "Explicar em linguagem simples"]
    : ["Avisar audiência marcada", "Pedir documentos", "Informar andamento do processo", "Cobrar honorários com cordialidade"];

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="flex max-h-[94dvh] w-[min(100vw-1rem,64rem)] max-w-none flex-col gap-0 overflow-hidden p-0">
        {/* Cabeçalho no estilo do Gmail */}
        <DialogHeader className="flex-row flex-wrap items-center gap-3 space-y-0 border-b bg-secondary/70 py-2.5 pl-4 pr-12 text-left">
          <DialogTitle className="flex-1 text-[15px]">{initial?.id ? "Editar comunicação" : "Nova mensagem"}</DialogTitle>
          <DialogDescription className="sr-only">E-mail, ofício ou WhatsApp — com modelo, IA, anexos, prazo e data de envio.</DialogDescription>
          <div className="flex flex-wrap gap-1">
            {(Object.keys(COMMUNICATION_KIND_LABELS) as CommunicationKind[]).map((k) => {
              const Icon = KIND_ICON[k];
              return (
                <button
                  key={k}
                  type="button"
                  onClick={() => {
                    setKind(k);
                    setTemplateId(NONE);
                  }}
                  className={cn("flex items-center gap-1.5 rounded-full px-2.5 py-1 text-xs transition", kind === k ? "bg-primary text-primary-foreground" : "bg-background hover:bg-accent")}
                >
                  <Icon className="size-3.5" /> {COMMUNICATION_KIND_LABELS[k]}
                </button>
              );
            })}
          </div>
        </DialogHeader>

        <div className="min-h-0 flex-1 overflow-y-auto">
          {/* Para */}
          <div className={row}>
            <span className="w-16 shrink-0 text-muted-foreground">Para</span>
            <Input className={bare} value={recipientName} onChange={(e) => setRecipientName(e.target.value)} placeholder={kind === "oficio" ? "Destinatário (nome / órgão)" : "Nome do destinatário"} />
            {kind === "email" && (
              <Input className={cn(bare, "max-w-[45%]")} type="email" value={toEmail} onChange={(e) => setToEmail(e.target.value)} placeholder="e-mail@exemplo.com" />
            )}
            {kind === "whatsapp" && (
              <Input className={cn(bare, "max-w-[40%]")} value={toPhone} onChange={(e) => setToPhone(e.target.value)} placeholder="Celular com DDD" />
            )}
          </div>
          {clientId !== NONE && !!contacts.length && (
            <div className={row}>
              <span className="w-16 shrink-0 text-muted-foreground">Enviar a</span>
              <Select value={contactId ?? NONE} onValueChange={(v) => chooseRecipient(v === NONE ? null : v)}>
                <SelectTrigger className="h-8 flex-1 border-0 px-0 shadow-none"><SelectValue /></SelectTrigger>
                <SelectContent>
                  <SelectItem value={NONE}>O próprio cliente{client ? ` — ${client.name}` : ""}</SelectItem>
                  {contacts
                    .filter((c) => c.receives_communications || c.id === contactId)
                    .map((c) => (
                      <SelectItem key={c.id} value={c.id}>
                        {c.name}
                        {c.relationship ? ` (${c.relationship})` : ""}
                      </SelectItem>
                    ))}
                </SelectContent>
              </Select>
            </div>
          )}
          {/* Cliente e processo */}
          <div className={cn(row, "flex-wrap")}>
            <span className="w-16 shrink-0 text-muted-foreground">Cliente</span>
            <Select value={clientId} onValueChange={setClientId}>
              <SelectTrigger className="h-8 min-w-[10rem] flex-1 border-0 px-0 shadow-none"><SelectValue /></SelectTrigger>
              <SelectContent>
                <SelectItem value={NONE}>Nenhum</SelectItem>
                {clients?.map((c) => <SelectItem key={c.id} value={c.id}>{c.name}</SelectItem>)}
              </SelectContent>
            </Select>
            <span className="shrink-0 text-muted-foreground">Processo</span>
            <Select value={processId} onValueChange={setProcessId}>
              <SelectTrigger className="h-8 min-w-[10rem] flex-1 border-0 px-0 shadow-none"><SelectValue /></SelectTrigger>
              <SelectContent>
                <SelectItem value={NONE}>{clientId !== NONE && !clientProcesses.length ? "Cliente sem processos" : "Nenhum"}</SelectItem>
                {processOptions.map((p) => <SelectItem key={p.id} value={p.id}>{processLabel(p)}</SelectItem>)}
              </SelectContent>
            </Select>
          </div>
          {kind !== "whatsapp" && (
            <div className={row}>
              <span className="w-16 shrink-0 text-muted-foreground">Assunto</span>
              <Input className={bare} value={subject} onChange={(e) => setSubject(e.target.value)} />
            </div>
          )}

          {/* Caixa da IA */}
          <div className="border-b bg-primary/[0.04] px-4 py-3">
            <div className="flex items-start gap-2">
              <Sparkles className="mt-2 size-4 shrink-0 text-primary" />
              <Textarea
                value={aiPrompt}
                onChange={(e) => setAiPrompt(e.target.value)}
                rows={2}
                placeholder={body.trim() ? "Diga à IA como melhorar o texto. Ex.: deixe mais curto e mais formal, e cite o prazo de 15 dias." : "Diga à IA o que escrever. Ex.: avisar o cliente que a audiência foi remarcada para 20/11 às 9h, de forma cordial."}
                className="min-h-[3.25rem] flex-1 resize-y bg-background text-sm"
                onKeyDown={(e) => {
                  // Enter gera; Shift+Enter quebra a linha
                  if (e.key === "Enter" && !e.shiftKey) {
                    e.preventDefault();
                    if (!aiBusy) void generate();
                  }
                }}
              />
              <Button type="button" onClick={() => void generate()} disabled={aiBusy} className="shrink-0">
                {aiBusy ? <Loader2 className="animate-spin" /> : <Sparkles />} {aiBusy ? "Escrevendo…" : body.trim() ? "Melhorar" : "Gerar"}
              </Button>
            </div>
            <div className="mt-2 flex flex-wrap items-center gap-1.5 pl-6">
              {QUICK.map((q) => (
                <button
                  key={q}
                  type="button"
                  disabled={aiBusy}
                  onClick={() => setAiPrompt((cur) => (cur.trim() ? `${cur.trim()}. ${q}` : q))}
                  className="rounded-full border bg-background px-2.5 py-0.5 text-[11.5px] text-muted-foreground transition hover:border-primary hover:text-primary"
                >
                  {q}
                </button>
              ))}
              <span className="ml-auto text-[11px] text-muted-foreground">Enter gera · Shift+Enter nova linha</span>
            </div>
            {aiStatus && !aiReady(aiStatus) ? (
              <button type="button" onClick={() => setAiSetup(true)} className="mt-1.5 pl-6 text-left text-[11px] font-medium text-primary hover:underline">
                {aiStatus.job.state === "running" ? `Instalando a IA… ${aiStatus.job.step}` : "A IA ainda não está pronta neste computador — instalar a IA gratuita ou escolher outra em Configurações"}
              </button>
            ) : (
              <p className="mt-1.5 pl-6 text-[11px] text-muted-foreground">Nada é enviado sem a sua revisão.</p>
            )}
          </div>

          {/* Corpo */}
          <Textarea
            value={body}
            onChange={(e) => setBody(e.target.value)}
            placeholder="Escreva a mensagem…"
            className={cn(
              "w-full resize-none rounded-none border-0 px-4 py-3 font-[inherit] text-[14.5px] leading-relaxed shadow-none focus-visible:ring-0",
              kind === "whatsapp" ? "min-h-[14rem]" : "min-h-[22rem]",
            )}
          />
          {!!placeholders.length && (
            <p className="px-4 pb-2 text-xs text-amber-700 dark:text-amber-400">Completar: {placeholders.slice(0, 8).map((p) => `[${p}]`).join(" ")}</p>
          )}

          {kind !== "whatsapp" && !!attachments.length && (
            <div className="flex flex-wrap gap-2 px-4 pb-3">
              {attachments.map((a) => (
                <span key={a.path} className="flex max-w-[260px] items-center gap-1.5 rounded-lg border bg-secondary/50 px-2 py-1 text-xs">
                  <Paperclip className="size-3.5 shrink-0 text-muted-foreground" />
                  <span className="min-w-0 truncate">{a.name}</span>
                  <span className="shrink-0 text-muted-foreground">{formatBytes(a.size)}</span>
                  <button type="button" onClick={() => setAttachments((l) => l.filter((x) => x.path !== a.path))} aria-label="Remover anexo" className="shrink-0 text-muted-foreground hover:text-foreground">
                    <X className="size-3.5" />
                  </button>
                </span>
              ))}
            </div>
          )}

          {/* Opções: modelo, prazo e envio */}
          <div className="grid gap-3 border-t bg-secondary/30 px-4 py-3 sm:grid-cols-3">
            <div className="grid gap-1">
              <Label className="text-xs">Modelo</Label>
              <Select value={templateId} onValueChange={(v) => (v === NONE ? setTemplateId(NONE) : void applyTemplate(v))}>
                <SelectTrigger className="h-8"><SelectValue placeholder="Escolher modelo" /></SelectTrigger>
                <SelectContent>
                  <SelectItem value={NONE}>Sem modelo</SelectItem>
                  {kindTemplates.map((t) => <SelectItem key={t.id} value={t.id}>{t.name}</SelectItem>)}
                </SelectContent>
              </Select>
              <details className="text-[11px] text-muted-foreground">
                <summary className="cursor-pointer">Variáveis dos modelos</summary>
                <p className="mt-1">{TEMPLATE_VARIABLES.map((v) => `{{${v.key}}}`).join(" · ")}</p>
              </details>
            </div>
            <div className="grid gap-1">
              <Label className="text-xs">Prazo para o cliente (opcional)</Label>
              <Input type="date" className="h-8" value={deadline} onChange={(e) => setDeadline(e.target.value)} />
              <p className="text-[11px] text-muted-foreground">Vira uma tarefa no calendário.</p>
            </div>
            <div className="grid gap-1">
              <Label className="flex items-center gap-1.5 text-xs"><CalendarClock className="size-3.5" /> Envio</Label>
              <div className="flex flex-wrap gap-1">
                {(
                  [
                    ["now", kind === "oficio" ? "Gerar agora" : "Agora"],
                    ["schedule", "Agendar"],
                    ["draft", "Rascunho"],
                  ] as [SendMode, string][]
                ).map(([m, label]) => (
                  <button
                    key={m}
                    type="button"
                    onClick={() => setMode(m)}
                    className={cn("rounded-full px-3 py-1 text-xs transition", mode === m ? "bg-primary text-primary-foreground" : "bg-background hover:bg-accent")}
                  >
                    {label}
                  </button>
                ))}
              </div>
              {mode === "schedule" && <Input type="datetime-local" className="h-8" value={sendAt} onChange={(e) => setSendAt(e.target.value)} />}
            </div>
          </div>

          {kind === "email" && !account && (
            <div className="flex flex-wrap items-center gap-3 border-t bg-primary/5 px-4 py-2.5">
              <span className="min-w-0 flex-1 text-xs text-muted-foreground">
                <b className="text-foreground">Envie pelo seu Gmail, de dentro do Lex</b> — com anexos e agendamento. Sem isso, a mensagem abre no seu programa de e-mail.
              </span>
              {mailSetup?.googleAvailable ? (
                <Button type="button" size="sm" onClick={() => openOAuthWindow("google", { gmail: true })}>
                  <Mail /> Conectar meu Gmail
                </Button>
              ) : (
                <Link href="/configuracoes/email" className="text-xs text-primary underline">Configurar e-mail de envio</Link>
              )}
            </div>
          )}
        </div>

        {/* Barra inferior no estilo do Gmail */}
        <div className="flex flex-wrap items-center gap-2 border-t px-4 py-2.5">
          <Button onClick={() => void submit()} disabled={busy || save.isPending} className="rounded-full px-5">
            {busy ? <Loader2 className="animate-spin" /> : <Send />} {primaryLabel}
          </Button>
          {kind !== "whatsapp" && (
            <>
              <Button type="button" variant="ghost" size="icon-sm" onClick={() => fileInput.current?.click()} disabled={uploading} aria-label="Anexar arquivo" title="Anexar arquivo">
                {uploading ? <Loader2 className="animate-spin" /> : <Paperclip />}
              </Button>
              <input ref={fileInput} type="file" multiple hidden onChange={(e) => e.target.files?.length && void addFiles(Array.from(e.target.files))} />
            </>
          )}
          {kind === "email" && account && (
            <span className="flex min-w-0 items-center gap-1.5 truncate text-xs text-muted-foreground">
              <Mail className="size-3.5 shrink-0" /> por <b className="truncate font-medium text-foreground">{account}</b>
            </span>
          )}
          <div className="flex-1" />
          <Button variant="ghost" onClick={() => onOpenChange(false)}>Cancelar</Button>
        </div>
        <AiSetupDialog open={aiSetup} onOpenChange={setAiSetup} />
      </DialogContent>
    </Dialog>
  );
}
