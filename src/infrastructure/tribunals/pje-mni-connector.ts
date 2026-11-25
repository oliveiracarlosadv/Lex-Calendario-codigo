import "server-only";
import { onlyDigits } from "@/domain/shared/document";
import { formatCnjNumber, tribunalAcronym } from "@/domain/processes/cnj-number";
import type { FetchedProcess, TribunalConnector } from "@/domain/monitoring/types";
import { parseSoap, soapCall, xmlEscape } from "./soap";

/**
 * PJe — Modelo Nacional de Interoperabilidade (MNI 2.2.2), operação consultarProcesso.
 * Requer credenciais do advogado no tribunal (CPF/senha do PJe) armazenadas
 * criptografadas em `court_credentials`. Autenticação por certificado A1
 * (mTLS) fica a cargo de `CertificateProvider` — ver docs/INTEGRACOES.md.
 *
 * Identificadores das instalações seguem o Anexo A do guia de implantação do PJe 2.1
 * (ex.: pje-tjpa-1g, pje-trf1-2g).
 */

/** Endpoints MNI conhecidos (1º grau). Tribunais adicionais podem ser configurados no banco. */
export const PJE_MNI_ENDPOINTS: Record<string, { installation: string; url: string }[]> = {
  TJPA: [
    { installation: "pje-tjpa-1g", url: "https://pje.tjpa.jus.br/pje/intercomunicacao" },
    { installation: "pje-tjpa-2g", url: "https://pje.tjpa.jus.br/pje-2g/intercomunicacao" },
  ],
  TRT8: [{ installation: "pje-trt8-1g", url: "https://pje.trt8.jus.br/pje-mni/intercomunicacao" }],
  TRF1: [{ installation: "pje-trf1-1g", url: "https://pje1g.trf1.jus.br/pje/intercomunicacao" }],
};

const NS_SERVICE = "http://www.cnj.jus.br/servico-intercomunicacao-2.2.2/";
const NS_TYPES = "http://www.cnj.jus.br/tipos-servico-intercomunicacao-2.2.2";

type Obj = Record<string, unknown>;

export interface PjeCredentials {
  username: string; // CPF do advogado
  password: string;
}

export class PjeMniConnector implements TribunalConnector {
  readonly id = "pje-mni";
  readonly label = "PJe — MNI (consultarProcesso)";

  constructor(
    private readonly resolveCredentials: (tribunal: string) => Promise<PjeCredentials | null>,
    private readonly endpoints = PJE_MNI_ENDPOINTS,
  ) {}

  supports(processNumber: string, tribunal?: string | null) {
    const t = tribunal ?? tribunalAcronym(processNumber);
    return !!t && !!this.endpoints[t];
  }

  async fetch(processNumber: string): Promise<FetchedProcess | null> {
    const tribunal = tribunalAcronym(processNumber);
    if (!tribunal) return null;
    const creds = await this.resolveCredentials(tribunal);
    if (!creds) return null;

    for (const { url } of this.endpoints[tribunal] ?? []) {
      const body = `<tip:consultarProcesso xmlns:tip="${NS_TYPES}">
        <tip:idConsultante>${xmlEscape(onlyDigits(creds.username))}</tip:idConsultante>
        <tip:senhaConsultante>${xmlEscape(creds.password)}</tip:senhaConsultante>
        <tip:numeroProcesso>${onlyDigits(processNumber)}</tip:numeroProcesso>
        <tip:movimentos>true</tip:movimentos>
        <tip:incluirCabecalho>true</tip:incluirCabecalho>
        <tip:incluirDocumentos>false</tip:incluirDocumentos>
      </tip:consultarProcesso>`;
      try {
        const xml = await soapCall(url, body, { soapAction: `"${NS_SERVICE}consultarProcesso"`, timeoutMs: 45_000 });
        const parsed = parseSoap(xml, ["movimento", "polo", "parte", "assunto", "complemento"]);
        const resp = parsed.consultarProcessoResposta as Obj | undefined;
        if (!resp || String(resp.sucesso) !== "true") continue;
        return this.map(processNumber, tribunal, resp.processo as Obj);
      } catch {
        continue;
      }
    }
    return null;
  }

