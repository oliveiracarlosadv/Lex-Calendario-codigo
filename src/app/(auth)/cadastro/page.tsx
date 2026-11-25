"use client";

import { useState } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { toast } from "sonner";
import { Divider, OAuthButtons } from "@/components/auth/oauth-buttons";
import { LogoMark } from "@/components/layout/logo";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { getSupabaseBrowserClient } from "@/infrastructure/supabase/client";
import { LEGAL_LINKS } from "@/lib/env";

export default function SignUpPage() {
  const router = useRouter();
  const [form, setForm] = useState({ name: "", office: "", email: "", password: "" });
  const [loading, setLoading] = useState(false);
  const [sent, setSent] = useState(false);

  async function submit(e: React.FormEvent) {
    e.preventDefault();
    if (form.password.length < 10) return toast.error("A senha precisa de ao menos 10 caracteres.");
    setLoading(true);
    const supabase = getSupabaseBrowserClient();
    // Já usando sem conta: transforma a sessão atual em conta, mantendo todos os dados
    const { data: current } = await supabase.auth.getUser();
    if (current.user?.is_anonymous) {
      const { error } = await supabase.auth.updateUser({ email: form.email, password: form.password, data: { full_name: form.name } });
      setLoading(false);
      if (error) return toast.error(error.message);
      toast.success("Conta criada. Seus compromissos foram mantidos.");
      router.replace("/calendario");
      router.refresh();
      return;
    }
    const { data, error } = await supabase.auth.signUp({
      email: form.email,
      password: form.password,
      options: {
        emailRedirectTo: `${window.location.origin}/auth/callback?next=/calendario`,
        data: { full_name: form.name, organization_name: form.office || undefined },
      },
    });
    setLoading(false);
    if (error) return toast.error(error.message);
    if (data.session) {
      router.replace("/calendario");
      router.refresh();
    } else setSent(true);
  }

  if (sent)
    return (
      <div className="space-y-3 text-center">
        <LogoMark className="mx-auto size-12 rounded-xl" />
        <h1 className="text-2xl font-semibold tracking-tight">Confirme seu e-mail</h1>
        <p className="text-sm text-muted-foreground">Enviamos um link para <strong>{form.email}</strong>. Abra-o para ativar sua conta.</p>
      </div>
    );

  return (
    <div className="space-y-6">
      <div className="space-y-2">
        <LogoMark className="size-10 rounded-xl" />
        <h1 className="text-2xl font-semibold tracking-tight">Crie sua conta</h1>
        <p className="text-sm text-muted-foreground">Opcional: use para acessar a mesma agenda em outros dispositivos.</p>
      </div>
      <OAuthButtons />
      <Divider label="ou com e-mail" />
      <form onSubmit={submit} className="grid gap-3">
        <div className="grid gap-1.5"><Label>Nome completo</Label><Input value={form.name} onChange={(e) => setForm({ ...form, name: e.target.value })} autoComplete="name" required /></div>
        <div className="grid gap-1.5"><Label>Escritório (opcional)</Label><Input value={form.office} onChange={(e) => setForm({ ...form, office: e.target.value })} placeholder="Silva & Associados" /></div>
        <div className="grid gap-1.5"><Label>E-mail</Label><Input type="email" value={form.email} onChange={(e) => setForm({ ...form, email: e.target.value })} autoComplete="email" required /></div>
        <div className="grid gap-1.5"><Label>Senha</Label><Input type="password" value={form.password} onChange={(e) => setForm({ ...form, password: e.target.value })} autoComplete="new-password" required minLength={10} /></div>
        <Button type="submit" className="mt-1 h-10" disabled={loading}>{loading ? "Criando…" : "Criar conta"}</Button>
      </form>
      <p className="text-center text-xs text-muted-foreground">
        Ao continuar, você concorda com os <a className="underline" href={LEGAL_LINKS.terms} target="_blank" rel="noreferrer">Termos de Uso</a> e a{" "}
        <a className="underline" href={LEGAL_LINKS.privacy} target="_blank" rel="noreferrer">Política de Privacidade</a> (LGPD).
      </p>
      <p className="text-center text-sm text-muted-foreground">Já tem conta? <Link href="/entrar" className="text-primary hover:underline">Entrar</Link></p>
    </div>
  );
}
