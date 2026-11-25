import "server-only";
import type { PGlite, Transaction } from "@electric-sql/pglite";

/**
 * Subconjunto da API do PostgREST usado pelo supabase-js, executado sobre o PGlite:
 * select com recursos embutidos (muitos-para-um, um-para-muitos e count), filtros
 * (eq, neq, gt, gte, lt, lte, like, ilike, is, in, or/and), order, limit/offset,
 * insert/upsert, update, delete e RPC.
 */

type Db = Pick<Transaction, "query">;

interface Column {
  name: string;
  type: string; // format_type(...)
  category: string; // pg_type.typcategory: A = array, U = json etc.
  isJson: boolean;
  generated: boolean; // coluna calculada pelo banco (ex.: "search"): nunca é gravada
}

interface Relation {
  src: string;
  srcCol: string;
  dst: string;
  dstCol: string;
}

export class RestError extends Error {
  constructor(
    public status: number,
    public code: string,
    message: string,
    public details: string | null = null,
  ) {
    super(message);
  }
}

// ───────────────────────────── Metadados ─────────────────────────────

const columnCache = new Map<string, Map<string, Column>>();
let relationCache: Relation[] | null = null;
const pkCache = new Map<string, string[]>();

const IDENT = /^[a-z_][a-z0-9_]*$/;
function ident(name: string) {
  if (!IDENT.test(name)) throw new RestError(400, "PGRST100", `Identificador inválido: ${name}`);
  return `"${name}"`;
}

async function columnsOf(db: Db, table: string) {
  let cols = columnCache.get(table);
  if (cols) return cols;
  const { rows } = await db.query<{ name: string; type: string; category: string; typname: string; generated: boolean }>(
    `select a.attname as name, format_type(a.atttypid, a.atttypmod) as type, t.typcategory as category, t.typname,
            a.attgenerated <> '' as generated
       from pg_attribute a
       join pg_class c on c.oid = a.attrelid
       join pg_namespace n on n.oid = c.relnamespace
       join pg_type t on t.oid = a.atttypid
      where n.nspname = 'public' and c.relname = $1 and a.attnum > 0 and not a.attisdropped`,
    [table],
  );
  if (!rows.length) throw new RestError(404, "PGRST205", `Tabela não encontrada: ${table}`);
  cols = new Map(rows.map((r) => [r.name, { name: r.name, type: r.type, category: r.category, isJson: r.typname === "jsonb" || r.typname === "json", generated: r.generated }]));
  columnCache.set(table, cols);
  return cols;
}

async function relations(db: Db) {
  if (relationCache) return relationCache;
  const { rows } = await db.query<Relation>(
    `select cs.relname as src, sa.attname as "srcCol", cd.relname as dst, da.attname as "dstCol"
       from pg_constraint con
       join pg_class cs on cs.oid = con.conrelid
       join pg_namespace ns on ns.oid = cs.relnamespace
       join pg_class cd on cd.oid = con.confrelid
       join pg_namespace nd on nd.oid = cd.relnamespace
       join pg_attribute sa on sa.attrelid = con.conrelid and sa.attnum = con.conkey[1]
       join pg_attribute da on da.attrelid = con.confrelid and da.attnum = con.confkey[1]
      where con.contype = 'f' and ns.nspname = 'public' and nd.nspname = 'public'`,
  );
  relationCache = rows;
  return rows;
}

async function primaryKey(db: Db, table: string) {
  const cached = pkCache.get(table);
  if (cached) return cached;
  const { rows } = await db.query<{ name: string }>(
    `select a.attname as name from pg_index i
       join pg_class c on c.oid = i.indrelid
       join pg_namespace n on n.oid = c.relnamespace
       join pg_attribute a on a.attrelid = c.oid and a.attnum = any(i.indkey)
      where i.indisprimary and n.nspname = 'public' and c.relname = $1`,
    [table],
  );
  const pk = rows.map((r) => r.name);
  pkCache.set(table, pk);
  return pk;
}

// ───────────────────────────── Parâmetros ─────────────────────────────

