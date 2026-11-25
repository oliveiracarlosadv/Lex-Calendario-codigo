import "server-only";
import { mkdir, readFile, rm, writeFile } from "node:fs/promises";
import path from "node:path";
import { localDataDir } from "./database";
import { signJwt, verifyJwt } from "./jwt";

/** Subconjunto do Supabase Storage: arquivos em LEX_DATA_DIR/arquivos/<bucket>/<caminho>. */
const MIME: Record<string, string> = {
  pdf: "application/pdf", png: "image/png", jpg: "image/jpeg", jpeg: "image/jpeg", webp: "image/webp", gif: "image/gif", heic: "image/heic",
  doc: "application/msword", docx: "application/vnd.openxmlformats-officedocument.wordprocessingml.document",
  xls: "application/vnd.ms-excel", xlsx: "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
  ppt: "application/vnd.ms-powerpoint", pptx: "application/vnd.openxmlformats-officedocument.presentationml.presentation",
  txt: "text/plain; charset=utf-8", csv: "text/csv; charset=utf-8", ics: "text/calendar; charset=utf-8", zip: "application/zip",
  mp3: "audio/mpeg", m4a: "audio/mp4", mp4: "video/mp4", odt: "application/vnd.oasis.opendocument.text", rtf: "application/rtf",
};

function resolve(bucket: string, objectPath: string) {
  const base = path.join(localDataDir(), "arquivos");
  const full = path.resolve(base, bucket, objectPath);
  if (!full.startsWith(path.resolve(base) + path.sep)) throw new Error("Caminho inválido");
  return full;
}

export async function handleStorage(segments: string[], request: Request): Promise<Response> {
  const json = (data: unknown, status = 200) => Response.json(data, { status });
  // segments: ["object", bucket, ...path] | ["object", "sign", bucket, ...path]
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
    const data = await readFile(resolve(bucket, objectPath)).catch(() => null);
    if (!data) return json({ error: "not_found" }, 404);
    const ext = objectPath.split(".").pop()?.toLowerCase() ?? "";
    return new Response(new Uint8Array(data), { headers: { "Content-Type": MIME[ext] ?? "application/octet-stream", "Cache-Control": "private, max-age=60" } });
  }

  const bucket = segments[1];
  const objectPath = segments.slice(2).join("/");

  if (request.method === "POST" || request.method === "PUT") {
    let bytes: Uint8Array;
    const type = request.headers.get("content-type") ?? "";
    if (type.includes("multipart/form-data")) {
      const form = await request.formData();
      const file = [...form.values()].find((v): v is File => v instanceof File);
      if (!file) return json({ error: "no_file" }, 400);
      bytes = new Uint8Array(await file.arrayBuffer());
    } else bytes = new Uint8Array(await request.arrayBuffer());
    if (bytes.byteLength > 50 * 1024 * 1024) return json({ error: "payload_too_large", message: "Arquivo acima de 50 MB" }, 413);
    const target = resolve(bucket, objectPath);
    await mkdir(path.dirname(target), { recursive: true });
    await writeFile(target, bytes);
    return json({ Key: `${bucket}/${objectPath}`, Id: objectPath });
  }

  if (request.method === "DELETE") {
    const { prefixes = [] } = (await request.json().catch(() => ({}))) as { prefixes?: string[] };
    for (const p of prefixes) await rm(resolve(bucket, p), { force: true });
    return json(prefixes.map((name) => ({ name })));
  }

  return json({ error: "method_not_allowed" }, 405);
}
