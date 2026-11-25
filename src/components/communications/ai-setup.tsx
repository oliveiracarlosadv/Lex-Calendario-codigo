"use client";

import { useState } from "react";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { CheckCircle2, Cpu, Download, Loader2, Power, Sparkles, Trash2 } from "lucide-react";
import { toast } from "sonner";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Dialog, DialogContent, DialogDescription, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { Progress } from "@/components/ui/progress";
import { cn } from "@/lib/utils";

interface OllamaStatus {
  desktop: boolean;
  platform: string;
  installed: boolean;
  running: boolean;
  version: string | null;
  model: string;
  modelInstalled: boolean;
  installedModels: string[];
  models: { id: string; label: string; size: string; ram: string }[];
  /** IA escolhida em Configurações; "external" = serviço pela internet (ChatGPT, Claude, Groq…) */
  provider?: string;
  external?: boolean;
  job: { state: "idle" | "running" | "done" | "error"; step: string; progress: number | null; error: string | null };
}

export function useAiStatus() {
  return useQuery({
    queryKey: ["ai-status"],
    queryFn: async () => {
      const res = await fetch("/api/ia/ollama");
      if (!res.ok) throw new Error();
      return (await res.json()) as OllamaStatus;
    },
    refetchInterval: (q) => (q.state.data?.job.state === "running" ? 1500 : false),
    staleTime: 15_000,
  });
}

export const aiReady = (s?: OllamaStatus) => !!s && (!!s.external || (s.running && s.modelInstalled));

