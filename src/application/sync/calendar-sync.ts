import "server-only";
import { createHash } from "node:crypto";
import { adapterFor } from "@/infrastructure/integrations/registry";
import { displayTitle, hasDoneMark, stripDoneMark, type EventKind, type EventPriority, type EventStatus } from "@/domain/events/types";
import { splitParties } from "@/domain/processes/parties";
import { buildEventDetails, htmlToText } from "@/infrastructure/integrations/event-details";
import type { ConnectionRow, ExternalEvent, OutboundEvent } from "@/infrastructure/integrations/types";
import { GUEST_COMMENT_SEPARATOR } from "@/infrastructure/integrations/shared-payload";
import { publicEnv } from "@/lib/env";
import { getSupabaseAdminClient } from "@/infrastructure/supabase/server";

type Admin = ReturnType<typeof getSupabaseAdminClient>;

const CONNECTION_COLUMNS = "*";

async function loadOutbound(admin: Admin, eventId: string) {
  const { data } = await admin
    .from("events")
    .select(
      "*, process:processes(title, number, procedural_class, subject, tribunal, court_division, opposing_party, client_role), client:clients(name, document, phone, email), checklist:event_checklist_items(title, is_done, position), reminders:event_reminders(offset_minutes, user_id), attachments:event_attachments(file_name, size_bytes), comments:event_comments(id, body, created_at, author_id, author_name, author_email, external_ref), collaborator:collaborators(name, role, email, phone), partner:partners(name, category, email, phone), related:events!related_event_id(title, kind, starts_at, all_day, status, completed_at)",
    )
    .eq("id", eventId)
    .maybeSingle();
  return data as
    | (Record<string, unknown> & {
        id: string;
        organization_id: string;
        responsible_id: string | null;
        created_by: string | null;
        deleted_at: string | null;
        is_private: boolean;
        shared_origin: string | null;
        shared_readonly: boolean;
        process: { title: string | null; number: string | null; procedural_class: string | null; subject: string | null; tribunal: string | null; court_division: string | null; opposing_party: string | null; client_role: string | null } | null;
        client: { name: string; document: string | null; phone: string | null; email: string | null } | null;
        checklist: { title: string; is_done: boolean; position: number }[] | null;
        reminders: { offset_minutes: number; user_id: string }[] | null;
        attachments: { file_name: string; size_bytes: number }[] | null;
        comments: { id: string; body: string; created_at: string; author_id: string; author_name: string | null; author_email: string | null; external_ref: string | null }[] | null;
        collaborator: { name: string; role: string | null; email: string | null; phone: string | null } | null;
        partner: { name: string; category: string; email: string | null; phone: string | null } | null;
        related: { title: string; kind: EventKind; starts_at: string; all_day: boolean; status: string; completed_at: string | null } | null;
      })
    | null;
}

