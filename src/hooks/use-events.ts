"use client";

import { useEffect } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { toast } from "sonner";
import { defaultRemindersFor } from "@/domain/events/rules";
import { publicEnv } from "@/lib/env";
import type { EventRow } from "@/types/db";
import { useWorkspace } from "./use-workspace";
import { sb, syncEventOutbound, unwrap } from "./supabase";

const EVENT_LIST_COLUMNS =
  "id, organization_id, title, kind, category_id, starts_at, ends_at, all_day, location, meeting_url, hearing_mode, client_id, process_id, tribunal, responsible_id, priority, status, completed_at, color, is_private, source, created_by, recurrence_rule, client:clients(id, name), process:processes(id, title, number), checklist:event_checklist_items(is_done)";

export const eventKeys = {
  all: ["events"] as const,
  range: (org: string, start: string, end: string) => ["events", org, start, end] as const,
  detail: (id: string) => ["event", id] as const,
};

export function useEventsInRange(start: string | null, end: string | null) {
  const { organization } = useWorkspace();
  return useQuery({
    queryKey: eventKeys.range(organization.id, start ?? "", end ?? ""),
    enabled: !!start && !!end,
    placeholderData: (prev) => prev,
    // Modo local (sem tempo real): atualiza a cada 30 s para refletir a sincronização com o Google
    refetchInterval: publicEnv.localMode ? 30_000 : false,
    queryFn: async () =>
      unwrap(
        await sb()
          .from("events")
          .select(EVENT_LIST_COLUMNS)
          .eq("organization_id", organization.id)
          .is("deleted_at", null)
          .lt("starts_at", end!)
          .gte("ends_at", start!)
          .order("starts_at")
          .limit(2000),
      ) as unknown as EventRow[],
  });
}

export function useEvent(id: string) {
  return useQuery({
    queryKey: eventKeys.detail(id),
    queryFn: async () =>
      unwrap(
        await sb()
          .from("events")
          .select("*, client:clients(id, name, phone, email), process:processes(id, title, number, tribunal, court_division)")
          .eq("id", id)
          .single(),
      ) as unknown as EventRow,
  });
}

export function useUpcomingEvents(days = 30, pastDays = 60) {
  const { organization } = useWorkspace();
  return useQuery({
    queryKey: ["events", organization.id, "upcoming", days, pastDays],
    refetchInterval: publicEnv.localMode ? 30_000 : false,
    queryFn: async () => {
      const now = new Date();
      const from = new Date(now.getTime() - pastDays * 864e5).toISOString();
      const to = new Date(now.getTime() + days * 864e5).toISOString();
      return unwrap(
        await sb()
          .from("events")
          .select(EVENT_LIST_COLUMNS)
          .eq("organization_id", organization.id)
          .is("deleted_at", null)
          .gte("starts_at", from)
          .lte("starts_at", to)
          .order("starts_at")
          .limit(1000),
      ) as unknown as EventRow[];
    },
  });
}

export type EventInput = Partial<Omit<EventRow, "id" | "organization_id" | "created_at" | "updated_at" | "client" | "process" | "checklist">>;

export function useCreateEvent() {
  const qc = useQueryClient();
  const { organization, userId, profile } = useWorkspace();
  return useMutation({
    mutationFn: async (input: EventInput & { title: string; starts_at: string; ends_at: string; reminders?: number[] }) => {
      const { reminders, ...fields } = input;
      const row = unwrap(
        await sb()
          .from("events")
          .insert({
            organization_id: organization.id,
            created_by: userId,
            responsible_id: fields.responsible_id ?? userId,
            timezone: profile.timezone ?? "America/Sao_Paulo",
            ...fields,
          })
          .select("id, kind")
          .single(),
      ) as { id: string; kind: EventRow["kind"] };
      const offsets = reminders ?? defaultRemindersFor(row.kind);
      if (offsets.length) {
        await sb()
          .from("event_reminders")
          .insert(offsets.map((m) => ({ organization_id: organization.id, event_id: row.id, user_id: fields.responsible_id ?? userId, offset_minutes: m })));
      }
      return row;
    },
    onSuccess: (row) => {
      syncEventOutbound(row.id);
      void qc.invalidateQueries({ queryKey: eventKeys.all });
    },
    onError: (e) => toast.error("Não foi possível criar o compromisso", { description: (e as Error).message }),
  });
}

