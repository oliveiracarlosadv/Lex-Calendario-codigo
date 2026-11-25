import type { Metadata } from "next";
import { PartnersPage } from "@/components/partners/partners-page";

export const metadata: Metadata = { title: "Parceiros" };

export default function Page() {
  return <PartnersPage />;
}