async function toOutbound(admin: Admin, e: NonNullable<Awaited<ReturnType<typeof loadOutbound>>>): Promise<OutboundEvent> {
  // Do mais antigo para o mais novo, numerados, para a leitura em sequência
  const comments = [...(e.comments ?? [])].sort((a, b) => a.created_at.localeCompare(b.created_at));
  const co = (Array.isArray(e.co_responsibles) ? e.co_responsibles : []) as { type: string; id: string }[];
  const peopleIds = [
    ...new Set([e.responsible_id, ...comments.map((c) => c.author_id), ...co.filter((r) => r.type === "member").map((r) => r.id)].filter(Boolean)),
  ] as string[];
  const { data: people } = peopleIds.length
    ? await admin.from("profiles").select("id, full_name").in("id", peopleIds)
    : { data: [] as { id: string; full_name: string | null }[] };
  const nameOf = (id: string | null) => (people ?? []).find((p) => p.id === id)?.full_name ?? null;
  const reminderOwner = e.responsible_id ?? e.created_by;
  const isGuestCopy = !!e.shared_origin; // este usuário é convidado; o organizador é outra conta
  // Outros responsáveis (equipe, responsáveis cadastrados e parceiros)
  const coIds = (type: string) => co.filter((r) => r.type === type).map((r) => r.id);
  const { data: coCollab } = coIds("collaborator").length
    ? await admin.from("collaborators").select("id, name").in("id", coIds("collaborator"))
    : { data: [] as { id: string; name: string }[] };
  const { data: coPartners } = coIds("partner").length
    ? await admin.from("partners").select("id, name").in("id", coIds("partner"))
    : { data: [] as { id: string; name: string }[] };
  const coNames = co
    .map((r) =>
      r.type === "member"
        ? nameOf(r.id)
        : r.type === "collaborator"
          ? (coCollab ?? []).find((x) => x.id === r.id)?.name
          : (coPartners ?? []).find((x) => x.id === r.id)?.name,
    )
    .filter(Boolean) as string[];
  // Polo ativo/passivo: partes publicadas nas intimações do processo
  let published: { nome: string; polo?: string }[] = [];
  if (e.process_id) {
    const { data: ints } = await admin.from("intimations").select("parties").eq("process_id", e.process_id as string).order("available_at", { ascending: false }).limit(10);
    const seen = new Map<string, { nome: string; polo?: string }>();
    for (const row of (ints ?? []) as { parties: { nome: string; polo?: string }[] }[])
      for (const p of row.parties ?? []) if (!seen.has(p.nome.toUpperCase())) seen.set(p.nome.toUpperCase(), p);
    published = [...seen.values()];
  }
  const polos = splitParties({ parties: published, clientName: e.client?.name, clientRole: e.process?.client_role, opposingParty: e.process?.opposing_party });
  const reminders = (e.reminders ?? []).filter((r) => r.user_id === reminderOwner).map((r) => r.offset_minutes);
  const timezone = String(e.timezone ?? "America/Sao_Paulo");

  const details = buildEventDetails({
    title: String(e.title),
    kind: e.kind as EventKind,
    priority: e.priority as EventPriority,
    status: e.status as EventStatus,
    startsAt: String(e.starts_at),
    endsAt: String(e.ends_at),
    allDay: Boolean(e.all_day),
    timezone,
    location: (e.location as string) ?? null,
    meetingUrl: (e.meeting_url as string) ?? null,
    hearingMode: (e.hearing_mode as "online" | "presencial" | null) ?? null,
    tribunal: (e.tribunal as string) ?? null,
    courtDivision: (e.court_division as string) ?? null,
    description: e.description ?? null,
    descriptionText: (e.description_text as string) ?? null,
    process: e.process
      ? {
          title: e.process.title,
          number: e.process.number,
          proceduralClass: e.process.procedural_class,
          subject: e.process.subject,
          tribunal: e.process.tribunal,
          courtDivision: e.process.court_division,
          opposingParty: e.process.opposing_party,
          clientRole: e.process.client_role,
          activeParties: polos.active,
          passiveParties: polos.passive,
        }
      : null,
    client: e.client,
    responsible:
      [
        e.collaborator
          ? [e.collaborator.name, e.collaborator.role, e.collaborator.email, e.collaborator.phone].filter(Boolean).join(" · ")
          : e.partner
            ? [e.partner.name, "parceiro", e.partner.email, e.partner.phone].filter(Boolean).join(" · ")
            : nameOf(e.responsible_id),
        ...coNames,
      ]
        .filter(Boolean)
        .join("; ") || null,
    related: e.related
      ? {
          title: e.related.title,
          kind: e.related.kind,
          startsAt: e.related.starts_at,
          allDay: e.related.all_day,
          completedAt: e.related.completed_at,
          done: e.related.status === "done",
        }
      : null,
    checklist: [...(e.checklist ?? [])].sort((a, b) => a.position - b.position).map((i) => ({ title: i.title, isDone: i.is_done })),
    reminders,
    attachments: (e.attachments ?? []).map((a) => ({ name: a.file_name, sizeBytes: Number(a.size_bytes) })),
    comments: comments.map((c) => ({ author: c.author_name ?? nameOf(c.author_id) ?? "Equipe", body: c.body, createdAt: c.created_at })),
    appUrl: `${publicEnv.appUrl}/eventos/${e.id}`,
    updatedAt: new Date(),
  });

  return {
    id: e.id,
    title: displayTitle(String(e.title), e.status as string),
    descriptionText: (e.description_text as string) ?? null,
    location: (e.location as string) ?? null,
    startsAt: String(e.starts_at),
    endsAt: String(e.ends_at),
    allDay: Boolean(e.all_day),
    timezone,
    status: String(e.status),
    meetingUrl: (e.meeting_url as string) ?? null,
    processNumber: e.process ? [e.process.title, e.process.number].filter(Boolean).join(" · ") || null : null,
    clientName: e.client?.name ?? null,
    detailsHtml: details.html,
    detailsText: details.text,
    reminders,
    attendees: Array.isArray(e.attendees) ? (e.attendees as { email: string; name?: string | null }[]) : [],
    guestsCanModify: e.guests_can_modify !== false,
    // Organizador: os dados do Lex acompanham o evento para as instalações dos convidados
    shared: isGuestCopy
      ? null
      : {
          v: 1,
          by: "",
          ro: e.guests_can_modify === false,
          kind: String(e.kind),
          priority: String(e.priority),
          status: String(e.status),
          hm: (e.hearing_mode as string | null) ?? null,
          ck: [...(e.checklist ?? [])].sort((a, b) => a.position - b.position).map((i) => ({ t: i.title, d: i.is_done })),
          cm: comments.map((c) => ({
            i: c.external_ref?.startsWith("lex:") ? c.external_ref.slice(4) : c.id,
            n: c.author_name ?? nameOf(c.author_id) ?? "Equipe",
            e: c.author_email,
            t: c.created_at,
            b: c.body,
          })),
        },
    // Convidado: só o que ele pode mudar + os comentários ainda não recebidos pelo organizador
    guest: isGuestCopy
      ? {
          readOnly: e.shared_readonly === true,
          selfComment:
            comments
              .filter((c) => !c.external_ref)
              .slice(-3)
              .map((c) => c.body.trim().slice(0, 900))
              .join(GUEST_COMMENT_SEPARATOR) || null,
        }
      : null,
  };
}

