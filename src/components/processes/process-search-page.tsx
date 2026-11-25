"use client";

import { useMemo, useState } from "react";
import { useQueryClient } from "@tanstack/react-query";
import { LinkClientButton } from "@/components/processes/link-client-button";
import { CheckCircle2, Download, ExternalLink, ShieldAlert, FileSearch, Info, Loader2, Plus, Search } from "lucide-react";
import { toast } from "sonner";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card, CardContent } from "@/components/ui/card";
import { Dialog, DialogContent, DialogDescription, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { EmptyState } from "@/components/ui/empty-state";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { PageHeader } from "@/components/layout/app-shell";
import { formatDay } from "@/lib/utils";

interface Result {
  id: string;
  processNumber: string;
  tribunal: string | null;
  organ: string | null;
  className: string | null;
  type: string;
  availableAt: string | null;
  parties: string[];
  lawyers: string[];
  excerpt: string;
  link: string | null;
  imported: boolean;
  exactName: boolean;
  citesCpf: boolean;
  raw: unknown;
}

interface FoundProcess {
  number: string;
  tribunal: string | null;
  organ: string | null;
  className: string | null;
  parties: string[];
  lawyers: string[];
  publications: Result[];
  last: string | null;
  exactName: boolean;
  citesCpf: boolean;
  imported: boolean;
}

const isoDay = (d: Date) => d.toLocaleDateString("en-CA", { timeZone: "America/Sao_Paulo" });

/**
 * Buscar processos: localiza processos em nome de uma pessoa pelas publicações do
 * Diário de Justiça Eletrônico Nacional (DJEN/CNJ), por nome completo, CPF, CNPJ ou outro número citado na publicação, num período.
 */
export function ProcessSearchPage() {
  const qc = useQueryClient();
  const [name, setName] = useState("");
  const [cpf, setCpf] = useState("");
  const [text, setText] = useState("");
  const [from, setFrom] = useState(isoDay(new Date(Date.now() - 365 * 864e5)));
  const [to, setTo] = useState(isoDay(new Date()));
  const [busy, setBusy] = useState(false);
  const [results, setResults] = useState<Result[] | null>(null);
  const [total, setTotal] = useState(0);
  const [searched, setSearched] = useState("");
  const [importing, setImporting] = useState<string | null>(null);
  const [onlyExact, setOnlyExact] = useState(false);

  const processes = useMemo<FoundProcess[]>(() => {
    const map = new Map<string, FoundProcess>();
    for (const r of results ?? []) {
      const p = map.get(r.processNumber) ?? {
        number: r.processNumber,
        tribunal: r.tribunal,
        organ: r.organ,
        className: r.className,
        parties: [],
        lawyers: [],
        publications: [],
        last: null,
        exactName: false,
        citesCpf: false,
        imported: true,
      };
      p.publications.push(r);
      for (const n of r.parties) if (!p.parties.includes(n)) p.parties.push(n);
      for (const n of r.lawyers) if (!p.lawyers.includes(n)) p.lawyers.push(n);
      if (r.availableAt && (!p.last || r.availableAt > p.last)) p.last = r.availableAt;
      p.exactName = p.exactName || r.exactName;
      p.citesCpf = p.citesCpf || r.citesCpf;
      p.imported = p.imported && r.imported;
      p.organ = p.organ ?? r.organ;
      p.className = p.className ?? r.className;
      map.set(r.processNumber, p);
    }
    return [...map.values()]
      .filter((p) => !onlyExact || p.exactName || p.citesCpf)
      .sort((a, b) => Number(b.citesCpf) - Number(a.citesCpf) || Number(b.exactName) - Number(a.exactName) || (b.last ?? "").localeCompare(a.last ?? ""));
  }, [results, onlyExact]);

  async function search() {
    const hasCpf = cpf.replace(/\D/g, "").length > 0;
    const hasText = text.trim().length > 0;
    if (!name.trim() && !hasCpf && !hasText) return toast.error("Informe o nome, o CPF/CNPJ ou outro número.");
    setBusy(true);
    setResults(null);
    try {
      const res = await fetch("/api/intimacoes/buscar", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ mode: hasCpf ? "cpf" : hasText ? "texto" : "nome", name, cpf, text, from, to }),
      });
      const body = (await res.json().catch(() => ({}))) as { error?: string; results?: Result[]; total?: number; searchedName?: string | null };
      if (!res.ok) throw new Error(body.error ?? "Falha na busca");
      setResults(body.results ?? []);
      setTotal(body.total ?? 0);
      setSearched(body.searchedName ?? name);
    } catch (e) {
      toast.error("Não foi possível buscar", { description: (e as Error).message, duration: 12_000 });
    } finally {
      setBusy(false);
    }
  }

  async function register(p: FoundProcess) {
    setImporting(p.number);
    try {
      const items = p.publications.filter((r) => !r.imported).map((r) => r.raw).slice(0, 100);
      const res = await fetch("/api/intimacoes/importar", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ items }) });
      const body = (await res.json().catch(() => ({}))) as { error?: string; inserted?: number };
      if (!res.ok) throw new Error(body.error ?? "Falha ao cadastrar");
      toast.success("Processo cadastrado para acompanhamento", { description: `${body.inserted ?? 0} publicação(ões) importada(s). Veja na Central de Processos e nas Intimações.` });
      setResults((list) => (list ?? []).map((r) => (r.processNumber === p.number ? { ...r, imported: true } : r)));
      for (const key of ["intimations", "processes", "suggestions", "notifications"]) void qc.invalidateQueries({ queryKey: [key] });
    } catch (e) {
      toast.error((e as Error).message);
    } finally {
      setImporting(null);
    }
  }

  const [bnmpOpen, setBnmpOpen] = useState(false);
  const BNMP_URL = "https://portalbnmp.cnj.jus.br/#/pesquisa-peca";

  async function copyName() {
    const who = name.trim();
    if (!who) return void toast.info("Preencha o nome completo no campo acima para copiar.");
    try {
      await navigator.clipboard.writeText(who);
      toast.success("Nome copiado", { description: "Cole no campo “Nome” da pesquisa (Ctrl+V ou Cmd+V)." });
    } catch {
      toast.info(`Digite na pesquisa: ${who}`, { duration: 12_000 });
    }
  }

  /** Abre a pesquisa pública de mandados (BNMP/CNJ) dentro do Lex, com o nome já copiado. */
  async function openBnmp() {
    if (name.trim()) await copyName();
    setBnmpOpen(true);
  }

  const exportTitle = `Processos encontrados para “${searched}” — ${formatDay(from)} a ${formatDay(to)}`;

  /** Planilha (abre no Excel): uma linha por processo. */
  function exportCsv() {
    const cell = (v: string | number | null) => `"${String(v ?? "").replace(/"/g, '""')}"`;
    const rows = [
      ["Processo", "Tribunal", "Classe", "Órgão", "Partes", "Advogados", "Publicações", "Última publicação", "Nome idêntico", "Cita o número", "Link da última publicação"],
      ...processes.map((p) => [
        p.number,
        p.tribunal,
        p.className,
        p.organ,
        p.parties.join("; "),
        p.lawyers.join("; "),
        p.publications.length,
        p.last ? formatDay(p.last) : "",
        p.exactName ? "Sim" : "Não",
        p.citesCpf ? "Sim" : "Não",
        p.publications.find((r) => r.link)?.link ?? "",
      ]),
    ];
    const csv = "\uFEFF" + rows.map((r) => r.map(cell).join(";")).join("\r\n");
    const a = document.createElement("a");
    a.href = URL.createObjectURL(new Blob([csv], { type: "text/csv;charset=utf-8" }));
    a.download = `processos-${(searched || "busca").normalize("NFD").replace(/[^\w]+/g, "-").replace(/^-|-$/g, "").slice(0, 50).toLowerCase()}-${to}.csv`;
    a.click();
    window.setTimeout(() => URL.revokeObjectURL(a.href), 5_000);
  }

  /** Relatório para imprimir ou salvar em PDF, com o trecho de cada publicação. */
  function exportPdf() {
    const esc = (v: string | null | undefined) => String(v ?? "").replace(/[&<>"]/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;" })[c] ?? c);
    const body = processes
      .map(
        (p) => `<section><h2>${esc(p.number)} <small>${esc(p.tribunal)}</small></h2>
<p class="muted">${esc([p.className, p.organ].filter(Boolean).join(" · "))}</p>
${p.parties.length ? `<p><b>Partes:</b> ${esc(p.parties.join("; "))}</p>` : ""}
${p.lawyers.length ? `<p><b>Advogados:</b> ${esc(p.lawyers.join("; "))}</p>` : ""}
${p.publications.map((r) => `<div class="pub"><b>${esc(r.type)}${r.availableAt ? ` · ${esc(formatDay(r.availableAt))}` : ""}</b><br>${esc(r.excerpt)}</div>`).join("")}
</section>`,
      )
      .join("");
    const html = `<!doctype html><html lang="pt-BR"><head><meta charset="utf-8"><title>${esc(exportTitle)}</title><style>
body{font-family:-apple-system,"Segoe UI",Roboto,sans-serif;color:#1d1d1f;margin:32px auto;max-width:820px;padding:0 24px;font-size:12px}
h1{font-size:18px;margin:0 0 4px}h2{font-size:14px;margin:18px 0 2px;font-family:ui-monospace,Menlo,monospace}h2 small{font-family:inherit;font-weight:400;color:#6e6e73}
p{margin:2px 0}.muted{color:#6e6e73}.pub{margin:6px 0;padding:6px 8px;border-left:3px solid #d9e2c8;background:#fafaf7}section{page-break-inside:avoid}
.note{border:1px solid #e5c97a;background:#fdf6e3;padding:8px 10px;border-radius:8px;margin:10px 0}
@media print{body{margin:0}.noprint{display:none}}</style></head><body>
<p class="noprint" style="text-align:right">Na janela que abriu, escolha <b>Salvar como PDF</b>. <button onclick="print()">Imprimir / salvar em PDF</button></p>
<h1>${esc(exportTitle)}</h1>
<p class="muted">${processes.length} processo(s) em ${total} publicação(ões) · gerado em ${esc(new Date().toLocaleString("pt-BR"))} · Fonte: Diário de Justiça Eletrônico Nacional (DJEN/CNJ)</p>
<p class="note">Somente processos públicos com publicação no período. Processos em segredo de justiça não aparecem; homônimos podem aparecer — confira nos autos.</p>
${body}
<script>window.addEventListener("load",function(){setTimeout(function(){window.print()},400)})</script>
</body></html>`;
    const url = URL.createObjectURL(new Blob([html], { type: "text/html;charset=utf-8" }));
    window.open(url, "_blank");
    window.setTimeout(() => URL.revokeObjectURL(url), 60_000);
  }

  return (
    <div>
      <PageHeader title="Buscar processos" description="Localize processos em nome de uma pessoa pelas publicações do Diário de Justiça Eletrônico Nacional (DJEN/CNJ)." />
      <div className="mx-auto max-w-5xl space-y-5 p-4 md:p-8">
        <div className="flex gap-3 rounded-2xl border border-amber-500/40 bg-amber-500/10 p-4 text-sm">
          <Info className="mt-0.5 size-5 shrink-0 text-amber-600" />
          <div className="space-y-1">
            <p className="font-semibold">Somente processos públicos</p>
            <p className="text-muted-foreground">
              Esta busca consulta apenas as <b>publicações disponibilizadas no Diário de Justiça Eletrônico Nacional (DJEN)</b>, conforme as regras de
              publicidade processual do CNJ. <b>Não aparecem</b> processos em segredo de justiça, sigilosos ou que não tiveram publicação no período.
              O resultado depende do nome exatamente como consta na publicação; pessoas com o mesmo nome (homônimos) podem aparecer — confira sempre nos autos.
            </p>
          </div>
        </div>

        <Card>
          <CardContent className="p-5">
            <form
              className="grid gap-3 md:grid-cols-[1.5fr_1.1fr_auto_auto_auto] md:items-end"
              onSubmit={(e) => {
                e.preventDefault();
                void search();
              }}
            >
              <div className="grid gap-1.5">
                <Label>Nome completo</Label>
                <Input value={name} onChange={(e) => setName(e.target.value)} placeholder="Nome e sobrenome, como consta no processo" autoFocus />
              </div>
              <div className="grid gap-1.5">
                <Label>CPF ou CNPJ</Label>
                <Input value={cpf} onChange={(e) => setCpf(e.target.value)} inputMode="numeric" placeholder="CPF ou CNPJ" />
              </div>
              <div className="grid gap-1.5">
                <Label>Data de início</Label>
                <Input type="date" value={from} max={to} onChange={(e) => setFrom(e.target.value)} />
              </div>
              <div className="grid gap-1.5">
                <Label>Data de fim</Label>
                <Input type="date" value={to} min={from} onChange={(e) => setTo(e.target.value)} />
              </div>
              <Button type="submit" disabled={busy}>{busy ? <Loader2 className="animate-spin" /> : <Search />} Buscar</Button>
            </form>
            <div className="mt-3 grid gap-1.5">
              <Label>Outro número ou trecho (opcional)</Label>
              <Input value={text} onChange={(e) => setText(e.target.value)} placeholder="Número de documento, RG, auto de infração, certidão de dívida ativa, notificação, número do processo…" />
            </div>
            <p className="mt-2 text-xs text-muted-foreground">
              O <b>CPF ou CNPJ</b> e o <b>outro número</b> são procurados no texto das publicações, com e sem pontuação. Com CPF/CNPJ, o Lex soma as publicações em nome da
              pessoa ou empresa (a razão social do CNPJ vem do cadastro público da Receita). Use um campo por vez: se preencher CPF/CNPJ, o campo “outro número” é ignorado.
              Notificações da Receita Federal e processos administrativos não saem no Diário: só aparecem quando o número é citado numa publicação judicial (por exemplo, numa execução fiscal).
            </p>
          </CardContent>
        </Card>

        <Card>
          <CardContent className="flex flex-wrap items-center gap-3 p-4">
            <ShieldAlert className="size-5 shrink-0 text-primary" />
            <div className="min-w-0 flex-1 text-sm">
              <p className="font-semibold">Mandados de prisão — BNMP/CNJ</p>
              <p className="text-xs text-muted-foreground">
                Consulta pelo nome no Banco Nacional de Mandados de Prisão, aqui mesmo no Lex. O CNJ exige a verificação “não sou um robô” a cada
                consulta: marque a caixa, cole o nome já copiado no campo “Nome” e clique em Pesquisar.
              </p>
            </div>
            <Button type="button" variant="outline" onClick={() => void openBnmp()}>
              <ExternalLink /> Pesquisar no BNMP
            </Button>
          </CardContent>
        </Card>

        {busy && <p className="text-center text-sm text-muted-foreground">Consultando o Diário de Justiça Eletrônico Nacional…</p>}

        {results && !busy && (
          <>
            <div className="flex flex-wrap items-center justify-between gap-2">
              <p className="text-sm">
                <b>{processes.length}</b> processo(s) em <b>{total}</b> publicação(ões) para “{searched}”, de {formatDay(from)} a {formatDay(to)}.
              </p>
              {processes.length > 0 && (
                <div className="flex gap-2">
                  <Button size="sm" variant="outline" onClick={exportCsv}><Download /> Exportar planilha</Button>
                  <Button size="sm" variant="outline" onClick={exportPdf}><Download /> Exportar PDF</Button>
                </div>
              )}
              <label className="flex items-center gap-2 text-xs text-muted-foreground">
                <input type="checkbox" checked={onlyExact} onChange={(e) => setOnlyExact(e.target.checked)} className="size-3.5 accent-[hsl(var(--primary))]" />
                Mostrar só nome idêntico ou que citam o número
              </label>
            </div>
            {!processes.length ? (
              <EmptyState
                icon={FileSearch}
                title="Nenhum processo encontrado"
                description="O Diário só mostra processos que tiveram publicação (intimação, edital, citação) no período. Amplie as datas, confira a grafia do nome ou pesquise pelo número do processo no campo “Outro número”. Processos sigilosos não aparecem."
              />
            ) : (
              <div className="space-y-3">
                {processes.map((p) => (
                  <Card key={p.number}>
                    <CardContent className="space-y-1.5 p-4 text-sm">
                      <div className="flex flex-wrap items-start gap-2">
                        <div className="min-w-0 flex-1 space-y-1">
                          <div className="flex flex-wrap items-center gap-2">
                            <span className="font-mono text-[14px] font-semibold">{p.number}</span>
                            {p.tribunal && <Badge variant="outline">{p.tribunal}</Badge>}
                            {p.citesCpf && <Badge variant="success">cita o número</Badge>}
                            {p.exactName && <Badge>nome idêntico</Badge>}
                            <span className="text-xs text-muted-foreground">
                              {p.publications.length} publicação(ões){p.last ? ` · última em ${formatDay(p.last)}` : ""}
                            </span>
                          </div>
                          <p className="text-xs text-muted-foreground">{[p.className, p.organ].filter(Boolean).join(" · ") || "Classe e órgão não informados"}</p>
                          {!!p.parties.length && <p className="text-xs"><span className="text-muted-foreground">Partes:</span> {p.parties.slice(0, 8).join("; ")}{p.parties.length > 8 ? "…" : ""}</p>}
                          {!!p.lawyers.length && <p className="text-xs text-muted-foreground">Advogados: {p.lawyers.slice(0, 6).join("; ")}{p.lawyers.length > 6 ? "…" : ""}</p>}
                        </div>
                        {p.imported ? (
                          <div className="flex flex-col items-end gap-1.5">
                            <Badge variant="secondary"><CheckCircle2 className="size-3" /> já cadastrado</Badge>
                            <LinkClientButton number={p.number} />
                          </div>
                        ) : (
                          <Button size="sm" disabled={importing === p.number} onClick={() => void register(p)}>
                            {importing === p.number ? <Loader2 className="animate-spin" /> : <Plus />} Cadastrar e acompanhar
                          </Button>
                        )}
                      </div>
                      <details className="text-xs">
                        <summary className="cursor-pointer text-primary">Ver publicações</summary>
                        <div className="mt-2 space-y-2">
                          {p.publications.map((r) => (
                            <div key={r.id} className="rounded-lg bg-secondary/50 p-2">
                              <p className="font-medium">
                                {r.type}
                                {r.availableAt ? ` · ${formatDay(r.availableAt)}` : ""}
                                {r.link && (
                                  <a href={r.link} target="_blank" rel="noreferrer" className="ml-2 inline-flex items-center gap-1 font-normal text-primary hover:underline">
                                    <ExternalLink className="size-3" /> Abrir no Diário
                                  </a>
                                )}
                              </p>
                              <p className="text-muted-foreground">{r.excerpt}</p>
                            </div>
                          ))}
                        </div>
                      </details>
                    </CardContent>
                  </Card>
                ))}
              </div>
            )}
          </>
        )}
        <p className="text-center text-xs text-muted-foreground">Fonte: Diário de Justiça Eletrônico Nacional — Plataforma de Comunicações Processuais do CNJ.</p>
      </div>
      <Dialog open={bnmpOpen} onOpenChange={setBnmpOpen}>
        <DialogContent className="flex h-[92dvh] w-[min(100vw-1rem,72rem)] max-w-none flex-col gap-0 overflow-hidden p-0">
          <DialogHeader className="flex-row flex-wrap items-center gap-2 space-y-0 border-b py-2.5 pl-4 pr-12 text-left">
            <DialogTitle className="flex-1 text-[15px]">Mandados de prisão — BNMP/CNJ</DialogTitle>
            <DialogDescription className="sr-only">Pesquisa pública do Banco Nacional de Mandados de Prisão.</DialogDescription>
            <Button size="sm" variant="outline" onClick={() => void copyName()}>Copiar o nome</Button>
            <Button size="sm" variant="ghost" asChild>
              <a href={BNMP_URL} target="_blank" rel="noreferrer"><ExternalLink /> Abrir no navegador</a>
            </Button>
          </DialogHeader>
          <p className="border-b bg-secondary/40 px-4 py-1.5 text-[11.5px] text-muted-foreground">
            1) Marque “Não sou um robô” · 2) Cole o nome no campo “Nome” · 3) Clique em Pesquisar. Se a página não carregar aqui, use “Abrir no navegador”.
          </p>
          <iframe title="BNMP — pesquisa de mandados" src={BNMP_URL} className="min-h-0 w-full flex-1 border-0 bg-white" referrerPolicy="no-referrer" />
        </DialogContent>
      </Dialog>
    </div>
  );
}
