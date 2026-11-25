import "server-only";
import webpush from "web-push";
import { optionalServerEnv, publicEnv } from "@/lib/env";

let configured = false;

function ensureConfigured() {
  if (configured) return true;
  const priv = optionalServerEnv("VAPID_PRIVATE_KEY");
  if (!priv || !publicEnv.vapidPublicKey) return false;
  webpush.setVapidDetails(optionalServerEnv("VAPID_SUBJECT") ?? "mailto:contato@lexcalendario.com.br", publicEnv.vapidPublicKey, priv);
  configured = true;
  return true;
}

export interface PushSubscriptionRow {
  id: string;
  endpoint: string;
  p256dh: string;
  auth: string;
}

export interface PushPayload {
  title: string;
  body: string;
  url: string;
  tag?: string;
}

/** Envia push; devolve os IDs de assinaturas expiradas (404/410) para remoção. */
export async function sendPush(subs: PushSubscriptionRow[], payload: PushPayload): Promise<string[]> {
  if (!ensureConfigured()) return [];
  const expired: string[] = [];
  await Promise.all(
    subs.map(async (s) => {
      try {
        await webpush.sendNotification(
          { endpoint: s.endpoint, keys: { p256dh: s.p256dh, auth: s.auth } },
          JSON.stringify(payload),
          { TTL: 3600, urgency: "high" },
        );
      } catch (e) {
        const status = (e as { statusCode?: number }).statusCode;
        if (status === 404 || status === 410) expired.push(s.id);
      }
    }),
  );
  return expired;
}