/** O que, ao mudar, merece um e-mail do Google aos convidados. */
export function guestNoticeHash(e: OutboundEvent): string {
  const key = JSON.stringify({
    s: new Date(e.startsAt).toISOString(),
    e: new Date(e.endsAt).toISOString(),
    a: e.allDay,
    l: (e.location ?? "").trim(),
    m: (e.meetingUrl ?? "").trim(),
    g: (e.attendees ?? []).map((x) => x.email.toLowerCase()).sort(),
    c: e.status === "cancelled",
  });
  return createHash("sha1").update(key).digest("hex");
}

/**
 * Envia (cria/atualiza/remove) um evento do Lex para as agendas externas
 * do responsável e do criador. Chamado após cada alteração na interface.
 */
export async function pushEvent(eventId: string) {
  const admin = getSupabaseAdminClient();
  const event = await loadOutbound(admin, eventId);
  if (!event) return { pushed: 0 };

  const owners = [...new Set([event.responsible_id, event.created_by].filter(Boolean))] as string[];
  const { data: connections } = await admin
    .from("calendar_connections")
    .select(CONNECTION_COLUMNS)
    .eq("organization_id", event.organization_id)
    .eq("is_active", true)
    .in("user_id", owners.length ? owners : ["00000000-0000-0000-0000-000000000000"]);

  const { data: links } = await admin.from("event_external_links").select("*").eq("event_id", eventId);
  let pushed = 0;
  let outbound: OutboundEvent | null = null;

  for (const conn of (connections ?? []) as ConnectionRow[]) {
    const link = links?.find((l) => l.connection_id === conn.id);
    const adapter = adapterFor(conn.provider);
    try {
      if (event.deleted_at) {
        if (link) {
          await adapter.remove(conn, link.external_id);
          await admin.from("event_external_links").delete().eq("event_id", eventId).eq("connection_id", conn.id);
        }
        continue;
      }
      // Cópia de convidado sem vínculo: não cria um evento novo na agenda dele
      if (event.shared_origin && !link) continue;
      outbound ??= await toOutbound(admin, event);
      // Avisa os convidados só se mudou o que importa a eles (data, hora, local, link, convidados)
      const hash = guestNoticeHash(outbound);
      const own = conn.account_email ?? "";
      const payload: OutboundEvent = outbound.shared
        ? { ...outbound, shared: { ...outbound.shared, by: own, cm: outbound.shared.cm.map((c) => ({ ...c, e: c.e ?? (own || null) })) } }
        : outbound;
      const result = await adapter.push(conn, payload, link?.external_id, {
        // Vínculos anteriores a esta versão (sem impressão digital) não disparam e-mail na primeira atualização
        notifyGuests: !link || (link.notify_hash != null && link.notify_hash !== hash),
      });
      // O organizador não permite alterações: daqui em diante só os comentários seguem
      if (result.forbidden && !event.shared_readonly) await admin.from("events").update({ shared_readonly: true }).eq("id", eventId);
      await admin.from("event_external_links").upsert({
        event_id: eventId,
        connection_id: conn.id,
        external_id: result.externalId,
        etag: result.etag,
        notify_hash: hash,
        last_synced_at: new Date().toISOString(),
      });
      pushed++;
      if (conn.last_push_error) await admin.from("calendar_connections").update({ last_push_error: null, last_push_error_at: null }).eq("id", conn.id);
    } catch (error) {
      const message = `${(error as Error).message}`.slice(0, 500);
      console.error(`[sync] falha ao enviar "${(event as { title?: string }).title ?? eventId}" para ${conn.provider}: ${message}`);
      await admin
        .from("calendar_connections")
        .update({ last_push_error: `${(event as { title?: string }).title ?? "Compromisso"}: ${message}`, last_push_error_at: new Date().toISOString() })
        .eq("id", conn.id);
    }
  }
  return { pushed };
}

