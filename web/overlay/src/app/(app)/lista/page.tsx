"use client";

import { Suspense } from "react";
import { useSearchParams } from "next/navigation";
import { FilteredList } from "@/components/dashboard/filtered-list";

function Content() {
  const q = useSearchParams();
  return <FilteredList filterKey={q.get("filtro") ?? "futuros"} />;
}

export default function Page() {
  return (
    <Suspense>
      <Content />
    </Suspense>
  );
}
