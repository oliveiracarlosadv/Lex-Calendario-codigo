"use client";

import { useState } from "react";
import { useQueryClient } from "@tanstack/react-query";
import { Download, ExternalLink, Loader2, Search } from "lucide-react";
import { toast } from "sonner";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { BR_STATES } from "@/domain/clients/types";
import { useWorkspace } from "@/hooks/use-workspace";
import { cn, formatDay } from "@/lib/utils";

type Mode = "oab" | "nome" | "cpf" | "texto";

interface Result {
  id: string;
  processNumber: string;
  tribunal: string | null;
  organ: string | null;
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

const MODES: { id: Mode; label: string; hint: string }[] = [
  { id: "oab", label: "Número da OAB", hint: "Para advogados: todas as publicações destinadas à OAB informada." },
  { id: "nome", label: "Nome completo", hint: "Publicações em que a pessoa aparece como parte ou como advogado. Nomes iguais de outras pessoas podem aparecer." },
  { id: "cpf", label: "CPF ou CNPJ", hint: "Publicações que citam o CPF ou CNPJ no texto, somadas às do nome da pessoa ou empresa (cliente, parceiro, seu perfil ou a razão social do CNPJ)." },
  { id: "texto", label: "Outro número", hint: "Qualquer número ou trecho citado na publicação: documento, auto de infração, certidão de dívida ativa, notificação ou o número do processo." },
];

/** Busca manual no Diário de Justiça Eletrônico Nacional por OAB, nome completo, CPF/CNPJ ou outro número. */
export function IntimationSearch() {
  const qc = useQueryClient();
  const { profile } = useWorkspace();
  const [mode, setMode] = useState<Mode>(profile.oab_number ? "oab" : "nome");
  const [oab, setOab] = useState(profile.oab_number ?? "");
  const [uf, setUf] = useState(profile.oab_state ?? "PA");
  const [name, setName] = useState(profile.oab_number ? "" : (profile.full_name ?? ""));
  const [cpf, setCpf] = useState(profile.document ?? "");
  const [text, setText] = useState("");
  const [days, setDays] = useState("30");
  const [busy, setBusy] = useState(false);
  const [importing, setImporting] = useState(false);
  const [results, setResults] = useState<Result[] | null>(null);
  const [info, setInfo] = useState("");
  const [selected, setSelected] = useState<Set<string>>(new Set());

  async function search() {
    setBusy(true);
    setResults(null);
    setSelected(new Set());
    try {
      const res = await fetch("/api/intimacoes/buscar", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ mode, oab, uf, name, cpf, text, days }),
      });
      const body = (await res.json().catch(() => ({}))) as { error?: string; results?: Result[]; total?: number; searchedName?: string | null };
      if (!res.ok) throw new Error(body.error ?? "Falha na busca");
      setResults(body.results ?? []);
      setInfo(`${body.total ?? 0} publicação(ões) nos últimos ${days} dias${body.searchedName ? ` para “${body.searchedName}”` : ""}`);
    } catch (e) {
      toast.error("Não foi possível buscar", { description: (e as Error).message, duration: 10_000 });
    } finally {
      setBusy(false);
    }
  }

  async function importSelected() {
    const items = (results ?? []).filter((r) => selected.has(r.id)).map((r) => r.raw);
    setImporting(true);
    try {
      const res = await fetch("/api/intimacoes/importar", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ items }) });
      const body = (await res.json().catch(() => ({}))) as { error?: string; inserted?: number };
      if (!res.ok) throw new Error(body.error ?? "Falha ao importar");
      toast.success(`${body.inserted ?? 0} intimação(ões) importada(s)`, { description: "Os processos foram cadastrados e os prazos sugeridos." });
      setResults((list) => (list ?? []).map((r) => (selected.has(r.id) ? { ...r, imported: true } : r)));
      setSelected(new Set());
      for (const key of ["intimations", "processes", "suggestions", "notifications"]) void qc.invalidateQueries({ queryKey: [key] });
    } catch (e) {
      toast.error((e as Error).message);
    } finally {
      setImporting(false);
    }
  }

  const toggle = (id: string) =>
    setSelected((s) => {
      const next = new Set(s);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });
  const selectable = (results ?? []).filter((r) => !r.imported);

  return (
    <Card>
      <CardHeader>
        <CardTitle className="flex items-center gap-2"><Search className="size-4" /> Buscar intimações no Diário</CardTitle>
        <CardDescription>Pesquise no Diário de Justiça Eletrônico Nacional (DJEN/CNJ) pelo número da OAB, nome completo, CPF, CNPJ ou outro número citado na publicação.</CardDescription>
      </CardHeader>
      <CardContent className="space-y-3">
        <div className="flex flex-wrap gap-1">
          {MODES.map((m) => (
            <button
              key={m.id}
              onClick={() => setMode(m.id)}
              className={cn("rounded-full px-3 py-1 text-xs transition", mode === m.id ? "bg-primary text-primary-foreground" : "bg-secondary hover:bg-accent")}
            >
              {m.label}
            </button>
          ))}
        </div>
        <p className="text-xs text-muted-foreground">{MODES.find((m) => m.id === mode)?.hint}</p>
        <form
          className="grid gap-3 sm:grid-cols-[1fr_auto_auto_auto] sm:items-end"
          onSubmit={(e) => {
            e.preventDefault();
            void search();
          }}
        >
          {mode === "oab" && (
            <div className="grid grid-cols-[1fr_90px] gap-2">
              <div className="grid gap-1.5"><Label>Número da OAB</Label><Input value={oab} onChange={(e) => setOab(e.target.value)} inputMode="numeric" placeholder="12345" /></div>
              <div className="grid gap-1.5">
                <Label>UF</Label>
                <Select value={uf} onValueChange={setUf}>
                  <SelectTrigger><SelectValue /></SelectTrigger>
                  <SelectContent>{BR_STATES.map((s) => <SelectItem key={s} value={s}>{s}</SelectItem>)}</SelectContent>
                </Select>
              </div>
            </div>
          )}
          {mode === "nome" && (
            <div className="grid gap-1.5"><Label>Nome completo</Label><Input value={name} onChange={(e) => setName(e.target.value)} placeholder="Nome e sobrenome, como consta no processo" /></div>
          )}
          {mode === "cpf" && (
            <div className="grid gap-2 sm:grid-cols-[180px_1fr]">
              <div className="grid gap-1.5"><Label>CPF ou CNPJ</Label><Input value={cpf} onChange={(e) => setCpf(e.target.value)} inputMode="numeric" placeholder="CPF ou CNPJ" /></div>
              <div className="grid gap-1.5"><Label>Nome completo (opcional)</Label><Input value={name} onChange={(e) => setName(e.target.value)} /></div>
            </div>
          )}
          {mode === "texto" && (
            <div className="grid gap-1.5"><Label>Número ou trecho</Label><Input value={text} onChange={(e) => setText(e.target.value)} placeholder="Documento, auto de infração, CDA, notificação, nº do processo…" /></div>
          )}
          <div className="grid gap-1.5">
            <Label>Período</Label>
            <Select value={days} onValueChange={setDays}>
              <SelectTrigger className="w-36"><SelectValue /></SelectTrigger>
              <SelectContent>
                <SelectItem value="7">7 dias</SelectItem>
                <SelectItem value="30">30 dias</SelectItem>
                <SelectItem value="90">90 dias</SelectItem>
                <SelectItem value="180">6 meses</SelectItem>
                <SelectItem value="365">1 ano</SelectItem>
              </SelectContent>
            </Select>
          </div>
          <Button type="submit" disabled={busy}>{busy ? <Loader2 className="animate-spin" /> : <Search />} Buscar</Button>
        </form>

        {results && (
          <div className="space-y-2">
            <div className="flex flex-wrap items-center justify-between gap-2">
              <p className="text-sm text-muted-foreground">{info}</p>
              <div className="flex gap-2">
                {selectable.length > 0 && (
                  <Button size="sm" variant="ghost" onClick={() => setSelected(new Set(selected.size === selectable.length ? [] : selectable.map((r) => r.id)))}>
                    {selected.size === selectable.length ? "Desmarcar todas" : "Marcar todas"}
                  </Button>
                )}
                <Button size="sm" disabled={!selected.size || importing} onClick={() => void importSelected()}>
                  {importing ? <Loader2 className="animate-spin" /> : <Download />} Importar {selected.size || ""} para a central
                </Button>
              </div>
            </div>
            {!results.length && <p className="py-4 text-center text-sm text-muted-foreground">Nenhuma publicação encontrada no período.</p>}
            <div className="max-h-[520px] space-y-2 overflow-y-auto pr-1">
              {results.map((r) => (
                <label key={r.id} className={cn("flex cursor-pointer gap-3 rounded-xl border p-3 text-sm transition hover:bg-accent/40", selected.has(r.id) && "border-primary bg-primary/5", r.imported && "opacity-60")}>
                  <input type="checkbox" className="mt-1 size-4 accent-[hsl(var(--primary))]" disabled={r.imported} checked={selected.has(r.id)} onChange={() => toggle(r.id)} />
                  <span className="min-w-0 flex-1 space-y-0.5">
                    <span className="flex flex-wrap items-center gap-2">
                      <span className="font-mono text-[13px] font-medium">{r.processNumber}</span>
                      {r.tribunal && <Badge variant="outline">{r.tribunal}</Badge>}
                      <span className="text-xs text-muted-foreground">{r.type}{r.availableAt ? ` · ${formatDay(r.availableAt)}` : ""}</span>
                      {r.citesCpf && <Badge variant="success">cita o número</Badge>}
                      {r.exactName && <Badge>nome idêntico</Badge>}
                      {r.imported && <Badge variant="secondary">já na central</Badge>}
                    </span>
                    {r.organ && <span className="block text-xs text-muted-foreground">{r.organ}</span>}
                    {!!r.parties.length && <span className="block truncate text-xs">Partes: {r.parties.join("; ")}</span>}
                    {!!r.lawyers.length && <span className="block truncate text-xs text-muted-foreground">Advogados: {r.lawyers.join("; ")}</span>}
                    <span className="line-clamp-2 block text-xs text-muted-foreground">{r.excerpt}</span>
                    {r.link && (
                      <a href={r.link} target="_blank" rel="noreferrer" className="inline-flex items-center gap-1 text-xs text-primary hover:underline" onClick={(e) => e.stopPropagation()}>
                        <ExternalLink className="size-3" /> Abrir no Diário
                      </a>
                    )}
                  </span>
                </label>
              ))}
            </div>
          </div>
        )}
      </CardContent>
    </Card>
  );
}
