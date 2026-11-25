import "server-only";
import { randomUUID } from "node:crypto";
import { encryptSecret } from "@/infrastructure/crypto/secrets";
import { stopGoogleChannel, watchGoogleCalendar } from "@/infrastructure/integrations/google/google-calendar";
import { renewOutlookSubscription, subscribeOutlook } from "@/infrastructure/integrations/microsoft/outlook-calendar";
import type { TokenResponse } from "@/infrastructure/integrations/token-store";
import type { ConnectionRow } from "@/infrastructure/integrations/types";
import { getSupabaseAdminClient } from "@/infrastructure/supabase/server";
import { webhookToken } from "@/lib/api";
import { publicEnv } from "@/lib/env";
import { pullConnection } from "./calendar-sync";

/** Cria/atualiza a conexão OAuth do usuário e registra webhooks. */
export async function upsertOAuthConnection(args: {
  orgId: string;
  userId: string;
  provider: "google" | "microsoft";
  email: string | null;
  tokens: TokenResponse;
}) {
  const admin = getSupabaseAdminClient();
  const { data, error } = await admin
    .from("calendar_connections")
    .upsert(
      {
        organization_id: args.orgId,
        user_id: args.userId,
        provider: args.provider,
        account_email: args.email,
        external_calendar_id: "primary",
        access_token_enc: encryptSecret(args.tokens.access_token),
        ...(args.tokens.refresh_token ? { refresh_token_enc: encryptSecret(args.tokens.refresh_token) } : {}),
        token_expires_at: new Date(Date.now() + (args.tokens.expires_in ?? 3600) * 1000).toISOString(),
        is_active: true,
        last_error: null,
        ...(args.tokens.scope ? { scopes: args.tokens.scope } : {}),
      },
      { onConflict: "user_id,provider,external_calendar_id" },
    )
    .select("*")
    .single();
  if (error || !data) throw error ?? new Error("Falha ao salvar conexão");
  const conn = data as ConnectionRow;
  await registerWebhook(conn).catch((e) => console.warn("[sync] webhook não registrado", (e as Error).message));
  await pullConnection(conn.id).catch((e) => console.warn("[sync] primeira sincronização falhou", (e as Error).message));
  return conn;
}

/** Webhooks exigem URL pública HTTPS (não funcionam em localhost — o cron cobre esse caso). */
export async function registerWebhook(conn: ConnectionRow) {
  if (!publicEnv.appUrl.startsWith("https://")) return;
  const admin = getSupabaseAdminClient();
  if (conn.provider === "google") {
    await stopGoogleChannel(conn);
    const channelId = randomUUID();
    const { resourceId, expiresAt } = await watchGoogleCalendar(conn, channelId, webhookToken(conn.id));
    await admin
      .from("calendar_connections")
      .update({ webhook_channel_id: channelId, webhook_resource_id: resourceId, webhook_expires_at: expiresAt })
      .eq("id", conn.id);
  } else if (conn.provider === "microsoft") {
    if (conn.webhook_channel_id) {
      const expiresAt = await renewOutlookSubscription(conn).catch(() => null);
      if (expiresAt) {
        await admin.from("calendar_connections").update({ webhook_expires_at: expiresAt }).eq("id", conn.id);
        return;
      }
    }
    const { subscriptionId, expiresAt } = await subscribeOutlook(conn, webhookToken(conn.id));
    await admin.from("calendar_connections").update({ webhook_channel_id: subscriptionId, webhook_expires_at: expiresAt }).eq("id", conn.id);
  }
}
