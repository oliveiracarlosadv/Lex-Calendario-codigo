"use client";

import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { toast } from "sonner";
import type { CommunicationAttachment, CommunicationKind, CommunicationStatus } from "@/domain/communications/types";
import { useWorkspace } from "./use-workspace";
import { sb, syncEventOutbound, unwrap } from "./supabase";

export interface CommunicationRow {
  id: string;
  organization_id: string;
  kind: CommunicationKind;
  status: CommunicationStatus;
  client_id: string | null;
  contact_id?: string | null;
  process_id: string | null;
  event_id: string | null;
  template_id: string | null;
  to_email: string | null;
  to_phone: string | null;
  recipient_name: string | null;
  subject: string;
  body: string;
  deadline_at: string | null;
  send_at: string | null;
  sent_at: string | null;
  error: string | null;
  attachments: CommunicationAttachment[];
  generated_by_ai: boolean;
  created_by: string | null;
  created_at: string;
  updated_at: string;
  client?: { id: string; name: string } | null;
  process?: { id: string; title?: string | null; number: string | null } | null;
}

export interface TemplateRow {
  id: string;
  organization_id: string;
  name: string;
  kind: CommunicationKind;
  subject: string;
  body: string;
  is_default: boolean;
  updated_at: string;
}

const SELECT = "*, client:clients(id, name), process:processes(id, title, number)";

export function useCommunications(f: { clientId?: string; status?: CommunicationStatus | "all" } = {}) {
  const { organization } = useWorkspace();
  return useQuery({
    queryKey: ["communications", organization.id, f],
    queryFn: async () => {
      let q = sb().from("communications").select(SELECT).eq("organization_id", organization.id).order("created_at", { ascending: false }).limit(500);
      if (f.clientId) q = q.eq("client_id", f.clientId);
      if (f.status && f.status !== "all") q = q.eq("status", f.status);
      return unwrap(await q) as CommunicationRow[];
    },
  });
}

export function useCommunication(id: string | null) {
  return useQuery({
    queryKey: ["communication", id],
    enabled: !!id,
    queryFn: async () => unwrap(await sb().from("communications").select(SELECT).eq("id", id!).single()) as CommunicationRow,
  });
}

export function useTemplates() {
  const { organization } = useWorkspace();
  return useQuery({
    queryKey: ["communication-templates", organization.id],
    queryFn: async () =>
      unwrap(await sb().from("communication_templates").select("*").eq("organization_id", organization.id).order("kind").order("name")) as TemplateRow[],
  });
}

export function useSaveTemplate() {
  const qc = useQueryClient();
  const { organization, userId } = useWorkspace();
  return useMutation({
    mutationFn: async (t: Partial<TemplateRow> & { name: string; kind: CommunicationKind; subject: string; body: string }) => {
      const payload = { name: t.name, kind: t.kind, subject: t.subject, body: t.body, organization_id: organization.id };
      if (t.id) return unwrap(await sb().from("communication_templates").update(payload).eq("id", t.id).select("id").single());
      return unwrap(await sb().from("communication_templates").insert({ ...payload, created_by: userId }).select("id").single());
    },
    onSuccess: () => {
      toast.success("Modelo salvo");
      void qc.invalidateQueries({ queryKey: ["communication-templates"] });
    },
    onError: (e: Error) => toast.error(e.message.includes("duplicate") ? "Já existe um modelo com esse nome." : e.message),
  });
}

export function useDeleteTemplate() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: async (id: string) => unwrap(await sb().from("communication_templates").delete().eq("id", id).select("id")),
    onSuccess: () => void qc.invalidateQueries({ queryKey: ["communication-templates"] }),
  });
}

export type CommunicationDraft = Partial<CommunicationRow> & { kind: CommunicationKind; subject: string; body: string };

/**
 * Salva a comunicação. Com prazo, cria (ou atualiza) uma Tarefa no calendário ligada ao
 * cliente e ao processo — ela aparece no histórico do cliente e sincroniza com o Google.
 */