class Params {
  values: (string | null)[] = [];
  add(v: unknown, col?: Column) {
    this.values.push(serialize(v, col));
    return `$${this.values.length}`;
  }
}

function pgArrayLiteral(values: unknown[]) {
  return `{${values.map((v) => (v === null ? "NULL" : `"${String(v).replace(/["\\]/g, "\\$&")}"`)).join(",")}}`;
}

function serialize(v: unknown, col?: Column): string | null {
  if (v === null || v === undefined) return null;
  if (col?.isJson) return JSON.stringify(v);
  if (Array.isArray(v)) return pgArrayLiteral(v);
  if (typeof v === "object") return JSON.stringify(v);
  return String(v);
}

const cast = (placeholder: string, col?: Column) => (col ? `${placeholder}::${col.type}` : placeholder);

// ───────────────────────────── select ─────────────────────────────

interface SelectItem {
  alias: string | null;
  name: string;
  hint: string | null; // "tabela!coluna": chave estrangeira a usar
  inner: string | null; // conteúdo entre parênteses (recurso embutido)
}

function splitTopLevel(input: string, sep = ","): string[] {
  const out: string[] = [];
  let depth = 0;
  let quote = false;
  let cur = "";
  for (const ch of input) {
    if (ch === '"') quote = !quote;
    if (!quote && ch === "(") depth++;
    if (!quote && ch === ")") depth--;
    if (!quote && depth === 0 && ch === sep) {
      out.push(cur);
      cur = "";
    } else cur += ch;
  }
  if (cur.trim()) out.push(cur);
  return out.map((s) => s.trim()).filter(Boolean);
}

function parseSelect(spec: string): SelectItem[] {
  return splitTopLevel(spec.replace(/\s+/g, " ")).map((raw) => {
    const m = /^(?:([a-z_][a-z0-9_]*)\s*:\s*)?([a-z_][a-z0-9_]*|\*)(?:!([a-z0-9_]+))?(?:\s*\((.*)\))?$/i.exec(raw.trim());
    if (!m) throw new RestError(400, "PGRST100", `Seleção inválida: ${raw}`);
    return { alias: m[1] ?? null, name: m[2], hint: m[3] ?? null, inner: m[4] !== undefined ? m[4] : null };
  });
}

let aliasCounter = 0;

async function buildSelectList(db: Db, table: string, alias: string, spec: string): Promise<string> {
  const cols = await columnsOf(db, table);
  const rels = await relations(db);
  const parts: string[] = [];
  for (const item of parseSelect(spec || "*")) {
    if (item.inner === null) {
      if (item.name === "*") parts.push(`${alias}.*`);
      else {
        if (!cols.has(item.name)) throw new RestError(400, "42703", `Coluna inexistente: ${table}.${item.name}`);
        parts.push(`${alias}.${ident(item.name)}${item.alias ? ` as ${ident(item.alias)}` : ""}`);
      }
      continue;
    }
    // "tabela!coluna" indica qual chave estrangeira usar (ex.: related:events!related_event_id(...))
    const target = item.name;
    const hint = item.hint;
    const outName = ident(item.alias ?? target);
    const sub = `e${++aliasCounter}`;
    const candidates = rels.filter((r) => r.src === table && r.dst === target);
    const manyToOne =
      candidates.find((r) => hint && r.srcCol === hint) ?? candidates.find((r) => item.alias && r.srcCol === `${item.alias}_id`) ?? (hint ? undefined : candidates[0]);
    const oneToMany = rels.find((r) => r.src === target && r.dst === table);

    if (item.inner.trim() === "count") {
      if (!oneToMany) throw new RestError(400, "PGRST200", `Sem relação entre ${table} e ${target}`);
      parts.push(
        `(select jsonb_build_array(jsonb_build_object('count', count(*))) from public.${ident(target)} ${sub} where ${sub}.${ident(oneToMany.srcCol)} = ${alias}.${ident(oneToMany.dstCol)}) as ${outName}`,
      );
      continue;
    }
    const innerList = await buildSelectList(db, target, sub, item.inner);
    if (manyToOne) {
      parts.push(
        `(select to_jsonb(s) from (select ${innerList} from public.${ident(target)} ${sub} where ${sub}.${ident(manyToOne.dstCol)} = ${alias}.${ident(manyToOne.srcCol)} limit 1) s) as ${outName}`,
      );
    } else if (oneToMany) {
      parts.push(
        `coalesce((select jsonb_agg(to_jsonb(s)) from (select ${innerList} from public.${ident(target)} ${sub} where ${sub}.${ident(oneToMany.srcCol)} = ${alias}.${ident(oneToMany.dstCol)}) s), '[]'::jsonb) as ${outName}`,
      );
    } else {
      throw new RestError(400, "PGRST200", `Sem relação entre ${table} e ${target}`);
    }
  }
  return parts.join(", ");
}

