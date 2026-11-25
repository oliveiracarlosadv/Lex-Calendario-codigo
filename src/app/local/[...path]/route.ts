import { AuthError, handleAuth, userFromToken } from "@/infrastructure/local/auth";
import { getLocalDb, isLocalMode, isMissingFilesError, resetLocalDb } from "@/infrastructure/local/database";
import { bearer } from "@/infrastructure/local/jwt";
import { executeRest, RestError, runAs } from "@/infrastructure/local/rest";
import { handleStorage } from "@/infrastructure/local/storage";

/**
 * Backend local compatível com o Supabase (modo desktop/offline).
 * Só responde quando LEX_LOCAL=1; exige o cabeçalho "apikey" (bloqueia requisições
 * simples de outros sites) e um token válido para dados.
 */
export const runtime = "nodejs";
export const dynamic = "force-dynamic";

const pgrstError = (status: number, code: string, message: string, details: string | null = null) =>
  Response.json({ code, message, details, hint: null }, { status });

async function handle(request: Request, { params }: { params: Promise<{ path: string[] }> }) {
  if (!isLocalMode()) return new Response("Not found", { status: 404 });
  const { path } = await params;
  const [service, , ...rest] = path; // ex.: ["rest","v1","events"]

  if (service === "health") {
    try {
      const db = await getLocalDb();
      await db.query("select 1 from public.profiles limit 1");
      return Response.json({ ok: true });
    } catch (e) {
      if (isMissingFilesError(e)) await resetLocalDb();
      return Response.json({ ok: false, error: (e as Error).message }, { status: 503 });
    }
  }

  const isSignedStorageGet = service === "storage" && request.method === "GET" && rest[0] === "object" && rest[1] === "sign";
  if (!request.headers.get("apikey") && !isSignedStorageGet) return pgrstError(401, "PGRST301", "apikey ausente");

  const db = await getLocalDb();
  const token = bearer(request);
  const serviceKey = process.env.SUPABASE_SERVICE_ROLE_KEY;
  const isService = !!serviceKey && token === serviceKey;

  try {
    if (service === "auth") {
      const result = await handleAuth(db, rest.join("/"), request, token);
      return result === null ? new Response(null, { status: 204 }) : Response.json(result);
    }

    const user = isService ? null : await userFromToken(db, token);
    if (!isService && !user && !isSignedStorageGet) return pgrstError(401, "PGRST301", "Sessão inválida");

    if (service === "storage") return await handleStorage(rest, request);

    if (service === "rest") {
      const url = new URL(request.url);
      let body: unknown = null;
      if (request.method !== "GET" && request.method !== "HEAD") {
        const text = await request.text();
        body = text ? JSON.parse(text) : null;
      }
      const prefer = request.headers.get("prefer") ?? "";
      const result = await runAs(db, user?.id ?? null, (tx) =>
        executeRest(tx, { method: request.method, table: rest.join("/"), query: url.searchParams, body, prefer }),
      );

      const headers: Record<string, string> = {};
      const rows = result.rows;
      if (Array.isArray(rows)) headers["Content-Range"] = `${rows.length ? `0-${rows.length - 1}` : "*"}/${result.count ?? "*"}`;

      if (result.status === 204) return new Response(null, { status: 204, headers });
      const wantsObject = (request.headers.get("accept") ?? "").includes("application/vnd.pgrst.object+json");
      if (wantsObject && Array.isArray(rows)) {
        if (rows.length !== 1)
          return pgrstError(406, "PGRST116", "JSON object requested, multiple (or no) rows returned", `The result contains ${rows.length} rows`);
        return Response.json(rows[0], { status: result.status, headers });
      }
      if (result.status === 201 && Array.isArray(rows) && !rows.length && !/return=representation/.test(prefer))
        return new Response(null, { status: 201, headers });
      return Response.json(rows, { status: result.status, headers });
    }

    return pgrstError(404, "PGRST000", "Serviço indisponível no modo local");
  } catch (e) {
    if (e instanceof RestError) return pgrstError(e.status, e.code, e.message, e.details);
    if (e instanceof AuthError) return Response.json({ code: e.status, error_code: e.code, msg: e.message, message: e.message }, { status: e.status });
    console.error("[local]", e);
    if (isMissingFilesError(e)) await resetLocalDb();
    return pgrstError(500, "XX000", (e as Error).message ?? "Erro interno");
  }
}

export { handle as GET, handle as POST, handle as PATCH, handle as PUT, handle as DELETE, handle as HEAD };
