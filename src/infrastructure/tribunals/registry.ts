import "server-only";
import type { FetchedProcess, TribunalConnector } from "@/domain/monitoring/types";
import { DatajudConnector } from "./datajud-connector";
import { PjeMniConnector, type PjeCredentials } from "./pje-mni-connector";
import { TjpaWebServiceConnector } from "./tjpa-connector";

/**
 * Conectores planejados (interfaces prontas, implementação depende de convênio/credenciais):
 *  - e-SAJ (TJSP, TJMS, TJAL, TJAM, TJCE...): consulta pública via scraping autorizado ou API de parceiros
 *  - Projudi (TJPR, TJGO, TJBA...): MNI quando disponível
 *  - eproc (TRF4, TJRS, TJSC, TJTO): MNI 2.2.2
 * Todos devem implementar `TribunalConnector` e ser registrados abaixo, em ordem de preferência.
 */
export function buildConnectors(resolvePjeCredentials: (tribunal: string) => Promise<PjeCredentials | null>): TribunalConnector[] {
  return [new TjpaWebServiceConnector(), new PjeMniConnector(resolvePjeCredentials), new DatajudConnector()];
}

/** Consulta os conectores em ordem até obter dados; combina movimentos sem duplicar. */
export async function fetchFromTribunals(
  connectors: TribunalConnector[],
  processNumber: string,
  tribunal?: string | null,
): Promise<{ data: FetchedProcess | null; connector: string | null; errors: string[] }> {
  const errors: string[] = [];
  for (const c of connectors) {
    if (!c.supports(processNumber, tribunal)) continue;
    try {
      const data = await c.fetch(processNumber);
      if (data && data.movements.length) return { data, connector: c.id, errors };
    } catch (e) {
      errors.push(`${c.label}: ${(e as Error).message}`);
    }
  }
  return { data: null, connector: null, errors };
}
