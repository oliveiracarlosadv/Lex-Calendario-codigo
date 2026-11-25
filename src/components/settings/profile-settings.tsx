"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { BR_STATES } from "@/domain/clients/types";
import { isValidLogo } from "@/domain/office/letterhead";
import { useCan, useWorkspace } from "@/hooks/use-workspace";
import { sb } from "@/hooks/supabase";

const PROFESSIONS = [
  "Advogado(a)",
  "Estagiário(a) de Direito",
  "Procurador(a)",
  "Defensor(a) público(a)",
  "Engenheiro(a)",
  "Médico(a)",
  "Contador(a)",
  "Arquiteto(a)",
  "Perito(a)",
  "Administrador(a)",
  "Secretário(a)",
  "Outro",
];

export function ProfileSettings() {
  const router = useRouter();
  const { profile, organization, userId } = useWorkspace();
  const canOrg = useCan("organization:update");
  const [p, setP] = useState({
    full_name: profile.full_name ?? "",
    phone: profile.phone ?? "",
    profession: profile.profession ?? "",
    document: profile.document ?? "",
    oab_number: profile.oab_number ?? "",
    oab_state: profile.oab_state ?? "",
  });
  const isLawyer = !p.profession || /advogad|estagi[aá]ri|procurador|defensor/i.test(p.profession);
  const [org, setOrg] = useState({
    name: organization.name,
    document: organization.document ?? "",
    holidays: (organization.settings?.extraHolidays ?? []).join(", "),
    address: organization.settings?.address ?? "",
    phone: organization.settings?.phone ?? "",
    logo: organization.settings?.logo ?? "",
  });

  /** Reduz a imagem escolhida (até 480 px) e guarda dentro do cadastro do escritório. */
  function chooseLogo(file: File | undefined) {
    if (!file) return;
    if (!/^image\/(png|jpeg|webp)$/.test(file.type)) return void toast.error("Use uma imagem PNG ou JPG.");
    const img = new Image();
    const url = URL.createObjectURL(file);
    img.onload = () => {
      const scale = Math.min(1, 480 / Math.max(img.width, img.height));
      const canvas = document.createElement("canvas");
      canvas.width = Math.max(1, Math.round(img.width * scale));
      canvas.height = Math.max(1, Math.round(img.height * scale));
      canvas.getContext("2d")?.drawImage(img, 0, 0, canvas.width, canvas.height);
      URL.revokeObjectURL(url);
      let data = canvas.toDataURL("image/png");
      if (!isValidLogo(data)) data = canvas.toDataURL("image/jpeg", 0.85);
      if (!isValidLogo(data)) return void toast.error("A imagem é grande demais. Use uma logomarca menor.");
      setOrg((o) => ({ ...o, logo: data }));
    };
    img.onerror = () => {
      URL.revokeObjectURL(url);
      toast.error("Não foi possível ler a imagem.");
    };
    img.src = url;
  }

  async function saveProfile() {
    const { error } = await sb()
      .from("profiles")
      .update({ ...p, profession: p.profession.trim() || null, document: p.document.replace(/\D/g, "") || null, oab_number: p.oab_number || null, oab_state: p.oab_state || null })
      .eq("id", userId);
    if (error) return toast.error(error.message);
    // Com OAB informada, já passa a monitorar as intimações no DJEN
    if (/^\d{1,7}[A-Za-z]?$/.test(p.oab_number.trim()) && p.oab_state) {
      await sb()
        .from("oab_monitors")
        .upsert(
          { organization_id: organization.id, user_id: userId, oab_number: p.oab_number.trim().toUpperCase(), oab_state: p.oab_state },
          { onConflict: "organization_id,oab_number,oab_state", ignoreDuplicates: true },
        );
    }
    toast.success("Perfil atualizado");
    router.refresh();
  }
  async function saveOrg() {
    const extraHolidays = org.holidays.split(/[,\s]+/).filter((d) => /^\d{4}-\d{2}-\d{2}$/.test(d));
    const { error } = await sb()
      .from("organizations")
      .update({ name: org.name, document: org.document || null, settings: { ...(organization.settings ?? {}), extraHolidays, address: org.address.trim() || null, phone: org.phone.trim() || null, logo: org.logo || null } })
      .eq("id", organization.id);
    if (error) return toast.error(error.message);
    toast.success("Escritório atualizado");
    router.refresh();
  }

  return (
    <div className="space-y-6">
      <Card>
        <CardHeader><CardTitle>Meu perfil</CardTitle></CardHeader>
        <CardContent className="grid gap-3 sm:grid-cols-2">
          <div className="grid gap-1.5 sm:col-span-2"><Label>Nome</Label><Input value={p.full_name} onChange={(e) => setP({ ...p, full_name: e.target.value })} /></div>
          <div className="grid gap-1.5">
            <Label>Função / profissão</Label>
            <Input value={p.profession} onChange={(e) => setP({ ...p, profession: e.target.value })} list="lex-profissoes" placeholder="Advogado(a), engenheiro(a), médico(a)…" />
            <datalist id="lex-profissoes">
              {PROFESSIONS.map((x) => <option key={x} value={x} />)}
            </datalist>
          </div>
          <div className="grid gap-1.5"><Label>Telefone</Label><Input value={p.phone} onChange={(e) => setP({ ...p, phone: e.target.value })} /></div>
          <div className="grid gap-1.5">
            <Label>CPF</Label>
            <Input value={p.document} onChange={(e) => setP({ ...p, document: e.target.value })} inputMode="numeric" placeholder="Usado na busca de intimações pelo seu nome" />
          </div>
          <div className={isLawyer ? "grid grid-cols-[1fr_90px] gap-2" : "hidden"}>
            <div className="grid gap-1.5"><Label>OAB nº</Label><Input value={p.oab_number} onChange={(e) => setP({ ...p, oab_number: e.target.value })} /></div>
            <div className="grid gap-1.5"><Label>UF</Label>
              <Select value={p.oab_state} onValueChange={(v) => setP({ ...p, oab_state: v })}>
                <SelectTrigger><SelectValue placeholder="—" /></SelectTrigger>
                <SelectContent>{BR_STATES.map((uf) => <SelectItem key={uf} value={uf}>{uf}</SelectItem>)}</SelectContent>
              </Select>
            </div>
          </div>
          <div className="sm:col-span-2"><Button onClick={() => void saveProfile()}>Salvar perfil</Button></div>
        </CardContent>
      </Card>
      {canOrg && (
        <Card>
          <CardHeader>
            <CardTitle>Escritório</CardTitle>
            <CardDescription>Feriados locais e forenses entram na contagem automática de prazos.</CardDescription>
          </CardHeader>
          <CardContent className="grid gap-3 sm:grid-cols-2">
            <div className="grid gap-1.5"><Label>Nome do escritório</Label><Input value={org.name} onChange={(e) => setOrg({ ...org, name: e.target.value })} /></div>
            <div className="grid gap-1.5"><Label>CNPJ</Label><Input value={org.document} onChange={(e) => setOrg({ ...org, document: e.target.value })} /></div>
            <div className="grid gap-1.5 sm:col-span-2"><Label>Feriados locais (AAAA-MM-DD, separados por vírgula)</Label><Input value={org.holidays} onChange={(e) => setOrg({ ...org, holidays: e.target.value })} placeholder="2026-01-12, 2026-08-15, 2026-10-12" /></div>
            <div className="grid gap-1.5 sm:col-span-2">
              <Label>Endereço (sai no cabeçalho dos relatórios)</Label>
              <Textarea rows={2} value={org.address} onChange={(e) => setOrg({ ...org, address: e.target.value })} placeholder="Rua, número, sala — bairro — cidade/UF — CEP" />
            </div>
            <div className="grid gap-1.5"><Label>Telefone e e-mail do escritório</Label><Input value={org.phone} onChange={(e) => setOrg({ ...org, phone: e.target.value })} placeholder="(91) 0000-0000 · contato@escritorio.com.br" /></div>
            <div className="grid gap-1.5">
              <Label>Logomarca (PNG ou JPG)</Label>
              <div className="flex flex-wrap items-center gap-3">
                {org.logo && (
                  // eslint-disable-next-line @next/next/no-img-element
                  <img src={org.logo} alt="Logomarca do escritório" className="h-12 max-w-[160px] rounded border bg-white object-contain p-1" />
                )}
                <Input type="file" accept="image/png,image/jpeg,image/webp" className="max-w-[240px]" onChange={(e) => chooseLogo(e.target.files?.[0])} />
                {org.logo && <Button type="button" variant="ghost" size="sm" onClick={() => setOrg({ ...org, logo: "" })}>Remover</Button>}
              </div>
            </div>
            <p className="text-xs text-muted-foreground sm:col-span-2">A logomarca e o endereço aparecem no topo do relatório do cliente e dos ofícios, cartas e e-mails impressos.</p>
            <div className="sm:col-span-2"><Button onClick={() => void saveOrg()}>Salvar escritório</Button></div>
          </CardContent>
        </Card>
      )}
    </div>
  );
}
