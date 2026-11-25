"use client";

import { useEffect, useState } from "react";
import { useQueryClient } from "@tanstack/react-query";
import Link from "next/link";
import { CheckCircle2, Copy, FileText, Mail, MessageCircle, MoreHorizontal, Pencil, Plus, Send, Trash2, Upload, XCircle } from "lucide-react";
import { toast } from "sonner";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Dialog, DialogContent, DialogFooter, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { DropdownMenu, DropdownMenuContent, DropdownMenuItem, DropdownMenuSeparator, DropdownMenuTrigger } from "@/components/ui/dropdown-menu";
import { EmptyState } from "@/components/ui/empty-state";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Skeleton } from "@/components/ui/skeleton";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { Textarea } from "@/components/ui/textarea";
import { PageHeader } from "@/components/layout/app-shell";
import {
  COMMUNICATION_KIND_LABELS,
  COMMUNICATION_STATUS_LABELS,
  TEMPLATE_VARIABLES,
  type CommunicationKind,
  type CommunicationStatus,
} from "@/domain/communications/types";
import {
  downloadAttachment,
  sendEmailNow,
  useCommunication,
  useCommunications,
  useDeleteCommunication,
  useDeleteTemplate,
  useMailAccount,
  useSaveTemplate,
  useTemplates,
  useUpdateCommunicationStatus,
  type CommunicationRow,
  type TemplateRow,
} from "@/hooks/use-communications";
import { formatDay, formatDateTime } from "@/lib/utils";
import { CommunicationDialog } from "./communication-dialog";
import { AiSettings } from "@/components/settings/ai-settings";
import { AiSetupCard, aiReady, useAiStatus } from "./ai-setup";
import { openOAuthWindow } from "@/lib/oauth-popup";
import { processLabel } from "@/domain/processes/types";
import { LinkClientButton } from "@/components/processes/link-client-button";

const KIND_ICON = { email: Mail, oficio: FileText, whatsapp: MessageCircle } as const;
const STATUS_VARIANT: Record<CommunicationStatus, "secondary" | "default" | "success" | "destructive" | "outline"> = {
  draft: "secondary",
  scheduled: "default",
  sent: "success",
  failed: "destructive",
  cancelled: "outline",
};

export function CommunicationsPage({ openId, clientId }: { openId: string | null; clientId: string | null }) {
  const [status, setStatus] = useState<CommunicationStatus | "all">("all");
  const [composer, setComposer] = useState<{ initial?: Partial<CommunicationRow> } | null>(clientId ? { initial: { client_id: clientId } } : null);
  const { data: opened } = useCommunication(openId);

  useEffect(() => {
    if (opened) setComposer({ initial: opened });
  }, [opened]);

  return (
    <div>
      <PageHeader
        title="Comunicações"
        description="E-mails, ofícios e mensagens aos clientes — com modelos, IA, prazo e envio agendado."
        actions={<Button onClick={() => setComposer({})}><Plus /> Nova comunicação</Button>}
      />
      <div className="p-4 md:p-8">
        <Tabs defaultValue="lista">
          <TabsList>
            <TabsTrigger value="lista">Comunicações</TabsTrigger>
            <TabsTrigger value="modelos">Modelos</TabsTrigger>
            <TabsTrigger value="ia">IA gratuita</TabsTrigger>
          </TabsList>
          <TabsContent value="lista" className="mt-4 space-y-4">
            <MailNotice />
            <AiNotice />
            <div className="flex flex-wrap gap-1">
              {(["all", "scheduled", "draft", "sent", "failed"] as const).map((s) => (
                <button
                  key={s}
                  onClick={() => setStatus(s)}
                  className={`rounded-full px-3 py-1 text-xs transition ${status === s ? "bg-primary text-primary-foreground" : "bg-secondary hover:bg-accent"}`}
                >
                  {s === "all" ? "Todas" : COMMUNICATION_STATUS_LABELS[s]}
                </button>
              ))}
            </div>
            <CommunicationList status={status} onEdit={(c) => setComposer({ initial: c })} />
          </TabsContent>
          <TabsContent value="modelos" className="mt-4">
            <TemplatesManager />
          </TabsContent>
          <TabsContent value="ia" className="mt-4 max-w-3xl">
            <AiSettings />
          </TabsContent>
        </Tabs>
      </div>
      {composer && (
        <CommunicationDialog
          key={composer.initial?.id ?? "nova"}
          open
          onOpenChange={(o) => !o && setComposer(null)}
          initial={composer.initial}
        />
      )}
    </div>
  );
}

