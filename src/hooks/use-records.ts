"use client";

import { useEffect, useMemo, useRef } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { toast } from "sonner";
import type {
  CategoryRow,
  ClientRow,
  ConnectionPublicRow,
  EventRow,
  MovementRow,
  NotificationRow,
  ProcessRow,
  SearchResultRow,
  SuggestionRow,
} from "@/types/db";
import { publicEnv } from "@/lib/env";
import { useWorkspace } from "./use-workspace";
import { sb, syncEventOutbound, unwrap } from "./supabase";

/** Dados de cliente/processo aparecem na descrição do Google: reenvia os compromissos futuros vinculados. */
async function resyncLinkedEvents(column: "client_id" | "process_id", id: string) {
  const { data } = await sb()
    .from("events")
    .select("id")
    .eq(column, id)
    .is("deleted_at", null)
    .gte("ends_at", new Date().toISOString())
    .limit(50);
  for (const e of (data ?? []) as { id: string }[]) syncEventOutbound(e.id);
}

// ─────────────────────────── Categorias ───────────────────────────
/**
 * Remove do registro o que o banco calcula sozinho (busca, datas de controle) e os dados
 * de tabelas ligadas trazidos pela consulta — enviá-los no salvamento gera erro.
 */
function writable<T extends object>(row: T): Record<string, unknown> {
  const out: Record<string, unknown> = {};
  for (const [k, v] of Object.entries(row)) {
    if (["search", "created_at", "updated_at"].includes(k)) continue;
    if (v !== null && typeof v === "object" && !Array.isArray(v) && !(v instanceof Date)) continue; // cliente, processos, responsável…
    if (Array.isArray(v) && v.length && typeof v[0] === "object" && k !== "tags") continue; // ex.: processes(count)
    out[k] = v;
  }
  return out;
}

export function useCategories() {
  const { organization, categories } = useWorkspace();
  return useQuery({
    queryKey: ["categories", organization.id],
    initialData: categories,
    queryFn: async () =>
      unwrap(await sb().from("event_categories").select("*").eq("organization_id", organization.id).order("position")) as CategoryRow[],
  });
}

export function useCategoryMutations() {
  const qc = useQueryClient();
  const { organization } = useWorkspace();
  const refresh = () => {
    void qc.invalidateQueries({ queryKey: ["categories"] });
    void qc.invalidateQueries({ queryKey: ["events"] });
  };
  const update = useMutation({
    mutationFn: async ({ id, ...patch }: Partial<CategoryRow> & { id: string }) => {
      unwrap(await sb().from("event_categories").update(patch).eq("id", id).select("id"));
    },
    onSuccess: refresh,
    onError: (e) => toast.error((e as Error).message),
  });
  const create = useMutation({
    mutationFn: async (c: Pick<CategoryRow, "name" | "color" | "kind">) => {
      unwrap(await sb().from("event_categories").insert({ ...c, organization_id: organization.id, position: 99 }).select("id"));
    },
    onSuccess: refresh,
    onError: (e) => toast.error((e as Error).message),
  });
  const remove = useMutation({
    mutationFn: async (id: string) => {
      unwrap(await sb().from("event_categories").delete().eq("id", id));
    },
    onSuccess: refresh,
  });
  return { update, create, remove };
}

// ─────────────────────────── Clientes ───────────────────────────
export function useClients(search = "") {
  const { organization } = useWorkspace();
  return useQuery({
    queryKey: ["clients", organization.id, search],
    queryFn: async () => {
      let q = sb()
        .from("clients")
        .select("*, processes(count)")
        .eq("organization_id", organization.id)
        .is("archived_at", null)
        .order("name")
        .limit(500);
      if (search.trim()) {
        const term = search.trim().replace(/[%,()]/g, " ");
        const digits = term.replace(/\D/g, "");
        q = q.or(`name.ilike.%${term}%,email.ilike.%${term}%${digits.length >= 3 ? `,document.ilike.%${digits}%` : ""}`);
      }
      return unwrap(await q) as ClientRow[];
    },
  });
}

