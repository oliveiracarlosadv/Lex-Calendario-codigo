import "server-only";
import { isBusinessDay, toISODate } from "@/domain/events/deadline-calculator";
import { formatCnjNumber, tribunalAcronym } from "@/domain/processes/cnj-number";
import { decryptSecret } from "@/infrastructure/crypto/secrets";
import { getSupabaseAdminClient } from "@/infrastructure/supabase/server";
import { fetchDjenByOab, isAddressedTo, stripHtml, type DjenItem } from "@/infrastructure/tribunals/djen-connector";
import { fetchPjePendingNotices, MniDisabledError, PJE_MNI_ENDPOINTS } from "@/infrastructure/tribunals/pje-mni-connector";
import { analyzePendingMovements } from "./process-monitor";

type Admin = ReturnType<typeof getSupabaseAdminClient>;

export interface NewIntimationNotice {
  title: string;
  body: string;
  url: string;
}

const addDays = (iso: string, n: number) => {
  const d = new Date(`${iso}T12:00:00`);
  d.setDate(d.getDate() + n);
  return d;
};

/** Publicação = 1º dia útil seguinte à disponibilização no Diário (Lei 11.419/2006, art. 4º, §3º). */
export function publicationDate(availableAt: string) {
  let d = addDays(availableAt, 1);
  while (!isBusinessDay(d, { applyForensicRecess: false })) d = addDays(toISODate(d), 1);
  return toISODate(d);
}

/** Ciência tácita no PJe: 10 dias corridos após a disponibilização (Lei 11.419/2006, art. 5º, §3º). */
export function tacitAwarenessDate(availableAt: string) {
  return toISODate(addDays(availableAt, 10));
}

const today = () => new Date().toLocaleDateString("en-CA", { timeZone: "America/Sao_Paulo" });

/** Garante o processo cadastrado (cria automaticamente a partir da intimação). */
async function ensureProcess(
  admin: Admin,
  orgId: string,
  userId: string | null,
  data: { number: string; tribunal?: string | null; organ?: string | null; className?: string | null; parties?: { nome: string; polo?: string }[] },
) {
  const number = formatCnjNumber(data.number);
  const { data: existing } = await admin.from("processes").select("id").eq("organization_id", orgId).eq("number", number).maybeSingle();
  if (existing) return { id: existing.id as string, created: false };
  const opposing = (data.parties ?? []).map((p) => p.nome).slice(0, 3).join("; ") || null;
  const { data: created, error } = await admin
    .from("processes")
    .insert({
      organization_id: orgId,
      number,
      tribunal: data.tribunal ?? tribunalAcronym(number),
      court_division: data.organ ?? null,
      procedural_class: data.className ?? null,
      responsible_id: userId,
      created_by: userId,
      is_monitored: true,
      notes: opposing ? `Partes indicadas na intimação: ${opposing}` : null,
    })
    .select("id")
    .single();
  if (error || !created) throw error ?? new Error("Falha ao cadastrar processo");
  return { id: created.id as string, created: true };
}

async function notifyUser(admin: Admin, orgId: string, userId: string | null, notice: NewIntimationNotice) {
  if (!userId) return;
  await admin.from("notifications").insert({ organization_id: orgId, user_id: userId, title: notice.title, body: notice.body, link: notice.url, kind: "intimation" });
}

// ─────────────────────────── DJEN (pela OAB) ───────────────────────────

/**
 * Grava uma comunicação do DJEN: cadastra o processo (se preciso), a intimação, a movimentação
 * e o aviso. Devolve null se já existia. Usada pelo monitoramento e pela busca manual.
 */
