import { FilteredList } from "@/components/dashboard/filtered-list";

export default async function ListPage({ searchParams }: { searchParams: Promise<{ filtro?: string }> }) {
  const { filtro } = await searchParams;
  return <FilteredList filterKey={filtro ?? "futuros"} />;
}