/**
 * Reenvia ao provedor as alterações feitas no Lex que ainda não chegaram lá
 * (janela fechada antes do envio, servidor reiniciando, falha temporária da API).
 */
export async function pushPendingEvents(connectionId: string, max = 25) {
  const admin = getSupabaseAdminClient();
  const { data, error } = await admin.rpc("sync_pending_events", { conn: connectionId, max_rows: max });
  if (error) {
    console.error(`[sync] pendências: ${error.message}`);
    return { pending: 0, pushed: 0 };
  }
  const ids = ((data ?? []) as { event_id: string }[]).map((r) => r.event_id);
  let pushed = 0;
  for (const id of ids) pushed += (await pushEvent(id)).pushed;
  return { pending: ids.length, pushed };
}

const KIND_GUESS: [RegExp, string][] = [
  [/audi[eê]ncia|sess[aã]o de julgamento/i, "hearing"],
  [/prazo|vencimento/i, "deadline"],
  [/tarefa|to-?do|pend[eê]ncia/i, "task"],
  [/reuni[aã]o|call|meet/i, "meeting"],
  [/dilig[eê]ncia|protocolo|f[oó]rum/i, "diligence"],
  [/consulta/i, "consultation"],
  [/atendimento/i, "service"],
];

/**
 * Observações que os convidados escrevem ao responder o convite no Google Agenda
 * ("Adicionar observação") viram comentários do compromisso no Lex (uma vez cada).
 */
