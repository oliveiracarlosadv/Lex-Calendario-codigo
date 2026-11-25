"use client";

import { useEffect, useState } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { BriefcaseBusiness, CheckCheck, ExternalLink, Inbox, RefreshCw, Settings2 } from "lucide-react";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { EmptyState } from "@/components/ui/empty-state";
import { PageHeader } from "@/components/layout/app-shell";
import { useIntimations, useMarkIntimationsRead, useOabMonitors, useSyncIntimations } from "@/hooks/use-intimations";
import { useProcesses } from "@/hooks/use-records";
import { RegisterFromIntimationDialog } from "./register-from-intimation";
import { cn, formatDate, formatDateTime } from "@/lib/utils";
import type { IntimationRow } from "@/types/db";
import { IntimationSearch } from "./intimation-search";

const br = (iso: string | null) => (iso ? iso.split("-").reverse().join("/") : "—");

function IntimationCard({
  i,
  onRead,
  clientName,
  autoOpen,
}: {
  i: IntimationRow;
  onRead: () => void;
  clientName: string | null;
  autoOpen?: boolean;
}) {
  const [open, setOpen] = useState(false);
  const [registering, setRegistering] = useState(false);
  useEffect(() => {
    if (!autoOpen) return;
    setRegistering(!clientName);
    setOpen(true);
    document.getElementById(`intimacao-${i.id}`)?.scrollIntoView({ behavior: "smooth", block: "center" });
  }, [autoOpen, clientName, i.id]);
  const poloAtivo = i.parties.filter((p) => p.polo === "A").map((p) => p.nome);
  const poloPassivo = i.parties.filter((p) => p.polo === "P").map((p) => p.nome);
  return (
    <article
      id={`intimacao-${i.id}`}
      className={cn("rounded-2xl border bg-card p-4 transition", !i.read_at && "border-primary/40 bg-primary/[0.03]", autoOpen && "ring-2 ring-primary/40")}
    >
      <div className="flex flex-wrap items-start gap-2">
        <div className="min-w-0 flex-1 space-y-1">
          <div className="flex flex-wrap items-center gap-1.5">
            {!i.read_at && <span className="size-2 rounded-full bg-[hsl(var(--today))]" aria-label="Não lida" />}
            <Badge variant="secondary">{i.tribunal ?? "—"}</Badge>
            <Badge variant="outline">{i.communication_type ?? "Comunicação"}</Badge>
            {i.document_type && <Badge variant="outline">{i.document_type}</Badge>}
            <Badge variant={i.source === "pje" ? "warning" : "default"}>{i.source === "pje" ? "PJe · pendente de ciência" : "DJEN"}</Badge>
          </div>
          {i.process_id ? (
            <Link href={`/processos/${i.process_id}`} className="block font-mono text-[15px] font-semibold hover:underline">
              {i.process_number}
            </Link>
          ) : (
            <p className="font-mono text-[15px] font-semibold">{i.process_number}</p>
          )}
          <p className="text-[13px] text-muted-foreground">{[i.class_name, i.organ].filter(Boolean).join(" · ")}</p>
          <p className="text-[13px]">
            {clientName ? (
              <span className="text-emerald-700 dark:text-emerald-400">Cliente: {clientName}</span>
            ) : (
              <span className="text-amber-700 dark:text-amber-400">Cliente ainda não cadastrado</span>
            )}
          </p>
          {(poloAtivo.length > 0 || poloPassivo.length > 0) && (
            <p className="text-[13px]">
              {poloAtivo.length > 0 && <span>Polo ativo: {poloAtivo.join(", ")}. </span>}
              {poloPassivo.length > 0 && <span>Polo passivo: {poloPassivo.join(", ")}.</span>}
            </p>
          )}
        </div>
        <div className="shrink-0 space-y-0.5 text-right text-xs">
          <p><span className="text-muted-foreground">Disponibilizada:</span> {br(i.available_at)}</p>
          {i.published_at && <p><span className="text-muted-foreground">Publicada:</span> <strong>{br(i.published_at)}</strong></p>}
          {i.tacit_awareness_at && <p><span className="text-muted-foreground">Ciência tácita:</span> <strong>{br(i.tacit_awareness_at)}</strong></p>}
        </div>
      </div>
      {i.text && (
        <div className="mt-3">
          <p className={cn("whitespace-pre-wrap text-sm leading-relaxed", !open && "line-clamp-4")}>{i.text}</p>
          <button className="mt-1 text-xs text-primary hover:underline" onClick={() => setOpen(!open)}>{open ? "Mostrar menos" : "Ler texto completo"}</button>
        </div>
      )}
      <div className="mt-3 flex flex-wrap gap-2">
        <Button size="sm" variant={clientName ? "outline" : "default"} onClick={() => setRegistering(true)}>
          <BriefcaseBusiness /> {clientName ? "Editar cadastro do processo" : i.process_id ? "Vincular ao cliente" : "Cadastrar processo e vincular ao cliente"}
        </Button>
        {i.process_id && <Button size="sm" variant="outline" asChild><Link href={`/processos/${i.process_id}`}>Ver processo e sugestões de prazo</Link></Button>}
        {i.link && (
          <Button size="sm" variant="ghost" asChild>
            <a href={i.link} target="_blank" rel="noreferrer"><ExternalLink /> Abrir no tribunal</a>
          </Button>
        )}
        {!i.read_at && <Button size="sm" variant="ghost" onClick={onRead}><CheckCheck /> Marcar como lida</Button>}
      </div>
      <RegisterFromIntimationDialog intimation={i} open={registering} onOpenChange={setRegistering} />
    </article>
  );
}

