"use client";

import { Suspense } from "react";
import { useSearchParams } from "next/navigation";
import { IntimationsPage } from "@/components/intimations/intimations-page";

function Content() {
  const q = useSearchParams();
  return <IntimationsPage openId={q.get("abrir")} />;
}

export default function Page() {
  return (
    <Suspense>
      <Content />
    </Suspense>
  );
}