async function importGuestComments(admin: Admin, connection: ConnectionRow, eventId: string, ext: ExternalEvent): Promise<number> {
  let imported = 0;
  for (const a of ext.attendees ?? []) {
    if (a.self || !a.comment?.trim()) continue;
    // A instalação do Lex do convidado pode enviar mais de um comentário, separados por uma linha
    for (const piece of a.comment.split(GUEST_COMMENT_SEPARATOR).map((x) => x.trim()).filter(Boolean)) {
      const ref = `google:${a.email.toLowerCase()}:${createHash("sha1").update(piece).digest("hex").slice(0, 16)}`;
      const { data: exists } = await admin.from("event_comments").select("id").eq("event_id", eventId).eq("external_ref", ref).maybeSingle();
      if (exists) continue;
      await admin.from("event_comments").insert({
        organization_id: connection.organization_id,
        event_id: eventId,
        author_id: connection.user_id,
        author_name: a.name || a.email,
        author_email: a.email.toLowerCase(),
        body: piece.slice(0, 10000),
        external_ref: ref,
      });
      await notifyOwners(admin, eventId, `Novo comentário de ${a.name || a.email}`, `${stripDoneMark(ext.title)}: ${piece.slice(0, 160)}`);
      imported++;
    }
  }
  return imported;
}

/**
 * Convidado: aplica o que o organizador enviou pela outra instalação do Lex — comentários
 * (de todos os participantes), checklist, tipo, prioridade, situação e modalidade.
 */
async function applySharedPayload(
  admin: Admin,
  connection: ConnectionRow,
  eventId: string,
  ext: ExternalEvent,
  categories: { id: string; kind: string }[] | null,
) {
  const payload = ext.shared;
  if (!payload) return;
  const own = (connection.account_email ?? "").toLowerCase();
  const { data: localRows } = await admin.from("event_comments").select("id, body, external_ref").eq("event_id", eventId);
  const local = (localRows ?? []) as { id: string; body: string; external_ref: string | null }[];
  for (const c of payload.cm) {
    if (local.some((l) => l.id === c.i || l.external_ref === `lex:${c.i}` || l.external_ref === `sent:${c.i}`)) continue;
    if (c.e && c.e.toLowerCase() === own) {
      // Meu comentário chegou ao organizador e voltou: marca como entregue (não duplica)
      const mine = local.find((l) => !l.external_ref && l.body.trim().slice(0, 900) === c.b.trim().slice(0, 900));
      if (mine) {
        mine.external_ref = `sent:${c.i}`;
        await admin.from("event_comments").update({ external_ref: mine.external_ref }).eq("id", mine.id);
      }
      continue;
    }
    const { error } = await admin.from("event_comments").insert({
      organization_id: connection.organization_id,
      event_id: eventId,
      author_id: connection.user_id,
      author_name: c.n,
      author_email: c.e,
      body: c.b.slice(0, 10000),
      external_ref: `lex:${c.i}`,
      created_at: c.t,
    });
    if (!error) await notifyOwners(admin, eventId, `Novo comentário de ${c.n}`, `${stripDoneMark(ext.title)}: ${c.b.slice(0, 160)}`);
  }

  // Tipo, prioridade, situação, modalidade e checklist definidos pelo organizador
  const { data: ev } = await admin.from("events").select("kind, priority, status, hearing_mode").eq("id", eventId).maybeSingle();
  if (ev) {
    const patch: Record<string, unknown> = {};
    if (payload.kind && payload.kind !== ev.kind) {
      patch.kind = payload.kind;
      patch.category_id = categories?.find((k) => k.kind === payload.kind)?.id ?? null;
    }
    if (payload.priority && payload.priority !== ev.priority) patch.priority = payload.priority;
    if (payload.status && payload.status !== ev.status) patch.status = payload.status;
    if ((payload.hm ?? null) !== (ev.hearing_mode ?? null)) patch.hearing_mode = payload.hm ?? null;
    if (Object.keys(patch).length) await admin.from("events").update(patch).eq("id", eventId);
  }
  const { data: items } = await admin.from("event_checklist_items").select("title, is_done, position").eq("event_id", eventId).order("position");
  const current = JSON.stringify(((items ?? []) as { title: string; is_done: boolean }[]).map((i) => ({ t: i.title, d: i.is_done })));
  if (current !== JSON.stringify(payload.ck)) {
    await admin.from("event_checklist_items").delete().eq("event_id", eventId);
    if (payload.ck.length) {
      await admin.from("event_checklist_items").insert(
        payload.ck.map((i, position) => ({ organization_id: connection.organization_id, event_id: eventId, title: i.t.slice(0, 500), is_done: i.d, position })),
      );
    }
  }
}

