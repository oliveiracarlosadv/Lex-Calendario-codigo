"use client";

import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { toast } from "sonner";
import type { CollaboratorRow } from "@/types/db";
import { useWorkspace } from "./use-workspace";
import { sb, unwrap } from "./supabase";

/** Responsáveis sem conta no app (estagiários, colegas, correspondentes, convidados por e-mail). */
export function useCollaborators() {
  const { organization } = useWorkspace();
  return useQuery({
    queryKey: ["collaborators", organization.id],
    queryFn: async () =>
      unwrap(await sb().from("collaborators").select("*").eq("organization_id", organization.id).order("name")) as CollaboratorRow[],
  });
}

export type CollaboratorInput = Partial<CollaboratorRow> & { name: string };

export function useSaveCollaborator() {
  const qc = useQueryClient();
  const { organization, userId } = useWorkspace();
  return useMutation({
    mutationFn: async (c: CollaboratorInput): Promise<CollaboratorRow> => {
      const payload = {
        organization_id: organization.id,
        name: c.name.trim(),
        email: c.email?.trim().toLowerCase() || null,
        phone: c.phone?.replace(/\D/g, "") || null,
        role: c.role?.trim() || null,
        oab: c.oab?.trim() || null,
        is_active: c.is_active ?? true,
      };
      if (c.id) return unwrap(await sb().from("collaborators").update(payload).eq("id", c.id).select("*").single()) as CollaboratorRow;
      return unwrap(await sb().from("collaborators").insert({ ...payload, created_by: userId }).select("*").single()) as CollaboratorRow;
    },
    onSuccess: () => void qc.invalidateQueries({ queryKey: ["collaborators"] }),
    onError: (e: Error) => toast.error(/duplicate|409|unique/i.test(e.message) ? "Já existe um responsável com esse e-mail." : e.message),
  });
}

export function useDeleteCollaborator() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: async (id: string) => unwrap(await sb().from("collaborators").delete().eq("id", id).select("id")),
    onSuccess: () => {
      toast.success("Responsável removido");
      void qc.invalidateQueries({ queryKey: ["collaborators"] });
    },
  });
}

/** Avisa o responsável por e-mail (conta de envio configurada). Silencioso se não houver conta. */
export async function notifyCollaborator(
  eventId: string,
  person?: { type: "member" | "collaborator" | "partner"; id: string },
): Promise<"sent" | "no-account" | "no-email" | "error"> {
  const res = await fetch(`/api/events/${eventId}/avisar-responsavel`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(person ? { person } : {}),
  }).catch(() => null);
  if (!res) return "error";
  const body = (await res.json().catch(() => ({}))) as { result?: "sent" | "no-account" | "no-email" };
  return res.ok ? (body.result ?? "sent") : "error";
}
