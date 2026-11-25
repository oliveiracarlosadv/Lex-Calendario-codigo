"use client";

import { Suspense } from "react";
import { useSearchParams } from "next/navigation";
import { EventWorkspace } from "@/components/events/event-workspace";

function Content() {
  const q = useSearchParams();
  return <EventWorkspace key={q.get("id")} id={q.get("id") ?? ""} />;
}

export default function Page() {
  return (
    <Suspense>
      <Content />
    </Suspense>
  );
}
