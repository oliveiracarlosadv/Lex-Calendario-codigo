"use client";

import { Suspense } from "react";
import { useSearchParams } from "next/navigation";
import { CommunicationsPage } from "@/components/communications/communications-page";

function Content() {
  const q = useSearchParams();
  return <CommunicationsPage openId={q.get("abrir")} clientId={q.get("cliente")} />;
}

export default function Page() {
  return (
    <Suspense>
      <Content />
    </Suspense>
  );
}
