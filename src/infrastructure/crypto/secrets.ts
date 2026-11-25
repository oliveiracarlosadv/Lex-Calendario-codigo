import "server-only";
import { createCipheriv, createDecipheriv, randomBytes } from "node:crypto";
import { requireServerEnv } from "@/lib/env";

/**
 * Criptografia simétrica AES-256-GCM para tokens OAuth, senhas CalDAV e
 * credenciais de tribunais. Formato: v1.<iv>.<tag>.<ciphertext> (base64url).
 */
function key(): Buffer {
  const k = Buffer.from(requireServerEnv("ENCRYPTION_KEY"), "base64");
  if (k.length !== 32) throw new Error("ENCRYPTION_KEY deve ter 32 bytes em base64.");
  return k;
}

export function encryptSecret(plain: string): string {
  const iv = randomBytes(12);
  const cipher = createCipheriv("aes-256-gcm", key(), iv);
  const enc = Buffer.concat([cipher.update(plain, "utf8"), cipher.final()]);
  const tag = cipher.getAuthTag();
  return ["v1", iv.toString("base64url"), tag.toString("base64url"), enc.toString("base64url")].join(".");
}

export function decryptSecret(payload: string | null | undefined): string | null {
  if (!payload) return null;
  const [version, iv, tag, data] = payload.split(".");
  if (version !== "v1" || !iv || !tag || !data) throw new Error("Segredo em formato inválido.");
  const decipher = createDecipheriv("aes-256-gcm", key(), Buffer.from(iv, "base64url"));
  decipher.setAuthTag(Buffer.from(tag, "base64url"));
  return Buffer.concat([decipher.update(Buffer.from(data, "base64url")), decipher.final()]).toString("utf8");
}