// ───────────────────────────── Filtros ─────────────────────────────

const RESERVED = new Set(["select", "order", "limit", "offset", "on_conflict", "columns"]);
const OPS: Record<string, string> = { eq: "=", neq: "<>", gt: ">", gte: ">=", lt: "<", lte: "<=" };

function unquote(v: string) {
  return v.startsWith('"') && v.endsWith('"') ? v.slice(1, -1).replace(/\\"/g, '"') : v;
}

async function condition(db: Db, table: string, alias: string, column: string, expr: string, p: Params): Promise<string> {
  const cols = await columnsOf(db, table);
  const col = cols.get(column);
  if (!col) throw new RestError(400, "42703", `Coluna inexistente: ${table}.${column}`);
  const ref = `${alias}.${ident(column)}`;
  let negate = false;
  let rest = expr;
  if (rest.startsWith("not.")) {
    negate = true;
    rest = rest.slice(4);
  }
  const dot = rest.indexOf(".");
  const op = dot >= 0 ? rest.slice(0, dot) : rest;
  const value = dot >= 0 ? rest.slice(dot + 1) : "";
  let sql: string;
  if (OPS[op]) sql = `${ref} ${OPS[op]} ${cast(p.add(unquote(value), col), col)}`;
  else if (op === "like" || op === "ilike") sql = `${ref}::text ${op === "like" ? "like" : "ilike"} ${p.add(unquote(value).replace(/\*/g, "%"))}`;
  else if (op === "is") {
    const v = value.toLowerCase();
    if (!["null", "true", "false", "unknown"].includes(v)) throw new RestError(400, "PGRST100", `Valor inválido para is: ${value}`);
    sql = `${ref} is ${v}`;
  } else if (op === "in") {
    const list = splitTopLevel(value.replace(/^\(|\)$/g, "")).map(unquote);
    sql = list.length ? `${ref} in (${list.map((v) => cast(p.add(v, col), col)).join(", ")})` : "false";
  } else throw new RestError(400, "PGRST100", `Operador não suportado: ${op}`);
  return negate ? `not (${sql})` : sql;
}

async function logicTree(db: Db, table: string, alias: string, kind: "or" | "and", body: string, p: Params): Promise<string> {
  const parts: string[] = [];
  for (const raw of splitTopLevel(body.replace(/^\(|\)$/g, ""))) {
    const nested = /^(not\.)?(and|or)\((.*)\)$/.exec(raw);
    if (nested) {
      const inner = await logicTree(db, table, alias, nested[2] as "or" | "and", nested[3], p);
      parts.push(nested[1] ? `not ${inner}` : inner);
      continue;
    }
    const dot = raw.indexOf(".");
    if (dot < 0) throw new RestError(400, "PGRST100", `Filtro inválido: ${raw}`);
    parts.push(await condition(db, table, alias, raw.slice(0, dot), raw.slice(dot + 1), p));
  }
  return parts.length ? `(${parts.join(` ${kind} `)})` : "true";
}

async function whereClause(db: Db, table: string, alias: string, query: URLSearchParams, p: Params) {
  const conds: string[] = [];
  for (const [key, value] of query.entries()) {
    if (RESERVED.has(key)) continue;
    if (key === "or" || key === "and") conds.push(await logicTree(db, table, alias, key, value, p));
    else conds.push(await condition(db, table, alias, key, value, p));
  }
  return conds.length ? ` where ${conds.join(" and ")}` : "";
}

function orderClause(order: string | null, alias: string) {
  if (!order) return "";
  const parts = order.split(",").map((o) => {
    const [col, ...mods] = o.split(".");
    const dir = mods.includes("desc") ? "desc" : "asc";
    const nulls = mods.includes("nullsfirst") ? " nulls first" : mods.includes("nullslast") ? " nulls last" : "";
    return `${alias}.${ident(col)} ${dir}${nulls}`;
  });
  return ` order by ${parts.join(", ")}`;
}

function limitClause(query: URLSearchParams) {
  const limit = Number(query.get("limit"));
  const offset = Number(query.get("offset"));
  return `${Number.isFinite(limit) && limit > 0 ? ` limit ${Math.floor(limit)}` : ""}${Number.isFinite(offset) && offset > 0 ? ` offset ${Math.floor(offset)}` : ""}`;
}

// ───────────────────────────── Execução ─────────────────────────────

export interface RestRequest {
  method: string;
  table: string; // ou "rpc/<função>"
  query: URLSearchParams;
  body: unknown;
  prefer: string;
}

export interface RestResult {
  status: number;
  rows: unknown[] | unknown;
  count?: number;
  isRpcScalar?: boolean;
}

function translateError(e: unknown): never {
  if (e instanceof RestError) throw e;
  const err = e as { code?: string; message?: string; detail?: string };
  const status = err.code === "23505" ? 409 : err.code === "23503" || err.code === "23502" || err.code === "23514" || err.code === "22P02" ? 400 : err.code === "P0001" ? 400 : 500;
  throw new RestError(status, err.code ?? "XX000", err.message ?? "Erro no banco local", err.detail ?? null);
}

export async function executeRest(db: Db, req: RestRequest): Promise<RestResult> {
  aliasCounter = 0;
  try {
    if (req.table.startsWith("rpc/")) return await rpc(db, req.table.slice(4), (req.body ?? {}) as Record<string, unknown>);
    const table = req.table;
    if (!IDENT.test(table)) throw new RestError(404, "PGRST205", "Recurso inválido");
    const select = req.query.get("select") ?? "*";
    const p = new Params();
    const wantsRows = req.method === "GET" || req.method === "HEAD" || /return=representation/.test(req.prefer);

    if (req.method === "GET" || req.method === "HEAD") {
      const list = await buildSelectList(db, table, "t0", select);
      const where = await whereClause(db, table, "t0", req.query, p);
      const sql = `select ${list} from public.${ident(table)} t0${where}${orderClause(req.query.get("order"), "t0")}${limitClause(req.query)}`;
      const { rows } = await db.query(sql, p.values);
      let count: number | undefined;
      if (/count=exact/.test(req.prefer)) {
        const c = new Params();
        const w = await whereClause(db, table, "t0", req.query, c);
        const r = await db.query<{ n: number }>(`select count(*)::int as n from public.${ident(table)} t0${w}`, c.values);
        count = r.rows[0]?.n ?? 0;
      }
      return { status: 200, rows, count };
    }

    const cols = await columnsOf(db, table);

    if (req.method === "POST") {
      const items = (Array.isArray(req.body) ? req.body : [req.body]) as Record<string, unknown>[];
      if (!items.length) return { status: 201, rows: [] };
      const keys = [...new Set(items.flatMap((r) => Object.keys(r)))].filter((k) => cols.has(k) && !cols.get(k)!.generated);
      const values = items
        .map((row) => `(${keys.map((k) => (k in row ? cast(p.add(row[k], cols.get(k)), cols.get(k)) : "default")).join(", ")})`)
        .join(", ");
      let conflict = "";
      if (/resolution=(merge|ignore)-duplicates/.test(req.prefer)) {
        const target = req.query.get("on_conflict")?.split(",").map((c) => c.trim()) ?? (await primaryKey(db, table));
        const updatable = keys.filter((k) => !target.includes(k));
        conflict = /merge-duplicates/.test(req.prefer) && updatable.length
          ? ` on conflict (${target.map(ident).join(", ")}) do update set ${updatable.map((k) => `${ident(k)} = excluded.${ident(k)}`).join(", ")}`
          : ` on conflict (${target.map(ident).join(", ")}) do nothing`;
      }
      const list = wantsRows ? await buildSelectList(db, table, "t0", select) : "1 as ok";
      const sql = `with w as (insert into public.${ident(table)} (${keys.map(ident).join(", ")}) values ${values}${conflict} returning *) select ${list} from w t0`;
      const { rows } = await db.query(sql, p.values);
      return { status: 201, rows: wantsRows ? rows : [], count: rows.length };
    }

    if (req.method === "PATCH") {
      const patch = (req.body ?? {}) as Record<string, unknown>;
      const keys = Object.keys(patch).filter((k) => cols.has(k) && !cols.get(k)!.generated);
      if (!keys.length) throw new RestError(400, "PGRST102", "Nada para atualizar");
      const sets = keys.map((k) => `${ident(k)} = ${cast(p.add(patch[k], cols.get(k)), cols.get(k))}`).join(", ");
      const where = await whereClause(db, table, "t0", req.query, p);
      const list = wantsRows ? await buildSelectList(db, table, "t0", select) : "1 as ok";
      const sql = `with w as (update public.${ident(table)} t0 set ${sets}${where} returning t0.*) select ${list} from w t0`;
      const { rows } = await db.query(sql, p.values);
      return { status: wantsRows ? 200 : 204, rows: wantsRows ? rows : [], count: rows.length };
    }

    if (req.method === "DELETE") {
      const where = await whereClause(db, table, "t0", req.query, p);
      const list = wantsRows ? await buildSelectList(db, table, "t0", select) : "1 as ok";
      const sql = `with w as (delete from public.${ident(table)} t0${where} returning t0.*) select ${list} from w t0`;
      const { rows } = await db.query(sql, p.values);
      return { status: wantsRows ? 200 : 204, rows: wantsRows ? rows : [], count: rows.length };
    }

    throw new RestError(405, "PGRST117", `Método não suportado: ${req.method}`);
  } catch (e) {
    translateError(e);
  }
}

async function rpc(db: Db, fn: string, args: Record<string, unknown>): Promise<RestResult> {
  if (!IDENT.test(fn)) throw new RestError(404, "PGRST202", "Função inválida");
  const { rows } = await db.query<{ retset: boolean; names: string[] | null; types: string[] }>(
    `select p.proretset as retset, p.proargnames as names,
            array(select format_type(t, null) from unnest(p.proargtypes::oid[]) t) as types
       from pg_proc p join pg_namespace n on n.oid = p.pronamespace
      where n.nspname = 'public' and p.proname = $1 limit 1`,
    [fn],
  );
  const meta = rows[0];
  if (!meta) throw new RestError(404, "PGRST202", `Função não encontrada: ${fn}`);
  const p = new Params();
  const named = Object.entries(args)
    .filter(([k]) => meta.names?.includes(k))
    .map(([k, v]) => {
      const type = meta.types[meta.names!.indexOf(k)];
      const col: Column = { name: k, type, category: "", isJson: type === "jsonb" || type === "json", generated: false };
      return `${ident(k)} => ${cast(p.add(v, col), col)}`;
    })
    .join(", ");
  if (meta.retset) {
    const r = await db.query(`select * from public.${ident(fn)}(${named})`, p.values);
    return { status: 200, rows: r.rows };
  }
  const r = await db.query<{ result: unknown }>(`select public.${ident(fn)}(${named}) as result`, p.values);
  return { status: 200, rows: r.rows[0]?.result ?? null, isRpcScalar: true };
}

/** Executa como um usuário: define auth.uid() dentro de uma transação. */
export async function runAs<T>(db: PGlite, userId: string | null, fn: (tx: Db) => Promise<T>): Promise<T> {
  return db.transaction(async (tx) => {
    await tx.query("select set_config('request.jwt.claim.sub', $1, true)", [userId ?? ""]);
    return fn(tx);
  });
}