export function useUpdateEvent() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: async ({ id, ...patch }: EventInput & { id: string }) => {
      unwrap(await sb().from("events").update(patch).eq("id", id).select("id").single());
      return id;
    },
    onMutate: async ({ id, ...patch }) => {
      await qc.cancelQueries({ queryKey: eventKeys.detail(id) });
      const prev = qc.getQueryData<EventRow>(eventKeys.detail(id));
      if (prev) qc.setQueryData(eventKeys.detail(id), { ...prev, ...patch });
      return { prev };
    },
    onError: (e, vars, ctx) => {
      if (ctx?.prev) qc.setQueryData(eventKeys.detail(vars.id), ctx.prev);
      toast.error("Não foi possível salvar", { description: (e as Error).message });
    },
    onSuccess: (id) => {
      syncEventOutbound(id);
      void qc.invalidateQueries({ queryKey: eventKeys.all });
      void qc.invalidateQueries({ queryKey: ["activity", id] });
    },
  });
}

/** Exclusão lógica (lixeira) — mantém o histórico e permite restaurar. */
export function useDeleteEvent() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: async (id: string) => {
      unwrap(await sb().from("events").update({ deleted_at: new Date().toISOString() }).eq("id", id).select("id").single());
      return id;
    },
    onSuccess: (id) => {
      syncEventOutbound(id);
      void qc.invalidateQueries({ queryKey: eventKeys.all });
    },
    onError: (e) => toast.error("Não foi possível excluir", { description: (e as Error).message }),
  });
}

export function useRestoreEvent() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: async (id: string) => {
      unwrap(await sb().from("events").update({ deleted_at: null }).eq("id", id).select("id").single());
      return id;
    },
    onSuccess: (id) => {
      syncEventOutbound(id);
      void qc.invalidateQueries({ queryKey: eventKeys.all });
    },
  });
}

/** Atualizações em tempo real dos eventos da organização. */
export function useEventsRealtime() {
  const qc = useQueryClient();
  const { organization } = useWorkspace();
  useEffect(() => {
    if (publicEnv.localMode) return; // modo local: sem servidor de tempo real
    const channel = sb()
      .channel(`events:${organization.id}`)
      .on(
        "postgres_changes",
        { event: "*", schema: "public", table: "events", filter: `organization_id=eq.${organization.id}` },
        (payload: { new: unknown; old: unknown }) => {
          void qc.invalidateQueries({ queryKey: eventKeys.all });
          const id = (payload.new as { id?: string })?.id ?? (payload.old as { id?: string })?.id;
          if (id) void qc.invalidateQueries({ queryKey: eventKeys.detail(id) });
        },
      )
      .subscribe();
    return () => {
      void sb().removeChannel(channel);
    };
  }, [qc, organization.id]);
}

/** Próximas audiências (a partir de hoje), para o destaque do painel. */
export function useUpcomingHearings(limit = 6) {
  const { organization } = useWorkspace();
  return useQuery({
    queryKey: ["events", organization.id, "hearings", limit],
    refetchInterval: 60_000,
    queryFn: async () => {
      const startOfToday = new Date(`${new Date().toLocaleDateString("en-CA", { timeZone: "America/Sao_Paulo" })}T00:00:00-03:00`).toISOString();
      return unwrap(
        await sb()
          .from("events")
          .select(EVENT_LIST_COLUMNS)
          .eq("organization_id", organization.id)
          .eq("kind", "hearing")
          .is("deleted_at", null)
          .not("status", "in", "(cancelled,done)")
          .gte("ends_at", startOfToday)
          .order("starts_at")
          .limit(limit),
      ) as unknown as EventRow[];
    },
  });
}
