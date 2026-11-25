"use client";

import { useEffect, useState } from "react";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { Bot, CheckCircle2, ExternalLink, Loader2, LogIn, ShieldCheck } from "lucide-react";
import { toast } from "sonner";
import { AiSetupCard } from "@/components/communications/ai-setup";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { AI_PROVIDERS, aiProvider, type AiProviderId } from "@/domain/ai/providers";
import { cn, formatDateTime } from "@/lib/utils";

interface AiConfig {
  provider: AiProviderId;
  model: string | null;
  baseUrl: string | null;
  hasKey: boolean;
  lastTestAt: string | null;
  lastError: string | null;
  saved: boolean;
  desktop: boolean;
}

const GROUPS = [
  { id: "gratuita", title: "Gratuitas", hint: "Recomendadas pelo Lex. Não é preciso pagar para usar." },
  { id: "conta", title: "A sua própria IA", hint: "Use a conta que você já tem. O custo é cobrado pelo próprio serviço, não pelo Lex." },
  { id: "outras", title: "Outras opções", hint: "" },
] as const;

/** Configurações → Agente de inteligência artificial: qual IA o Lex usa para escrever textos e sugerir prazos. */
export function AiSettings() {
  const qc = useQueryClient();
  const { data: config, isLoading } = useQuery({
    queryKey: ["ai-config"],
    queryFn: async () => {
      const res = await fetch("/api/ia/config");
      if (!res.ok) throw new Error();
      return (await res.json()) as AiConfig;
    },
  });
  const [provider, setProvider] = useState<AiProviderId>("ollama");
  const [model, setModel] = useState("");
  const [baseUrl, setBaseUrl] = useState("");
  const [apiKey, setApiKey] = useState("");
  const [busy, setBusy] = useState(false);

  useEffect(() => {
    if (!config) return;
    setProvider(config.provider);
    setModel(config.model ?? "");
    setBaseUrl(config.baseUrl ?? "");
  }, [config]);

  const current = aiProvider(provider);
  const usesKey = current.protocol === "openai" || current.protocol === "anthropic";
  const isActive = !!config && config.provider === provider && (config.saved || provider === "ollama");
  const keySaved = !!config?.hasKey && config.provider === provider;

  function choose(id: AiProviderId) {
    setProvider(id);
    setApiKey("");
    const p = aiProvider(id);
    setModel(config?.provider === id && config.model ? config.model : (p.defaultModel ?? ""));
    setBaseUrl(config?.provider === id ? (config.baseUrl ?? "") : "");
  }

  async function save() {
    setBusy(true);
    try {
      const res = await fetch("/api/ia/config", {
        method: "PUT",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ provider, model, baseUrl, apiKey }),
      });
      const body = (await res.json().catch(() => ({}))) as { error?: string; tested?: boolean; model?: string | null; adjusted?: boolean };
      if (!res.ok) toast.error(body.error ?? "Não foi possível salvar.", { duration: 12_000 });
      else {
        if (body.model) setModel(body.model);
        toast.success(`${current.label} ativada`, {
          description: body.adjusted ? `O modelo sugerido não existe mais; o Lex escolheu “${body.model}”, disponível na sua conta, e o teste funcionou.` : body.tested ? "O teste de conexão funcionou." : undefined,
          duration: 10_000,
        });
      }
      setApiKey("");
    } finally {
      setBusy(false);
      for (const key of ["ai-config", "ai-status"]) void qc.invalidateQueries({ queryKey: [key] });
    }
  }

  if (isLoading || !config) return <Card><CardContent className="p-5 text-sm text-muted-foreground">Carregando…</CardContent></Card>;

  return (
    <div className="space-y-6">
      <Card>
        <CardHeader>
          <CardTitle className="flex items-center gap-2"><Bot className="size-4" /> Agente de inteligência artificial</CardTitle>
          <CardDescription>
            Escolha a IA que o Lex usa para escrever e melhorar e-mails, ofícios e mensagens e para sugerir prazos e audiências a partir das intimações.
            Em uso agora: <b className="font-medium text-foreground">{aiProvider(config.provider).label}</b>.
          </CardDescription>
        </CardHeader>
        <CardContent className="space-y-5">
          {GROUPS.map((g) => (
            <div key={g.id} className="space-y-2">
              <div>
                <p className="text-sm font-semibold">{g.title}</p>
                {g.hint && <p className="text-xs text-muted-foreground">{g.hint}</p>}
              </div>
              <div className="grid gap-2 sm:grid-cols-2">
                {AI_PROVIDERS.filter((p) => p.group === g.id).map((p) => (
                  <button
                    key={p.id}
                    type="button"
                    onClick={() => choose(p.id)}
                    className={cn("rounded-xl border px-3 py-2.5 text-left transition hover:bg-accent/50", provider === p.id && "border-primary bg-primary/5")}
                  >
                    <span className="flex flex-wrap items-center gap-1.5 text-sm font-medium">
                      {p.label}
                      {config.provider === p.id && (config.saved || p.id === "ollama") && <Badge variant="success"><CheckCircle2 className="size-3" /> em uso</Badge>}
                    </span>
                    <span className="mt-0.5 block text-xs text-muted-foreground">{p.summary}</span>
                  </button>
                ))}
              </div>
            </div>
          ))}
        </CardContent>
      </Card>

      {usesKey && (
        <Card>
          <CardHeader>
            <CardTitle className="text-[15px]">Conectar: {current.label}</CardTitle>
            <CardDescription>{current.keyHelp}</CardDescription>
          </CardHeader>
          <CardContent className="space-y-3">
            {current.login && (
              <div className="space-y-2 rounded-xl border border-primary/40 bg-primary/5 p-3">
                <p className="text-sm font-medium">Entrar sem chave de acesso</p>
                <p className="text-xs text-muted-foreground">Clique para entrar com a sua conta do OpenRouter. O Lex recebe a autorização sozinho — você não copia nem cola nada.</p>
                <Button asChild>
                  <a href="/api/ia/openrouter/connect"><LogIn /> Entrar com o OpenRouter</a>
                </Button>
                <p className="text-[11px] text-muted-foreground">Ou, se preferir, informe uma chave abaixo.</p>
              </div>
            )}
            {current.keyUrl && (
              <Button variant="outline" size="sm" asChild>
                <a href={current.keyUrl} target="_blank" rel="noreferrer"><ExternalLink /> Abrir a página para criar {current.keyLabel ? "o token" : "a chave"}</a>
              </Button>
            )}
            {provider === "custom" && (
              <div className="grid gap-1.5">
                <Label>Endereço do serviço</Label>
                <Input value={baseUrl} onChange={(e) => setBaseUrl(e.target.value)} placeholder="https://…/v1" />
              </div>
            )}
            <div className="grid gap-1.5">
              <Label>{current.keyLabel ?? "Chave de acesso (API Key)"}</Label>
              <Input
                type="password"
                autoComplete="off"
                value={apiKey}
                onChange={(e) => setApiKey(e.target.value)}
                placeholder={keySaved ? "•••••••• (salva — preencha só para trocar)" : "Cole aqui"}
              />
            </div>
            <div className="grid gap-1.5">
              <Label>Modelo</Label>
              <Input value={model} onChange={(e) => setModel(e.target.value)} list="lex-ai-models" placeholder={current.defaultModel ?? "nome do modelo"} />
              <datalist id="lex-ai-models">{(current.models ?? []).map((m) => <option key={m} value={m} />)}</datalist>
              <p className="text-[11px] text-muted-foreground">Na dúvida, deixe como está: se o modelo não existir mais, o Lex escolhe sozinho um que funcione na sua conta.</p>
            </div>
            <p className="flex gap-2 rounded-xl bg-amber-500/10 p-3 text-xs text-muted-foreground">
              <ShieldCheck className="mt-0.5 size-4 shrink-0 text-amber-600" />
              <span>
                Com esta opção, os textos enviados à IA (trechos de intimações, nomes de clientes e números de processo) saem do computador e vão para {current.label}.
                Avalie o sigilo profissional antes de ativar. A chave fica guardada criptografada no Lex e nunca é mostrada de novo.
              </span>
            </p>
            {isActive && config.lastTestAt && (
              <p className={cn("text-xs", config.lastError ? "text-destructive" : "text-emerald-600")}>
                {config.lastError ? `Último teste falhou: ${config.lastError}` : `Último teste funcionou em ${formatDateTime(config.lastTestAt)}.`}
              </p>
            )}
            <Button onClick={() => void save()} disabled={busy}>{busy ? <Loader2 className="animate-spin" /> : <CheckCircle2 />} Salvar, testar e usar esta IA</Button>
          </CardContent>
        </Card>
      )}

      {provider === "ollama" && (
        <>
          {!isActive && <Button onClick={() => void save()} disabled={busy}>{busy ? <Loader2 className="animate-spin" /> : <CheckCircle2 />} Usar a IA do Lex no computador</Button>}
          <AiSetupCard />
        </>
      )}

      {provider === "rules" && !isActive && (
        <Button variant="outline" onClick={() => void save()} disabled={busy}>{busy ? <Loader2 className="animate-spin" /> : null} Desligar a IA</Button>
      )}
    </div>
  );
}
