import "server-only";
import { XMLParser } from "fast-xml-parser";

/** Utilitário mínimo para chamadas SOAP 1.1 document/literal. */
export async function soapCall(endpoint: string, body: string, opts: { soapAction?: string; timeoutMs?: number } = {}) {
  const envelope = `<?xml version="1.0" encoding="UTF-8"?><soapenv:Envelope xmlns:soapenv="http://schemas.xmlsoap.org/soap/envelope/"><soapenv:Body>${body}</soapenv:Body></soapenv:Envelope>`;
  const res = await fetch(endpoint, {
    method: "POST",
    headers: { "Content-Type": "text/xml; charset=utf-8", SOAPAction: opts.soapAction ?? '""' },
    body: envelope,
    signal: AbortSignal.timeout(opts.timeoutMs ?? 30_000),
    cache: "no-store",
  });
  const xml = await res.text();
  if (!res.ok && !xml.includes("Envelope")) throw new Error(`SOAP ${res.status}: ${xml.slice(0, 200)}`);
  return xml;
}

export function parseSoap(xml: string, arrayTags: string[]) {
  const parser = new XMLParser({
    ignoreAttributes: false,
    attributeNamePrefix: "@",
    removeNSPrefix: true,
    parseTagValue: false,
    isArray: (name) => arrayTags.includes(name),
  });
  // Respostas MTOM/XOP (multipart) trazem o envelope SOAP entre delimitadores
  const start = xml.search(/<([A-Za-z0-9_]+:)?Envelope[\s>]/);
  const end = xml.lastIndexOf("Envelope>");
  if (start > 0 && end > start) xml = xml.slice(start, end + 9);
  const doc = parser.parse(xml);
  const body = doc?.Envelope?.Body ?? {};
  if (body.Fault) throw new Error(`SOAP Fault: ${body.Fault.faultstring ?? "erro desconhecido"}`);
  return body as Record<string, unknown>;
}

export const xmlEscape = (s: string) =>
  s.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;").replace(/"/g, "&quot;");
