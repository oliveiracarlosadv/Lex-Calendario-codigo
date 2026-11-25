"use client";

import { Suspense } from "react";
import { useSearchParams } from "next/navigation";
import { ClientDetail } from "@/components/clients/client-detail";

function Content() {
  const q = useSearchParams();
  return <ClientDetail key={q.get("id")} id={q.get("id") ?? ""} />;
}

export default function Page() {
  return (
    <Suspense>
      <Content />
    </Suspense>
  );
}
