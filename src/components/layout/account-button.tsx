"use client";

import Link from "next/link";
import { useQuery } from "@tanstack/react-query";
import { CheckCircle2, CloudOff, LogIn, RefreshCw } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Popover, PopoverContent, PopoverTrigger } from "@/components/ui/popover";
import { useConnections } from "@/hooks/use-records";
import { useWorkspace } from "@/hooks/use-workspace";
import { LEGAL_LINKS, publicEnv } from "@/lib/env";
import { openOAuthWindow } from "@/lib/oauth-popup";

// Somente Google por decisão de produto (Microsoft e Apple seguem no código, desativados na interface)
const PROVIDERS = [{ id: "google", label: "Google", detail: "Gmail / Google Agenda" }] as const;

/** Canto superior direito: o app funciona sem conta; "Entrar" conecta contas para sincronizar a agenda. */
export function AccountButton() {
  const { isAnonymous } = useWorkspace();
  const { data: connections = [] } = useConnections();
  const { data: available } = useQuery({
    queryKey: ["integration-providers"],
    staleTime: Infinity,
    queryFn: async () => (await (await fetch("/api/integrations/providers")).json()) as Record<string, boolean>,
  });
  const connected = connections.filter((c) => c.is_active);

  return (
    <>
      <Popover>
        <PopoverTrigger asChild>
          {connected.length ? (
            <Button variant="outline" size="sm" className="gap-1.5">
              <RefreshCw className="text-emerald-600" /> <span className="hidden sm:inline">Sincronizado</span>
            </Button>
          ) : (
            <Button size="sm" className="gap-1.5">
              <LogIn /> Entrar
            </Button>
          )}
        </PopoverTrigger>
        <PopoverContent align="end" className="w-80 space-y-3">
          <div>
            <p className="text-sm font-semibold">Sincronizar com o Google Agenda</p>
            <p className="text-[13px] text-muted-foreground">
              O Lex Calendário funciona sem conta{publicEnv.localMode ? ", offline, com os dados neste computador" : ""}. Entre com sua conta Google só se quiser sincronizar com o Google Agenda.
            </p>
          </div>
          <div className="space-y-1.5">
            {PROVIDERS.map((p) => {
              const conn = connected.find((c) => c.provider === p.id);
              const enabled = available?.[p.id];
              const content = (
                <>
                  <span className="min-w-0 flex-1 text-left">
                    <span className="block text-sm font-medium">{conn ? p.label : `Entrar com ${p.label}`}</span>
                    <span className="block truncate text-xs text-muted-foreground">{conn ? conn.account_email ?? p.detail : p.detail}</span>
                  </span>
                  {conn ? <CheckCircle2 className="size-4 text-emerald-600" /> : !enabled && <CloudOff className="size-4 text-muted-foreground" />}
                </>
              );
              const cls = "flex w-full items-center gap-3 rounded-xl border px-3 py-2.5 transition hover:bg-accent/60 disabled:opacity-60";
              if (conn && publicEnv.webMode)
                return (
                  <div key={p.id} className="space-y-2">
                    <div className={cls}>{content}</div>
                    <button
                      type="button"
                      className="text-xs text-destructive hover:underline"
                      onClick={async () => {
                        if (!confirm("Desconectar a conta Google? A agenda guardada neste aparelho continua até você entrar de novo.")) return;
                        await fetch(`/api/integrations/connections/${conn.id}`, { method: "DELETE" });
                        window.location.reload();
                      }}
                    >
                      Desconectar a conta Google
                    </button>
                  </div>
                );
              if (conn) return <Link key={p.id} href="/configuracoes/integracoes" className={cls}>{content}</Link>;
              return enabled ? (
                <button key={p.id} type="button" onClick={() => openOAuthWindow(p.id)} className={cls}>{content}</button>
              ) : (
                <button key={p.id} className={cls} disabled title="Integração ainda não habilitada nesta versão">{content}</button>
              );
            })}
          </div>
          {!publicEnv.localMode && isAnonymous && (
            <p className="text-xs text-muted-foreground">
              Quer acessar em outros dispositivos? <Link href="/cadastro" className="text-primary hover:underline">Crie uma conta</Link> ou{" "}
              <Link href="/entrar" className="text-primary hover:underline">entre</Link>.
            </p>
          )}
          {!publicEnv.webMode && <Link href="/configuracoes/integracoes" className="block text-xs text-primary hover:underline">Gerenciar integrações e importar/exportar .ics</Link>}
          <p className="text-[11px] text-muted-foreground">
            Ao entrar, você concorda com os{" "}
            <a href={LEGAL_LINKS.terms} target="_blank" rel="noreferrer" className="underline">Termos de Uso</a> e a{" "}
            <a href={LEGAL_LINKS.privacy} target="_blank" rel="noreferrer" className="underline">Política de Privacidade</a>.
          </p>
        </PopoverContent>
      </Popover>
    </>
  );
}
