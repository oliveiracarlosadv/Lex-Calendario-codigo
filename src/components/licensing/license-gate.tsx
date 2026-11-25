"use client";

import { useState } from "react";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { CreditCard, Download, Loader2, LogOut, Mail, RefreshCw } from "lucide-react";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { formatDay } from "@/lib/utils";

interface License {
  required: boolean;
  signedIn: boolean;
  allowed: boolean;
  offline: boolean;
  status: { email: string; name: string | null; state: "trial" | "active" | "expired"; until: string | null; subscribed: boolean; price: number } | null;
}

const money = (v: number) => v.toLocaleString("pt-BR", { style: "currency", currency: "BRL" });
const daysLeft = (iso: string | null) => (iso ? Math.max(0, Math.ceil((new Date(iso).getTime() - Date.now()) / 864e5)) : 0);

export function useLicense() {
  return useQuery({
    queryKey: ["license"],
    queryFn: async () => {
      const res = await fetch("/api/assinatura");
      if (!res.ok) throw new Error();
      return (await res.json()) as License;
    },
    staleTime: 10 * 60_000,
    refetchInterval: 60 * 60_000,
    retry: 1,
  });
}

async function post(body: Record<string, unknown>) {
  const res = await fetch("/api/assinatura", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify(body) });
  const data = (await res.json().catch(() => ({}))) as { error?: string; url?: string };
  if (!res.ok) throw new Error(data.error ?? "Não foi possível concluir.");
  return data;
}

function Frame({ title, children }: { title: string; children: React.ReactNode }) {
  return (
    <div className="flex min-h-dvh items-center justify-center bg-background p-6">
      <div className="w-full max-w-md space-y-4 rounded-3xl border bg-card p-7 shadow-sm">
        <div>
          <p className="text-xs font-semibold uppercase tracking-widest text-primary">Lex Calendário</p>
          <h1 className="mt-1 text-xl font-semibold">{title}</h1>
        </div>
        {children}
      </div>
    </div>
  );
}

/** Entrada do assinante: e-mail e código de 6 números recebido por e-mail. */
function SignIn({ onDone }: { onDone: () => void }) {
  const [email, setEmail] = useState("");
  const [code, setCode] = useState("");
  const [sent, setSent] = useState(false);
  const [busy, setBusy] = useState(false);

  async function run(action: "codigo" | "entrar") {
    setBusy(true);
    try {
      await post({ action, email, code });
      if (action === "codigo") {
        setSent(true);
        toast.success("Código enviado", { description: `Confira a caixa de entrada de ${email}.` });
      } else onDone();
    } catch (e) {
      toast.error((e as Error).message);
    } finally {
      setBusy(false);
    }
  }

  return (
    <Frame title="Entrar">
      <p className="text-sm text-muted-foreground">Informe o seu e-mail. Enviamos um código para você entrar — sem senha. Os seus dados continuam guardados neste computador.</p>
      <form
        className="space-y-3"
        onSubmit={(e) => {
          e.preventDefault();
          void run(sent ? "entrar" : "codigo");
        }}
      >
        <div className="grid gap-1.5">
          <Label>E-mail</Label>
          <Input type="email" required value={email} onChange={(e) => setEmail(e.target.value)} disabled={sent} autoFocus placeholder="voce@exemplo.com" />
        </div>
        {sent && (
          <div className="grid gap-1.5">
            <Label>Código recebido por e-mail</Label>
            <Input inputMode="numeric" required value={code} onChange={(e) => setCode(e.target.value)} placeholder="000000" maxLength={8} autoFocus />
          </div>
        )}
        <Button type="submit" className="w-full" disabled={busy}>
          {busy ? <Loader2 className="animate-spin" /> : <Mail />} {sent ? "Entrar" : "Enviar código"}
        </Button>
        {sent && (
          <button type="button" className="w-full text-xs text-muted-foreground hover:underline" onClick={() => { setSent(false); setCode(""); }}>
            Usar outro e-mail ou pedir novo código
          </button>
        )}
      </form>
    </Frame>
  );
}

