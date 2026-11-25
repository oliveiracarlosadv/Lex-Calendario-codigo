"use client";

import { useState } from "react";
import { BrainCircuit, Radar, RefreshCw, Sparkles } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { EmptyState } from "@/components/ui/empty-state";
import { PageHeader } from "@/components/layout/app-shell";
import { useCheckProcess, useProcesses, useSuggestions } from "@/hooks/use-records";
import { formatDateTime } from "@/lib/utils";
import { SuggestionCard } from "./suggestion-card";
import { processLabel } from "@/domain/processes/types";

const CONNECTORS = [
  { name: "TJPA — WebService oficial", status: "Ativo", detail: "Consulta pública SOAP (1º grau, juizados, 2º grau e turmas recursais)." },
  { name: "DJEN — Diário de Justiça Eletrônico Nacional", status: "Ativo", detail: "Intimações pela OAB, por nome completo ou CPF (Central de Intimações)." },
  { name: "DataJud — CNJ", status: "Ativo com chave", detail: "Cobertura nacional de movimentos (Tabela Processual Unificada)." },
  { name: "e-SAJ", status: "Em preparação", detail: "TJSP, TJMS, TJAL, TJAM, TJCE…" },
  { name: "Projudi", status: "Em preparação", detail: "TJPR, TJGO, TJBA…" },
  { name: "eproc", status: "Em preparação", detail: "TRF4, TJRS, TJSC, TJTO" },
  { name: "Certificado digital A1", status: "Estrutura pronta", detail: "Armazenamento criptografado e autenticação mTLS." },
];

export function MonitoringPage() {
  const { data: suggestions = [] } = useSuggestions();
  const { data: processes = [] } = useProcesses();
  const check = useCheckProcess();
  const [running, setRunning] = useState(false);
  const monitored = processes.filter((p) => p.is_monitored);

  async function checkAll() {
    setRunning(true);
    for (const p of monitored) await check.mutateAsync(p.id).catch(() => undefined);
    setRunning(false);
  }

  return (
    <div>
      <PageHeader
        title="Monitoramento e IA"
        description="Movimentações dos tribunais analisadas para sugerir audiências, prazos e lembretes"
        actions={<Button variant="outline" onClick={() => void checkAll()} disabled={running || !monitored.length}><RefreshCw className={running ? "animate-spin" : ""} /> Consultar todos ({monitored.length})</Button>}
      />
      <div className="grid gap-6 p-4 md:p-8 xl:grid-cols-[1fr_360px]">
        <section className="space-y-3">
          <h2 className="flex items-center gap-2 text-[15px] font-semibold"><Sparkles className="size-4 text-primary" /> Sugestões pendentes</h2>
          {suggestions.length ? (
            suggestions.map((s) => <SuggestionCard key={s.id} s={s} />)
          ) : (
            <EmptyState icon={BrainCircuit} title="Nenhuma sugestão pendente" description="Quando uma movimentação indicar audiência designada ou prazo, a sugestão aparece aqui para você agendar com um clique." />
          )}
        </section>
        <aside className="space-y-6">
          <Card>
            <CardHeader>
              <CardTitle>Como funciona</CardTitle>
              <CardDescription>
                A cada 3 horas os processos monitorados são consultados. Cada nova movimentação passa pelo analisador por regras e, quando o texto
                é ambíguo, por um modelo de linguagem open source (Ollama). Prazos são contados em dias úteis (CPC, arts. 219, 220 e 224).
                Confira sempre a data efetiva da intimação.
              </CardDescription>
            </CardHeader>
          </Card>
          <Card>
            <CardHeader><CardTitle>Conectores</CardTitle></CardHeader>
            <CardContent className="space-y-3">
              {CONNECTORS.map((c) => (
                <div key={c.name} className="text-sm">
                  <p className="flex items-center justify-between gap-2 font-medium">{c.name}<span className="text-xs font-normal text-muted-foreground">{c.status}</span></p>
                  <p className="text-xs text-muted-foreground">{c.detail}</p>
                </div>
              ))}
            </CardContent>
          </Card>
          <Card>
            <CardHeader><CardTitle className="flex items-center gap-2"><Radar className="size-4" /> Últimas consultas</CardTitle></CardHeader>
            <CardContent className="space-y-2 text-sm">
              {monitored.slice(0, 10).map((p) => (
                <p key={p.id} className="flex justify-between gap-2">
                  <span className="truncate text-xs">{processLabel(p)}</span>
                  <span className="shrink-0 text-xs text-muted-foreground">{p.monitoring_checked_at ? formatDateTime(p.monitoring_checked_at) : "pendente"}</span>
                </p>
              ))}
              {!monitored.length && <p className="text-muted-foreground">Nenhum processo monitorado.</p>}
            </CardContent>
          </Card>
        </aside>
      </div>
    </div>
  );
}
