import type { Metadata } from "next";
import { IntimationsPage } from "@/components/intimations/intimations-page";

export const metadata: Metadata = { title: "Intimações" };

/** ?abrir=<id> abre a intimação (vindo de uma notificação) com o cadastro do processo e cliente. */
export default async function Page({ searchParams }: { searchParams: Promise<{ abrir?: string }> }) {
  const { abrir } = await searchParams;
  return <IntimationsPage openId={abrir ?? null} />;
}