/** Depois de gravar o evento vindo do Google: comentários de convidados (organizador) ou dados do organizador (convidado). */
/** Devolve true quando o organizador recebeu comentários novos e precisa republicar os dados para os convidados. */
async function syncSharedData(admin: Admin, connection: ConnectionRow, eventId: string, ext: ExternalEvent, categories: { id: string; kind: string }[] | null): Promise<boolean> {
  if (ext.organizerSelf === false) {
    await applySharedPayload(admin, connection, eventId, ext, categories);
    return false;
  }
  return (await importGuestComments(admin, connection, eventId, ext)) > 0;
}

/** Marca o vínculo como desatualizado: a próxima sincronização reenvia o evento (em silêncio) com os comentários novos. */
async function requestRepublish(admin: Admin, eventId: string, connectionId: string) {
  await admin
    .from("event_external_links")
    .update({ last_synced_at: new Date(Date.now() - 5 * 60_000).toISOString() })
    .eq("event_id", eventId)
    .eq("connection_id", connectionId);
}

/** Aviso no sino do Lex (e notificação do sistema) para o responsável e o criador do compromisso. */
async function notifyOwners(admin: Admin, eventId: string, title: string, body: string) {
  const { data: ev } = await admin.from("events").select("organization_id, responsible_id, created_by").eq("id", eventId).maybeSingle();
  if (!ev) return;
  const users = [...new Set([ev.responsible_id, ev.created_by].filter(Boolean))] as string[];
  if (!users.length) return;
  await admin.from("notifications").insert(
    users.map((user_id) => ({ organization_id: ev.organization_id, user_id, title, body, link: `/eventos/${eventId}`, kind: "event_change" })),
  );
}

const fmtWhen = (iso: string, allDay: boolean) =>
  new Intl.DateTimeFormat("pt-BR", { timeZone: "America/Sao_Paulo", dateStyle: "short", ...(allDay ? {} : { timeStyle: "short" }) }).format(new Date(iso));

/** Compara o compromisso do Lex com o que veio do Google e avisa se data, hora ou local mudaram. */
async function notifyExternalChange(admin: Admin, eventId: string, ext: ExternalEvent, connection: ConnectionRow) {
  const { data: before } = await admin.from("events").select("title, starts_at, ends_at, all_day, location").eq("id", eventId).maybeSingle();
  if (!before) return;
  const changes: string[] = [];
  if (new Date(before.starts_at as string).getTime() !== new Date(ext.startsAt).getTime() || Boolean(before.all_day) !== ext.allDay) {
    changes.push(`nova data: ${fmtWhen(ext.startsAt, ext.allDay)} (antes ${fmtWhen(before.starts_at as string, Boolean(before.all_day))})`);
  } else if (new Date(before.ends_at as string).getTime() !== new Date(ext.endsAt).getTime() && !ext.allDay) {
    changes.push(`novo término: ${fmtWhen(ext.endsAt, false)}`);
  }
  if ((before.location ?? "") !== (ext.location ?? "")) changes.push(`local: ${ext.location || "removido"}`);
  if (stripDoneMark(String(before.title)) !== stripDoneMark(ext.title)) changes.push(`novo nome: ${stripDoneMark(ext.title)}`);
  if (!changes.length) return;
  await notifyOwners(admin, eventId, `Compromisso alterado no ${connection.provider === "google" ? "Google Agenda" : "calendário externo"}`, `${stripDoneMark(ext.title)} — ${changes.join(" · ")}`);
}

