"use client";

import { useState } from "react";
import Link from "next/link";
import { toast } from "sonner";
import { LogoMark } from "@/components/layout/logo";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { getSupabaseBrowserClient } from "@/infrastructure/supabase/client";

export default function RecoverPage() {
  const [email, setEmail] = useState("");
  const [sent, setSent] = useState(false);
  async function submit(e: React.FormEvent) {
    e.preventDefault();
    const { error } = await getSupabaseBrowserClient().auth.resetPasswordForEmail(email, {
      redirectTo: `${window.location.origin}/auth/callback?next=/configuracoes/seguranca`,
    });
    if (error) return toast.error(error.message);
    setSent(true);
  }
  return (
    <div className="space-y-6">
      <LogoMark className="size-10 rounded-xl" />
      <h1 className="text-2xl font-semibold tracking-tight">Recuperar senha</h1>
      {sent ? (
        <p className="text-sm text-muted-foreground">Se houver uma conta para <strong>{email}</strong>, você receberá um link para redefinir a senha.</p>
      ) : (
        <form onSubmit={submit} className="grid gap-3">
          <Input type="email" value={email} onChange={(e) => setEmail(e.target.value)} placeholder="seu@email.com.br" required />
          <Button type="submit" className="h-10">Enviar link</Button>
        </form>
      )}
      <Link href="/entrar" className="block text-center text-sm text-primary hover:underline">Voltar para o login</Link>
    </div>
  );
}
