"use client";

import { useEffect } from "react";
import Link from "next/link";
import { AlertTriangle } from "lucide-react";
import { Button } from "@/components/ui/button";

/** Tela de erro amigável: registra a causa no log do app (dados/lex.log) para diagnóstico. */
export default function AppError({ error, reset }: { error: Error & { digest?: string }; reset: () => void }) {
  useEffect(() => {
    void fetch("/api/client-error", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ message: error.message, stack: error.stack?.slice(0, 4000), digest: error.digest, url: window.location.href }),
    }).catch(() => undefined);
  }, [error]);

  return (
    <div className="flex min-h-[70vh] flex-col items-center justify-center gap-3 px-6 text-center">
      <span className="flex size-12 items-center justify-center rounded-full bg-destructive/10">
        <AlertTriangle className="size-6 text-destructive" />
      </span>
      <h1 className="text-xl font-semibold">Algo deu errado nesta tela</h1>
      <p className="max-w-md text-sm text-muted-foreground">Seus dados estão preservados. O erro foi registrado para correção.</p>
      <code className="max-w-lg break-all rounded-lg bg-secondary px-3 py-2 text-xs">{error.message}</code>
      <div className="flex gap-2 pt-2">
        <Button onClick={reset}>Tentar novamente</Button>
        <Button variant="outline" asChild><Link href="/calendario">Voltar ao calendário</Link></Button>
      </div>
    </div>
  );
}