export function useClient(id: string) {
  return useQuery({
    queryKey: ["client", id],
    queryFn: async () => unwrap(await sb().from("clients").select("*").eq("id", id).single()) as ClientRow,
  });
}

export function useSaveClient() {
  const qc = useQueryClient();
  const { organization, userId } = useWorkspace();
  return useMutation({
    mutationFn: async (c: Partial<ClientRow> & { name: string }) => {
      const payload = writable({ ...c, organization_id: organization.id });
      if (c.id) return unwrap(await sb().from("clients").update(payload).eq("id", c.id).select("id").single()) as { id: string };
      return unwrap(await sb().from("clients").insert({ ...payload, created_by: userId }).select("id").single()) as { id: string };
    },
    onSuccess: (row) => {
      void resyncLinkedEvents("client_id", row.id);
      void qc.invalidateQueries({ queryKey: ["clients"] });
      void qc.invalidateQueries({ queryKey: ["client", row.id] });
      toast.success("Cliente salvo");
    },
    onError: (e) => {
      const msg = (e as Error).message;
      toast.error(msg.includes("duplicate") ? "Já existe um cliente com este CPF/CNPJ." : "Não foi possível salvar", { description: msg });
    },
  });
}

export function useArchiveClient() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: async (id: string) => {
      unwrap(await sb().from("clients").update({ archived_at: new Date().toISOString() }).eq("id", id).select("id"));
    },
    onSuccess: () => qc.invalidateQueries({ queryKey: ["clients"] }),
  });
}

/** Exclui o cliente definitivamente. Processos, compromissos e comunicações continuam, sem o cliente. */
export function useDeleteClient() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: async (id: string) => {
      unwrap(await sb().from("clients").delete().eq("id", id).select("id"));
    },
    onSuccess: () => {
      toast.success("Cliente excluído");
      void qc.invalidateQueries({ queryKey: ["clients"] });
      void qc.invalidateQueries({ queryKey: ["processes"] });
      void qc.invalidateQueries({ queryKey: ["events"] });
    },
    onError: (e: Error) => toast.error("Não foi possível excluir", { description: e.message }),
  });
}

// ─────────────────────────── Processos ───────────────────────────
export interface ProcessFilters {
  search?: string;
  status?: string;
  clientId?: string;
  responsibleId?: string;
}

const fold = (v: string | null | undefined) => (v ?? "").normalize("NFD").replace(/[\u0300-\u036f]/g, "").toLowerCase();

/**
 * Busca da Central de Processos: nome, número (com ou sem pontuação), cliente, parte contrária,
 * classe, assunto, tribunal, vara e observações; todas as palavras precisam aparecer.
 */
export function matchesProcess(p: ProcessRow, search: string, partyNames = ""): boolean {
  const digits = search.replace(/\D/g, "");
  if (digits.length >= 4 && (p.number ?? "").replace(/\D/g, "").includes(digits)) return true;
  const haystack = fold(
    [p.title, p.number, p.client?.name, p.opposing_party, p.procedural_class, p.subject, p.tribunal, p.court_division, p.client_role, p.notes, partyNames, ...(p.tags ?? [])].join(" "),
  );
  return fold(search)
    .split(/\s+/)
    .filter(Boolean)
    .every((word) => haystack.includes(word));
}

/** Nomes de todas as partes de cada processo (das intimações), para a busca por nome da parte. */
export function useProcessPartyNames() {
  const { organization } = useWorkspace();
  return useQuery({
    queryKey: ["process-party-names", organization.id],
    staleTime: 5 * 60_000,
    queryFn: async () => {
      const rows = unwrap(
        await sb().from("intimations").select("process_id, parties").eq("organization_id", organization.id).not("process_id", "is", null).limit(10000),
      ) as { process_id: string; parties: { nome?: string }[] | null }[];
      const map = new Map<string, string>();
      for (const r of rows) {
        const names = (r.parties ?? []).map((x) => x.nome ?? "").filter(Boolean).join(" ");
        if (names) map.set(r.process_id, `${map.get(r.process_id) ?? ""} ${names}`);
      }
      return map;
    },
  });
}

