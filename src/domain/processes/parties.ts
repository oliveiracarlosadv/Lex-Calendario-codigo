/**
 * Polo ativo e polo passivo do processo.
 * Fonte principal: partes publicadas no Diário (intimações, com polo "A"/"P").
 * Sem publicações, deduz pelo polo do cliente e pela parte contrária cadastrados.
 */
const ACTIVE_ROLES = /autor|reclamante|requerente|exequente|apelante|agravante|impetrante|recorrente|embargante/i;

export interface PartiesInput {
  parties?: { nome: string; polo?: string }[];
  clientName?: string | null;
  clientRole?: string | null;
  opposingParty?: string | null;
}

export function splitParties({ parties = [], clientName, clientRole, opposingParty }: PartiesInput) {
  const active = parties.filter((p) => p.polo === "A").map((p) => p.nome);
  const passive = parties.filter((p) => p.polo === "P").map((p) => p.nome);
  if (active.length || passive.length) return { active, passive };

  const opposing = (opposingParty ?? "").split(";").map((s) => s.trim()).filter(Boolean);
  const client = clientName ? [clientName] : [];
  if (!client.length && !opposing.length) return { active: [], passive: [] };
  const clientIsActive = clientRole ? ACTIVE_ROLES.test(clientRole) : true;
  return clientIsActive ? { active: client, passive: opposing } : { active: opposing, passive: client };
}
