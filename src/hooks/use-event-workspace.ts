"use client";

import { useEffect } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { toast } from "sonner";
import type { NotificationChannel } from "@/domain/events/types";
import { publicEnv } from "@/lib/env";
import type { ActivityRow, AttachmentRow, ChecklistRow, CommentRow, ReminderRow } from "@/types/db";
import { useWorkspace } from "./use-workspace";
import { sb, syncEventOutbound, unwrap } from "./supabase";

// ─────────────────────────── Checklist ───────────────────────────
export function useChecklist(eventId: string) {
  return useQuery({
    queryKey: ["checklist", eventId],
    queryFn: async () =>
      unwrap(await sb().from("event_checklist_items").select("*").eq("event_id", eventId).order("position")) as ChecklistRow[],
  });
}

export function useChecklistMutations(eventId: string) {
  const qc = useQueryClient();
  const { organization, userId } = useWorkspace();
  const key = ["checklist", eventId];
  const refresh = () => {
    void qc.invalidateQueries({ queryKey: key });
    void qc.invalidateQueries({ queryKey: ["events"] });
    syncEventOutbound(eventId);
  };

  const add = useMutation({
    mutationFn: async (title: string) => {
      const items = qc.getQueryData<ChecklistRow[]>(key) ?? [];
      unwrap(
        await sb()
          .from("event_checklist_items")
          .insert({ organization_id: organization.id, event_id: eventId, title, position: items.length })
          .select("id")
          .single(),
      );
    },
    onSuccess: refresh,
  });

  const toggle = useMutation({
    mutationFn: async (item: ChecklistRow) => {
      unwrap(
        await sb()
          .from("event_checklist_items")
          .update({ is_done: !item.is_done, done_at: item.is_done ? null : new Date().toISOString(), done_by: item.is_done ? null : userId })
          .eq("id", item.id)
          .select("id")
          .single(),
      );
    },
    onMutate: async (item) => {
      await qc.cancelQueries({ queryKey: key });
      const prev = qc.getQueryData<ChecklistRow[]>(key);
      qc.setQueryData<ChecklistRow[]>(key, (rows) => rows?.map((r) => (r.id === item.id ? { ...r, is_done: !r.is_done } : r)));
      return { prev };
    },
    onError: (_e, _v, ctx) => ctx?.prev && qc.setQueryData(key, ctx.prev),
    onSettled: refresh,
  });

  const rename = useMutation({
    mutationFn: async ({ id, title }: { id: string; title: string }) => {
      unwrap(await sb().from("event_checklist_items").update({ title }).eq("id", id).select("id").single());
    },
    onSuccess: refresh,
  });

  const remove = useMutation({
    mutationFn: async (id: string) => {
      unwrap(await sb().from("event_checklist_items").delete().eq("id", id));
    },
    onSuccess: refresh,
  });

  const reorder = useMutation({
    mutationFn: async (ordered: ChecklistRow[]) => {
      qc.setQueryData(key, ordered.map((r, i) => ({ ...r, position: i })));
      await Promise.all(ordered.map((r, i) => sb().from("event_checklist_items").update({ position: i }).eq("id", r.id)));
    },
    onSettled: refresh,
  });

  return { add, toggle, rename, remove, reorder };
}

// ─────────────────────────── Lembretes ───────────────────────────
export function useReminders(eventId: string) {
  const { userId } = useWorkspace();
  return useQuery({
    queryKey: ["reminders", eventId, userId],
    queryFn: async () =>
      unwrap(
        await sb().from("event_reminders").select("*").eq("event_id", eventId).eq("user_id", userId).order("offset_minutes", { ascending: false }),
      ) as ReminderRow[],
  });
}

export function useReminderMutations(eventId: string) {
  const qc = useQueryClient();
  const { organization, userId } = useWorkspace();
  const refresh = () => {
    syncEventOutbound(eventId);
    return qc.invalidateQueries({ queryKey: ["reminders", eventId] });
  };

  const add = useMutation({
    mutationFn: async ({ minutes, channels }: { minutes: number; channels: NotificationChannel[] }) => {
      unwrap(
        await sb()
          .from("event_reminders")
          .upsert(
            { organization_id: organization.id, event_id: eventId, user_id: userId, offset_minutes: minutes, channels },
            { onConflict: "event_id,user_id,offset_minutes" },
          )
          .select("id"),
      );
    },
    onSuccess: refresh,
    onError: (e) => toast.error("Não foi possível adicionar o lembrete", { description: (e as Error).message }),
  });

  const updateChannels = useMutation({
    mutationFn: async ({ id, channels }: { id: string; channels: NotificationChannel[] }) => {
      unwrap(await sb().from("event_reminders").update({ channels }).eq("id", id).select("id"));
    },
    onSuccess: refresh,
  });

  const remove = useMutation({
    mutationFn: async (id: string) => {
      unwrap(await sb().from("event_reminders").delete().eq("id", id));
    },
    onSuccess: refresh,
  });

  return { add, updateChannels, remove };
}

// ─────────────────────────── Anexos ───────────────────────────
export const ACCEPTED_FILES =
  ".pdf,.doc,.docx,.xls,.xlsx,.ppt,.pptx,.odt,.rtf,.txt,.csv,.ics,.png,.jpg,.jpeg,.webp,.heic,.gif,.mp3,.m4a,.mp4,.zip,.eml,.msg";

export function useAttachments(scope: { eventId?: string; processId?: string; clientId?: string }) {
  const column = scope.eventId ? "event_id" : scope.processId ? "process_id" : "client_id";
  const value = scope.eventId ?? scope.processId ?? scope.clientId ?? "";
  return useQuery({
    queryKey: ["attachments", column, value],
    enabled: !!value,
    queryFn: async () =>
      unwrap(await sb().from("event_attachments").select("*").eq(column, value).order("created_at", { ascending: false })) as AttachmentRow[],
  });
}

