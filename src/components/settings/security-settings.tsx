"use client";

import { useEffect, useState } from "react";
import { KeyRound, ShieldCheck, ShieldOff } from "lucide-react";
import { toast } from "sonner";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { sb } from "@/hooks/supabase";
import { publicEnv } from "@/lib/env";

interface Factor { id: string; friendly_name?: string; status: string; created_at: string }

export function SecuritySettings() {
  const [factors, setFactors] = useState<Factor[]>([]);
  const [enroll, setEnroll] = useState<{ id: string; qr: string; secret: string } | null>(null);
  const [code, setCode] = useState("");
  const [password, setPassword] = useState("");

  async function load() {
    const { data } = await sb().auth.mfa.listFactors();
    setFactors((data?.totp ?? []) as Factor[]);
  }
  useEffect(() => {
    if (!publicEnv.localMode) void load();
  }, []);

  if (publicEnv.localMode)
    return (
      <Card>
        <CardHeader>
          <CardTitle className="flex items-center gap-2"><ShieldCheck className="size-4" /> Segurança no modo local</CardTitle>
          <CardDescription>
            Seus dados ficam apenas neste computador (pasta Documentos/Lex Calendário/dados) e o aplicativo só aceita conexões do próprio computador.
            Senhas e tokens das contas conectadas são guardados criptografados. Proteja o acesso com a senha do seu usuário do sistema.
          </CardDescription>
        </CardHeader>
      </Card>
    );

  async function start() {
    const { data, error } = await sb().auth.mfa.enroll({ factorType: "totp", friendlyName: `Lex ${new Date().toLocaleDateString("pt-BR")}` });
    if (error || !data) return toast.error(error?.message ?? "Falha ao iniciar");
    setEnroll({ id: data.id, qr: data.totp.qr_code, secret: data.totp.secret });
  }

  async function verify() {
    if (!enroll) return;
    const { error } = await sb().auth.mfa.challengeAndVerify({ factorId: enroll.id, code });
    if (error) return toast.error("Código inválido. Confira o horário do celular e tente novamente.");
    toast.success("Verificação em duas etapas ativada");
    setEnroll(null);
    setCode("");
    void load();
  }

  async function remove(id: string) {
    if (!confirm("Desativar a verificação em duas etapas?")) return;
    const { error } = await sb().auth.mfa.unenroll({ factorId: id });
    if (error) return toast.error(error.message);
    toast.success("MFA desativado");
    void load();
  }

  async function changePassword() {
    if (password.length < 10) return toast.error("Use ao menos 10 caracteres.");
    const { error } = await sb().auth.updateUser({ password });
    if (error) return toast.error(error.message);
    setPassword("");
    toast.success("Senha alterada");
  }

  const verified = factors.filter((f) => f.status === "verified");

  return (
    <div className="space-y-6">
      <Card>
        <CardHeader>
          <CardTitle className="flex items-center gap-2"><ShieldCheck className="size-4" /> Verificação em duas etapas (MFA)</CardTitle>
          <CardDescription>Proteja o acesso com um código do Google Authenticator, Microsoft Authenticator, 1Password ou app equivalente.</CardDescription>
        </CardHeader>
        <CardContent className="space-y-4">
          {verified.map((f) => (
            <div key={f.id} className="flex items-center gap-3 rounded-xl border px-3 py-2 text-sm">
              <Badge variant="success">Ativo</Badge>
              <span className="flex-1">{f.friendly_name ?? "Autenticador"}</span>
              <Button size="sm" variant="ghost" onClick={() => void remove(f.id)}><ShieldOff /> Desativar</Button>
            </div>
          ))}
          {!enroll && !verified.length && <Button onClick={() => void start()}>Ativar MFA</Button>}
          {enroll && (
            <div className="grid gap-4 rounded-xl border p-4 sm:grid-cols-[180px_1fr]">
              {/* eslint-disable-next-line @next/next/no-img-element */}
              <img src={enroll.qr} alt="QR Code para o aplicativo autenticador" className="size-44 rounded-lg bg-white p-2" />
              <div className="space-y-3">
                <p className="text-sm">1. Escaneie o QR Code no aplicativo autenticador.</p>
                <p className="text-xs text-muted-foreground">Ou digite a chave: <code className="break-all">{enroll.secret}</code></p>
                <p className="text-sm">2. Informe o código de 6 dígitos:</p>
                <div className="flex gap-2">
                  <Input value={code} onChange={(e) => setCode(e.target.value.replace(/\D/g, "").slice(0, 6))} inputMode="numeric" className="w-36 text-center font-mono text-lg tracking-[0.3em]" />
                  <Button onClick={() => void verify()} disabled={code.length !== 6}>Confirmar</Button>
                </div>
              </div>
            </div>
          )}
        </CardContent>
      </Card>
      <Card>
        <CardHeader><CardTitle className="flex items-center gap-2"><KeyRound className="size-4" /> Alterar senha</CardTitle></CardHeader>
        <CardContent className="flex flex-wrap items-end gap-2">
          <div className="grid gap-1.5"><Label>Nova senha</Label><Input type="password" value={password} onChange={(e) => setPassword(e.target.value)} autoComplete="new-password" className="w-72" /></div>
          <Button onClick={() => void changePassword()}>Alterar</Button>
        </CardContent>
      </Card>
    </div>
  );
}
