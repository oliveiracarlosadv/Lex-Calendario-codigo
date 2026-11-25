import { z } from "zod";
import { formatCnjNumber } from "@/domain/processes/cnj-number";
import { formatDocument, isValidCNPJ, isValidCPF } from "@/domain/shared/document";
import { lookupCnpj } from "@/infrastructure/brasil/cnpj";
import { searchDjen, stripHtml, type DjenItem } from "@/infrastructure/tribunals/djen-connector";
import { fail, getUserContext, json } from "@/lib/api";

export const dynamic = "force-dynamic";
export const maxDuration = 120;

const Body = z.object({
  mode: z.enum(["oab", "nome", "cpf", "texto"]),
  oab: z.string().max(12).optional(),
  uf: z.string().max(2).optional(),
  name: z.string().max(200).optional(),
  /** CPF ou CNPJ */
  cpf: z.string().max(24).optional(),
  /** outro número ou trecho: documento, auto de infração, CDA, notificação, número do processo… */
  text: z.string().max(120).optional(),
  days: z.coerce.number().int().min(1).max(365).default(30),
  /** período explícito (AAAA-MM-DD), usado em "Buscar processos" */
  from: z.string().regex(/^\d{4}-\d{2}-\d{2}$/).optional(),
  to: z.string().regex(/^\d{4}-\d{2}-\d{2}$/).optional(),
});

const day = (d: Date) => d.toLocaleDateString("en-CA", { timeZone: "America/Sao_Paulo" });
/** Nome da empresa sem a forma societária e sem pontuação: "Natulife Produtos Naturais Ltda - ME" → "NATULIFE PRODUTOS NATURAIS". */
const coreCompanyName = (name: string) =>
  name
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "")
    .toUpperCase()
    .replace(/[.,;/()-]/g, " ")
    .replace(/\b(LTDA|ME|EPP|EIRELI|S\s*A|SA|SS|MEI|SOCIEDADE ANONIMA|LIMITADA|EM RECUPERACAO JUDICIAL)\b/g, " ")
    .replace(/\s+/g, " ")
    .trim();
const fold = (s: string) => s.normalize("NFD").replace(/[̀-ͯ]/g, "").toUpperCase().replace(/\s+/g, " ").trim();

/**
 * Busca intimações no Diário de Justiça Eletrônico Nacional (DJEN/CNJ):
 *   oab   — número e UF da OAB (advogados)
 *   nome  — nome completo, como parte ou como advogado
 *   cpf   — CPF ou CNPJ: publicações cujo texto cita o número (com ou sem pontuação), somadas às
 *           do nome da pessoa/empresa quando ele é informado, está cadastrado ou consta na Receita (CNPJ)
 *   texto — qualquer outro número ou trecho citado na publicação (documento, auto de infração,
 *           certidão de dívida ativa, notificação) ou o número do processo
 */
