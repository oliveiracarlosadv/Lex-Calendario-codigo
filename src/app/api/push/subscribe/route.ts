import { z } from "zod";
import { fail, getUserContext, json } from "@/lib/api";

export const dynamic = "force-dynamic";

const Sub = z.object({ endpoint: z.string().url(), keys: z.object({ p256dh: z.string(), auth: z.string() }) });

export async function POST(request: Request) {
  const ctx = await getUserContext();
  if (!ctx) return fail("Não autenticado", 401);
  const parsed = Sub.safeParse(await request.json().catch(() => null));
  if (!parsed.success) return fail("Assinatura inválida");
  const { error } = await ctx.supabase.from("push_subscriptions").upsert(
    {
      user_id: ctx.user.id,
      endpoint: parsed.data.endpoint,
      p256dh: parsed.data.keys.p256dh,
      auth: parsed.data.keys.auth,
      user_agent: request.headers.get("user-agent")?.slice(0, 300),
    },
    { onConflict: "endpoint" },
  );
  if (error) return fail(error.message, 500);
  return json({ ok: true });
}

export async function DELETE(request: Request) {
  const ctx = await getUserContext();
  if (!ctx) return fail("Não autenticado", 401);
  const { endpoint } = (await request.json().catch(() => ({}))) as { endpoint?: string };
  if (endpoint) await ctx.supabase.from("push_subscriptions").delete().eq("endpoint", endpoint).eq("user_id", ctx.user.id);
  return json({ ok: true });
}
