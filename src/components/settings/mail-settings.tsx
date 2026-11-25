"use client";

import { useEffect, useState } from "react";
import { useQueryClient } from "@tanstack/react-query";
import { CheckCircle2, Loader2, Mail, Trash2 } from "lucide-react";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Switch } from "@/components/ui/switch";
import { useMailAccount } from "@/hooks/use-communications";
import { openOAuthWindow } from "@/lib/oauth-popup";
import { useWorkspace } from "@/hooks/use-workspace";
import { formatDateTime } from "@/lib/utils";

const PRESETS = [
  { id: "gmail", label: "Gmail (senha de app)", host: "smtp.gmail.com", port: 465, secure: true, help: "Ative a verificação em duas etapas e crie uma senha de app em myaccount.google.com/apppasswords." },
  { id: "outlook", label: "Outlook / Hotmail / Microsoft 365", host: "smtp.office365.com", port: 587, secure: false, help: "Use uma senha de app (account.microsoft.com → Segurança). Contas corporativas podem exigir liberação do administrador (SMTP AUTH)." },
  { id: "icloud", label: "iCloud", host: "smtp.mail.me.com", port: 587, secure: false, help: "Crie uma senha de app em appleid.apple.com → Senhas de apps. O usuário é o e-mail @icloud.com." },
  { id: "outro", label: "Outro (provedor do escritório)", host: "", port: 465, secure: true, help: "Consulte o servidor SMTP e a porta com o seu provedor (Locaweb, HostGator, Zoho, UOL...)." },
] as const;

