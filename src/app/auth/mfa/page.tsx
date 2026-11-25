"use client";

import { Suspense, useState } from "react";
import { useRouter, useSearchParams } from "next/navigation";
import { toast } from "sonner";
import { LogoMark } from "@/components/layout/logo";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { getSupabaseBrowserClient } from "@/infrastructure/supabase/client";

function MfaForm() {
  const router = useRouter();
  const params = useSearchParams();
  const next = params.get("next") ?? (typeof window !== "undefined" && window.location.pathname !== "/auth/mfa" ? window.location.pathname : "/calendario");
  const [code, setCode] = useState("");
  const [loading, setLoading] = useState(false);

  async function verify(e: React.FormEvent) {
    e.preventDefault();
    setLoading(true);
    const supabase = getSupabaseBrowserClient();
    const { data: factors } = await supabase.auth.mfa.listFactors();
    const factor = (factors?.totp as { id: string; status: string }[] | undefined)?.find((f) => f.status === "verified");
    if (!factor) {
      setLoading(false);
      return toast.error("Nenhum autenticador configurado.");
    }
    const { error } = await supabase.auth.mfa.challengeAndVerify({ factorId: factor.id, code });
    setLoading(false);
    if (error) return toast.error("Código inválido.");
    router.replace(next.startsWith("/") ? next : "/calendario");
    router.refresh();
  }

  return (
    <div className="flex min-h-dvh items-center justify-center px-4">
      <form onSubmit={verify} className="w-full max-w-xs space-y-5 text-center">
        <LogoMark className="mx-auto size-12 rounded-xl" />
        <div>
          <h1 className="text-xl font-semibold tracking-tight">Verificação em duas etapas</h1>
          <p className="text-sm text-muted-foreground">Digite o código de 6 dígitos do seu aplicativo autenticador.</p>
        </div>
        <Input autoFocus value={code} onChange={(e) => setCode(e.target.value.replace(/\D/g, "").slice(0, 6))} inputMode="numeric" autoComplete="one-time-code" className="h-12 text-center font-mono text-2xl tracking-[0.4em]" />
        <Button type="submit" className="h-10 w-full" disabled={code.length !== 6 || loading}>Verificar</Button>
        <button
          type="button"
          className="text-sm text-muted-foreground hover:underline"
          onClick={async () => {
            await getSupabaseBrowserClient().auth.signOut();
            router.replace("/entrar");
          }}
        >
          Usar outra conta
        </button>
      </form>
    </div>
  );
}

export default function MfaPage() {
  return (
    <Suspense>
      <MfaForm />
    </Suspense>
  );
}
