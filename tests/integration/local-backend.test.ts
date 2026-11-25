import { readdirSync, readFileSync } from "node:fs";
import type { PGlite } from "@electric-sql/pglite";
import { beforeAll, describe, expect, it } from "vitest";
import { handleAuth, userFromToken } from "@/infrastructure/local/auth";
import { getLocalDb } from "@/infrastructure/local/database";
import { MIGRATIONS } from "@/infrastructure/local/migrations.generated";
import { executeRest, runAs } from "@/infrastructure/local/rest";

process.env.LEX_LOCAL_SECRET = "segredo-de-teste";

let db: PGlite;
let userId: string;
let orgId: string;
let token: string;

const rest = (method: string, table: string, query = "", body: unknown = null, prefer = "") =>
  runAs(db, userId, (tx) => executeRest(tx, { method, table, query: new URLSearchParams(query), body, prefer }));
const rows = async <T = Record<string, unknown>>(p: ReturnType<typeof rest>) => (await p).rows as T[];

describe("migrations embutidas", () => {
  it("estão sincronizadas com supabase/migrations", () => {
    const files = readdirSync("supabase/migrations").filter((f) => f.endsWith(".sql")).sort();
    expect(MIGRATIONS.map((m) => m.name)).toEqual(files);
    for (const m of MIGRATIONS) expect(m.sql).toBe(readFileSync(`supabase/migrations/${m.name}`, "utf8"));
  });
});

