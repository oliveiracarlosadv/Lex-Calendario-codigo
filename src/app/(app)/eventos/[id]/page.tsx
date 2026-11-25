import type { Metadata } from "next";
import { EventWorkspace } from "@/components/events/event-workspace";

export const metadata: Metadata = { title: "Compromisso" };

export default async function EventPage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  return <EventWorkspace id={id} />;
}