export function useProcesses(f: ProcessFilters = {}) {
  const { organization } = useWorkspace();
  return useQuery({
    queryKey: ["processes", organization.id, { status: f.status, clientId: f.clientId, responsibleId: f.responsibleId }],
    queryFn: async () => {
      let q = sb()
        .from("processes")
        .select("*, client:clients(id, name)")
        .eq("organization_id", organization.id)
        .order("next_deadline_at", { ascending: true, nullsFirst: false })
        .limit(1000);
      if (f.status && f.status !== "all") q = q.eq("status", f.status);
      if (f.clientId) q = q.eq("client_id", f.clientId);
      if (f.responsibleId) q = q.eq("responsible_id", f.responsibleId);
      return unwrap(await q) as ProcessRow[];
    },
    // A busca filtra na hora, sem consultar o banco a cada letra
    select: (rows: ProcessRow[]) => (f.search?.trim() ? rows.filter((p) => matchesProcess(p, f.search!)) : rows),
  });
}

export function useProcess(id: string) {
  return useQuery({
    queryKey: ["process", id],
    queryFn: async () => unwrap(await sb().from("processes").select("*, client:clients(id, name)").eq("id", id).single()) as ProcessRow,
  });
}

export function useSaveProcess() {
  const qc = useQueryClient();
  const { organization, userId } = useWorkspace();
  return useMutation({
    mutationFn: async (p: Partial<ProcessRow>) => {
      const payload = writable({ ...p, organization_id: organization.id });
      if (p.id) return unwrap(await sb().from("processes").update(payload).eq("id", p.id).select("id").single()) as { id: string };
      return unwrap(
        await sb()
          .from("processes")
          .insert({ ...payload, created_by: userId, responsible_id: p.responsible_id ?? userId })
          .select("id")
          .single(),
      ) as { id: string };
    },
    onSuccess: (row) => {
      void resyncLinkedEvents("process_id", row.id);
      void qc.invalidateQueries({ queryKey: ["processes"] });
      void qc.invalidateQueries({ queryKey: ["process", row.id] });
      toast.success("Processo salvo");
    },
    onError: (e) => {
      const msg = (e as Error).message;
      toast.error(msg.includes("duplicate") ? "Este processo já está cadastrado." : "Não foi possível salvar", { description: msg });
    },
  });
}

export function useDeleteProcess() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: async (id: string) => {
      unwrap(await sb().from("processes").delete().eq("id", id));
    },
    onSuccess: () => qc.invalidateQueries({ queryKey: ["processes"] }),
    onError: (e) => toast.error("Não foi possível excluir", { description: (e as Error).message }),
  });
}

export function useMovements(processId: string) {
  return useQuery({
    queryKey: ["movements", processId],
    queryFn: async () =>
      unwrap(
        await sb().from("process_movements").select("*").eq("process_id", processId).order("occurred_at", { ascending: false }).limit(300),
      ) as MovementRow[],
  });
}

export function useAddMovement(processId: string) {
  const qc = useQueryClient();
  const { organization } = useWorkspace();
  return useMutation({
    mutationFn: async (m: { occurred_at: string; title: string; description?: string }) => {
      unwrap(
        await sb()
          .from("process_movements")
          .insert({ ...m, organization_id: organization.id, process_id: processId, source: "manual", external_id: crypto.randomUUID() })
          .select("id"),
      );
      await fetch(`/api/processes/${processId}/analyze`, { method: "POST" }).catch(() => undefined);
    },
    onSuccess: () => {
      void qc.invalidateQueries({ queryKey: ["movements", processId] });
      void qc.invalidateQueries({ queryKey: ["suggestions"] });
      void qc.invalidateQueries({ queryKey: ["process", processId] });
    },
  });
}