/** Quadro "IA gratuita": situação, escolha do modelo e instalação com um clique. */
export function AiSetupCard({ compact }: { compact?: boolean }) {
  const qc = useQueryClient();
  const { data: s, isLoading } = useAiStatus();
  const [model, setModel] = useState<string | null>(null);
  const chosen = model ?? s?.model ?? "qwen2.5:7b";
  const busy = s?.job.state === "running";

  const [removing, setRemoving] = useState(false);

  async function remove() {
    if (!window.confirm("Desinstalar a IA gratuita (Ollama) deste computador?\n\nO programa e os modelos baixados (vários GB) serão apagados. Você pode instalar de novo quando quiser.")) return;
    setRemoving(true);
    try {
      const res = await fetch("/api/ia/ollama", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ action: "desinstalar" }) });
      const body = (await res.json().catch(() => ({}))) as { error?: string };
      if (!res.ok) toast.error(body.error ?? "Não foi possível desinstalar.", { duration: 12_000 });
      else toast.success("IA gratuita desinstalada", { description: "O Ollama e os modelos foram removidos deste computador." });
    } finally {
      setRemoving(false);
      void qc.invalidateQueries({ queryKey: ["ai-status"] });
    }
  }

  async function act(action: "instalar" | "ligar") {
    const res = await fetch("/api/ia/ollama", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ action, model: chosen }) });
    const body = (await res.json().catch(() => ({}))) as { error?: string };
    if (!res.ok) toast.error(body.error ?? "Não foi possível concluir.");
    else if (action === "instalar") toast.info("Instalação iniciada", { description: "Pode continuar usando o Lex; avisamos quando terminar." });
    void qc.invalidateQueries({ queryKey: ["ai-status"] });
  }

  if (isLoading || !s) return compact ? null : <Card><CardContent className="p-4 text-sm text-muted-foreground">Verificando a IA…</CardContent></Card>;

  const ready = s.running && s.modelInstalled;
  const statusBadge = ready ? (
    <Badge variant="success"><CheckCircle2 className="size-3" /> Pronta</Badge>
  ) : busy ? (
    <Badge><Loader2 className="size-3 animate-spin" /> Instalando</Badge>
  ) : s.installed && !s.running ? (
    <Badge variant="warning">Desligada</Badge>
  ) : s.installed ? (
    <Badge variant="warning">Falta o modelo</Badge>
  ) : (
    <Badge variant="secondary">Não instalada</Badge>
  );

  return (
    <Card className={cn(compact && "border-dashed")}>
      <CardHeader className={cn(compact && "p-4 pb-2")}>
        <CardTitle className="flex items-center gap-2 text-[15px]"><Sparkles className="size-4 text-primary" /> IA gratuita no seu computador {statusBadge}</CardTitle>
        <CardDescription>
          Escreve e melhora e-mails, ofícios e mensagens. Usa o Ollama, de código aberto: roda neste computador, sem custo e sem enviar seus textos para a internet.
        </CardDescription>
      </CardHeader>
      <CardContent className={cn("space-y-3", compact && "p-4 pt-0")}>
        {ready && !busy ? (
          <p className="text-sm text-muted-foreground">
            Modelo em uso: <b className="font-medium text-foreground">{s.model}</b>
            {s.version ? ` · Ollama ${s.version}` : ""}. Use o botão “Gerar com a IA” na comunicação.
          </p>
        ) : (
          <>
            {!busy && (
              <div className="grid gap-2 sm:grid-cols-2">
                {s.models.map((m) => (
                  <button
                    key={m.id}
                    type="button"
                    onClick={() => setModel(m.id)}
                    className={cn("rounded-xl border px-3 py-2 text-left transition hover:bg-accent/50", chosen === m.id && "border-primary bg-primary/5")}
                  >
                    <span className="flex items-center gap-1.5 text-sm font-medium"><Cpu className="size-3.5" /> {m.label}</span>
                    <span className="block text-xs text-muted-foreground">{m.id} · download de {m.size} · {m.ram}</span>
                    {s.installedModels.includes(m.id) && <span className="text-xs text-emerald-600">já baixado</span>}
                  </button>
                ))}
              </div>
            )}
            {busy && (
              <div className="space-y-1.5">
                <p className="text-sm">{s.job.step}</p>
                <Progress value={s.job.progress != null ? Math.round(s.job.progress * 100) : 5} className={cn(s.job.progress == null && "animate-pulse")} />
                <p className="text-xs text-muted-foreground">O download pode levar alguns minutos. Você pode fechar esta janela; a instalação continua.</p>
              </div>
            )}
            {s.job.state === "error" && <p className="text-xs text-destructive">{s.job.error}</p>}
            {!busy && (
              <div className="flex flex-wrap gap-2">
                {s.desktop ? (
                  <>
                    <Button onClick={() => void act("instalar")}>
                      <Download /> {s.installed ? (s.modelInstalled ? "Usar este modelo" : "Baixar o modelo") : "Instalar IA gratuita"}
                    </Button>
                    {s.installed && !s.running && (
                      <Button variant="outline" onClick={() => void act("ligar")}><Power /> Ligar o Ollama</Button>
                    )}
                  </>
                ) : (
                  <Button variant="outline" asChild>
                    <a href="https://ollama.com/download" target="_blank" rel="noreferrer"><Download /> Baixar o Ollama (ollama.com)</a>
                  </Button>
                )}
              </div>
            )}
            {!s.installed && !busy && s.desktop && (
              <p className="text-[11px] text-muted-foreground">
                O Lex baixa o instalador oficial em ollama.com e instala o Ollama em Aplicativos. Depois baixa o modelo escolhido. Requer internet só nesta etapa.
              </p>
            )}
          </>
        )}
        {s.desktop && s.installed && !busy && (
          <Button variant="ghost" size="sm" className="text-destructive hover:text-destructive" disabled={removing} onClick={() => void remove()}>
            {removing ? <Loader2 className="animate-spin" /> : <Trash2 />} Desinstalar a IA gratuita (Ollama)
          </Button>
        )}
      </CardContent>
    </Card>
  );
}

/** Janela com o quadro de instalação (aberta a partir da tela de comunicação). */
export function AiSetupDialog({ open, onOpenChange }: { open: boolean; onOpenChange: (o: boolean) => void }) {
  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-w-xl">
        <DialogHeader>
          <DialogTitle>Instalar a IA gratuita</DialogTitle>
          <DialogDescription>Uma vez instalada, ela fica disponível sempre, mesmo sem internet.</DialogDescription>
        </DialogHeader>
        <AiSetupCard compact />
      </DialogContent>
    </Dialog>
  );
}
