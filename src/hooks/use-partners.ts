"use client";

import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { toast } from "sonner";
import type { PartnerRow, ProcessRow } from "@/types/db";
import { useWorkspace } from "./use-workspace";
import { sb, unwrap } from "./supabase";

export const PARTNER_CATEGORIES: { id: string; label: string }[] = [
  { id: "correspondente", label: "Advogado(a) correspondente" },
  { id: "escritorio", label: "Escritório parceiro" },
  { id: "perito", label: "Perito(a) / assistente técnico" },
  { id: "contador", label: "Contador(a) / cálculos" },
  { id: "indicador", label: "Indicação de clientes" },
  { id: "despachante", label: "Despachante / diligências" },
  { id: "tradutor", label: "Tradutor(a)" },
  { id: "outro", label: "Outro" },
];
export const partnerCategoryLabel = (id: string) => PARTNER_CATEGORIES.find((c) => c.id === id)?.label ?? id;

export function usePartners() {
  const { organization } = useWorkspace();
  return useQuery({
    queryKey: ["partners", organization.id],
    queryFn: async () => unwrap(await sb().from("partners").select("*").eq("organization_id", organization.id).order("name")) as PartnerRow[],
  });
}

/** Processos vinculados a cada parceiro (para contagem e detalhe). */
export function usePartnerProcesses() {
  const { organization } = useWorkspace();
  return useQuery({
    queryKey: ["processes", organization.id, "by-partner"],
    queryFn: async () =>
      unwrap(
        await sb()
          .from("processes")
          .select("id, title, number, status, partner_id, partner_fee_percent, client:clients(id, name)")
          .eq("organization_id", organization.id)
          .not("partner_id", "is", null),
      ) as Pick<ProcessRow, "id" | "title" | "number" | "status" | "partner_id" | "partner_fee_percent" | "client">[],
  });
}

export type PartnerInput = Partial<PartnerRow> & { name: string };

export function useSavePartner() {
  const qc = useQueryClient();
  const { organization, userId } = useWorkspace();
  return useMutation({
    mutationFn: async (p: PartnerInput): Promise<PartnerRow> => {
      const clean = (v: string | null | undefined) => (v ?? "").trim() || null;
      const payload = {
        organization_id: organization.id,
        kind: p.kind ?? "individual",
        category: p.category ?? "correspondente",
        name: p.name.trim(),
        trade_name: clean(p.trade_name),
        document: (p.document ?? "").replace(/\D/g, "") || null,
        oab: clean(p.oab),
        email: clean(p.email)?.toLowerCase() ?? null,
        phone: (p.phone ?? "").replace(/\D/g, "") || null,
        secondary_phone: (p.secondary_phone ?? "").replace(/\D/g, "") || null,
        website: clean(p.website),
        address_city: clean(p.address_city),
        address_state: clean(p.address_state)?.toUpperCase() ?? null,
        specialties: clean(p.specialties),
        fee_percent: p.fee_percent ?? null,
        bank_info: clean(p.bank_info),
        notes: clean(p.notes),
        is_active: p.is_active ?? true,
      };
      if (p.id) return unwrap(await sb().from("partners").update(payload).eq("id", p.id).select("*").single()) as PartnerRow;
      return unwrap(await sb().from("partners").insert({ ...payload, created_by: userId }).select("*").single()) as PartnerRow;
    },
    onSuccess: () => {
      toast.success("Parceiro salvo");
      void qc.invalidateQueries({ queryKey: ["partners"] });
    },
    onError: (e: Error) => toast.error(e.message),
  });
}

export function useDeletePartner() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: async (id: string) => unwrap(await sb().from("partners").delete().eq("id", id).select("id")),
    onSuccess: () => {
      toast.success("Parceiro removido");
      void qc.invalidateQueries({ queryKey: ["partners"] });
      void qc.invalidateQueries({ queryKey: ["processes"] });
    },
  });
}
