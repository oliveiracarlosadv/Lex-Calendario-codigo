"use client";

import { Suspense, useEffect, useState } from "react";
import { useSearchParams } from "next/navigation";
import { LogoMark, OliveBranch } from "@/components/layout/logo";
import { getSupabaseBrowserClient } from "@/infrastructure/supabase/client";

/** Entrada automática: cria/recupera a sessão local (sem conta) e abre o calendário. */
function Bootstrap() {
  const params = useSearchParams();
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    // Chegou aqui por reescrita do middleware: volta para o próprio endereço pedido
    const here = window.location.pathname === "/inicio" ? null : `${window.location.pathname}${window.location.search}`;
    const next = params.get("next") ?? here;
    const target = next && next.startsWith("/") && !next.startsWith("//") ? next : "/calendario";
    let cancelled = false;
    (async () => {
      const supabase = getSupabaseBrowserClient();
      // Valida a sessão no servidor: se o banco local foi recriado, a sessão antiga não vale mais
      const { data } = await supabase.auth.getUser();
      if (!data.user) {
        await supabase.auth.signOut({ scope: "local" }).catch(() => undefined);
        const { error: signInError } = await supabase.auth.signInAnonymously({
          options: { data: { full_name: "Você", organization_name: "Meu escritório" } },
        });
        if (signInError) {
          if (!cancelled) setError(signInError.message);
          return;
        }
      }
      // Recarga completa: o servidor passa a ver a nova sessão (cookies) na mesma origem
      if (!cancelled) window.location.replace(target);
    })();
    return () => {
      cancelled = true;
    };
  }, [params]);

  return (
    <div className="flex min-h-dvh flex-col items-center justify-center gap-4 px-6 text-center">
      <LogoMark className="size-14 rounded-2xl" />
      <OliveBranch className="h-8 w-32 text-olive-600 dark:text-olive-300" />
      {error ? (
        <>
          <p className="font-medium">Não foi possível abrir sua agenda.</p>
          <p className="max-w-sm text-sm text-muted-foreground">{error}</p>
          <button onClick={() => window.location.reload()} className="text-sm text-primary hover:underline">
            Tentar novamente
          </button>
        </>
      ) : (
        <p className="text-sm text-muted-foreground">Preparando sua agenda…</p>
      )}
    </div>
  );
}

export default function InicioPage() {
  return (
    <Suspense>
      <Bootstrap />
    </Suspense>
  );
}
