import type { Metadata } from "next";
import { ProcessSearchPage } from "@/components/processes/process-search-page";

export const metadata: Metadata = { title: "Buscar processos" };

export default function Page() {
  return <ProcessSearchPage />;
}
