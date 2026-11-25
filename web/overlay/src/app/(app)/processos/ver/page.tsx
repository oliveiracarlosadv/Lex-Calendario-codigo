"use client";

import { Suspense } from "react";
import { useSearchParams } from "next/navigation";
import { ProcessDetail } from "@/components/processes/process-detail";

function Content() {
  const q = useSearchParams();
  return <ProcessDetail key={q.get("id")} id={q.get("id") ?? ""} />;
}

export default function Page() {
  return (
    <Suspense>
      <Content />
    </Suspense>
  );
}
