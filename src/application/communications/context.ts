import "server-only";
import type { SupabaseClient } from "@supabase/supabase-js";
import { formatDeadline, longDate } from "@/domain/communications/types";
import { formatDocument } from "@/domain/shared/document";

export interface CommunicationRefs {
  clientId?: string | null;
  processId?: string | null;
  eventId?: string | null;
  deadline?: string | null;
}

/** Valores das variáveis dos modelos ({{cliente}}, {{processo}}...) para um cliente/processo/compromisso. */
export async function templateVariables(sb: SupabaseClient, orgId: string, userId: string, refs: CommunicationRefs) {
  const [{ data: org }, { data: profile }] = await Promise.all([
    sb.from("organizations").select("name").eq("id", orgId).maybeSingle(),
    sb.from("profiles").select("full_name, oab_number, oab_state").eq("id", userId).maybeSingle(),
  ]);
  const { data: client } = refs.clientId
    ? await sb.from("clients").select("name, document, email, phone").eq("id", refs.clientId).maybeSingle()
    : { data: null };
  const { data: process } = refs.processId
    ? await sb
        .from("processes")
        .select("title, number, tribunal, court_division, opposing_party, last_movement_summary, last_movement_at, procedural_class, subject")
        .eq("id", refs.processId)
        .maybeSingle()
    : { data: null };
  const { data: event } = refs.eventId
    ? await sb.from("events").select("title, starts_at, all_day, location").eq("id", refs.eventId).maybeSingle()
    : { data: null };

  const when = event?.starts_at
    ? new Intl.DateTimeFormat("pt-BR", {
        timeZone: "America/Sao_Paulo",
        dateStyle: "full",
        ...(event.all_day ? {} : { timeStyle: "short" }),
      }).format(new Date(event.starts_at as string))
    : null;
  const name = (client?.name as string | undefined) ?? null;

  return {
    cliente: name,
    primeiro_nome: name ? name.split(/\s+/)[0] : null,
    documento: client?.document ? formatDocument(client.document as string) : null,
    processo: ((process?.number ?? process?.title) as string | undefined) ?? null,
    nome_processo: (process?.title as string | undefined) ?? null,
    tribunal: (process?.tribunal as string | undefined) ?? null,
    vara: (process?.court_division as string | undefined) ?? null,
    parte_contraria: (process?.opposing_party as string | undefined) ?? null,
    ultima_movimentacao: (process?.last_movement_summary as string | undefined) ?? null,
    classe: (process?.procedural_class as string | undefined) ?? null,
    assunto_processo: (process?.subject as string | undefined) ?? null,
    data_evento: when,
    local_evento: (event?.location as string | undefined) ?? null,
    titulo_evento: (event?.title as string | undefined) ?? null,
    prazo: refs.deadline ? formatDeadline(refs.deadline) : null,
    advogado: (profile?.full_name as string | undefined) ?? null,
    oab: profile?.oab_number ? `${profile.oab_number}/${profile.oab_state ?? ""}`.replace(/\/$/, "") : null,
    escritorio: (org?.name as string | undefined) ?? null,
    hoje: longDate(),
    ano: String(new Date().getFullYear()),
    email_cliente: (client?.email as string | undefined) ?? null,
    telefone_cliente: (client?.phone as string | undefined) ?? null,
  } satisfies Record<string, string | null>;
}

export type TemplateVariables = Awaited<ReturnType<typeof templateVariables>>;