/** Lista de comunicações (também usada na página do cliente). */
export function CommunicationList({
  status = "all",
  clientId,
  onEdit,
  compact,
}: {
  status?: CommunicationStatus | "all";
  clientId?: string;
  onEdit: (c: CommunicationRow) => void;
  compact?: boolean;
}) {
  const { data, isLoading } = useCommunications({ status, clientId });
  const setStatus = useUpdateCommunicationStatus();
  const remove = useDeleteCommunication();
  const qc = useQueryClient();
  const [sending, setSending] = useState<string | null>(null);

  async function sendNow(c: CommunicationRow) {
    setSending(c.id);
    try {
      await sendEmailNow(c.id);
      toast.success("E-mail enviado");
    } catch (e) {
      toast.error("Falha no envio", { description: (e as Error).message, duration: 10_000 });
    } finally {
      setSending(null);
      void qc.invalidateQueries({ queryKey: ["communications"] });
      void qc.invalidateQueries({ queryKey: ["client-history"] });
    }
  }

  if (isLoading) return <div className="space-y-2">{Array.from({ length: 3 }).map((_, i) => <Skeleton key={i} className="h-14" />)}</div>;
  if (!data?.length) {
    return compact ? (
      <p className="py-4 text-center text-sm text-muted-foreground">Nenhuma comunicação.</p>
    ) : (
      <EmptyState icon={Send} title="Nenhuma comunicação" description="Envie e-mails, ofícios e mensagens de WhatsApp aos clientes, com prazo e data de envio." />
    );
  }

  return (
    <div className={compact ? "space-y-1" : "overflow-hidden rounded-2xl border"}>
      {data.map((c) => {
        const Icon = KIND_ICON[c.kind];
        return (
          <div key={c.id} className={`flex items-center gap-3 px-3 py-2.5 ${compact ? "rounded-xl hover:bg-accent/60" : "border-t first:border-t-0 hover:bg-accent/40"}`}>
            <Icon className="size-4 shrink-0 text-muted-foreground" />
            <button className="min-w-0 flex-1 text-left" onClick={() => onEdit(c)}>
              <span className="flex flex-wrap items-center gap-2">
                <span className="truncate text-sm font-medium">{c.subject || COMMUNICATION_KIND_LABELS[c.kind]}</span>
                <Badge variant={STATUS_VARIANT[c.status]} className="text-[11px]">{COMMUNICATION_STATUS_LABELS[c.status]}</Badge>
                {c.generated_by_ai && <Badge variant="outline" className="text-[11px]">IA</Badge>}
                {!!c.attachments?.length && <span className="text-[11px] text-muted-foreground">{c.attachments.length} anexo(s)</span>}
              </span>
              <span className="block truncate text-xs text-muted-foreground">
                {[
                  !compact && c.client?.name,
                  c.recipient_name && c.recipient_name !== c.client?.name ? c.recipient_name : null,
                  c.to_email ?? (c.to_phone ? `WhatsApp ${c.to_phone}` : null),
                  c.status === "sent" && c.sent_at ? `enviada ${formatDateTime(c.sent_at)}` : null,
                  c.status === "scheduled" && c.send_at ? `envio ${formatDateTime(c.send_at)}` : null,
                  c.deadline_at ? `prazo ${formatDay(c.deadline_at)}` : null,
                  c.process ? processLabel(c.process) : null,
                ]
                  .filter(Boolean)
                  .join(" · ")}
              </span>
              {c.status === "failed" && c.error && <span className="block text-xs text-destructive">{c.error}</span>}
            </button>
            <LinkClientButton processId={c.process_id} size="xs" />
            <DropdownMenu>
              <DropdownMenuTrigger asChild>
                <Button variant="ghost" size="icon-sm" aria-label="Ações"><MoreHorizontal /></Button>
              </DropdownMenuTrigger>
              <DropdownMenuContent align="end" className="w-56">
                <DropdownMenuItem onClick={() => onEdit(c)}><Pencil /> Abrir / editar</DropdownMenuItem>
                {c.kind === "email" && c.status !== "sent" && (
                  <DropdownMenuItem disabled={sending === c.id} onClick={() => void sendNow(c)}><Send /> Enviar agora</DropdownMenuItem>
                )}
                {c.kind !== "email" && (
                  <DropdownMenuItem asChild>
                    <a href={`/api/comunicacoes/${c.id}/documento`} target="_blank" rel="noreferrer"><FileText /> Documento para imprimir / PDF</a>
                  </DropdownMenuItem>
                )}
                <DropdownMenuItem asChild>
                  <a href={`/api/comunicacoes/${c.id}/documento?formato=doc`} download><FileText /> Baixar para Word</a>
                </DropdownMenuItem>
                <DropdownMenuItem
                  onClick={() => void navigator.clipboard.writeText(`${c.subject ? `${c.subject}\n\n` : ""}${c.body}`).then(() => toast.success("Texto copiado"))}
                >
                  <Copy /> Copiar texto
                </DropdownMenuItem>
                {c.attachments?.map((a) => (
                  <DropdownMenuItem key={a.path} onClick={() => void downloadAttachment(a.path)}><Upload className="rotate-180" /> {a.name}</DropdownMenuItem>
                ))}
                <DropdownMenuSeparator />
                {c.status !== "sent" && (
                  <DropdownMenuItem onClick={() => setStatus.mutate({ id: c.id, status: "sent" })}><CheckCircle2 /> Marcar como enviada / entregue</DropdownMenuItem>
                )}
                {c.status === "scheduled" && (
                  <DropdownMenuItem onClick={() => setStatus.mutate({ id: c.id, status: "cancelled" })}><XCircle /> Cancelar agendamento</DropdownMenuItem>
                )}
                {c.event_id && (
                  <DropdownMenuItem asChild>
                    <Link href={`/eventos/${c.event_id}`}><CheckCircle2 /> Ver tarefa do prazo</Link>
                  </DropdownMenuItem>
                )}
                <DropdownMenuItem destructive onClick={() => confirm("Excluir esta comunicação?") && remove.mutate(c.id)}><Trash2 /> Excluir</DropdownMenuItem>
              </DropdownMenuContent>
            </DropdownMenu>
          </div>
        );
      })}
    </div>
  );
}