/** Outro provedor (SMTP): Outlook, iCloud, provedor do escritório ou Gmail com senha de app. */
function SmtpSettings() {
  const qc = useQueryClient();
  const { profile, email } = useWorkspace();
  const { data: setup, isLoading } = useMailAccount();
  const account = setup?.account ?? null;
  const [preset, setPreset] = useState<(typeof PRESETS)[number]["id"]>("outlook");
  const [host, setHost] = useState("smtp.office365.com");
  const [port, setPort] = useState(587);
  const [secure, setSecure] = useState(false);
  const [username, setUsername] = useState("");
  const [password, setPassword] = useState("");
  const [fromName, setFromName] = useState(profile.full_name ?? "");
  const [fromEmail, setFromEmail] = useState("");
  const [busy, setBusy] = useState(false);

  useEffect(() => {
    if (!account) {
      if (email && !email.endsWith("@lex.local")) {
        setUsername((u) => u || email);
        setFromEmail((f) => f || email);
      }
      return;
    }
    setHost(account.host);
    setPort(account.port);
    setSecure(account.secure);
    setUsername(account.username);
    setFromName(account.from_name ?? "");
    setFromEmail(account.from_email);
    setPreset((PRESETS.find((p) => p.host === account.host)?.id ?? "outro") as typeof preset);
  }, [account, email]);

  function choose(id: (typeof PRESETS)[number]["id"]) {
    const p = PRESETS.find((x) => x.id === id)!;
    setPreset(id);
    if (p.host) setHost(p.host);
    setPort(p.port);
    setSecure(p.secure);
  }

  async function submit() {
    setBusy(true);
    try {
      const res = await fetch("/api/conta-email", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ host, port, secure, username, password: password || undefined, fromName, fromEmail: fromEmail || username }),
      });
      const data = (await res.json().catch(() => ({}))) as { error?: string };
      if (!res.ok) toast.error(data.error ?? "Não foi possível salvar.", { duration: 12_000 });
      else toast.success("Conta de e-mail conectada", { description: "Teste de conexão aprovado. Os e-mails aos clientes saem por esta conta." });
      setPassword("");
      void qc.invalidateQueries({ queryKey: ["mail-account"] });
    } finally {
      setBusy(false);
    }
  }

  async function disconnect() {
    if (!confirm("Remover a conta de e-mail de envio? A senha é apagada deste computador.")) return;
    await fetch("/api/conta-email", { method: "DELETE" });
    void qc.invalidateQueries({ queryKey: ["mail-account"] });
    toast.success("Conta removida");
  }

  const current = PRESETS.find((p) => p.id === preset)!;

  return (
    <Card>
      <CardHeader>
        <CardTitle className="flex items-center gap-2"><Mail className="size-4" /> Outro provedor de e-mail (SMTP)</CardTitle>
        <CardDescription>
          Para quem não usa Gmail: Outlook, iCloud ou o e-mail do escritório. A senha fica criptografada neste computador e nunca é exibida.
        </CardDescription>
      </CardHeader>
      <CardContent className="space-y-4">
        {account && (
          <div className="flex items-center gap-3 rounded-xl border px-3 py-2.5 text-sm">
            <CheckCircle2 className={account.last_error ? "size-4 text-amber-500" : "size-4 text-emerald-500"} />
            <span className="min-w-0 flex-1">
              <span className="block font-medium">{account.from_email}</span>
              <span className="block text-xs text-muted-foreground">
                {account.host}:{account.port} · {account.last_error ? `último teste falhou: ${account.last_error}` : `testada ${account.last_test_at ? formatDateTime(account.last_test_at) : ""}`}
              </span>
            </span>
            <Button variant="ghost" size="sm" onClick={() => void disconnect()}><Trash2 /> Remover</Button>
          </div>
        )}

        <div className="flex flex-wrap gap-1">
          {PRESETS.map((p) => (
            <button
              key={p.id}
              type="button"
              onClick={() => choose(p.id)}
              className={`rounded-full px-3 py-1 text-xs transition ${preset === p.id ? "bg-primary text-primary-foreground" : "bg-secondary hover:bg-accent"}`}
            >
              {p.label}
            </button>
          ))}
        </div>
        <p className="rounded-xl bg-secondary/60 p-3 text-xs text-muted-foreground">{current.help}</p>

        <div className="grid gap-3 sm:grid-cols-2">
          <div className="grid gap-1.5">
            <Label>Seu nome (remetente)</Label>
            <Input value={fromName} onChange={(e) => setFromName(e.target.value)} placeholder="Dra. Maria Silva — Advocacia" />
          </div>
          <div className="grid gap-1.5">
            <Label>E-mail do remetente</Label>
            <Input type="email" value={fromEmail} onChange={(e) => setFromEmail(e.target.value)} placeholder="voce@gmail.com" />
          </div>
          <div className="grid gap-1.5">
            <Label>Usuário (login do e-mail)</Label>
            <Input value={username} onChange={(e) => setUsername(e.target.value)} autoComplete="off" />
          </div>
          <div className="grid gap-1.5">
            <Label>Senha de app</Label>
            <Input type="password" value={password} onChange={(e) => setPassword(e.target.value)} autoComplete="new-password" placeholder={account ? "•••••••• (mantida)" : ""} />
          </div>
          <div className="grid gap-1.5">
            <Label>Servidor SMTP</Label>
            <Input value={host} onChange={(e) => setHost(e.target.value)} placeholder="smtp.seuprovedor.com.br" />
          </div>
          <div className="grid grid-cols-[1fr_auto] items-end gap-3">
            <div className="grid gap-1.5">
              <Label>Porta</Label>
              <Input type="number" value={port} onChange={(e) => setPort(Number(e.target.value))} />
            </div>
            <label className="flex h-9 items-center gap-2 text-sm">
              SSL <Switch checked={secure} onCheckedChange={setSecure} />
            </label>
          </div>
        </div>
        <Button onClick={() => void submit()} disabled={busy || isLoading || !host || !username}>
          {busy && <Loader2 className="animate-spin" />} {account ? "Salvar e testar" : "Conectar e testar"}
        </Button>
      </CardContent>
    </Card>
  );
}

