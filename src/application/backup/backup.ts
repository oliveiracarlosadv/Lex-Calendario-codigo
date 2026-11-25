import "server-only";
import { getSupabaseAdminClient } from "@/infrastructure/supabase/server";

type Admin = ReturnType<typeof getSupabaseAdminClient>;
type Row = Record<string, unknown> & { id?: string };

/**
 * Backup completo do escritório: dados, rotinas e configurações.
 * Formato: { app, format, version, exportedAt, organization, profile, tables, files }.
 * A importação é idempotente (mesmos IDs são atualizados) e remapeia vínculos para a
 * instalação de destino (categorias por nome, clientes por CPF/CNPJ, processos pelo número).
 */
export const BACKUP_FORMAT = 1;

/** Ordem respeita as chaves estrangeiras. */
const TABLES = [
  "event_categories",
  "clients",
  "client_contacts",
  "partners",
  "processes",
  "collaborators",
  "events",
  "event_checklist_items",
  "event_reminders",
  "event_comments",
  "event_attachments",
  "process_movements",
  "process_notes",
  "oab_monitors",
  "intimations",
  "ai_suggestions",
  "communication_templates",
  "communications",
] as const;
type TableName = (typeof TABLES)[number];

const GENERATED = new Set(["search"]);
const USER_COLUMNS = ["created_by", "responsible_id", "user_id", "author_id", "decided_by", "done_by", "uploaded_by"];
const MAX_FILES_BYTES = 300 * 1024 * 1024;

export interface BackupFile {
  app: "lex-calendario";
  format: number;
  version: string;
  exportedAt: string;
  organization: { id: string; name: string; document: string | null; settings: unknown };
  profile: {
    full_name: string | null;
    phone: string | null;
    oab_number: string | null;
    oab_state: string | null;
    timezone: string;
    preferences: unknown;
    profession?: string | null;
    document?: string | null;
  } | null;
  /** Equipe do escritório (quem tem acesso), para conferência; os responsáveis cadastrados vão em tables.collaborators. */
  team?: { name: string | null; email: string | null; role: string; profession: string | null; oab: string | null }[];
  tables: Partial<Record<TableName, Row[]>>;
  files?: Record<string, string>; // storage_path → base64
  filesSkipped?: number;
}

async function fetchAll(admin: Admin, table: TableName, orgId: string) {
  const rows: Row[] = [];
  for (let offset = 0; ; offset += 1000) {
    const { data, error } = await admin.from(table).select("*").eq("organization_id", orgId).order("id").range(offset, offset + 999);
    if (error) throw new Error(`${table}: ${error.message}`);
    const page = (data ?? []) as Row[];
    rows.push(...page.map((r) => Object.fromEntries(Object.entries(r).filter(([k]) => !GENERATED.has(k)))));
    if (page.length < 1000) break;
  }
  return rows;
}