// ───────────────────────────── Modelos ─────────────────────────────

function TemplatesManager() {
  const { data: templates, isLoading } = useTemplates();
  const remove = useDeleteTemplate();
  const [editing, setEditing] = useState<Partial<TemplateRow> | null>(null);

  return (
    <Card>
      <CardHeader className="flex-row items-start justify-between gap-4">
        <div>
          <CardTitle>Modelos de comunicação</CardTitle>
          <CardDescription>Textos prontos com variáveis como {"{{cliente}}"} e {"{{processo}}"}, preenchidas automaticamente.</CardDescription>
        </div>
        <Button size="sm" onClick={() => setEditing({ kind: "email", name: "", subject: "", body: "" })}><Plus /> Novo modelo</Button>
      </CardHeader>
      <CardContent className="space-y-1">
        {isLoading && <Skeleton className="h-24" />}
        {templates?.map((t) => {
          const Icon = KIND_ICON[t.kind];
          return (
            <div key={t.id} className="flex items-center gap-3 rounded-xl px-2 py-2 hover:bg-accent/60">
              <Icon className="size-4 text-muted-foreground" />
              <button className="min-w-0 flex-1 text-left" onClick={() => setEditing(t)}>
                <span className="block text-sm font-medium">{t.name}</span>
                <span className="block truncate text-xs text-muted-foreground">{COMMUNICATION_KIND_LABELS[t.kind]} · {t.subject}</span>
              </button>
              <Button variant="ghost" size="icon-sm" aria-label="Excluir modelo" onClick={() => confirm(`Excluir o modelo “${t.name}”?`) && remove.mutate(t.id)}>
                <Trash2 />
              </Button>
            </div>
          );
        })}
      </CardContent>
      {editing && <TemplateDialog initial={editing} onClose={() => setEditing(null)} />}
    </Card>
  );
}