export function IntimationsPage({ openId = null }: { openId?: string | null }) {
  const router = useRouter();
  const [filter, setFilter] = useState<"unread" | "all">(openId ? "all" : "unread");
  const { data: items = [], isLoading } = useIntimations(filter);
  const { data: processes = [] } = useProcesses();
  const clientOf = (i: IntimationRow) => processes.find((p) => p.id === i.process_id)?.client?.name ?? null;
  const { data: monitors = [] } = useOabMonitors();
  const markRead = useMarkIntimationsRead();
  const sync = useSyncIntimations();
  useEffect(() => {
    if (!openId || !items.some((i) => i.id === openId)) return;
    const t = setTimeout(() => router.replace("/intimacoes", { scroll: false }), 1500);
    return () => clearTimeout(t);
  }, [openId, items, router]);
  const lastCheck = monitors.map((m) => m.last_checked_at).filter(Boolean).sort().pop() ?? null;

  return (
    <div>
      <PageHeader
        title="Intimações"
        description={
          monitors.length
            ? `OAB monitorada: ${monitors.map((m) => `${m.oab_number}/${m.oab_state}`).join(", ")}${lastCheck ? ` · última busca ${formatDateTime(lastCheck)}` : ""}`
            : "Cadastre sua OAB para receber as intimações automaticamente"
        }
        actions={
          <>
            <Button variant="outline" asChild><Link href="/configuracoes/tribunais"><Settings2 /> OAB monitorada</Link></Button>
            <Button onClick={() => sync.mutate()} disabled={sync.isPending || !monitors.length}>
              <RefreshCw className={sync.isPending ? "animate-spin" : ""} /> Buscar agora
            </Button>
          </>
        }
      />
      <div className="mx-auto max-w-4xl space-y-4 p-4 md:p-8">
        <IntimationSearch />
        <div className="flex items-center justify-between gap-2">
          <div className="inline-flex rounded-lg bg-secondary p-[3px]">
            {(["unread", "all"] as const).map((f) => (
              <button key={f} onClick={() => setFilter(f)} className={cn("rounded-md px-3 py-1 text-[13px] font-medium transition", filter === f ? "bg-background shadow-soft" : "text-muted-foreground")}>
                {f === "unread" ? "Não lidas" : "Todas"}
              </button>
            ))}
          </div>
          {filter === "unread" && items.length > 0 && (
            <Button size="sm" variant="ghost" onClick={() => markRead.mutate(items.map((i) => i.id))}><CheckCheck /> Marcar todas como lidas</Button>
          )}
        </div>

        {!monitors.length && items.length > 0 && (
          <Link href="/configuracoes/tribunais" className="block rounded-2xl border border-primary/30 bg-primary/5 px-4 py-3 text-sm hover:bg-primary/10">
            Cadastre sua OAB para receber automaticamente as intimações publicadas no Diário de Justiça Eletrônico Nacional.
          </Link>
        )}
        {!monitors.length && !items.length && !isLoading ? (
          <EmptyState
            icon={Inbox}
            title="Monitore suas intimações pela OAB"
            description="Informe o número e a UF da sua OAB. O Lex consulta o Diário de Justiça Eletrônico Nacional (DJEN/CNJ) várias vezes ao dia, cadastra os processos e sugere os prazos."
            action={<Button asChild><Link href="/configuracoes/tribunais">Cadastrar OAB</Link></Button>}
          />
        ) : isLoading ? null : !items.length ? (
          <EmptyState icon={Inbox} title={filter === "unread" ? "Nenhuma intimação não lida" : "Nenhuma intimação ainda"} description="As novas publicações aparecem aqui e como notificação no computador." />
        ) : (
          items.map((i) => (
            <IntimationCard
              key={i.id}
              i={i}
              clientName={clientOf(i)}
              autoOpen={i.id === openId}
              onRead={() => markRead.mutate([i.id])}
            />
          ))
        )}
        <p className="pt-2 text-center text-xs text-muted-foreground">
          Fonte: Diário de Justiça Eletrônico Nacional (CNJ). Prazos contados a partir da publicação (1º dia útil após a disponibilização). Confira sempre nos autos. Atualizado em {formatDate(new Date().toISOString())}.
        </p>
      </div>
    </div>
  );
}
