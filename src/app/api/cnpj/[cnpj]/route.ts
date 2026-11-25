import { isValidCNPJ } from "@/domain/shared/document";
import { lookupCnpj } from "@/infrastructure/brasil/cnpj";
import { fail, getUserContext, json } from "@/lib/api";

export const dynamic = "force-dynamic";

/** Dados públicos da empresa (Receita Federal) para preencher o cadastro do cliente. */
export async function GET(_request: Request, { params }: { params: Promise<{ cnpj: string }> }) {
  const ctx = await getUserContext();
  if (!ctx) return fail("Não autenticado", 401);
  const digits = (await params).cnpj.replace(/\D/g, "");
  if (!isValidCNPJ(digits)) return fail("CNPJ inválido.");
  const company = await lookupCnpj(digits);
  if (!company) return fail("Não foi possível consultar este CNPJ agora. Verifique a internet ou preencha à mão.", 502);
  return json(company);
}
