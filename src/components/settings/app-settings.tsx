"use client";

import { useQuery, useQueryClient } from "@tanstack/react-query";
import { Check, Globe, MonitorSmartphone } from "lucide-react";
import { toast } from "sonner";
import { Badge } from "@/components/ui/badge";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { cn } from "@/lib/utils";
import { DangerZone, UpdateSettings } from "./update-settings";

const LABELS: Record<string, { title: string; desc: string }> = {
  padrao: { title: "Navegador padrão do sistema", desc: "Abre numa aba do navegador que você já usa. Recomendado." },
  chrome: { title: "Google Chrome — meu perfil", desc: "Janela de aplicativo usando o seu perfil do Chrome (favoritos, senhas e logins preservados)." },
  edge: { title: "Microsoft Edge — meu perfil", desc: "Janela de aplicativo usando o seu perfil do Edge." },
  brave: { title: "Brave — meu perfil", desc: "Janela de aplicativo usando o seu perfil do Brave." },
  safari: { title: "Safari", desc: "Abre no Safari." },
  firefox: { title: "Firefox", desc: "Abre no Firefox." },
  app: { title: "Janela própria (perfil separado)", desc: "Janela isolada, sem misturar com seu navegador. Pode parecer um Chrome “vazio”, sem seus favoritos." },
};

export function AppSettings() {
  const qc = useQueryClient();
  const { data, isError } = useQuery({
    queryKey: ["desktop-browser"],
    queryFn: async () => {
      const res = await fetch("/api/desktop/navegador");
      if (!res.ok) throw new Error();
      return (await res.json()) as { choice: string; options: { id: string; installed: boolean }[] };
    },
  });

  async function choose(id: string) {
    const res = await fetch("/api/desktop/navegador", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ choice: id }) });
    if (!res.ok) return toast.error("Não foi possível salvar a escolha.");
    void qc.invalidateQueries({ queryKey: ["desktop-browser"] });
    toast.success("Navegador escolhido", { description: "Vale a partir da próxima abertura: clique no ícone do Lex Calendário no Dock (ou atalho)." });
  }

  if (isError) {
    return (
      <Card>
        <CardHeader>
          <CardTitle>Aplicativo</CardTitle>
          <CardDescription>Estas opções existem apenas no aplicativo instalado no computador.</CardDescription>
        </CardHeader>
      </Card>
    );
  }

  return (
    <div className="space-y-6">
    <UpdateSettings />
    <Card>
      <CardHeader>
        <CardTitle className="flex items-center gap-2"><Globe className="size-4" /> Navegador do aplicativo</CardTitle>
        <CardDescription>
          Escolha onde o Lex Calendário abre. Os seus dados ficam sempre no Lex (no computador), qualquer que seja o navegador.
          O Lex nunca altera nem apaga dados do seu navegador.
        </CardDescription>
      </CardHeader>
      <CardContent className="space-y-2">
        {(data?.options ?? []).map((o) => {
          const label = LABELS[o.id];
          const active = data?.choice === o.id;
          return (
            <button
              key={o.id}
              disabled={!o.installed}
              onClick={() => void choose(o.id)}
              className={cn(
                "flex w-full items-start gap-3 rounded-xl border px-3 py-2.5 text-left transition hover:bg-accent/50 disabled:cursor-not-allowed disabled:opacity-50",
                active && "border-primary bg-primary/5",
              )}
            >
              <MonitorSmartphone className="mt-0.5 size-4 shrink-0 text-muted-foreground" />
              <span className="min-w-0 flex-1">
                <span className="flex items-center gap-2 text-sm font-medium">
                  {label?.title ?? o.id}
                  {!o.installed && <Badge variant="outline">não instalado</Badge>}
                </span>
                <span className="block text-xs text-muted-foreground">{label?.desc}</span>
              </span>
              {active && <Check className="size-4 text-primary" />}
            </button>
          );
        })}
      </CardContent>
    </Card>
    <DangerZone />
    </div>
  );
}