export async function exportBackup(orgId: string, userId: string | null, opts: { includeFiles: boolean }): Promise<BackupFile> {
  const admin = getSupabaseAdminClient();
  const { data: org } = await admin.from("organizations").select("id, name, document, settings").eq("id", orgId).single();
  const { data: profile } = userId
    ? await admin.from("profiles").select("full_name, phone, oab_number, oab_state, timezone, preferences, profession, document").eq("id", userId).maybeSingle()
    : { data: null };

  const { data: memberships } = await admin.from("memberships").select("user_id, role").eq("organization_id", orgId);
  const memberIds = ((memberships ?? []) as { user_id: string }[]).map((m) => m.user_id);
  const { data: memberProfiles } = memberIds.length
    ? await admin.from("profiles").select("id, full_name, email, profession, oab_number, oab_state").in("id", memberIds)
    : { data: [] };
  const team = ((memberships ?? []) as { user_id: string; role: string }[]).map((m) => {
    const p = ((memberProfiles ?? []) as Row[]).find((x) => x.id === m.user_id);
    return {
      name: (p?.full_name as string | null) ?? null,
      email: (p?.email as string | null) ?? null,
      role: m.role,
      profession: (p?.profession as string | null) ?? null,
      oab: p?.oab_number ? `${p.oab_number as string}/${(p.oab_state as string | null) ?? ""}` : null,
    };
  });

  const tables: BackupFile["tables"] = {};
  for (const t of TABLES) tables[t] = await fetchAll(admin, t, orgId);

  const backup: BackupFile = {
    app: "lex-calendario",
    format: BACKUP_FORMAT,
    version: process.env.LEX_DESKTOP_VERSION ?? process.env.NEXT_PUBLIC_APP_VERSION ?? "dev",
    exportedAt: new Date().toISOString(),
    organization: { id: org?.id ?? orgId, name: org?.name ?? "", document: org?.document ?? null, settings: org?.settings ?? {} },
    profile: (profile as BackupFile["profile"]) ?? null,
    team,
    tables,
  };

  if (opts.includeFiles) {
    backup.files = {};
    let total = 0;
    let skipped = 0;
    for (const a of (tables.event_attachments ?? []) as { storage_path: string; size_bytes: number }[]) {
      if (total + Number(a.size_bytes) > MAX_FILES_BYTES) {
        skipped++;
        continue;
      }
      const { data: signed } = await admin.storage.from("attachments").createSignedUrl(a.storage_path, 120);
      const res = signed?.signedUrl ? await fetch(signed.signedUrl).catch(() => null) : null;
      if (!res?.ok) {
        skipped++;
        continue;
      }
      const buf = Buffer.from(await res.arrayBuffer());
      total += buf.byteLength;
      backup.files[a.storage_path] = buf.toString("base64");
    }
    backup.filesSkipped = skipped;
  }
  return backup;
}

// ───────────────────────────── Importação ─────────────────────────────

export interface ImportSummary {
  imported: Record<string, number>;
  failed: Record<string, number>;
  files: number;
  settingsRestored: boolean;
}