export async function ingestDjenItem(
  admin: Admin,
  owner: { orgId: string; userId: string; monitorId: string | null },
  item: DjenItem,
): Promise<{ id: string; processId: string; notice: NewIntimationNotice } | null> {
  const number = formatCnjNumber(item.numeroprocessocommascara ?? item.numero_processo);
  const availableAt = item.data_disponibilizacao ?? today();
  const publishedAt = publicationDate(availableAt);

  const { data: exists } = await admin
    .from("intimations")
    .select("id")
    .eq("organization_id", owner.orgId)
    .eq("source", "djen")
    .eq("external_id", String(item.id))
    .maybeSingle();
  if (exists) return null;

  const proc = await ensureProcess(admin, owner.orgId, owner.userId, {
    number,
    tribunal: item.siglaTribunal,
    organ: item.nomeOrgao,
    className: item.nomeClasse,
    parties: item.destinatarios,
  });
  const text = stripHtml(item.texto ?? "").slice(0, 20_000);
  const title = [item.tipoComunicacao, item.tipoDocumento].filter(Boolean).join(" — ") || "Comunicação processual";

  const { data: created, error } = await admin
    .from("intimations")
    .insert({
      organization_id: owner.orgId,
      process_id: proc.id,
      monitor_id: owner.monitorId,
      user_id: owner.userId,
      source: "djen",
      external_id: String(item.id),
      process_number: number,
      tribunal: item.siglaTribunal ?? null,
      organ: item.nomeOrgao ?? null,
      class_name: item.nomeClasse ?? null,
      communication_type: item.tipoComunicacao ?? null,
      document_type: item.tipoDocumento ?? null,
      available_at: availableAt,
      published_at: publishedAt,
      text,
      link: item.link ?? null,
      parties: item.destinatarios ?? [],
      lawyers: (item.destinatarioadvogados ?? []).map((d) => d.advogado).filter(Boolean),
    })
    .select("id")
    .single();
  if (error || !created) return null;

  // A movimentação usa a data de PUBLICAÇÃO: o prazo começa no dia útil seguinte (CPC, art. 224, §3º)
  await admin.from("process_movements").upsert(
    {
      organization_id: owner.orgId,
      process_id: proc.id,
      occurred_at: `${publishedAt}T12:00:00-03:00`,
      title: `${title} (DJEN)`,
      description: text,
      source: "djen",
      external_id: String(item.id),
    },
    { onConflict: "process_id,source,external_id", ignoreDuplicates: true },
  );

  const notice = {
    title: `Nova intimação · ${item.siglaTribunal ?? "DJEN"}`,
    body: `${number} — ${title}${proc.created ? " · cadastre o cliente para acompanhar" : ""}`,
    url: `/intimacoes?abrir=${created.id}`,
  };
  await notifyUser(admin, owner.orgId, owner.userId, notice);
  return { id: created.id as string, processId: proc.id, notice };
}

/** Importa comunicações escolhidas na busca manual (por OAB, nome ou CPF) para a Central de Intimações. */
export async function importDjenItems(orgId: string, userId: string, items: DjenItem[]) {
  const admin = getSupabaseAdminClient();
  const touched = new Set<string>();
  let inserted = 0;
  for (const item of items) {
    const result = await ingestDjenItem(admin, { orgId, userId, monitorId: null }, item);
    if (!result) continue;
    inserted++;
    touched.add(result.processId);
  }
  for (const processId of touched) await analyzePendingMovements(processId, admin).catch(() => 0);
  return { inserted };
}

export async function syncOabMonitor(monitorId: string, admin: Admin = getSupabaseAdminClient()) {
  const { data: monitor } = await admin.from("oab_monitors").select("*").eq("id", monitorId).single();
  if (!monitor) return { inserted: 0, notices: [] as NewIntimationNotice[] };

  // Primeira consulta: últimos 30 dias; depois, desde a última verificação (com folga de 3 dias)
  const from = monitor.last_checked_at
    ? new Date(new Date(monitor.last_checked_at).getTime() - 3 * 864e5).toLocaleDateString("en-CA", { timeZone: "America/Sao_Paulo" })
    : new Date(Date.now() - 30 * 864e5).toLocaleDateString("en-CA", { timeZone: "America/Sao_Paulo" });

  let items: DjenItem[];
  try {
    items = await fetchDjenByOab({ oab: monitor.oab_number, uf: monitor.oab_state, from, to: today() });
  } catch (e) {
    await admin.from("oab_monitors").update({ last_error: (e as Error).message.slice(0, 300) }).eq("id", monitorId);
    throw e;
  }

  const notices: NewIntimationNotice[] = [];
  const touched = new Set<string>();
  let inserted = 0;

  for (const item of items) {
    if (item.ativo === false || !isAddressedTo(item, monitor.oab_number, monitor.oab_state)) continue;
    const result = await ingestDjenItem(admin, { orgId: monitor.organization_id, userId: monitor.user_id, monitorId: monitor.id }, item);
    if (!result) continue;
    inserted++;
    touched.add(result.processId);
    notices.push(result.notice);
  }

  for (const processId of touched) await analyzePendingMovements(processId, admin).catch(() => 0);
  await admin.from("oab_monitors").update({ last_checked_at: new Date().toISOString(), last_error: null }).eq("id", monitorId);
  return { inserted, notices };
}

// ─────────────────────────── PJe (CPF e senha) ───────────────────────────

