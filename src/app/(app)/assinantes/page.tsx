import { notFound } from "next/navigation";
import { isLicenseAdmin, listSubscribers, price, trialDays } from "@/application/licensing/server";
import { PageHeader } from "@/components/layout/app-shell";
import { getSupabaseServerClient } from "@/infrastructure/supabase/server";
import { formatDay } from "@/lib/utils";

export const dynamic = "force-dynamic";

const LABEL = { trial: "Em teste", active: "Assinante em dia", expired: "Bloqueado (sem pagamento)" } as const;

/** Painel do titular: quem está em teste, quem paga e quem está bloqueado. Só no servidor de assinaturas. */
export default async function SubscribersPage() {
  const supabase = await getSupabaseServerClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (process.env.LEX_DESKTOP === "1" || !isLicenseAdmin(user?.email)) notFound();
  const subscribers = await listSubscribers();
  const count = (state: keyof typeof LABEL) => subscribers.filter((s) => s.state === state).length;
  const value = price();

  return (
    <div>
      <PageHeader title="Assinantes" description={`Mensalidade: ${value.toLocaleString("pt-BR", { style: "currency", currency: "BRL" })} · teste grátis de ${trialDays()} dias. Pagamentos e notas ficam no painel do Asaas.`} />
      <div className="space-y-4 p-4 md:p-8">
        <div className="grid gap-3 sm:grid-cols-4">
          {[
            ["Assinantes em dia", count("active")],
            ["Em teste", count("trial")],
            ["Bloqueados", count("expired")],
            ["Receita mensal prevista", (count("active") * value).toLocaleString("pt-BR", { style: "currency", currency: "BRL" })],
          ].map(([label, n]) => (
            <div key={String(label)} className="rounded-2xl border bg-card p-4">
              <p className="text-xs text-muted-foreground">{label}</p>
              <p className="mt-1 text-2xl font-semibold">{n}</p>
            </div>
          ))}
        </div>
        <div className="overflow-x-auto rounded-2xl border bg-card">
          <table className="w-full text-sm">
            <thead className="text-left text-xs text-muted-foreground">
              <tr>
                {["E-mail", "Nome", "Situação", "Válido até", "Desde", "Último acesso"].map((h) => <th key={h} className="px-4 py-2 font-medium">{h}</th>)}
              </tr>
            </thead>
            <tbody>
              {subscribers.map((s) => (
                <tr key={s.email} className="border-t">
                  <td className="px-4 py-2">{s.email}</td>
                  <td className="px-4 py-2">{s.name ?? "—"}</td>
                  <td className="px-4 py-2">{LABEL[s.state]}</td>
                  <td className="px-4 py-2">{s.until ? formatDay(s.until) : "—"}</td>
                  <td className="px-4 py-2">{formatDay(s.createdAt)}</td>
                  <td className="px-4 py-2">{s.lastSeenAt ? formatDay(s.lastSeenAt) : "—"}</td>
                </tr>
              ))}
              {!subscribers.length && (
                <tr><td colSpan={6} className="px-4 py-8 text-center text-muted-foreground">Nenhum assinante ainda.</td></tr>
              )}
            </tbody>
          </table>
        </div>
      </div>
    </div>
  );
}