/** Compromisso do Lex com o mesmo nome e início, ainda sem vínculo com esta conta. */
async function findUnlinkedTwin(admin: Admin, connection: ConnectionRow, title: string, startsAt: string): Promise<string | null> {
  const { data: candidates } = await admin
    .from("events")
    .select("id, title")
    .eq("organization_id", connection.organization_id)
    .eq("starts_at", new Date(startsAt).toISOString())
    .is("deleted_at", null)
    .limit(20);
  const same = ((candidates ?? []) as { id: string; title: string }[]).filter(
    (c) => stripDoneMark(c.title).trim().toLowerCase() === stripDoneMark(title).trim().toLowerCase(),
  );
  if (!same.length) return null;
  const { data: linked } = await admin
    .from("event_external_links")
    .select("event_id")
    .eq("connection_id", connection.id)
    .in("event_id", same.map((c) => c.id));
  const taken = new Set(((linked ?? []) as { event_id: string }[]).map((l) => l.event_id));
  return same.find((c) => !taken.has(c.id))?.id ?? null;
}

type PullResult = { created: number; updated: number; deleted: number };
const pullsRunning = ((globalThis as { __lexPulls?: Map<string, Promise<PullResult>> }).__lexPulls ??= new Map());

/**
 * Importa alterações de uma conexão externa para o Lex (sincronização de entrada).
 * Uma importação por conexão de cada vez: duas ao mesmo tempo criavam o mesmo compromisso em dobro.
 */
export function pullConnection(connectionId: string): Promise<PullResult> {
  const running = pullsRunning.get(connectionId);
  if (running) return running;
  const run = runPull(connectionId).finally(() => pullsRunning.delete(connectionId));
  pullsRunning.set(connectionId, run);
  return run;
}