export function useProcessEvents(processId: string) {
  return useQuery({
    queryKey: ["events", "process", processId],
    queryFn: async () =>
      unwrap(
        await sb().from("events").select("id, title, kind, starts_at, ends_at, all_day, status, priority").eq("process_id", processId).is("deleted_at", null).order("starts_at"),
      ) as EventRow[],
  });
}

export function useClientEvents(clientId: string) {
  return useQuery({
    queryKey: ["events", "client", clientId],
    queryFn: async () =>
      unwrap(
        await sb().from("events").select("id, title, kind, starts_at, ends_at, all_day, status, priority").eq("client_id", clientId).is("deleted_at", null).order("starts_at", { ascending: false }).limit(100),
      ) as EventRow[],
  });
}

export function useCheckProcess() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: async (processId: string) => {
      const res = await fetch(`/api/processes/${processId}/check`, { method: "POST" });
      const json = (await res.json()) as { inserted?: number; suggestions?: number; errors?: string[]; error?: string; connector?: string | null };
      if (!res.ok) throw new Error(json.error ?? "Falha na consulta");
      return json;
    },
    onSuccess: (r, id) => {
      void qc.invalidateQueries({ queryKey: ["movements", id] });
      void qc.invalidateQueries({ queryKey: ["process", id] });
      void qc.invalidateQueries({ queryKey: ["suggestions"] });
      if (r.connector) toast.success(`Consulta concluída: ${r.inserted ?? 0} nova(s) movimentação(ões), ${r.suggestions ?? 0} sugestão(ões).`);
      else toast.warning("Nenhum conector retornou dados para este processo.", { description: r.errors?.join(" · ") });
    },
    onError: (e) => toast.error((e as Error).message),
  });
}

// ─────────────────────────── Sugestões da IA ───────────────────────────
export function useSuggestions(processId?: string) {
  const { organization } = useWorkspace();
  return useQuery({
    queryKey: ["suggestions", organization.id, processId ?? "all"],
    queryFn: async () => {
      let q = sb()
        .from("ai_suggestions")
        .select("*, process:processes(id, title, number)")
        .eq("organization_id", organization.id)
        .eq("status", "pending")
        .order("created_at", { ascending: false })
        .limit(200);
      if (processId) q = q.eq("process_id", processId);
      return unwrap(await q) as SuggestionRow[];
    },
  });
}

export function useDecideSuggestion() {
  const qc = useQueryClient();
  const { userId } = useWorkspace();
  return useMutation({
    mutationFn: async ({ id, accept }: { id: string; accept: boolean }) => {
      if (accept) {
        const eventId = unwrap(await sb().rpc("accept_ai_suggestion", { suggestion_id: id })) as string;
        void fetch(`/api/events/${eventId}/sync`, { method: "POST" }).catch(() => undefined);
        return eventId;
      }
      unwrap(
        await sb().from("ai_suggestions").update({ status: "dismissed", decided_by: userId, decided_at: new Date().toISOString() }).eq("id", id).select("id"),
      );
      return null;
    },
    onSuccess: (eventId) => {
      void qc.invalidateQueries({ queryKey: ["suggestions"] });
      void qc.invalidateQueries({ queryKey: ["events"] });
      void qc.invalidateQueries({ queryKey: ["dashboard"] });
      if (eventId) toast.success("Compromisso criado na agenda");
    },
    onError: (e) => toast.error((e as Error).message),
  });
}

// ─────────────────────────── Painel ───────────────────────────
export interface DashboardMetrics {
  hearingsToday: number;
  deadlinesNext7: number;
  upcoming: number;
  pending: number;
  overdue: number;
  critical: number;
  completedThisMonth: number;
  createdThisMonth: number;
  deadlinesMetOnTime: number;
  deadlinesTotalMonth: number;
  activeProcesses: number;
  clients: number;
  pendingSuggestions: number;
  checklistProgress: number;
  weekly: { week: string; done: number; total: number }[];
}

export function useDashboardMetrics() {
  const { organization } = useWorkspace();
  return useQuery({
    queryKey: ["dashboard", organization.id],
    refetchInterval: 60_000,
    queryFn: async () => unwrap(await sb().rpc("dashboard_metrics", { org: organization.id })) as DashboardMetrics,
  });
}

