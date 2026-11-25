"use client";

import { useEffect, useState } from "react";
import { useRouter } from "next/navigation";
import { BellRing, Smartphone } from "lucide-react";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { REMINDER_PRESETS } from "@/domain/events/types";
import { sb } from "@/hooks/supabase";
import { useWorkspace } from "@/hooks/use-workspace";
import { publicEnv } from "@/lib/env";

function urlBase64ToUint8Array(base64: string) {
  const padding = "=".repeat((4 - (base64.length % 4)) % 4);
  const raw = atob((base64 + padding).replace(/-/g, "+").replace(/_/g, "/"));
  return Uint8Array.from([...raw].map((c) => c.charCodeAt(0)));
}

export function NotificationsSettings() {
  const router = useRouter();
  const { profile, userId } = useWorkspace();
  const [permission, setPermission] = useState<NotificationPermission | "unsupported">("default");
  const [defaults, setDefaults] = useState<number[]>(profile.preferences?.defaultReminders ?? [1440, 60]);

  useEffect(() => {
    setPermission(typeof Notification === "undefined" || !("serviceWorker" in navigator) ? "unsupported" : Notification.permission);
  }, []);

  async function enablePush() {
    if (!publicEnv.vapidPublicKey) return toast.error("Notificações push não configuradas no servidor (VAPID).");
    const result = await Notification.requestPermission();
    setPermission(result);
    if (result !== "granted") return toast.warning("Permissão negada pelo navegador.");
    const reg = await navigator.serviceWorker.register("/sw.js");
    await navigator.serviceWorker.ready;
    const sub = await reg.pushManager.subscribe({ userVisibleOnly: true, applicationServerKey: urlBase64ToUint8Array(publicEnv.vapidPublicKey) });
    const res = await fetch("/api/push/subscribe", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify(sub.toJSON()) });
    if (!res.ok) return toast.error("Não foi possível registrar este dispositivo.");
    toast.success("Notificações ativadas neste dispositivo");
  }

  async function saveDefaults(next: number[]) {
    setDefaults(next);
    const { error } = await sb().from("profiles").update({ preferences: { ...(profile.preferences ?? {}), defaultReminders: next } }).eq("id", userId);
    if (error) toast.error(error.message);
    else router.refresh();
  }

  async function sendTest() {
    const res = await fetch("/api/notificacoes/teste", { method: "POST" });
    if (!res.ok) return toast.error("Não foi possível criar a notificação de teste.");
    toast.success("Notificação de teste enviada", {
      description: publicEnv.localMode ? "Ela aparece na Central de Notificações do sistema em até 30 segundos." : "Ela aparece no sino de notificações.",
    });
  }

  return (
    <div className="space-y-6">
      {publicEnv.localMode && (
        <Card>
          <CardHeader>
            <CardTitle className="flex items-center gap-2"><BellRing className="size-4" /> Notificações do sistema</CardTitle>
            <CardDescription>
              Lembretes e intimações aparecem como notificações do computador (Central de Notificações no Mac, avisos do Windows), mesmo com a janela
              fechada. No Mac, permita em Ajustes do Sistema → Notificações → Lex Calendário.
            </CardDescription>
          </CardHeader>
          <CardContent>
            <Button onClick={() => void sendTest()}><BellRing /> Enviar notificação de teste</Button>
          </CardContent>
        </Card>
      )}
      {!publicEnv.localMode && (
      <Card>
        <CardHeader>
          <CardTitle className="flex items-center gap-2"><BellRing className="size-4" /> Notificações push</CardTitle>
          <CardDescription>
            Receba lembretes no computador e no celular. No iPhone/iPad (iOS 16.4+), adicione o Lex Calendário à Tela de Início pelo Safari antes de ativar.
          </CardDescription>
        </CardHeader>
        <CardContent className="flex flex-wrap items-center gap-3">
          {permission === "unsupported" ? (
            <p className="text-sm text-muted-foreground">Este navegador não oferece notificações push.</p>
          ) : (
            <>
              <Button onClick={() => void enablePush()}><Smartphone /> {permission === "granted" ? "Registrar este dispositivo novamente" : "Ativar neste dispositivo"}</Button>
              <span className="text-sm text-muted-foreground">Status: {permission === "granted" ? "permitido" : permission === "denied" ? "bloqueado nas configurações do navegador" : "não solicitado"}</span>
            </>
          )}
          <Button variant="outline" onClick={() => void sendTest()}>Enviar notificação de teste</Button>
        </CardContent>
      </Card>
      )}
      <Card>
        <CardHeader>
          <CardTitle>Lembretes padrão</CardTitle>
          <CardDescription>Usados quando você cria compromissos sem escolher lembretes. E-mails exigem RESEND_API_KEY no servidor.</CardDescription>
        </CardHeader>
        <CardContent className="flex flex-wrap gap-1.5">
          {REMINDER_PRESETS.map((r) => {
            const on = defaults.includes(r.minutes);
            return (
              <button
                key={r.minutes}
                onClick={() => void saveDefaults(on ? defaults.filter((m) => m !== r.minutes) : [...defaults, r.minutes])}
                className="rounded-full border px-3 py-1.5 text-[13px] transition data-[on=true]:border-primary data-[on=true]:bg-primary/10 data-[on=true]:text-primary"
                data-on={on}
              >
                {r.label}
              </button>
            );
          })}
        </CardContent>
      </Card>
    </div>
  );
}