  private map(processNumber: string, tribunal: string, p: Obj): FetchedProcess {
    const header = (p.dadosBasicos ?? {}) as Obj;
    const orgao = (header.orgaoJulgador ?? {}) as Obj;
    const movimentos = (Array.isArray(p.movimento) ? p.movimento : []) as Obj[];
    // dataHora no MNI: AAAAMMDDHHMMSS
    const parseDate = (v: unknown) => {
      const s = String(v ?? "");
      if (!/^\d{14}$/.test(s)) return new Date().toISOString();
      return new Date(`${s.slice(0, 4)}-${s.slice(4, 6)}-${s.slice(6, 8)}T${s.slice(8, 10)}:${s.slice(10, 12)}:${s.slice(12, 14)}-03:00`).toISOString();
    };
    return {
      number: formatCnjNumber(processNumber),
      courtDivision: (orgao["@nomeOrgao"] as string) ?? null,
      tribunal,
      movements: movimentos.map((m) => {
        const nacional = (m.movimentoNacional ?? {}) as Obj;
        const local = (m.movimentoLocal ?? {}) as Obj;
        const complementos = (Array.isArray(m.complemento) ? m.complemento : []).map(String).join("; ");
        return {
          occurredAt: parseDate(m["@dataHora"]),
          code: nacional["@codigoNacional"] ? Number(nacional["@codigoNacional"]) : null,
          title: String(local["@descricao"] ?? nacional["@descricao"] ?? "Movimentação"),
          description: complementos || null,
          source: "pje",
          externalId: String(m["@identificadorMovimento"] ?? `${m["@dataHora"]}:${nacional["@codigoNacional"] ?? ""}`),
          raw: m,
        };
      }),
    };
  }
}

// ─────────────── Avisos pendentes (intimações) — SEM registrar ciência ───────────────

export interface PjePendingNotice {
  idAviso: string;
  tipoComunicacao: string | null;
  processNumber: string;
  availableAt: string | null; // AAAA-MM-DD
  className: string | null;
  organ: string | null;
}

export class MniDisabledError extends Error {}

/**
 * consultarAvisosPendentes: lista intimações/citações aguardando ciência do advogado.
 * IMPORTANTE: não chamamos consultarTeorComunicacao, que registraria a ciência e iniciaria o prazo.
 */
export async function fetchPjePendingNotices(endpoint: string, creds: PjeCredentials): Promise<PjePendingNotice[]> {
  const body = `<tip:consultarAvisosPendentes xmlns:tip="${NS_TYPES}">
      <tip:idConsultante>${xmlEscape(onlyDigits(creds.username))}</tip:idConsultante>
      <tip:senhaConsultante>${xmlEscape(creds.password)}</tip:senhaConsultante>
    </tip:consultarAvisosPendentes>`;
  let xml: string;
  try {
    xml = await soapCall(endpoint, body, { soapAction: `"${NS_SERVICE}consultarAvisosPendentes"`, timeoutMs: 45_000 });
  } catch (e) {
    throw new Error(`Falha de comunicação com o PJe: ${(e as Error).message}`);
  }
  // Respostas MTOM (multipart) trazem o envelope entre delimitadores
  const envelope = xml.slice(Math.max(0, xml.indexOf("<soap:Envelope")), xml.lastIndexOf("Envelope>") + 9) || xml;
  let parsed: Record<string, unknown>;
  try {
    parsed = parseSoap(envelope, ["aviso", "polo", "parte", "assunto"]);
  } catch (e) {
    const msg = (e as Error).message;
    if (/desabilitado/i.test(msg)) throw new MniDisabledError("O tribunal desabilitou o acesso ao PJe por login e senha (MNI). Use o monitoramento pela OAB (DJEN).");
    throw e;
  }
  const resp = parsed.consultarAvisosPendentesResposta as Obj | undefined;
  if (!resp) throw new Error("Resposta inesperada do PJe");
  if (String(resp.sucesso) !== "true") throw new Error(String(resp.mensagem ?? "Acesso negado pelo PJe (confira CPF e senha)"));
  const avisos = (Array.isArray(resp.aviso) ? resp.aviso : []) as Obj[];
  return avisos.map((a) => {
    const proc = (a.processo ?? {}) as Obj;
    const orgao = (proc.orgaoJulgador ?? {}) as Obj;
    const dt = String(a.dataDisponibilizacao ?? "");
    return {
      idAviso: String(a["@idAviso"] ?? ""),
      tipoComunicacao: (a["@tipoComunicacao"] as string) ?? null,
      processNumber: formatCnjNumber(String(proc["@numero"] ?? "")),
      availableAt: /^\d{8}/.test(dt) ? `${dt.slice(0, 4)}-${dt.slice(4, 6)}-${dt.slice(6, 8)}` : null,
      className: proc["@classeProcessual"] ? String(proc["@classeProcessual"]) : null,
      organ: (orgao["@nomeOrgao"] as string) ?? null,
    };
  });
}
