"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { Mail, UserMinus } from "lucide-react";
import { toast } from "sonner";
import { Avatar } from "@/components/ui/avatar";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { ROLES, ROLE_DESCRIPTIONS, ROLE_LABELS, type Role } from "@/domain/identity/permissions";
import { sb } from "@/hooks/supabase";
import { useCan, useWorkspace } from "@/hooks/use-workspace";
import { publicEnv } from "@/lib/env";

export function TeamSettings() {
  const router = useRouter();
  const { members, organization, userId } = useWorkspace();
  const canManage = useCan("team:manage");
  const [email, setEmail] = useState("");
  const [role, setRole] = useState<Role>("lawyer");
  const [sending, setSending] = useState(false);

  async function changeRole(uid: string, r: Role) {
    const { error } = await sb().from("memberships").update({ role: r }).eq("organization_id", organization.id).eq("user_id", uid);
    if (error) return toast.error(error.message);
    toast.success("Papel atualizado");
    router.refresh();
  }

  async function removeMember(uid: string) {
    if (!confirm("Remover este membro do escritório?")) return;
    const { error } = await sb().from("memberships").delete().eq("organization_id", organization.id).eq("user_id", uid);
    if (error) return toast.error(error.message);
    router.refresh();
  }

  async function invite() {
    setSending(true);
    const res = await fetch("/api/team/invite", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ email, role }) });
    setSending(false);
    const json = (await res.json().catch(() => ({}))) as { error?: string };
    if (!res.ok) return toast.error(json.error ?? "Convite não enviado");
    toast.success(`Convite enviado para ${email}`);
    setEmail("");
  }

  return (
    <div className="space-y-6">
      <Card>
        <CardHeader>
          <CardTitle>Equipe do escritório</CardTitle>
          <CardDescription>{members.length} membro(s)</CardDescription>
        </CardHeader>
        <CardContent className="space-y-2">
          {members.map((m) => (
            <div key={m.user_id} className="flex flex-wrap items-center gap-3 rounded-xl border px-3 py-2">
              <Avatar name={m.profile?.full_name} src={m.profile?.avatar_url} />
              <div className="min-w-0 flex-1">
                <p className="truncate text-sm font-medium">{m.profile?.full_name ?? "—"} {m.user_id === userId && <span className="text-muted-foreground">(você)</span>}</p>
                <p className="truncate text-xs text-muted-foreground">{m.profile?.email}</p>
              </div>
              {canManage && m.user_id !== userId ? (
                <>
                  <Select value={m.role} onValueChange={(v) => void changeRole(m.user_id, v as Role)}>
                    <SelectTrigger className="h-8 w-40"><SelectValue /></SelectTrigger>
                    <SelectContent>{ROLES.map((r) => <SelectItem key={r} value={r}>{ROLE_LABELS[r]}</SelectItem>)}</SelectContent>
                  </Select>
                  <Button variant="ghost" size="icon-sm" onClick={() => void removeMember(m.user_id)} aria-label="Remover"><UserMinus /></Button>
                </>
              ) : (
                <span className="text-sm text-muted-foreground">{ROLE_LABELS[m.role]}</span>
              )}
            </div>
          ))}
        </CardContent>
      </Card>
      {canManage && !publicEnv.localMode && (
        <Card>
          <CardHeader>
            <CardTitle>Convidar pessoa</CardTitle>
            <CardDescription>O convite chega por e-mail; ao criar a conta, a pessoa entra direto no escritório.</CardDescription>
          </CardHeader>
          <CardContent className="space-y-4">
            <div className="flex flex-wrap gap-2">
              <Input type="email" value={email} onChange={(e) => setEmail(e.target.value)} placeholder="email@escritorio.com.br" className="min-w-[240px] flex-1" />
              <Select value={role} onValueChange={(v) => setRole(v as Role)}>
                <SelectTrigger className="w-44"><SelectValue /></SelectTrigger>
                <SelectContent>{ROLES.map((r) => <SelectItem key={r} value={r}>{ROLE_LABELS[r]}</SelectItem>)}</SelectContent>
              </Select>
              <Button onClick={() => void invite()} disabled={!email.includes("@") || sending}><Mail /> Convidar</Button>
            </div>
            <dl className="grid gap-2 text-sm sm:grid-cols-2">
              {ROLES.map((r) => (
                <div key={r} className="rounded-xl bg-secondary/50 p-3">
                  <dt className="font-medium">{ROLE_LABELS[r]}</dt>
                  <dd className="text-xs text-muted-foreground">{ROLE_DESCRIPTIONS[r]}</dd>
                </div>
              ))}
            </dl>
          </CardContent>
        </Card>
      )}
    </div>
  );
}
