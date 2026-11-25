import type { Metadata } from "next";
import { CommunicationsPage } from "@/components/communications/communications-page";

export const metadata: Metadata = { title: "Comunicações" };

/** ?abrir=<id> abre a comunicação (vindo de uma notificação ou do histórico do cliente). */
export default async function Page({ searchParams }: { searchParams: Promise<{ abrir?: string; cliente?: string }> }) {
  const { abrir, cliente } = await searchParams;
  return <CommunicationsPage openId={abrir ?? null} clientId={cliente ?? null} />;
}
