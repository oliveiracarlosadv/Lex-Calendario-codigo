import { AuthError, handleAuth, userFromToken } from "@/infrastructure/local/auth";
import { getLocalDb } from "@/infrastructure/local/database";
import { bearer } from "@/infrastructure/local/jwt";
import { executeRest, RestError, runAs } from "@/infrastructure/local/rest";
import { handleStorage } from "@/infrastructure/local/storage";

/** O mesmo backend do app de computador (app/local/[...path]), executado dentro do navegador. */
const pgrstError = (status: number, code: string, message: string, details: string | null = null) =>
  Response.json({ code, message, details, hint: null }, { status });

export async function handleLocal(request: Request): Promise<Response> {
  const url = new URL(request.url);
  const [service, , ...rest] = url.pathname.slice(url.pathname.indexOf("/local/") + 7).split("/").map(decodeURIComponent);
  const db = await getLocalDb();
  const token = bearer(request);
  const isSignedGet = service === "storage" && request.method === "GET" && rest[0] === "object" && rest[1] === "sign";

  try {
    if (service === "auth") {
      const result = await handleAuth(db, rest.join("/"), request, token);
      return result === null ? new Response(null, { status: 204 }) : Response.json(result);
    }
    const user = await userFromToken(db, token);
    if (!user && !isSignedGet) return pgrstError(401, "PGRST301", "Sessão inválida");
    if (service === "storage") return await handleStorage(rest, request);
    if (service !== "rest") return pgrstError(404, "PGRST000", "Serviço indisponível");

    let body: unknown = null;
    if (request.method !== "GET" && request.method !== "HEAD") {
      const text = await request.text();
      body = text ? JSON.parse(text) : null;
    }
    const prefer = request.headers.get("prefer") ?? "";
    const result = await runAs(db as never, user?.id ?? null, (tx) =>
      executeRest(tx, { method: request.method, table: rest.join("/"), query: url.searchParams, body, prefer }),
    );
    const headers: Record<string, string> = {};
    const rows = result.rows;
    if (Array.isArray(rows)) headers["Content-Range"] = `${rows.length ? `0-${rows.length - 1}` : "*"}/${result.count ?? "*"}`;
    if (result.status === 204) return new Response(null, { status: 204, headers });
    if ((request.headers.get("accept") ?? "").includes("application/vnd.pgrst.object+json") && Array.isArray(rows)) {
      if (rows.length !== 1) return pgrstError(406, "PGRST116", "JSON object requested, multiple (or no) rows returned", `The result contains ${rows.length} rows`);
      return Response.json(rows[0], { status: result.status, headers });
    }
    if (result.status === 201 && Array.isArray(rows) && !rows.length && !/return=representation/.test(prefer)) return new Response(null, { status: 201, headers });
    return Response.json(rows, { status: result.status, headers });
  } catch (e) {
    if (e instanceof RestError) return pgrstError(e.status, e.code, e.message, e.details);
    if (e instanceof AuthError) return Response.json({ code: e.status, error_code: e.code, msg: e.message, message: e.message }, { status: e.status });
    console.error("[lex-web]", e);
    return pgrstError(500, "XX000", (e as Error).message ?? "Erro interno");
  }
}
