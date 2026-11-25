import Link from "next/link";
import { notFound } from "next/navigation";
import { PageHeader } from "@/components/layout/app-shell";
import { AiSettings } from "@/components/settings/ai-settings";
import { AppSettings } from "@/components/settings/app-settings";
import { BackupSettings } from "@/components/settings/backup-settings";
import { CategoriesSettings } from "@/components/settings/categories-settings";
import { MailSettings } from "@/components/settings/mail-settings";
import { IntegrationsSettings } from "@/components/settings/integrations-settings";
import { NotificationsSettings } from "@/components/settings/notifications-settings";
import { ProfileSettings } from "@/components/settings/profile-settings";
import { SecuritySettings } from "@/components/settings/security-settings";
import { TeamTab } from "@/components/settings/collaborators-settings";
import { TribunalsSettings } from "@/components/settings/tribunals-settings";
import { cn } from "@/lib/utils";

const TABS = {
  perfil: { label: "Perfil e escritório", component: ProfileSettings },
  categorias: { label: "Categorias e cores", component: CategoriesSettings },
  integracoes: { label: "Integrações", component: IntegrationsSettings },
  notificacoes: { label: "Notificações", component: NotificationsSettings },
  email: { label: "E-mail de envio", component: MailSettings },
  ia: { label: "Agente de inteligência artificial", component: AiSettings },
  seguranca: { label: "Segurança e MFA", component: SecuritySettings },
  equipe: { label: "Equipe e responsáveis", component: TeamTab },
  tribunais: { label: "OAB e intimações", component: TribunalsSettings },
  backup: { label: "Backup e restauração", component: BackupSettings },
  aplicativo: { label: "Aplicativo e navegador", component: AppSettings },
} as const;

export function generateStaticParams() {
  return Object.keys(TABS).map((tab) => ({ tab }));
}

export default async function SettingsPage({ params, searchParams }: { params: Promise<{ tab: string }>; searchParams: Promise<{ status?: string }> }) {
  const { tab } = await params;
  const { status } = await searchParams;
  const current = TABS[tab as keyof typeof TABS];
  if (!current) notFound();
  const Component = current.component;

  return (
    <div>
      <PageHeader title="Configurações" />
      <div className="grid gap-6 p-4 md:grid-cols-[220px_1fr] md:p-8">
        <nav className="flex gap-1 overflow-x-auto md:flex-col">
          {Object.entries(TABS).map(([key, t]) => (
            <Link
              key={key}
              href={`/configuracoes/${key}`}
              className={cn("whitespace-nowrap rounded-lg px-3 py-2 text-sm transition", key === tab ? "bg-accent font-medium" : "text-muted-foreground hover:bg-accent/60 hover:text-foreground")}
            >
              {t.label}
            </Link>
          ))}
        </nav>
        <div className="min-w-0 max-w-3xl space-y-4">
          {status === "conectado" && <p className="rounded-xl bg-emerald-500/10 px-4 py-3 text-sm text-emerald-700 dark:text-emerald-400">Calendário conectado. A primeira sincronização já começou.</p>}
          {status === "ia-conectada" && <p className="rounded-xl bg-emerald-500/10 px-4 py-3 text-sm text-emerald-700 dark:text-emerald-400">Conta conectada. O Lex já está usando esta IA.</p>}
          {status === "ia-erro" && <p className="rounded-xl bg-destructive/10 px-4 py-3 text-sm text-destructive">Não foi possível concluir a entrada na IA. Tente novamente.</p>}
          {status === "erro" && <p className="rounded-xl bg-destructive/10 px-4 py-3 text-sm text-destructive">Não foi possível concluir a conexão. Tente novamente.</p>}
          <Component />
        </div>
      </div>
    </div>
  );
}