/** Configurações → E-mail de envio: Gmail com um clique (recomendado) ou outro provedor. */
export function MailSettings() {
  const qc = useQueryClient();
  const { data: setup } = useMailAccount();
  const [testing, setTesting] = useState(false);
  const gmail = setup?.gmail;

  async function test() {
    setTesting(true);
    try {
      const res = await fetch("/api/conta-email/teste", { method: "POST" });
      const body = (await res.json().catch(() => ({}))) as { error?: string; to?: string };
      if (!res.ok) toast.error("O teste falhou", { description: body.error, duration: 15_000 });
      else toast.success("E-mail de teste enviado", { description: `Confira a caixa de entrada de ${body.to}.` });
    } finally {
      setTesting(false);
    }
  }

  async function stopGmail() {
    if (!confirm("Parar de enviar as comunicações pelo Gmail? A agenda do Google continua conectada.")) return;
    await fetch("/api/conta-email/gmail", { method: "DELETE" });
    void qc.invalidateQueries({ queryKey: ["mail-account"] });
  }

  return (
    <div className="space-y-6">
      <Card className={gmail ? "border-emerald-500/40" : "border-primary/40"}>
        <CardHeader>
          <CardTitle className="flex items-center gap-2"><Mail className="size-4 text-primary" /> Enviar pelo Gmail <span className="rounded-full bg-primary/10 px-2 py-0.5 text-[11px] font-medium text-primary">recomendado</span></CardTitle>
          <CardDescription>
            As comunicações aos clientes saem de dentro do Lex pelo seu Gmail, com anexos e envio agendado, e ficam salvas em “Enviados”.
            Basta autorizar uma vez: não precisa de senha de app nem de servidor. O Lex só envia — não lê seus e-mails.
          </CardDescription>
        </CardHeader>
        <CardContent className="space-y-3">
          {gmail ? (
            <>
              <div className="flex flex-wrap items-center gap-3 rounded-xl border px-3 py-2.5 text-sm">
                <CheckCircle2 className="size-4 text-emerald-500" />
                <span className="min-w-0 flex-1">
                  <span className="block font-medium">Enviando por {gmail.email ?? "sua conta Google"}</span>
                  <span className="block text-xs text-muted-foreground">Gmail conectado ao Lex</span>
                </span>
                <Button variant="outline" size="sm" onClick={() => void test()} disabled={testing}>
                  {testing && <Loader2 className="animate-spin" />} Enviar e-mail de teste
                </Button>
                <Button variant="ghost" size="sm" onClick={() => void stopGmail()}>Desconectar</Button>
              </div>
              {gmail.replies ? (
                <p className="text-xs text-muted-foreground">
                  ✓ Respostas viram comentários: quando alguém responde ao e-mail de um comentário, a resposta entra no compromisso (o Lex lê apenas essas conversas).
                </p>
              ) : (
                <div className="flex flex-wrap items-center gap-3 rounded-xl bg-secondary/60 p-3 text-xs">
                  <span className="min-w-0 flex-1">
                    <b>Receber as respostas como comentários:</b> autorize o Lex a ler as respostas aos e-mails de comentário. Ele lê somente as conversas que ele mesmo iniciou.
                  </span>
                  <Button size="sm" variant="outline" onClick={() => openOAuthWindow("google", { gmail: true })}>Autorizar</Button>
                </div>
              )}
            </>
          ) : setup?.googleAvailable ? (
            <div className="space-y-2">
              <Button size="lg" onClick={() => openOAuthWindow("google", { gmail: true })}>
                <Mail /> Conectar meu Gmail
              </Button>
              <ol className="list-decimal space-y-0.5 pl-5 text-xs text-muted-foreground">
                <li>Clique em “Conectar meu Gmail” e escolha sua conta{setup.googleEmail ? ` (${setup.googleEmail})` : ""}.</li>
                <li>Na tela do Google, marque a permissão <b>“Enviar e-mail em seu nome”</b> e clique em Continuar.</li>
                <li>Pronto: use “Enviar e-mail de teste” para conferir.</li>
              </ol>
            </div>
          ) : (
            <p className="text-sm text-muted-foreground">A integração com o Google não está disponível nesta instalação. Use outro provedor abaixo.</p>
          )}
        </CardContent>
      </Card>

      <details className="group rounded-2xl" open={!gmail && !!setup?.account}>
        <summary className="cursor-pointer list-none text-sm font-medium text-muted-foreground hover:text-foreground">
          ▸ Usar outro provedor de e-mail (Outlook, iCloud, e-mail do escritório)
        </summary>
        <div className="mt-3">
          <SmtpSettings />
        </div>
      </details>
    </div>
  );
}
