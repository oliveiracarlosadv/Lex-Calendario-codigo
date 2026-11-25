import type { Metadata } from "next";
import { ProcessDetail } from "@/components/processes/process-detail";

export const metadata: Metadata = { title: "Processo" };

export default async function Page({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  return <ProcessDetail id={id} />;
}
