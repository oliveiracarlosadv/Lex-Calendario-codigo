import type { PGlite as PGliteWorker } from "@electric-sql/pglite";
import { getLocalDb } from "./database";
import { signJwt, verifyJwt } from "./jwt";

/** Subconjunto do Supabase Storage: os anexos ficam no banco do próprio navegador. */
const MIME: Record<string, string> = {
  pdf: "application/pdf", png: "image/png", jpg: "image/jpeg", jpeg: "image/jpeg", webp: "image/webp", gif: "image/gif", heic: "image/heic",
  doc: "application/msword", docx: "application/vnd.openxmlformats-officedocument.wordprocessingml.document",
  xls: "application/vnd.ms-excel", xlsx: "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
  txt: "text/plain; charset=utf-8", csv: "text/csv; charset=utf-8", ics: "text/calendar; charset=utf-8", zip: "application/zip",
};

const read = async (db: PGliteWorker, bucket: string, path: string) =>
  (await db.query<{ bytes: Uint8Array }>("select bytes from public.lex_web_files where bucket = $1 and path = $2", [bucket, path])).rows[0]?.bytes ?? null;

export async function handleStorage(segments: string[], request: Request): Promise<Response> {
  const db = await getLocalDb();
  const json = (data: unknown, status = 200) => Response.json(data, { status });
  if (segments[0] !== "object") return json({ error: "not_found", message: "Recurso indisponível" }, 404);

  if (segments[1] === "sign") {
    const bucket = segments[2];
    const objectPath = segments.slice(3).join("/");
    if (request.method === "POST") {
      const { expiresIn = 300 } = (await request.json().catch(() => ({}))) as { expiresIn?: number };
      const token = signJwt({ role: "storage", path: `${bucket}/${objectPath}`, exp: Math.floor(Date.now() / 1000) + Number(expiresIn) });
      return json({ signedURL: `/object/sign/${bucket}/${objectPath}?token=${token}` });
    }
    const claims = verifyJwt(new URL(request.url).searchParams.get("token"));
    if (claims?.role !== "storage" || claims.path !== `${bucket}/${objectPath}`) return json({ error: "invalid_token" }, 400);
    const data = await read(db, bucket, objectPath);
    if (!data) return json({ error: "not_found" }, 404);
    const ext = objectPath.split(".").pop()?.toLowerCase() ?? "";
    return new Response(new Uint8Array(data), { headers: { "Content-Type": MIME[ext] ?? "application/octet-stream" } });
  }

  const bucket = segments[1] === "authenticated" || segments[1] === "public" ? segments[2] : segments[1];
  const objectPath = segments.slice(segments[1] === "authenticated" || segments[1] === "public" ? 3 : 2).join("/");

  if (request.method === "GET") {
    const data = await read(db, bucket, objectPath);
    return data ? new Response(new Uint8Array(data)) : json({ error: "not_found" }, 404);
  }
  if (request.method === "POST" || request.method === "PUT") {
    let bytes: Uint8Array;
    if ((request.headers.get("content-type") ?? "").includes("multipart/form-data")) {
      const file = [...(await request.formData()).values()].find((v): v is File => v instanceof File);
      if (!file) return json({ error: "no_file" }, 400);
      bytes = new Uint8Array(await file.arrayBuffer());
    } else bytes = new Uint8Array(await request.arrayBuffer());
    if (bytes.byteLength > 50 * 1024 * 1024) return json({ error: "payload_too_large", message: "Arquivo acima de 50 MB" }, 413);
    await db.query("insert into public.lex_web_files (bucket, path, bytes) values ($1, $2, $3) on conflict (bucket, path) do update set bytes = excluded.bytes", [bucket, objectPath, bytes]);
    return json({ Key: `${bucket}/${objectPath}`, Id: objectPath });
  }
  if (request.method === "DELETE") {
    const { prefixes = [] } = (await request.json().catch(() => ({}))) as { prefixes?: string[] };
    for (const p of prefixes) await db.query("delete from public.lex_web_files where bucket = $1 and path = $2", [bucket, p]);
    return json(prefixes.map((name) => ({ name })));
  }
  return json({ error: "method_not_allowed" }, 405);
}