export async function syncPjeCredential(credentialId: string, admin: Admin = getSupabaseAdminClient()) {
  const { data: cred } = await admin.from("court_credentials").select("*").eq("id", credentialId).single();
  if (!cred || cred.court_system !== "pje") return { inserted: 0, notices: [] as NewIntimationNotice[] };
  const password = decryptSecret(cred.secret_enc);
  const endpoints = PJE_MNI_ENDPOINTS[String(cred.tribunal).toUpperCase()] ?? [];
  const notices: NewIntimationNotice[] = [];
  let inserted = 0;
  const errors: string[] = [];

  if (!password || !endpoints.length) {
    await admin
      .from("court_credentials")
      .update({ last_checked_at: new Date().toISOString(), last_error: endpoints.length ? "Senha ausente" : `Endereço do PJe do ${cred.tribunal} ainda não cadastrado no Lex` })
      .eq("id", credentialId);
    return { inserted, notices };
  }

  for (const { url } of endpoints) {
    try {
      const avisos = await fetchPjePendingNotices(url, { username: cred.username, password });
      for (const a of avisos) {
        if (!a.idAviso || !a.processNumber) continue;
        const availableAt = a.availableAt ?? today();
        const proc = await ensureProcess(admin, cred.organization_id, cred.user_id, { number: a.processNumber, tribunal: cred.tribunal, organ: a.organ });
        const tacit = tacitAwarenessDate(availableAt);
        const { data: created, error } = await admin.from("intimations").insert({
          organization_id: cred.organization_id,
          process_id: proc.id,
          user_id: cred.user_id,
          source: "pje",
          external_id: `${cred.tribunal}:${a.idAviso}`,
          process_number: a.processNumber,
          tribunal: cred.tribunal,
          organ: a.organ,
          class_name: a.className,
          communication_type: a.tipoComunicacao ?? "Intimação",
          document_type: "Aviso pendente de ciência",
          available_at: availableAt,
          tacit_awareness_at: tacit,
          text:
            `Comunicação pendente de ciência no PJe (${cred.tribunal}). O Lex Calendário NÃO abriu o teor, para não registrar a ciência. ` +
            `Se não houver ciência expressa, a ciência tácita ocorre em ${tacit.split("-").reverse().join("/")} (Lei 11.419/2006, art. 5º, §3º).`,
        }).select("id").single();
        if (error || !created) continue; // já registrado
        inserted++;
        await admin.from("ai_suggestions").insert({
          organization_id: cred.organization_id,
          process_id: proc.id,
          kind: "reminder",
          title: `Ciência tácita da intimação — ${a.processNumber}`,
          starts_at: `${tacit}T09:00:00-03:00`,
          ends_at: `${tacit}T09:30:00-03:00`,
          rationale: "Aviso pendente no PJe. Abra o teor no PJe para dar ciência ou acompanhe a data da ciência tácita; o prazo começa a correr a partir dela.",
          confidence: 0.95,
          analyzer: "rules",
        });
        const notice = {
          title: `Intimação pendente no PJe · ${cred.tribunal}`,
          body: `${a.processNumber} — ciência tácita em ${tacit.split("-").reverse().join("/")}`,
          url: `/intimacoes?abrir=${created.id}`,
        };
        notices.push(notice);
        await notifyUser(admin, cred.organization_id, cred.user_id, notice);
      }
    } catch (e) {
      errors.push(e instanceof MniDisabledError ? e.message : `${url}: ${(e as Error).message}`);
      if (e instanceof MniDisabledError) break;
    }
  }

  await admin
    .from("court_credentials")
    .update({ last_checked_at: new Date().toISOString(), last_error: errors.length ? errors.join(" · ").slice(0, 500) : null })
    .eq("id", credentialId);
  return { inserted, notices };
}

/** Executa todos os monitores (cron/inicializador desktop). */
export async function syncAllIntimations(filter?: { userId?: string }) {
  const admin = getSupabaseAdminClient();
  let monitorsQ = admin.from("oab_monitors").select("id").eq("is_active", true);
  let credsQ = admin.from("court_credentials").select("id").eq("court_system", "pje");
  if (filter?.userId) {
    monitorsQ = monitorsQ.eq("user_id", filter.userId);
    credsQ = credsQ.eq("user_id", filter.userId);
  }
  const [{ data: monitors }, { data: creds }] = await Promise.all([monitorsQ, credsQ]);
  const notices: NewIntimationNotice[] = [];
  const errors: string[] = [];
  let inserted = 0;
  for (const m of monitors ?? []) {
    try {
      const r = await syncOabMonitor(m.id, admin);
      inserted += r.inserted;
      notices.push(...r.notices);
    } catch (e) {
      errors.push((e as Error).message);
    }
  }
  for (const c of creds ?? []) {
    const r = await syncPjeCredential(c.id, admin).catch((e) => {
      errors.push((e as Error).message);
      return { inserted: 0, notices: [] };
    });
    inserted += r.inserted;
    notices.push(...r.notices);
  }
  return { inserted, notifications: notices, errors };
}
