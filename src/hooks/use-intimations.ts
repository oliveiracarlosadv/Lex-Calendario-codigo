"use client";

import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { toast } from "sonner";
import type { IntimationRow, OabMonitorRow } from "@/types/db";
import { publicEnv } from "@/lib/env";
import { useWorkspace } from "./use-workspace";
import { sb, unwrap } from "./supabase";

export function useIntimations(filter: "unread" | "all" = "all") {
  const { organization } = useWorkspace();
  return useQuery({
    queryKey: ["intimations", organization.id, filter],
    refetchInterval: publicEnv.localMode ? 60_000 : false,
    queryFn: async () => {
      let q = sb().from("intimations").select("*").eq("organization_id", organization.id).order("available_at", { ascending: false }).limit(300);
      if (filter === "unread") q = q.is("read_at", null);
      return unwrap(await q) as IntimationRow[];
    },
  });
}

export function useMarkIntimationsRead() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: async (ids: string[]) => {
      if (!ids.length) return;
      unwrap(await sb().from("intimations").update({ read_at: new Date().toISOString() }).in("id", ids).select("id"));
    },
    onSuccess: () => qc.invalidateQueries({ queryKey: ["intimations"] }),
  });
}

export function useSyncIntimations() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: async () => {
      const res = await fetch("/api/intimacoes/sync", { method: "POST" });
      const json = (await res.json().catch(() => ({}))) as { inserted?: number; errors?: string[]; error?: string };
      if (!res.ok) throw new Error(json.error ?? "Falha na consulta");
      return json;
    },
    onSuccess: (r) => {
      void qc.invalidateQueries({ queryKey: ["intimations"] });
      void qc.invalidateQueries({ queryKey: ["oab-monitors"] });
      void qc.invalidateQueries({ queryKey: ["court-credentials"] });
      void qc.invalidateQueries({ queryKey: ["processes"] });
      void qc.invalidateQueries({ queryKey: ["suggestions"] });
      if (r.errors?.length) toast.warning(`${r.inserted ?? 0} nova(s) intimação(ões). Avisos: ${r.errors.join(" · ")}`);
      else toast.success(r.inserted ? `${r.inserted} nova(s) intimação(ões) encontrada(s)` : "Nenhuma intimação nova");
    },
    onError: (e) => toast.error((e as Error).message),
  });
}

export function useOabMonitors() {
  const { organization } = useWorkspace();
  return useQuery({
    queryKey: ["oab-monitors", organization.id],
    queryFn: async () => unwrap(await sb().from("oab_monitors").select("*").eq("organization_id", organization.id).order("created_at")) as OabMonitorRow[],
  });
}

export function useOabMonitorMutations() {
  const qc = useQueryClient();
  const { organization, userId } = useWorkspace();
  const refresh = () => qc.invalidateQueries({ queryKey: ["oab-monitors"] });
  const add = useMutation({
    mutationFn: async ({ number, state }: { number: string; state: string }) => {
      unwrap(
        await sb()
          .from("oab_monitors")
          .upsert(
            { organization_id: organization.id, user_id: userId, oab_number: number.replace(/[^0-9A-Za-z]/g, "").toUpperCase(), oab_state: state.toUpperCase(), is_active: true },
            { onConflict: "organization_id,oab_number,oab_state" },
          )
          .select("id"),
      );
    },
    onSuccess: () => {
      void refresh();
      toast.success("OAB cadastrada para monitoramento");
    },
    onError: (e) => toast.error((e as Error).message),
  });
  const remove = useMutation({
    mutationFn: async (id: string) => {
      unwrap(await sb().from("oab_monitors").delete().eq("id", id));
    },
    onSuccess: refresh,
  });
  const toggle = useMutation({
    mutationFn: async ({ id, active }: { id: string; active: boolean }) => {
      unwrap(await sb().from("oab_monitors").update({ is_active: active }).eq("id", id).select("id"));
    },
    onSuccess: refresh,
  });
  return { add, remove, toggle };
}
