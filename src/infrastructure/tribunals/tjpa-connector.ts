import "server-only";
import { onlyDigits } from "@/domain/shared/document";
import { formatCnjNumber, parseCnjNumber } from "@/domain/processes/cnj-number";
import type { FetchedProcess, TribunalConnector } from "@/domain/monitoring/types";
import { parseSoap, soapCall, xmlEscape } from "./soap";

/**
 * WebService público de Consulta Processual do TJPA (sem autenticação).
 * https://consultas.tjpa.jus.br/WSConsultaProcessualTJ/ConsultaProcessualService?wsdl
 * Operações usadas: dadosProcessoCNJ e dadosProcessoListaDocumento.
 */
const ENDPOINT = "https://consultas.tjpa.jus.br/WSConsultaProcessualTJ/ConsultaProcessualService";
const NS = "http://servicews.processo.consulta.portal.tjpa.jus.br/";

export type TjpaTipoConsulta =
  | "PRIMEIRO_GRAU"
  | "JUIZADOS_ESPECIAIS"
  | "JUSTICA_MILITAR"
  | "SEGUNDO_GRAU"
  | "TURMAS_RECURSAIS"
  | "CORREGEDORIA";

const ARRAYS = [
  "assuntos", "partes", "representantes", "documentos", "custas", "movimentos", "movimentos2g",
  "audiencias", "parteAudienciaLista", "documentoLista", "processoTJPALista", "subMovimentoList",
];

type Obj = Record<string, unknown>;
const str = (v: unknown) => (v == null ? null : String(v));
const arr = (v: unknown) => (Array.isArray(v) ? (v as Obj[]) : []);

/** Datas do WS chegam como xs:dateTime sem fuso (horário de Belém, UTC−3). */
const toISO = (v: unknown) => {
  const s = str(v);
  if (!s) return null;
  return /[zZ]|[+-]\d{2}:\d{2}$/.test(s) ? new Date(s).toISOString() : new Date(`${s.slice(0, 19)}-03:00`).toISOString();
};

export class TjpaWebServiceConnector implements TribunalConnector {
  readonly id = "tjpa-ws";
  readonly label = "TJPA — WebService de Consulta Processual";

  supports(processNumber: string) {
    const p = parseCnjNumber(processNumber);
    return !!p && p.segment === "8" && p.court === "14";
  }

  private async call(op: string, params: Record<string, string>) {
    const inner = Object.entries(params)
      .map(([k, v]) => `<${k}>${xmlEscape(v)}</${k}>`)
      .join("");
    const xml = await soapCall(ENDPOINT, `<ser:${op} xmlns:ser="${NS}">${inner}</ser:${op}>`);
    const body = parseSoap(xml, ARRAYS);
    const response = body[`${op}Response`] as Obj | undefined;
    return (response?.return ?? null) as Obj | null;
  }

  async fetch(processNumber: string): Promise<FetchedProcess | null> {
    const numero = onlyDigits(processNumber);
    const tipos: TjpaTipoConsulta[] = ["PRIMEIRO_GRAU", "JUIZADOS_ESPECIAIS", "SEGUNDO_GRAU", "TURMAS_RECURSAIS"];

    for (const tipo of tipos) {
      let data = await this.call("dadosProcessoCNJ", { numeroProcessoCNJ: numero, tipoConsulta: tipo });
      const status = data?.status as Obj | undefined;
      if (!data || status?.resultado === "FALHA") continue;

      // Processo em mais de uma instância/documento: escolhe o primeiro documento listado
      const lista = arr(data.documentoLista);
      if (!arr(data.movimentos).length && !arr(data.movimentos2g).length && lista.length) {
        const doc = str(lista[0].cdDocumento);
        if (doc) data = await this.call("dadosProcessoListaDocumento", { numeroProcesso: numero, numeroDocumento: doc, tipoConsulta: tipo });
      }
      if (data) return this.map(processNumber, data, tipo);
    }
    return null;
  }

  private map(processNumber: string, d: Obj, tipo: TjpaTipoConsulta): FetchedProcess {
    const movements1g = arr(d.movimentos).map((m) => {
      const subs = arr(m.subMovimentoList)
        .map((s) => str(s.descricao))
        .filter(Boolean)
        .join(" ");
      return {
        occurredAt: toISO(m.dataMovimento) ?? new Date().toISOString(),
        code: m.cdtpmovimento != null ? Number(m.cdtpmovimento) : null,
        title: str(m.detpmovimento) ?? "Movimentação",
        description: subs || null,
        source: "tjpa",
        externalId: `${tipo}:${str(m.cddocumento) ?? ""}:${str(m.nrseqmovimento) ?? ""}`,
        raw: m,
      };
    });
    const movements2g = arr(d.movimentos2g).map((m) => ({
      occurredAt: toISO(m.dataMovimento) ?? new Date().toISOString(),
      code: m.cdtpmovimento != null ? Number(m.cdtpmovimento) : null,
      title: str(m.detpmovimento) ?? "Movimentação",
      description: [str((m.origem as Obj | undefined)?.deorigem), str((m.destino as Obj | undefined)?.deorigem)]
        .filter(Boolean)
        .join(" → ") || null,
      source: "tjpa",
      externalId: `${tipo}:${str(m.cdprocesso) ?? ""}:${str(m.nrseqmovimento) ?? ""}`,
      raw: m,
    }));

    const hearings = arr(d.audiencias)
      .map((a) => ({ at: toISO(a.dataAgendamento), kind: str(a.tipo) ?? "Audiência" }))
      .filter((h): h is { at: string; kind: string } => !!h.at);

    // Audiências agendadas viram movimentações sintéticas para o motor de sugestões
    const hearingMovements = hearings.map((h) => {
      const dt = new Date(h.at);
      return {
        occurredAt: new Date().toISOString(),
        code: null,
        title: `Audiência designada: ${h.kind}`,
        description: `Audiência de ${h.kind.toLowerCase()} designada para ${dt.toLocaleDateString("pt-BR", { timeZone: "America/Belem" })} às ${dt.toLocaleTimeString("pt-BR", { timeZone: "America/Belem", hour: "2-digit", minute: "2-digit" })}.`,
        source: "tjpa",
        externalId: `${tipo}:audiencia:${h.at}`,
        raw: h,
      };
    });

    const principal = arr(d.assuntos).find((a) => a.flprincipal === "S") ?? arr(d.assuntos)[0];
    return {
      number: formatCnjNumber(str(d.numeroCNJ) ?? processNumber),
      proceduralClass: str(d.classe),
      subject: principal ? str(principal.deassunto) : null,
      courtDivision: str(d.vara) ?? str(d.secretaria),
      tribunal: "TJPA",
      judge: str(d.nomeMagistrado),
      status: str(d.situacao),
      parties: arr(d.partes).map((p) => ({
        name: str(p.nome) ?? "",
        role: str((p.tpparticipacao as Obj | undefined)?.detpparticipacao) ?? "",
      })),
      hearings,
      movements: [...movements1g, ...movements2g, ...hearingMovements],
    };
  }
}