/** Assinar: nome e CPF/CNPJ (exigidos pela cobrança) e abertura da página de pagamento do Asaas. */
export function SubscribeForm({ license, onRefresh }: { license: License; onRefresh: () => void }) {
  const [name, setName] = useState(license.status?.name ?? "");
  const [doc, setDoc] = useState("");
  const [busy, setBusy] = useState(false);

  async function subscribe() {
    setBusy(true);
    try {
      const data = await post({ action: "assinar", name, document: doc });
      if (data.url) window.open(data.url, "_blank", "noopener");
      toast.info("Página de pagamento aberta", { description: "Depois de pagar, clique em “Já paguei”." , duration: 12_000 });
    } catch (e) {
      toast.error((e as Error).message, { duration: 12_000 });
    } finally {
      setBusy(false);
    }
  }

  return (
    <form
      className="space-y-3"
      onSubmit={(e) => {
        e.preventDefault();
        void subscribe();
      }}
    >
      <div className="grid gap-1.5">
        <Label>Nome completo ou razão social</Label>
        <Input required minLength={3} value={name} onChange={(e) => setName(e.target.value)} />
      </div>
      <div className="grid gap-1.5">
        <Label>CPF ou CNPJ</Label>
        <Input required inputMode="numeric" value={doc} onChange={(e) => setDoc(e.target.value)} placeholder="Somente para emitir a cobrança" />
      </div>
      <Button type="submit" className="w-full" disabled={busy}>
        {busy ? <Loader2 className="animate-spin" /> : <CreditCard />} Assinar{license.status?.price ? ` por ${money(license.status.price)} por mês` : ""}
      </Button>
      <Button type="button" variant="outline" className="w-full" onClick={onRefresh}><RefreshCw /> Já paguei — verificar</Button>
      <p className="text-center text-[11px] text-muted-foreground">Pagamento por Pix, boleto ou cartão, processado pelo Asaas. Cancele quando quiser.</p>
    </form>
  );
}

/** No aplicativo instalado com assinatura ativada: pede a entrada e, vencido o teste, a assinatura. */
export function LicenseGate({ children }: { children: React.ReactNode }) {
  const qc = useQueryClient();
  const { data: license, isLoading } = useLicense();
  const [checking, setChecking] = useState(false);
  const [showSubscribe, setShowSubscribe] = useState(false);

  async function refresh() {
    setChecking(true);
    try {
      const res = await fetch("/api/assinatura?atualizar=1");
      if (res.ok) {
        const fresh = (await res.json()) as License;
        qc.setQueryData(["license"], fresh);
        if (fresh.status?.state === "active") {
          setShowSubscribe(false);
          toast.success("Assinatura ativa. Obrigado!");
        } else toast.info("Pagamento ainda não confirmado", { description: "O Pix confirma em instantes; boleto pode levar até 3 dias úteis." });
      }
    } finally {
      setChecking(false);
    }
  }
  async function signOut() {
    await post({ action: "sair" }).catch(() => undefined);
    void qc.invalidateQueries({ queryKey: ["license"] });
  }

  // Sem assinatura nesta instalação (ou ainda carregando): o Lex abre normalmente
  if (isLoading || !license || !license.required) return <>{children}</>;
  if (!license.signedIn) return <SignIn onDone={() => void qc.invalidateQueries({ queryKey: ["license"] })} />;

  const s = license.status;
  if (!license.allowed || showSubscribe) {
    const blocked = !license.allowed;
    return (
      <Frame title={!blocked ? "Assinar o Lex Calendário" : license.offline && s?.state !== "expired" ? "Conecte-se à internet" : s?.subscribed ? "Pagamento pendente" : "O período de teste terminou"}>
        <p className="text-sm text-muted-foreground">
          {!blocked
            ? "Assine agora e continue usando sem interrupção quando o teste terminar."
            : license.offline && s?.state !== "expired"
              ? "Faz alguns dias que o Lex não consegue confirmar a sua assinatura. Conecte o computador à internet e clique em verificar."
              : "Para continuar usando o Lex Calendário, faça a assinatura mensal. Os seus dados continuam guardados neste computador e voltam a aparecer assim que o pagamento for confirmado."}
        </p>
        <p className="text-xs text-muted-foreground">Conta: <b className="text-foreground">{s?.email}</b></p>
        {license && <SubscribeForm license={license} onRefresh={() => void refresh()} />}
        {checking && <p className="flex items-center justify-center gap-2 text-xs text-muted-foreground"><Loader2 className="size-3 animate-spin" /> Verificando…</p>}
        <div className="flex flex-wrap justify-between gap-2 border-t pt-3">
          {blocked ? (
            <Button variant="ghost" size="sm" asChild><a href="/api/backup/export"><Download /> Baixar meus dados (backup)</a></Button>
          ) : (
            <Button variant="ghost" size="sm" onClick={() => setShowSubscribe(false)}>Voltar ao calendário</Button>
          )}
          <Button variant="ghost" size="sm" onClick={() => void signOut()}><LogOut /> Sair</Button>
        </div>
      </Frame>
    );
  }

  return (
    <>
      {s?.state === "trial" && (
        <div className="fixed bottom-3 left-1/2 z-40 flex -translate-x-1/2 flex-wrap items-center justify-center gap-x-3 gap-y-1 rounded-full border bg-card px-4 py-1.5 text-center text-xs shadow-md">
          <span>
            Teste grátis: {daysLeft(s.until) === 1 ? "falta 1 dia" : `faltam ${daysLeft(s.until)} dias`}
            {s.until ? ` (até ${formatDay(s.until)})` : ""}.
          </span>
          <button className="font-semibold text-primary hover:underline" onClick={() => setShowSubscribe(true)}>Assinar agora</button>
        </div>
      )}
      {children}
    </>
  );
}