export async function POST(request: Request) {
  const ctx = await getUserContext();
  if (!ctx) return fail("Não autenticado", 401);
  const parsed = Body.safeParse(await request.json().catch(() => null));
  if (!parsed.success) return fail("Confira os dados da busca.");
  const b = parsed.data;
  const to = b.to ?? day(new Date());
  const from = b.from ?? day(new Date(new Date(`${to}T12:00:00`).getTime() - b.days * 864e5));
  if (from > to) return fail("A data de início deve ser anterior à data de fim.");
  // Períodos longos: mais páginas do Diário (até 500 publicações por consulta)
  const pages = b.from ? 5 : 3;

  let items: DjenItem[] = [];
  let searchedName: string | null = null;
  /** nomes procurados (para marcar "nome idêntico") */
  const wantedNames: string[] = [];
  /** números/trechos procurados no texto (sem pontuação), para destacar as publicações que os citam */
  const terms: string[] = [];
  const merge = (lists: DjenItem[][]) => {
    const seen = new Set<number>();
    return lists.flat().filter((i) => !seen.has(i.id) && seen.add(i.id));
  };
  const byName = (name: string) => [searchDjen({ partyName: name, from, to, maxPages: pages }), searchDjen({ lawyerName: name, from, to, maxPages: pages })];
  try {
    if (b.mode === "oab") {
      if (!/^\d{1,7}[A-Za-z]?$/.test((b.oab ?? "").trim()) || !b.uf) return fail("Informe o número e a UF da OAB.");
      items = await searchDjen({ oab: b.oab!, uf: b.uf, from, to, maxPages: 5 });
    } else if (b.mode === "cpf") {
      const digits = (b.cpf ?? "").replace(/\D/g, "");
      const isCnpj = digits.length === 14;
      if (isCnpj ? !isValidCNPJ(digits) : !isValidCPF(digits)) return fail(isCnpj ? "CNPJ inválido." : "CPF ou CNPJ inválido.");
      terms.push(digits);
      let name = (b.name ?? "").trim();
      if (!name) {
        const [{ data: client }, { data: partner }, { data: profile }] = await Promise.all([
          ctx.supabase.from("clients").select("name").eq("organization_id", ctx.orgId).eq("document", digits).maybeSingle(),
          ctx.supabase.from("partners").select("name").eq("organization_id", ctx.orgId).eq("document", digits).maybeSingle(),
          ctx.supabase.from("profiles").select("full_name").eq("document", digits).maybeSingle(),
        ]);
        name = (client?.name as string) || (partner?.name as string) || (profile?.full_name as string) || "";
      }
      // CNPJ: razão social e nome fantasia são públicos (Receita Federal, via BrasilAPI)
      const company = isCnpj ? await lookupCnpj(digits) : null;
      if (!name && company) name = company.razaoSocial;
      const hasName = name.split(/\s+/).length >= 2;
      searchedName = hasName ? `${name} — ${formatDocument(digits)}` : formatDocument(digits);
      // O Diário procura o nome por trecho; a mesma empresa aparece como "X LTDA", "X LTDA - ME", "X S/A"…
      // então também se busca o nome sem a forma societária e o nome fantasia.
      const names = isCnpj
        ? [...new Set([name, coreCompanyName(name), company?.nomeFantasia ?? ""].map((n) => n.trim()).filter((n) => n.length >= 5))]
        : hasName
          ? [name]
          : [];
      items = merge(
        await Promise.all([
          searchDjen({ text: formatDocument(digits), from, to, maxPages: pages }),
          searchDjen({ text: digits, from, to, maxPages: pages }),
          // Empresa é parte, não advogado: basta o nome como parte
          ...(isCnpj ? names.map((n) => searchDjen({ partyName: n, from, to, maxPages: pages })) : names.flatMap((n) => byName(n))),
        ]),
      );
      for (const n of names) wantedNames.push(n);
    } else if (b.mode === "texto") {
      const text = (b.text ?? "").trim();
      if (text.replace(/\s/g, "").length < 5) return fail("Informe pelo menos 5 caracteres do número ou do trecho.");
      const digits = text.replace(/\D/g, "");
      const mostlyNumber = digits.length >= 5 && digits.length >= text.replace(/[\s./-]/g, "").length - 2;
      terms.push(mostlyNumber ? digits : text);
      searchedName = text;
      items = merge(
        await Promise.all([
          searchDjen({ text, from, to, maxPages: pages }),
          ...(mostlyNumber && digits !== text ? [searchDjen({ text: digits, from, to, maxPages: pages })] : []),
          // 20 dígitos: também pode ser o número do processo (CNJ)
          ...(digits.length === 20 ? [searchDjen({ processNumber: digits, from, to, maxPages: pages })] : []),
        ]),
      );
    } else {
      const name = (b.name ?? "").trim();
      if (name.split(/\s+/).length < 2) return fail("Informe o nome completo (nome e sobrenome).");
      searchedName = name;
      items = merge(await Promise.all(byName(name)));
    }
  } catch (e) {
    return fail((e as Error).message, 502);
  }

  const ids = items.map((i) => String(i.id));
  const imported = new Set<string>();
  for (let i = 0; i < ids.length; i += 200) {
    const { data } = await ctx.supabase.from("intimations").select("external_id").eq("organization_id", ctx.orgId).eq("source", "djen").in("external_id", ids.slice(i, i + 200));
    for (const r of data ?? []) imported.add(r.external_id as string);
  }

  const wantedSet = new Set([...(searchedName ? [searchedName.split(" — ")[0]] : []), ...wantedNames].map((n) => fold(coreCompanyName(n))).filter(Boolean));
  const numeric = terms.filter((t) => /^\d+$/.test(t));
  const literal = terms.filter((t) => !/^\d+$/.test(t)).map(fold);
  /** Trecho em volta do número procurado (em vez do começo da publicação). */
  const excerptOf = (text: string) => {
    for (const t of terms) {
      const pattern = /^\d+$/.test(t) ? t.split("").join("[\\s./-]*") : t.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
      const at = text.search(new RegExp(pattern, "i"));
      if (at >= 0) return `${at > 200 ? "…" : ""}${text.slice(Math.max(0, at - 200), at + 300)}`;
    }
    return text.slice(0, 500);
  };
  const results = items
    .filter((i) => i.ativo !== false)
    .map((i) => {
      const text = stripHtml(i.texto ?? "");
      const parties = (i.destinatarios ?? []).map((d) => d.nome);
      const lawyers = (i.destinatarioadvogados ?? []).map((d) => d.advogado).filter(Boolean).map((a) => `${a!.nome} (OAB ${a!.numero_oab}/${a!.uf_oab})`);
      const exactName = wantedSet.size > 0 && [...parties, ...(i.destinatarioadvogados ?? []).map((d) => d.advogado?.nome ?? "")].some((n) => wantedSet.has(fold(coreCompanyName(n))));
      const onlyDigits = numeric.length ? text.replace(/\D/g, "") : "";
      const citesCpf = numeric.some((t) => onlyDigits.includes(t)) || (literal.length > 0 && literal.some((t) => fold(text).includes(t)));
      return {
        id: String(i.id),
        processNumber: formatCnjNumber(i.numeroprocessocommascara ?? i.numero_processo),
        tribunal: i.siglaTribunal ?? null,
        organ: i.nomeOrgao ?? null,
        className: i.nomeClasse ?? null,
        type: [i.tipoComunicacao, i.tipoDocumento].filter(Boolean).join(" — ") || "Comunicação",
        availableAt: i.data_disponibilizacao ?? null,
        parties,
        lawyers,
        excerpt: excerptOf(text),
        link: i.link ?? null,
        imported: imported.has(String(i.id)),
        exactName,
        citesCpf,
        raw: i,
      };
    })
    // Primeiro as que citam o número procurado, depois as de nome idêntico, depois as mais recentes
    .sort((a, b2) => Number(b2.citesCpf) - Number(a.citesCpf) || Number(b2.exactName) - Number(a.exactName) || (b2.availableAt ?? "").localeCompare(a.availableAt ?? ""))
    .slice(0, 600);

  return json({ total: items.length, searchedName, period: { from, to }, results });
}