function TemplateDialog({ initial, onClose }: { initial: Partial<TemplateRow>; onClose: () => void }) {
  const save = useSaveTemplate();
  const [name, setName] = useState(initial.name ?? "");
  const [kind, setKind] = useState<CommunicationKind>(initial.kind ?? "email");
  const [subject, setSubject] = useState(initial.subject ?? "");
  const [body, setBody] = useState(initial.body ?? "");

  async function importFile(file: File) {
    if (!/\.(txt|md|html?)$/i.test(file.name)) return toast.error("Importe um arquivo de texto (.txt) ou HTML. Para Word, copie e cole o texto.");
    let text = await file.text();
    if (/\.html?$/i.test(file.name)) {
      const doc = new DOMParser().parseFromString(text, "text/html");
      text = doc.body.innerText;
    }
    setBody(text.trim());
    if (!name) setName(file.name.replace(/\.[^.]+$/, ""));
  }

  return (
    <Dialog open onOpenChange={(o) => !o && onClose()}>
      <DialogContent className="max-h-[92dvh] max-w-2xl overflow-y-auto">
        <DialogHeader>
          <DialogTitle>{initial.id ? "Editar modelo" : "Novo modelo"}</DialogTitle>
        </DialogHeader>
        <div className="space-y-3">
          <div className="grid gap-3 sm:grid-cols-[1fr_180px]">
            <div className="grid gap-1.5">
              <Label>Nome</Label>
              <Input value={name} onChange={(e) => setName(e.target.value)} placeholder="Ex.: Convocação para assinatura" />
            </div>
            <div className="grid gap-1.5">
              <Label>Tipo</Label>
              <Select value={kind} onValueChange={(v) => setKind(v as CommunicationKind)}>
                <SelectTrigger><SelectValue /></SelectTrigger>
                <SelectContent>
                  {(Object.keys(COMMUNICATION_KIND_LABELS) as CommunicationKind[]).map((k) => <SelectItem key={k} value={k}>{COMMUNICATION_KIND_LABELS[k]}</SelectItem>)}
                </SelectContent>
              </Select>
            </div>
          </div>
          <div className="grid gap-1.5">
            <Label>Assunto</Label>
            <Input value={subject} onChange={(e) => setSubject(e.target.value)} />
          </div>
          <div className="grid gap-1.5">
            <div className="flex items-center justify-between">
              <Label>Texto</Label>
              <label className="cursor-pointer text-xs text-primary hover:underline">
                Importar de arquivo (.txt, .html)
                <input type="file" accept=".txt,.md,.html,.htm" hidden onChange={(e) => e.target.files?.[0] && void importFile(e.target.files[0])} />
              </label>
            </div>
            <Textarea value={body} onChange={(e) => setBody(e.target.value)} rows={14} />
          </div>
          <div className="flex flex-wrap gap-1">
            {TEMPLATE_VARIABLES.map((v) => (
              <button
                key={v.key}
                type="button"
                title={v.label}
                onClick={() => setBody((b) => `${b}{{${v.key}}}`)}
                className="rounded-md bg-secondary px-2 py-0.5 font-mono text-[11px] hover:bg-accent"
              >
                {`{{${v.key}}}`}
              </button>
            ))}
          </div>
        </div>
        <DialogFooter>
          <Button variant="ghost" onClick={onClose}>Cancelar</Button>
          <Button
            disabled={!name.trim() || !body.trim() || save.isPending}
            onClick={() => save.mutate({ id: initial.id, name: name.trim(), kind, subject, body }, { onSuccess: onClose })}
          >
            Salvar modelo
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

/** Aviso discreto quando a IA gratuita ainda não está pronta neste computador. */
function AiNotice() {
  const { data } = useAiStatus();
  if (!data || aiReady(data)) return null;
  return <AiSetupCard compact />;
}

/** Convite para enviar pelo Gmail de dentro do Lex, enquanto nenhum e-mail de envio estiver conectado. */
function MailNotice() {
  const { data } = useMailAccount();
  if (!data || data.gmail || data.account || !data.googleAvailable) return null;
  return (
    <div className="flex flex-wrap items-center gap-3 rounded-2xl border border-primary/30 bg-primary/5 p-4">
      <Mail className="size-5 text-primary" />
      <p className="min-w-0 flex-1 text-sm">
        <b>Envie as comunicações pelo seu Gmail, de dentro do Lex</b> — com anexos e agendamento. Um clique para autorizar, sem senha.
      </p>
      <Button onClick={() => openOAuthWindow("google", { gmail: true })}><Mail /> Conectar meu Gmail</Button>
    </div>
  );
}
