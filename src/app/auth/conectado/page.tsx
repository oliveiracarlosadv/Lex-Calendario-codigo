import { OAuthDone } from "./oauth-done";

/** Fim do login com o Google: fecha a janela de login e avisa o calendário. */
export default async function Page({ searchParams }: { searchParams: Promise<{ status?: string; provedor?: string }> }) {
  const { status = "erro", provedor = "google" } = await searchParams;
  return <OAuthDone status={status} provider={provedor} />;
}
