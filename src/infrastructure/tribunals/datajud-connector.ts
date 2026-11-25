import "server-only";
import { onlyDigits } from "@/domain/shared/document";
import { formatCnjNumber, parseCnjNumber, tribunalAcronym } from "@/domain/processes/cnj-number";
import type { FetchedProcess, TribunalConnector } from "@/domain/monitoring/types";
import { optionalServerEnv } from "@/lib/env";

/**
 * API Pública do DataJud (CNJ) — cobertura nacional de metadados e movimentos (TPU).
 * Documentação: https://datajud-wiki.cnj.jus.br/api-publica/
 */
const BASE = "https://api-publica.datajud.cnj.jus.br";

function aliasFor(processNumber: string): string | null {
  const acronym = tribunalAcronym(processNumber);
  if (!acronym) return null;
  return `api_publica_${acronym.toLowerCase().replace(/-/g, "")}`;
}

interface DatajudMovement {
  codigo?: number;
  nome?: string;
  dataHora?: string;
  complementosTabelados?: { nome?: string; descricao?: string; valor?: number }[];
}

interface DatajudSource {
  numeroProcesso: string;
  classe?: { nome?: string };
  assuntos?: { nome?: string }[];
  orgaoJulgador?: { nome?: string };
  tribunal?: string;
  movimentos?: DatajudMovement[];
}

export class DatajudConnector implements TribunalConnector {
  readonly id = "datajud";
  readonly label = "DataJud — API Pública do CNJ";

  supports(processNumber: string) {
    return !!optionalServerEnv("DATAJUD_API_KEY") && !!parseCnjNumber(processNumber) && !!aliasFor(processNumber);
  }

  async fetch(processNumber: string): Promise<FetchedProcess | null> {
    const alias = aliasFor(processNumber);
    const key = optionalServerEnv("DATAJUD_API_KEY");
    if (!alias || !key) return null;

    const res = await fetch(`${BASE}/${alias}/_search`, {
      method: "POST",
      headers: { Authorization: `APIKey ${key}`, "Content-Type": "application/json" },
      body: JSON.stringify({ query: { match: { numeroProcesso: onlyDigits(processNumber) } }, size: 1 }),
      signal: AbortSignal.timeout(30_000),
      cache: "no-store",
    });
    if (!res.ok) throw new Error(`DataJud ${res.status}`);
    const json = (await res.json()) as { hits?: { hits?: { _source: DatajudSource }[] } };
    const src = json.hits?.hits?.[0]?._source;
    if (!src) return null;

    return {
      number: formatCnjNumber(src.numeroProcesso),
      proceduralClass: src.classe?.nome ?? null,
      subject: src.assuntos?.[0]?.nome ?? null,
      courtDivision: src.orgaoJulgador?.nome ?? null,
      tribunal: src.tribunal ?? tribunalAcronym(processNumber),
      movements: (src.movimentos ?? []).map((m) => ({
        occurredAt: m.dataHora ? new Date(m.dataHora).toISOString() : new Date().toISOString(),
        code: m.codigo ?? null,
        title: m.nome ?? "Movimentação",
        description:
          (m.complementosTabelados ?? [])
            .map((c) => [c.descricao, c.nome].filter(Boolean).join(": "))
            .join("; ") || null,
        source: "datajud",
        externalId: `${m.codigo ?? 0}:${m.dataHora ?? ""}`,
        raw: m,
      })),
    };
  }
}
