import "server-only";

/** Dados públicos de uma empresa no cadastro da Receita Federal (via BrasilAPI, gratuito). */
export interface CompanyData {
  razaoSocial: string;
  nomeFantasia: string | null;
  cep: string | null;
  logradouro: string | null;
  numero: string | null;
  complemento: string | null;
  bairro: string | null;
  municipio: string | null;
  uf: string | null;
  email: string | null;
  telefone: string | null;
  situacao: string | null;
}

const clean = (v: unknown) => (typeof v === "string" && v.trim() ? v.trim() : null);

export async function lookupCnpj(cnpj: string): Promise<CompanyData | null> {
  const digits = cnpj.replace(/\D/g, "");
  if (digits.length !== 14) return null;
  const res = await fetch(`https://brasilapi.com.br/api/cnpj/v1/${digits}`, {
    // sem identificação o serviço recusa (403)
    headers: { "User-Agent": "LexCalendario/1.0", Accept: "application/json" },
    signal: AbortSignal.timeout(15_000),
    cache: "no-store",
  }).catch(() => null);
  if (!res?.ok) return null;
  const d = (await res.json().catch(() => null)) as Record<string, unknown> | null;
  const razaoSocial = clean(d?.razao_social);
  if (!d || !razaoSocial) return null;
  const tipo = clean(d.descricao_tipo_de_logradouro);
  const rua = clean(d.logradouro);
  return {
    razaoSocial,
    nomeFantasia: clean(d.nome_fantasia),
    cep: clean(String(d.cep ?? "")),
    logradouro: rua ? [tipo && !rua.toUpperCase().startsWith(tipo.toUpperCase()) ? tipo : null, rua].filter(Boolean).join(" ") : null,
    numero: clean(d.numero),
    complemento: clean(d.complemento),
    bairro: clean(d.bairro),
    municipio: clean(d.municipio),
    uf: clean(d.uf),
    email: clean(d.email),
    telefone: clean(d.ddd_telefone_1),
    situacao: clean(d.descricao_situacao_cadastral),
  };
}