async function runPull(connectionId: string): Promise<PullResult> {
  const admin = getSupabaseAdminClient();
  const { data: conn } = await admin.from("calendar_connections").select(CONNECTION_COLUMNS).eq("id", connectionId).single();
  if (!conn || !conn.is_active) return { created: 0, updated: 0, deleted: 0 };
  const connection = conn as ConnectionRow;

  const result = await adapterFor(connection.provider).pull(connection);
  const { data: links } = await admin.from("event_external_links").select("*").eq("connection_id", connectionId);
  const byExternal = new Map((links ?? []).map((l) => [l.external_id as string, l]));
  const { data: categories } = await admin
    .from("event_categories")
    .select("id, kind")
    .eq("organization_id", connection.organization_id);

  let created = 0;
  let updated = 0;
  let deleted = 0;
  const seen = new Set<string>();

  for (const ext of result.events) {
    seen.add(ext.externalId);
    const link = byExternal.get(ext.externalId);
    if (link && ext.etag && link.etag === ext.etag) continue; // sem mudanças (inclusive eco do próprio push)

    if (ext.cancelled) {
      if (link) {
        await admin.from("events").update({ deleted_at: new Date().toISOString() }).eq("id", link.event_id);
        await admin.from("event_external_links").delete().eq("event_id", link.event_id).eq("connection_id", connectionId);
        deleted++;
      }
      continue;
    }

    // "✔️" no início do nome = concluída (a marca não é gravada no nome)
    const fields = {
      title: stripDoneMark(ext.title) || ext.title,
      ...(hasDoneMark(ext.title) ? { status: "done" as const } : {}),
      starts_at: ext.startsAt,
      ends_at: ext.endsAt < ext.startsAt ? ext.startsAt : ext.endsAt,
      all_day: ext.allDay,
      location: ext.location ?? null,
      recurrence_rule: ext.recurrenceRule ?? null,
      ...(ext.attendees ? { attendees: ext.attendees } : {}),
      // Convidado neste evento: guarda quem organiza e se pode alterar
      ...(ext.organizerSelf === false
        ? {
            shared_origin: ext.organizerEmail ?? "organizador",
            shared_readonly: ext.shared?.ro ?? ext.guestsCanModify === false,
            // A descrição é a do organizador (o convidado nunca a reenvia)
            description_text: ext.description ? htmlToText(ext.description) : null,
          }
        : {}),
    };

    // Vínculo criado por outra sincronização depois que esta começou
    const fresh = link
      ? null
      : (await admin.from("event_external_links").select("event_id").eq("connection_id", connectionId).eq("external_id", ext.externalId).maybeSingle()).data;
    const targetId = link?.event_id ?? (fresh?.event_id as string | undefined) ?? ext.lexEventId ?? null;
    if (targetId) {
      const { data: exists } = await admin.from("events").select("id").eq("id", targetId).maybeSingle();
      if (exists) {
        await notifyExternalChange(admin, targetId, ext, connection);
        await admin.from("events").update(fields).eq("id", targetId);
        const republish = await syncSharedData(admin, connection, targetId, ext, categories as { id: string; kind: string }[] | null);
        await admin.from("event_external_links").upsert({
          event_id: targetId,
          connection_id: connectionId,
          external_id: ext.externalId,
          etag: ext.etag ?? null,
          last_synced_at: new Date().toISOString(),
        });
        if (republish) await requestRepublish(admin, targetId, connectionId);
        updated++;
        continue;
      }
    }

    // Já existe no Lex sem vínculo (ex.: restaurado de um backup)? Vincula em vez de duplicar.
    const twin = await findUnlinkedTwin(admin, connection, fields.title, ext.startsAt);
    if (twin) {
      await admin.from("events").update(fields).eq("id", twin);
      await syncSharedData(admin, connection, twin, ext, categories as { id: string; kind: string }[] | null);
      await admin.from("event_external_links").upsert({
        event_id: twin,
        connection_id: connectionId,
        external_id: ext.externalId,
        etag: ext.etag ?? null,
        last_synced_at: new Date().toISOString(),
      });
      updated++;
      continue;
    }

    const kind = KIND_GUESS.find(([re]) => re.test(ext.title))?.[1] ?? "custom";
    const { data: inserted, error } = await admin
      .from("events")
      .insert({
        ...fields,
        organization_id: connection.organization_id,
        kind,
        category_id: categories?.find((c) => c.kind === kind)?.id ?? null,
        description_text: ext.description ? (/<[a-z][^>]*>/i.test(ext.description) ? htmlToText(ext.description) : ext.description) : null,
        responsible_id: connection.user_id,
        created_by: connection.user_id,
        source: connection.provider,
      })
      .select("id")
      .single();
    if (error || !inserted) continue;
    const { error: linkError } = await admin.from("event_external_links").insert({
      event_id: inserted.id,
      connection_id: connectionId,
      external_id: ext.externalId,
      etag: ext.etag ?? null,
    });
    if (linkError) {
      // O evento externo já está vinculado a outro compromisso: desfaz a cópia
      await admin.from("events").delete().eq("id", inserted.id);
      continue;
    }
    await syncSharedData(admin, connection, inserted.id as string, ext, categories as { id: string; kind: string }[] | null);
    created++;
  }

  // Em sincronização completa, vínculos ausentes indicam exclusão no provedor
  if (result.fullSync) {
    for (const [externalId, link] of byExternal) {
      if (seen.has(externalId)) continue;
      await admin.from("events").update({ deleted_at: new Date().toISOString() }).eq("id", link.event_id).eq("source", connection.provider);
      await admin.from("event_external_links").delete().eq("event_id", link.event_id).eq("connection_id", connectionId);
      deleted++;
    }
  }

  await admin
    .from("calendar_connections")
    .update({ sync_token: result.nextSyncToken ?? connection.sync_token, last_synced_at: new Date().toISOString(), last_error: null })
    .eq("id", connectionId);

  return { created, updated, deleted };
}