describe("backend local (PGlite + API compatível com Supabase)", () => {
  beforeAll(async () => {
    db = await getLocalDb(null);
    const session = (await handleAuth(
      db,
      "signup",
      new Request("http://127.0.0.1/local/auth/v1/signup", { method: "POST", body: JSON.stringify({ data: { full_name: "Você", organization_name: "Meu escritório" } }) }),
      null,
    )) as { access_token: string; user: { id: string; is_anonymous: boolean } };
    token = session.access_token;
    userId = session.user.id;
    expect(session.user.is_anonymous).toBe(true);
  });

  it("entrar sem conta sempre devolve o mesmo usuário local", async () => {
    const again = (await handleAuth(db, "signup", new Request("http://x/signup", { method: "POST", body: "{}" }), null)) as { user: { id: string } };
    expect(again.user.id).toBe(userId);
    expect((await userFromToken(db, token))?.id).toBe(userId);
  });

  it("atualiza os dados do usuário (PUT /auth/v1/user)", async () => {
    const user = (await handleAuth(
      db,
      "user",
      new Request("http://x/user", { method: "PUT", body: JSON.stringify({ data: { full_name: "Dra. Teste" } }) }),
      token,
    )) as unknown as { user_metadata: { full_name: string } };
    expect(user.user_metadata.full_name).toBe("Dra. Teste");
  });

  it("cria perfil, escritório e categorias padrão pelo gatilho", async () => {
    const [profile] = await rows<{ current_organization_id: string; full_name: string }>(rest("GET", "profiles", `select=*&id=eq.${userId}`));
    expect(profile.full_name).toBe("Dra. Teste");
    orgId = profile.current_organization_id;
    const categories = await rows(rest("GET", "event_categories", `select=*&organization_id=eq.${orgId}&order=position.asc`));
    expect(categories).toHaveLength(9); // inclui "Tarefa"
  });

  it("insere e consulta com recursos embutidos, filtros e ordenação", async () => {
    const [client] = await rows<{ id: string }>(
      rest("POST", "clients", "select=id", { organization_id: orgId, name: "Marcos Albuquerque", document: "52998224725", tags: ["vip"] }, "return=representation"),
    );
    const [process] = await rows<{ id: string }>(
      rest("POST", "processes", "select=id", { organization_id: orgId, number: "0801234-16.2025.8.14.0301", client_id: client.id, tribunal: "TJPA" }, "return=representation"),
    );
    const start = new Date(Date.now() + 3 * 864e5).toISOString();
    const end = new Date(Date.now() + 3 * 864e5 + 3600e3).toISOString();
    const [event] = await rows<{ id: string }>(
      rest(
        "POST",
        "events",
        "select=id",
        { organization_id: orgId, title: "Audiência de conciliação", kind: "hearing", starts_at: start, ends_at: end, client_id: client.id, process_id: process.id, description: { type: "doc" } },
        "return=representation",
      ),
    );
    await rest("POST", "event_checklist_items", "", [{ organization_id: orgId, event_id: event.id, title: "Preparar acordo" }]);
    await rest(
      "POST",
      "event_reminders",
      "on_conflict=event_id,user_id,offset_minutes",
      { organization_id: orgId, event_id: event.id, user_id: userId, offset_minutes: 60, channels: ["in_app", "push"] },
      "resolution=merge-duplicates,return=representation",
    );

    const list = await rows<{ client: { name: string }; process: { number: string }; checklist: { is_done: boolean }[] }>(
      rest(
        "GET",
        "events",
        `select=id,title,client:clients(id,name),process:processes(id,number),checklist:event_checklist_items(is_done)&organization_id=eq.${orgId}&deleted_at=is.null&lt=x`.replace("&lt=x", "") +
          `&starts_at=lt.${new Date(Date.now() + 30 * 864e5).toISOString()}&ends_at=gte.${new Date().toISOString()}&order=starts_at.asc&limit=10`,
      ),
    );
    expect(list).toHaveLength(1);
    expect(list[0].client.name).toBe("Marcos Albuquerque");
    expect(list[0].process.number).toBe("0801234-16.2025.8.14.0301");
    expect(list[0].checklist).toEqual([{ is_done: false }]);

    const counted = await rows<{ processes: { count: number }[] }>(rest("GET", "clients", `select=*,processes(count)&organization_id=eq.${orgId}`));
    expect(counted[0].processes[0].count).toBe(1);

    const searched = await rows(rest("GET", "clients", `select=id&or=(name.ilike.%25marcos%25,email.ilike.%25marcos%25)`.replace(/%25/g, "%")));
    expect(searched).toHaveLength(1);

    const [process2] = await rows<{ next_hearing_at: string }>(rest("GET", "processes", `select=next_hearing_at&id=eq.${process.id}`));
    expect(process2.next_hearing_at).not.toBeNull();
  });

  it("atualiza, registra histórico e exclui", async () => {
    const [ev] = await rows<{ id: string }>(rest("GET", "events", "select=id&limit=1"));
    await rest("PATCH", "events", `id=eq.${ev.id}`, { status: "done", priority: "critical" });
    const history = await rows<{ action: string }>(rest("GET", "activity_log", `select=action&or=(and(entity_type.eq.event,entity_id.eq.${ev.id}),and(parent_type.eq.event,parent_id.eq.${ev.id}))`));
    expect(history.map((h) => h.action)).toContain("updated");
    await rest("DELETE", "event_checklist_items", `event_id=eq.${ev.id}`);
    expect(await rows(rest("GET", "event_checklist_items", `select=id&event_id=eq.${ev.id}`))).toHaveLength(0);
  });

  it("executa RPCs (painel, busca global e aceite de sugestão da IA)", async () => {
    const metrics = (await rest("POST", "rpc/dashboard_metrics", "", { org: orgId })).rows as { clients: number };
    expect(metrics.clients).toBe(1);
    const found = await rows<{ entity_type: string }>(rest("POST", "rpc/global_search", "", { org: orgId, q: "audiência", max_results: 5 }));
    expect(found.some((r) => r.entity_type === "event")).toBe(true);

    const [proc] = await rows<{ id: string }>(rest("GET", "processes", "select=id"));
    const s = await runAs(db, null, (tx) =>
      executeRest(tx, {
        method: "POST",
        table: "ai_suggestions",
        query: new URLSearchParams("select=id"),
        body: { organization_id: orgId, process_id: proc.id, kind: "deadline", title: "Prazo: contestação", starts_at: new Date(Date.now() + 10 * 864e5).toISOString(), confidence: 0.8 },
        prefer: "return=representation",
      }),
    );
    const suggestionId = (s.rows as { id: string }[])[0].id;
    const eventId = (await rest("POST", "rpc/accept_ai_suggestion", "", { suggestion_id: suggestionId })).rows;
    expect(typeof eventId).toBe("string");
  });

  it("semeia modelos de comunicação e grava comunicações com prazo e anexos", async () => {
    const templates = await rows<{ name: string; kind: string }>(rest("GET", "communication_templates", `select=name,kind&organization_id=eq.${orgId}&order=name.asc`));
    expect(templates.length).toBeGreaterThanOrEqual(5);
    expect(templates.map((t) => t.kind)).toEqual(expect.arrayContaining(["email", "oficio", "whatsapp"]));
    const [client] = await rows<{ id: string }>(rest("GET", "clients", `select=id&organization_id=eq.${orgId}&limit=1`));
    const [c] = await rows<{ id: string; status: string }>(
      rest(
        "POST",
        "communications",
        "select=id,status",
        {
          organization_id: orgId,
          kind: "email",
          status: "scheduled",
          client_id: client.id,
          to_email: "cliente@exemplo.com",
          subject: "Documentos",
          body: "Prezado(a)...",
          deadline_at: "2026-12-01",
          send_at: new Date(Date.now() - 60_000).toISOString(),
          attachments: [{ name: "a.pdf", path: `${orgId}/comunicacoes/a.pdf`, size: 10, mime: "application/pdf" }],
        },
        "return=representation",
      ),
    );
    expect(c.status).toBe("scheduled");
    const [saved] = await rows<{ deadline_at: string }>(rest("GET", "communications", `select=deadline_at&id=eq.${c.id}`));
    expect(saved.deadline_at).toBe("2026-12-01"); // colunas date voltam como no Supabase
    const due = await rows(rest("GET", "communications", `select=id,client:clients(name)&status=eq.scheduled&notified_at=is.null&send_at=lte.${new Date().toISOString()}`));
    expect(due).toHaveLength(1);
  });

  it("cadastra responsável sem conta e o atribui a uma tarefa", async () => {
    const [person] = await rows<{ id: string }>(
      rest("POST", "collaborators", "select=id", { organization_id: orgId, name: "Estagiária Ana", email: "ana@exemplo.com", role: "Estagiário(a)" }, "return=representation"),
    );
    const start = new Date(Date.now() + 864e5).toISOString();
    const [task] = await rows<{ id: string }>(
      rest("POST", "events", "select=id", { organization_id: orgId, title: "Protocolar petição", kind: "task", starts_at: start, ends_at: start, collaborator_id: person.id }, "return=representation"),
    );
    const [loaded] = await rows<{ collaborator: { name: string } }>(rest("GET", "events", `select=id,collaborator:collaborators(name)&id=eq.${task.id}`));
    expect(loaded.collaborator.name).toBe("Estagiária Ana");

    // Concluir grava a data; a nova tarefa aponta para a concluída
    await rest("PATCH", "events", `id=eq.${task.id}`, { status: "done" });
    const [next] = await rows<{ id: string }>(
      rest("POST", "events", "select=id", { organization_id: orgId, title: "Acompanhar despacho", kind: "task", starts_at: start, ends_at: start, related_event_id: task.id }, "return=representation"),
    );
    const [withRelated] = await rows<{ related: { title: string; status: string; completed_at: string | null } }>(
      rest("GET", "events", `select=id,related:events!related_event_id(title,status,completed_at)&id=eq.${next.id}`),
    );
    expect(withRelated.related.title).toBe("Protocolar petição");
    expect(withRelated.related.status).toBe("done");
    expect(withRelated.related.completed_at).not.toBeNull();
  });

  it("lista alterações do Lex ainda não enviadas ao Google", async () => {
    const [conn] = (
      await db.query<{ id: string }>(
        "insert into public.calendar_connections (organization_id, user_id, provider, account_email) values ($1, $2, 'google', 'x@gmail.com') returning id",
        [orgId, userId],
      )
    ).rows;
    const start = new Date(Date.now() + 2 * 864e5).toISOString();
    const [ev] = await rows<{ id: string }>(
      rest("POST", "events", "select=id", { organization_id: orgId, title: "Reunião nova", kind: "meeting", starts_at: start, ends_at: start, created_by: userId, responsible_id: userId }, "return=representation"),
    );
    const pending = async () => ((await db.query<{ event_id: string }>("select event_id from public.sync_pending_events($1, 100)", [conn.id])).rows).map((r) => r.event_id);
    expect(await pending()).toContain(ev.id); // nunca enviada

    await db.query("insert into public.event_external_links (event_id, connection_id, external_id, last_synced_at) values ($1, $2, 'g1', now() + interval '1 minute')", [ev.id, conn.id]);
    expect(await pending()).not.toContain(ev.id); // já enviada

    await db.query("update public.event_external_links set last_synced_at = now() - interval '1 minute' where event_id = $1", [ev.id]);
    await rest("POST", "event_checklist_items", "", [{ organization_id: orgId, event_id: ev.id, title: "Levar documentos" }]);
    expect(await pending()).toContain(ev.id); // checklist alterado depois do envio
  });

  it("processo identificado por nome, com número opcional, e encontrado pela busca global", async () => {
    const [proc] = await rows<{ id: string; number: string | null }>(
      rest("POST", "processes", "select=id,number", { organization_id: orgId, title: "Cobrança — contra Banco Exemplo" }, "return=representation"),
    );
    expect(proc.number).toBeNull();
    await expect(rest("POST", "processes", "", { organization_id: orgId })).rejects.toBeTruthy(); // sem nome e sem número
    const found = (await rest("POST", "rpc/global_search", "", { org: orgId, q: "banco exemplo" })).rows as { entity_type: string; title: string }[];
    expect(found.some((r) => r.entity_type === "process" && r.title.startsWith("Cobrança"))).toBe(true);
  });

  it("salva cliente mesmo recebendo a coluna calculada de busca (edição com o registro inteiro)", async () => {
    const [full] = await rows<Record<string, unknown>>(rest("GET", "clients", `select=*&organization_id=eq.${orgId}&limit=1`));
    expect(full.search).toBeDefined();
    const [saved] = await rows<{ name: string }>(rest("PATCH", "clients", `id=eq.${full.id}&select=name`, { ...full, name: "Nome Atualizado" }, "return=representation"));
    expect(saved.name).toBe("Nome Atualizado");
  });

  it("audiência é salva com AUDIÊNCIA: no início do nome, sem duplicar", async () => {
    const start = new Date(Date.now() + 5 * 864e5).toISOString();
    const [h] = await rows<{ id: string; title: string }>(
      rest("POST", "events", "select=id,title", { organization_id: orgId, title: "Instrução — Maria x Banco", kind: "hearing", starts_at: start, ends_at: start }, "return=representation"),
    );
    expect(h.title).toBe("AUDIÊNCIA: Instrução — Maria x Banco");
    const [again] = await rows<{ title: string }>(rest("PATCH", "events", `id=eq.${h.id}&select=title`, { title: "audiencia: Instrução remarcada" }, "return=representation"));
    expect(again.title).toBe("AUDIÊNCIA: Instrução remarcada");
    const [meeting] = await rows<{ title: string }>(rest("PATCH", "events", `id=eq.${h.id}&select=title`, { kind: "meeting" }, "return=representation"));
    expect(meeting.title).toBe("Instrução remarcada");
  });

  it("une compromissos duplicados mantendo o mais completo e o vínculo com o Google", async () => {
    const start = new Date(Date.now() + 9 * 864e5).toISOString();
    const end = new Date(Date.now() + 9 * 864e5 + 3600e3).toISOString();
    const [client] = await rows<{ id: string }>(rest("GET", "clients", `select=id&organization_id=eq.${orgId}&limit=1`));
    const [rich] = await rows<{ id: string }>(
      rest("POST", "events", "select=id", { organization_id: orgId, title: "Reunião Duplicada", kind: "meeting", source: "google", starts_at: start, ends_at: end, client_id: client.id }, "return=representation"),
    );
    await rest("POST", "event_comments", "", { organization_id: orgId, event_id: rich.id, author_id: userId, body: "nota" });
    const [bare] = await rows<{ id: string }>(
      rest("POST", "events", "select=id", { organization_id: orgId, title: "Reunião Duplicada", kind: "meeting", source: "google", starts_at: start, ends_at: end }, "return=representation"),
    );
    const [conn] = (await db.query<{ id: string }>("select id from public.calendar_connections limit 1")).rows;
    await db.query("insert into public.event_external_links (event_id, connection_id, external_id) values ($1, $2, 'dup-1')", [bare.id, conn.id]);

    const merged = (await db.query<{ n: number }>("select public.merge_duplicate_events($1) as n", [orgId])).rows[0].n;
    expect(merged).toBeGreaterThanOrEqual(1);
    const alive = (await db.query<{ id: string }>("select id from public.events where title = 'Reunião Duplicada' and deleted_at is null")).rows;
    expect(alive.map((e) => e.id)).toEqual([rich.id]);
    const link = (await db.query<{ event_id: string }>("select event_id from public.event_external_links where external_id = 'dup-1'")).rows[0];
    expect(link.event_id).toBe(rich.id);
  });

  it("cadastra parceiro, vincula a processo e marca audiência on-line", async () => {
    const [partner] = await rows<{ id: string }>(
      rest("POST", "partners", "select=id", { organization_id: orgId, name: "Correspondente Silva", category: "correspondente", fee_percent: 30 }, "return=representation"),
    );
    const [proc] = await rows<{ id: string; partner: { name: string } }>(
      rest("POST", "processes", "select=id,partner:partners(name)", { organization_id: orgId, title: "Ação em parceria", partner_id: partner.id, partner_fee_percent: 30 }, "return=representation"),
    );
    expect(proc.partner.name).toBe("Correspondente Silva");
    const start = new Date(Date.now() + 3 * 864e5).toISOString();
    const [h] = await rows<{ hearing_mode: string }>(
      rest("POST", "events", "select=hearing_mode", { organization_id: orgId, title: "Conciliação", kind: "hearing", starts_at: start, ends_at: start, hearing_mode: "online" }, "return=representation"),
    );
    expect(h.hearing_mode).toBe("online");
    await expect(rest("POST", "events", "", { organization_id: orgId, title: "X", kind: "hearing", starts_at: start, ends_at: start, hearing_mode: "hibrida" })).rejects.toBeTruthy();
  });

  it("parceiro como responsável da tarefa e exclusão de cliente mantendo os compromissos", async () => {
    const [partner] = await rows<{ id: string }>(rest("POST", "partners", "select=id", { organization_id: orgId, name: "Perita Costa", category: "perito" }, "return=representation"));
    const [cl] = await rows<{ id: string }>(rest("POST", "clients", "select=id", { organization_id: orgId, name: "Cliente Temporário" }, "return=representation"));
    const start = new Date(Date.now() + 4 * 864e5).toISOString();
    const [task] = await rows<{ id: string }>(
      rest("POST", "events", "select=id", { organization_id: orgId, title: "Laudo", kind: "task", starts_at: start, ends_at: start, partner_id: partner.id, client_id: cl.id }, "return=representation"),
    );
    const [withPartner] = await rows<{ partner: { name: string } }>(rest("GET", "events", `select=partner:partners(name)&id=eq.${task.id}`));
    expect(withPartner.partner.name).toBe("Perita Costa");

    await rest("DELETE", "clients", `id=eq.${cl.id}`);
    const [after] = await rows<{ id: string; client_id: string | null }>(rest("GET", "events", `select=id,client_id&id=eq.${task.id}`));
    expect(after.client_id).toBeNull();
  });

  it("anotações no processo e contatos do cliente para comunicação", async () => {
    const [proc] = await rows<{ id: string }>(rest("POST", "processes", "select=id", { organization_id: orgId, title: "Processo com anotações" }, "return=representation"));
    await rest("POST", "process_notes", "", { organization_id: orgId, process_id: proc.id, author_id: userId, body: "Cliente trouxe documentos" });
    const notes = await rows<{ body: string }>(rest("GET", "process_notes", `select=body&process_id=eq.${proc.id}`));
    expect(notes.map((n) => n.body)).toEqual(["Cliente trouxe documentos"]);

    const [cl] = await rows<{ id: string }>(rest("POST", "clients", "select=id", { organization_id: orgId, name: "Cliente com contato" }, "return=representation"));
    const [contact] = await rows<{ id: string }>(
      rest("POST", "client_contacts", "select=id", { organization_id: orgId, client_id: cl.id, name: "Maria (esposa)", relationship: "Cônjuge", email: "maria@exemplo.com" }, "return=representation"),
    );
    const [comm] = await rows<{ contact: { name: string } }>(
      rest("POST", "communications", "select=contact:client_contacts(name)", { organization_id: orgId, kind: "email", client_id: cl.id, contact_id: contact.id, subject: "Olá", body: "Texto" }, "return=representation"),
    );
    expect(comm.contact.name).toBe("Maria (esposa)");
  });

  it("tarefa com vários responsáveis e cliente com tipo de contrato", async () => {
    const start = new Date(Date.now() + 6 * 864e5).toISOString();
    const co = [{ type: "member", id: userId }, { type: "partner", id: "00000000-0000-0000-0000-000000000001" }];
    const [ev] = await rows<{ co_responsibles: unknown[] }>(
      rest("POST", "events", "select=co_responsibles", { organization_id: orgId, title: "Tarefa conjunta", kind: "task", starts_at: start, ends_at: start, co_responsibles: co }, "return=representation"),
    );
    expect(ev.co_responsibles).toHaveLength(2);
    const [cl] = await rows<{ contract_type: string }>(
      rest("POST", "clients", "select=contract_type", { organization_id: orgId, name: "Cliente Avença", contract_type: "fixo", contract_value: 1500 }, "return=representation"),
    );
    expect(cl.contract_type).toBe("fixo");
    await expect(rest("POST", "clients", "", { organization_id: orgId, name: "X", contract_type: "outro" })).rejects.toBeTruthy();
  });

  it("retorna erro 409 para duplicidade", async () => {
    await expect(rest("POST", "clients", "", { organization_id: orgId, name: "Outro", document: "52998224725" })).rejects.toMatchObject({ status: 409 });
  });
});
