import Link from "next/link";
import { notFound } from "next/navigation";
import { PageHeader } from "@/components/layout/app-shell";
import { BackupSettings } from "@/components/settings/backup-settings";
import { CategoriesSettings } from "@/components/settings/categories-settings";
import { IntegrationsSettings } from "@/components/settings/integrations-settings";
import { ProfileSettings } from "@/components/settings/profile-settings";
import { TeamTab } from "@/components/settings/collaborators-settings";
import { cn } from "@/lib/utils";

/** Versão web: só as configurações que funcionam sem servidor. */
const TABS = {
  perfil: { label: "Perfil e escritório", component: ProfileSettings },
  categorias: { label: "Categorias e cores", component: CategoriesSettings },
  integracoes: { label: "Google Agenda", component: IntegrationsSettings },
  equipe: { label: "Equipe e responsáveis", component: TeamTab },
  backup: { label: "Backup e restauração", component: BackupSettings },
} as const;

export function generateStaticParams() {
  return Object.keys(TABS).map((tab) => ({ tab }));
}

export default async function SettingsPage({ params }: { params: Promise<{ tab: string }> }) {
  const { tab } = await params;
  const current = TABS[tab as keyof typeof TABS];
  if (!current) notFound();
  const Component = current.component;
  return (
    <div>
      <PageHeader title="Configurações" />
      <div className="grid gap-6 p-4 md:grid-cols-[220px_1fr] md:p-8">
        <nav className="flex gap-1 overflow-x-auto md:flex-col">
          {Object.entries(TABS).map(([key, t]) => (
            <Link key={key} href={`/configuracoes/${key}`} className={cn("whitespace-nowrap rounded-lg px-3 py-2 text-sm transition", key === tab ? "bg-accent font-medium" : "text-muted-foreground hover:bg-accent/60 hover:text-foreground")}>
              {t.label}
            </Link>
          ))}
        </nav>
        <div className="min-w-0 max-w-3xl space-y-4">
          <Component />
        </div>
      </div>
    </div>
  );
}
