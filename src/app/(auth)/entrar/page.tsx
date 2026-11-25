"use client";

import { Suspense, useState } from "react";
import Link from "next/link";
import { useRouter, useSearchParams } from "next/navigation";
import { toast } from "sonner";
import { Divider, OAuthButtons } from "@/components/auth/oauth-buttons";
import { LogoMark } from "@/components/layout/logo";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { getSupabaseBrowserClient } from "@/infrastructure/supabase/client";

function SignInForm() {
  const router = useRouter();
  const params = useSearchParams();
  const next = params.get("next") ?? "/calendario";
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [loading, setLoading] = useState(false);

  async function submit(e: React.FormEvent) {
    e.preventDefault();
    setLoading(true);
    const supabase = getSupabaseBrowserClient();
    const { error } = await supabase.auth.signInWithPassword({ email, password });
    if (error) {
      setLoading(false);
      return toast.error(error.message === "Invalid login credentials" ? "E-mail ou senha incorretos." : error.message);
    }
    const { data: aal } = await supabase.auth.mfa.getAuthenticatorAssuranceLevel();
    router.replace(aal?.nextLevel === "aal2" && aal.currentLevel !== "aal2" ? `/auth/mfa?next=${encodeURIComponent(next)}` : next);
    router.refresh();
  }

  return (
    <div className="space-y-6">
      <div className="space-y-2">
        <LogoMark className="size-10 rounded-xl" />
        <h1 className="text-2xl font-semibold tracking-tight">Entrar no Lex Calendário</h1>
        <p className="text-sm text-muted-foreground">Bem-vindo de volta.</p>
      </div>
      {params.get("erro") && <p className="rounded-lg bg-destructive/10 px-3 py-2 text-sm text-destructive">Não foi possível concluir o acesso. Tente novamente.</p>}
      <OAuthButtons next={next} />
      <Divider label="ou com e-mail" />
      <form onSubmit={submit} className="grid gap-3">
        <div className="grid gap-1.5"><Label htmlFor="email">E-mail</Label><Input id="email" type="email" autoComplete="email" value={email} onChange={(e) => setEmail(e.target.value)} required /></div>
        <div className="grid gap-1.5">
          <div className="flex items-center justify-between"><Label htmlFor="password">Senha</Label><Link href="/recuperar-senha" className="text-xs text-primary hover:underline">Esqueci a senha</Link></div>
          <Input id="password" type="password" autoComplete="current-password" value={password} onChange={(e) => setPassword(e.target.value)} required />
        </div>
        <Button type="submit" className="mt-1 h-10" disabled={loading}>{loading ? "Entrando…" : "Entrar"}</Button>
      </form>
      <p className="text-center text-sm text-muted-foreground">Novo por aqui? <Link href="/cadastro" className="text-primary hover:underline">Crie sua conta</Link></p>
    </div>
  );
}

export default function SignInPage() {
  return (
    <Suspense>
      <SignInForm />
    </Suspense>
  );
}