export async function importBackup(input: unknown, orgId: string, userId: string, opts: { restoreSettings: boolean }): Promise<ImportSummary> {
  const backup = input as BackupFile;
  if (backup?.app !== "lex-calendario" || typeof backup.format !== "number" || !backup.tables) throw new Error("Arquivo não é um backup do Lex Calendário.");
  if (backup.format > BACKUP_FORMAT) throw new Error("Este backup foi gerado por uma versão mais nova do Lex Calendário. Atualize o app e tente novamente.");

  const admin = getSupabaseAdminClient();
  const summary: ImportSummary = { imported: {}, failed: {}, files: 0, settingsRestored: false };
  const { data: members } = await admin.from("memberships").select("user_id").eq("organization_id", orgId);
  const memberIds = new Set((members ?? []).map((m) => m.user_id as string));
  const sourceOrg = backup.organization?.id;

  // Mapas de IDs do backup → IDs desta instalação
  const idMap: Record<string, Map<string, string>> = { categories: new Map(), clients: new Map(), processes: new Map(), templates: new Map() };

  const { data: cats } = await admin.from("event_categories").select("id, name").eq("organization_id", orgId);
  for (const c of (backup.tables.event_categories ?? []) as { id: string; name: string }[]) {
    const same = (cats ?? []).find((x) => (x.name as string).toLowerCase() === c.name.toLowerCase());
    if (same) idMap.categories.set(c.id, same.id as string);
  }
  const { data: clients } = await admin.from("clients").select("id, document").eq("organization_id", orgId).not("document", "is", null);
  for (const c of (backup.tables.clients ?? []) as { id: string; document: string | null }[]) {
    const same = c.document ? (clients ?? []).find((x) => x.document === c.document) : null;
    if (same) idMap.clients.set(c.id, same.id as string);
  }
  const { data: procs } = await admin.from("processes").select("id, number").eq("organization_id", orgId);
  for (const p of (backup.tables.processes ?? []) as { id: string; number: string | null }[]) {
    const same = p.number ? (procs ?? []).find((x) => x.number === p.number) : null;
    if (same) idMap.processes.set(p.id, same.id as string);
  }

  const { data: tpls } = await admin.from("communication_templates").select("id, name").eq("organization_id", orgId);
  for (const t of (backup.tables.communication_templates ?? []) as { id: string; name: string }[]) {
    const same = (tpls ?? []).find((x) => (x.name as string).toLowerCase() === t.name.toLowerCase());
    if (same) idMap.templates.set(t.id, same.id as string);
  }

  const remap = (row: Row, table: TableName): Row => {
    const r: Row = { ...row, organization_id: orgId };
    for (const col of USER_COLUMNS) if (col in r && r[col] && !memberIds.has(r[col] as string)) r[col] = userId;
    if (table === "event_categories" && r.id && idMap.categories.has(r.id)) r.id = idMap.categories.get(r.id);
    if (table === "clients" && r.id && idMap.clients.has(r.id)) r.id = idMap.clients.get(r.id);
    if (table === "processes" && r.id && idMap.processes.has(r.id)) r.id = idMap.processes.get(r.id);
    if (table === "communication_templates" && r.id && idMap.templates.has(r.id)) r.id = idMap.templates.get(r.id);
    if (typeof r.template_id === "string") r.template_id = idMap.templates.get(r.template_id) ?? r.template_id;
    if (typeof r.category_id === "string") r.category_id = idMap.categories.get(r.category_id) ?? r.category_id;
    if (typeof r.client_id === "string") r.client_id = idMap.clients.get(r.client_id) ?? r.client_id;
    if (typeof r.process_id === "string") r.process_id = idMap.processes.get(r.process_id) ?? r.process_id;
    if (table === "event_attachments" && typeof r.storage_path === "string" && sourceOrg) {
      r.storage_path = (r.storage_path as string).replace(new RegExp(`^${sourceOrg}/`), `${orgId}/`);
    }
    for (const k of Object.keys(r)) if (GENERATED.has(k)) delete r[k];
    return r;
  };

  for (const table of TABLES) {
    const rows = ((backup.tables[table] ?? []) as Row[]).map((r) => remap(r, table));
    let ok = 0;
    let failed = 0;
    for (let i = 0; i < rows.length; i += 200) {
      const batch = rows.slice(i, i + 200);
      const { error } = await admin.from(table).upsert(batch, { onConflict: "id" });
      if (!error) {
        ok += batch.length;
        continue;
      }
      // Lote com conflito (ex.: dado duplicado por outra chave única): tenta linha a linha
      for (const row of batch) {
        const { error: rowError } = await admin.from(table).upsert(row, { onConflict: "id" });
        if (rowError) failed++;
        else ok++;
      }
    }
    summary.imported[table] = ok;
    if (failed) summary.failed[table] = failed;
  }

  // Arquivos anexados
  for (const [path, base64] of Object.entries(backup.files ?? {})) {
    const target = sourceOrg ? path.replace(new RegExp(`^${sourceOrg}/`), `${orgId}/`) : path;
    const bytes = Buffer.from(base64, "base64");
    const { error } = await admin.storage.from("attachments").upload(target, new Blob([bytes]), { upsert: true });
    if (!error) summary.files++;
  }

  // Une compromissos que ficaram duplicados (ex.: já vindos do Google nesta instalação)
  await admin.rpc("merge_duplicate_events", { org: orgId });

  if (opts.restoreSettings) {
    // Escritório: nome, CNPJ, logomarca, endereço, feriados e demais preferências
    if (backup.organization) {
      const { name, document, settings } = backup.organization;
      await admin
        .from("organizations")
        .update({ ...(name && name.length >= 2 ? { name } : {}), ...(document ? { document } : {}), ...(settings ? { settings } : {}) })
        .eq("id", orgId);
    }
    if (backup.profile) {
      const { full_name, phone, oab_number, oab_state, timezone, preferences, profession, document } = backup.profile;
      await admin
        .from("profiles")
        .update({ full_name, phone, oab_number, oab_state, timezone, preferences, ...(profession !== undefined ? { profession } : {}), ...(document !== undefined ? { document } : {}) })
        .eq("id", userId);
    }
    summary.settingsRestored = true;
  }
  return summary;
}

/** Usado pelo backup automático do app desktop (sem sessão de usuário). */
export async function primaryOrganization() {
  const admin = getSupabaseAdminClient();
  const { data } = await admin.from("memberships").select("organization_id, user_id, role, created_at").order("created_at").limit(1).maybeSingle();
  return data ? { orgId: data.organization_id as string, userId: data.user_id as string } : null;
}