// ─────────────────────────── Notificações ───────────────────────────
export function useNotifications() {
  const qc = useQueryClient();
  const { userId } = useWorkspace();
  useEffect(() => {
    if (publicEnv.localMode) return;
    const ch = sb()
      .channel(`notifications:${userId}`)
      .on("postgres_changes", { event: "INSERT", schema: "public", table: "notifications", filter: `user_id=eq.${userId}` }, (p: { new: unknown }) => {
        const n = p.new as NotificationRow;
        toast(n.title, { description: n.body ?? undefined });
        void qc.invalidateQueries({ queryKey: ["notifications"] });
      })
      .subscribe();
    return () => {
      void sb().removeChannel(ch);
    };
  }, [qc, userId]);

  const query = useQuery({
    queryKey: ["notifications", userId],
    refetchInterval: publicEnv.localMode ? 30_000 : false,
    queryFn: async () =>
      unwrap(await sb().from("notifications").select("*").eq("user_id", userId).order("created_at", { ascending: false }).limit(100)) as NotificationRow[],
  });

  // Modo local (sem tempo real): avisa na tela quando chegam notificações novas
  const seen = useRef<Set<string> | null>(null);
  useEffect(() => {
    if (!publicEnv.localMode || !query.data) return;
    if (seen.current) {
      for (const n of query.data) if (!n.read_at && !seen.current.has(n.id)) toast(n.title, { description: n.body ?? undefined });
    }
    seen.current = new Set(query.data.map((n) => n.id));
  }, [query.data]);

  return query;
}

/**
 * Compromissos com alteração ainda não vista (feita por convidado ou vinda do calendário):
 * id do compromisso → ids dos avisos não lidos. Usa o mesmo cache do sino, sem repetir os avisos na tela.
 */
export function useUnseenEventChanges() {
  const { userId } = useWorkspace();
  const { data } = useQuery({
    queryKey: ["notifications", userId],
    refetchInterval: publicEnv.localMode ? 30_000 : false,
    queryFn: async () =>
      unwrap(await sb().from("notifications").select("*").eq("user_id", userId).order("created_at", { ascending: false }).limit(100)) as NotificationRow[],
  });
  return useMemo(() => {
    const map = new Map<string, string[]>();
    for (const n of data ?? []) {
      if (n.read_at || n.kind !== "event_change" || !n.link?.startsWith("/eventos/")) continue;
      const id = n.link.slice("/eventos/".length).split(/[?#/]/)[0];
      map.set(id, [...(map.get(id) ?? []), n.id]);
    }
    return map;
  }, [data]);
}

export function useMarkNotificationsRead() {
  const qc = useQueryClient();
  const { userId } = useWorkspace();
  return useMutation({
    mutationFn: async (ids?: string[]) => {
      let q = sb().from("notifications").update({ read_at: new Date().toISOString() }).eq("user_id", userId).is("read_at", null);
      if (ids?.length) q = q.in("id", ids);
      unwrap(await q.select("id"));
    },
    onSuccess: () => qc.invalidateQueries({ queryKey: ["notifications"] }),
  });
}

// ─────────────────────────── Busca global ───────────────────────────
export function useGlobalSearch(q: string) {
  const { organization } = useWorkspace();
  return useQuery({
    queryKey: ["search", organization.id, q],
    enabled: q.trim().length >= 2,
    placeholderData: (prev) => prev,
    queryFn: async () =>
      unwrap(await sb().rpc("global_search", { org: organization.id, q: q.trim(), max_results: 6 })) as SearchResultRow[],
  });
}

// ─────────────────────────── Integrações ───────────────────────────
export function useConnections() {
  const { userId } = useWorkspace();
  return useQuery({
    queryKey: ["connections", userId],
    queryFn: async () =>
      unwrap(await sb().from("calendar_connections_public").select("*").eq("user_id", userId).order("created_at")) as ConnectionPublicRow[],
  });
}
