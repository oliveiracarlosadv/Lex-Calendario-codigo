import type { Metadata } from "next";
import { ProcessesPage } from "@/components/processes/processes-page";

export const metadata: Metadata = { title: "Central de Processos" };

export default function Page() {
  return <ProcessesPage />;
}