export function useAttachmentMutations(scope: { eventId?: string; processId?: string; clientId?: string }) {
  const qc = useQueryClient();
  const { organization, userId } = useWorkspace();
  const refresh = () => {
    if (scope.eventId) syncEventOutbound(scope.eventId);
    return qc.invalidateQueries({ queryKey: ["attachments"] });
  };
  const entity = scope.eventId ? "events" : scope.processId ? "processes" : "clients";
  const entityId = scope.eventId ?? scope.processId ?? scope.clientId ?? "";

  const upload = useMutation({
    mutationFn: async (files: File[]) => {
      for (const file of files) {
        if (file.size > 50 * 1024 * 1024) throw new Error(`${file.name}: limite de 50 MB`);
        const safe = file.name.normalize("NFD").replace(/[^\w.\-]+/g, "_");
        const path = `${organization.id}/${entity}/${entityId}/${crypto.randomUUID()}-${safe}`;
        const up = await sb().storage.from("attachments").upload(path, file, { contentType: file.type || undefined, upsert: false });
        if (up.error) throw new Error(up.error.message);
        unwrap(
          await sb()
            .from("event_attachments")
            .insert({
              organization_id: organization.id,
              event_id: scope.eventId ?? null,
              process_id: scope.processId ?? null,
              client_id: scope.clientId ?? null,
              storage_path: path,
              file_name: file.name,
              mime_type: file.type || "application/octet-stream",
              size_bytes: file.size,
              uploaded_by: userId,
            })
            .select("id"),
        );
      }
    },
    onSuccess: () => {
      void refresh();
      toast.success("Arquivo anexado");
    },
    onError: (e) => toast.error("Falha no envio", { description: (e as Error).message }),
  });

  const remove = useMutation({
    mutationFn: async (a: AttachmentRow) => {
      await sb().storage.from("attachments").remove([a.storage_path]);
      unwrap(await sb().from("event_attachments").delete().eq("id", a.id));
    },
    onSuccess: refresh,
  });

  return { upload, remove };
}

export async function openAttachment(a: AttachmentRow) {
  const { data, error } = await sb().storage.from("attachments").createSignedUrl(a.storage_path, 300, { download: false });
  if (error || !data) return toast.error("Não foi possível abrir o arquivo");
  window.open(data.signedUrl, "_blank", "noopener");
}

// ─────────────────────────── Comentários ───────────────────────────
export function useComments(eventId: string) {
  const qc = useQueryClient();
  useEffect(() => {
    if (publicEnv.localMode) return;
    const ch = sb()
      .channel(`comments:${eventId}`)
      .on("postgres_changes", { event: "*", schema: "public", table: "event_comments", filter: `event_id=eq.${eventId}` }, () =>
        qc.invalidateQueries({ queryKey: ["comments", eventId] }),
      )
      .subscribe();
    return () => {
      void sb().removeChannel(ch);
    };
  }, [eventId, qc]);

  return useQuery({
    queryKey: ["comments", eventId],
    queryFn: async () =>
      unwrap(
        await sb().from("event_comments").select("*").eq("event_id", eventId).order("created_at"),
      ) as CommentRow[],
  });
}

export function useCommentMutations(eventId: string) {
  const qc = useQueryClient();
  const { organization, userId } = useWorkspace();
  const refresh = () => {
    syncEventOutbound(eventId);
    return qc.invalidateQueries({ queryKey: ["comments", eventId] });
  };
  const add = useMutation({
    mutationFn: async (input: string | { body: string; email?: boolean }) => {
      const { body, email } = typeof input === "string" ? { body: input, email: false } : input;
      const rows = unwrap(
        await sb().from("event_comments").insert({ organization_id: organization.id, event_id: eventId, author_id: userId, body }).select("id"),
      ) as { id: string }[];
      // Comentário novo por e-mail aos convidados e ao responsável da tarefa
      if (email && rows[0]?.id) {
        const res = await fetch(`/api/events/${eventId}/comentario-email`, {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ commentId: rows[0].id }),
        }).catch(() => null);
        const r = (await res?.json().catch(() => ({}))) as { sent?: number; reason?: string; error?: string } | undefined;
        if (res?.ok && r?.sent) toast.success(`Comentário enviado por e-mail a ${r.sent} pessoa(s)`);
        else if (r?.reason === "no-sender") toast.info("Comentário salvo", { description: "Para enviá-lo por e-mail, conecte seu Gmail em Configurações → E-mail de envio." });
        else if (res && !res.ok) toast.error("Comentário salvo, mas o e-mail falhou", { description: r?.error });
      }
    },
    onSuccess: refresh,
    onError: (e) => toast.error("Comentário não enviado", { description: (e as Error).message }),
  });
  const remove = useMutation({
    mutationFn: async (id: string) => {
      unwrap(await sb().from("event_comments").delete().eq("id", id));
    },
    onSuccess: refresh,
  });
  return { add, remove };
}

// ─────────────────────────── Histórico ───────────────────────────
export function useActivity(entity: { type: "event" | "client" | "process"; id: string }) {
  return useQuery({
    queryKey: ["activity", entity.id],
    queryFn: async () =>
      unwrap(
        await sb()
          .from("activity_log")
          .select("*")
          .or(`and(entity_type.eq.${entity.type},entity_id.eq.${entity.id}),and(parent_type.eq.${entity.type},parent_id.eq.${entity.id})`)
          .order("created_at", { ascending: false })
          .limit(100),
      ) as ActivityRow[],
  });
}