export function useSaveCommunication() {
  const qc = useQueryClient();
  const { organization, userId, categories } = useWorkspace();
  return useMutation({
    mutationFn: async (c: CommunicationDraft): Promise<CommunicationRow> => {
      const fields = {
        organization_id: organization.id,
        kind: c.kind,
        status: c.status ?? "draft",
        client_id: c.client_id ?? null,
        contact_id: c.contact_id ?? null,
        process_id: c.process_id ?? null,
        template_id: c.template_id ?? null,
        to_email: c.to_email?.trim() || null,
        to_phone: c.to_phone?.replace(/\D/g, "") || null,
        recipient_name: c.recipient_name?.trim() || null,
        subject: c.subject,
        body: c.body,
        deadline_at: c.deadline_at || null,
        send_at: c.send_at || null,
        attachments: c.attachments ?? [],
        generated_by_ai: !!c.generated_by_ai,
        error: null,
        notified_at: null,
      };
      const saved = (
        c.id
          ? unwrap(await sb().from("communications").update(fields).eq("id", c.id).select(SELECT).single())
          : unwrap(await sb().from("communications").insert({ ...fields, created_by: userId }).select(SELECT).single())
      ) as CommunicationRow;

      // Prazo → tarefa no calendário
      let eventId = saved.event_id;
      if (fields.deadline_at) {
        const day = fields.deadline_at.slice(0, 10);
        const task = {
          title: `Prazo: ${fields.subject || "comunicação"}${fields.recipient_name ? ` — ${fields.recipient_name}` : ""}`,
          starts_at: new Date(`${day}T09:00:00-03:00`).toISOString(),
          ends_at: new Date(`${day}T10:00:00-03:00`).toISOString(),
          all_day: false,
          client_id: fields.client_id,
          process_id: fields.process_id,
          description_text: `Prazo informado na comunicação (${fields.kind}) enviada ao cliente.\n\n${fields.body.slice(0, 1500)}`,
        };
        if (eventId) {
          await sb().from("events").update(task).eq("id", eventId);
        } else {
          const category = categories.find((k) => k.kind === "task");
          const ev = unwrap(
            await sb()
              .from("events")
              .insert({
                ...task,
                organization_id: organization.id,
                kind: "task",
                category_id: category?.id ?? null,
                priority: "high",
                status: "scheduled",
                source: "lex",
                created_by: userId,
                responsible_id: userId,
                timezone: "America/Sao_Paulo",
              })
              .select("id")
              .single(),
          ) as { id: string };
          eventId = ev.id;
          await sb().from("event_reminders").insert({ organization_id: organization.id, event_id: ev.id, user_id: userId, offset_minutes: 1440 });
          await sb().from("communications").update({ event_id: ev.id }).eq("id", saved.id);
        }
        syncEventOutbound(eventId);
      }
      return { ...saved, event_id: eventId };
    },
    onSuccess: () => {
      void qc.invalidateQueries({ queryKey: ["communications"] });
      void qc.invalidateQueries({ queryKey: ["client-history"] });
      void qc.invalidateQueries({ queryKey: ["events"] });
    },
  });
}

export function useUpdateCommunicationStatus() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: async ({ id, status }: { id: string; status: CommunicationStatus }) =>
      unwrap(
        await sb()
          .from("communications")
          .update({ status, ...(status === "sent" ? { sent_at: new Date().toISOString(), error: null } : {}) })
          .eq("id", id)
          .select("id"),
      ),
    onSuccess: () => {
      void qc.invalidateQueries({ queryKey: ["communications"] });
      void qc.invalidateQueries({ queryKey: ["client-history"] });
    },
  });
}

export function useDeleteCommunication() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: async (id: string) => unwrap(await sb().from("communications").delete().eq("id", id).select("id")),
    onSuccess: () => {
      toast.success("Comunicação excluída");
      void qc.invalidateQueries({ queryKey: ["communications"] });
      void qc.invalidateQueries({ queryKey: ["client-history"] });
    },
  });
}

export async function sendEmailNow(id: string) {
  const res = await fetch(`/api/comunicacoes/${id}/enviar`, { method: "POST" });
  const body = (await res.json().catch(() => ({}))) as { error?: string };
  if (!res.ok) throw new Error(body.error ?? "Falha no envio.");
}

export async function uploadCommunicationFile(orgId: string, file: File): Promise<CommunicationAttachment> {
  const safe = file.name.normalize("NFD").replace(/[̀-ͯ]/g, "").replace(/[^\w.-]+/g, "_");
  const path = `${orgId}/comunicacoes/${crypto.randomUUID()}-${safe}`;
  const up = await sb().storage.from("attachments").upload(path, file, { contentType: file.type || undefined, upsert: false });
  if (up.error) throw new Error(up.error.message);
  return { name: file.name, path, size: file.size, mime: file.type || "application/octet-stream" };
}

export async function downloadAttachment(path: string) {
  const { data } = await sb().storage.from("attachments").createSignedUrl(path, 120);
  if (data?.signedUrl) window.open(data.signedUrl, "_blank", "noopener");
}

export function useMailAccount() {
  return useQuery({
    queryKey: ["mail-account"],
    queryFn: async () => {
      const res = await fetch("/api/conta-email");
      if (!res.ok) throw new Error();
      return (await res.json()) as MailSetup;
    },
  });
}

export interface MailSetup {
  account: MailAccount | null;
  gmail: { email: string | null; replies?: boolean } | null;
  googleEmail: string | null;
  googleAvailable: boolean;
}

/** Por onde os e-mails aos clientes saem (Gmail tem prioridade). */
export function mailSenderLabel(s: MailSetup | undefined): string | null {
  if (!s) return null;
  if (s.gmail) return `Gmail (${s.gmail.email ?? "conta Google"})`;
  if (s.account) return s.account.from_email;
  return null;
}

export interface MailAccount {
  id: string;
  host: string;
  port: number;
  secure: boolean;
  username: string;
  from_name: string | null;
  from_email: string;
  last_test_at: string | null;
  last_error: string | null;
}
