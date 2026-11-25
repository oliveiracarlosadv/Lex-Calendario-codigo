import {
  Bell,
  Inbox,
  BriefcaseBusiness,
  CalendarDays,
  Info,
  FileSearch,
  Handshake,
  LayoutDashboard,
  Send,
  Radar,
  Settings,
  Users,
  type LucideIcon,
} from "lucide-react";

export interface NavItem {
  href: string;
  label: string;
  icon: LucideIcon;
}

export const NAV_ITEMS: NavItem[] = [
  { href: "/calendario", label: "Calendário", icon: CalendarDays },
  { href: "/painel", label: "Painel", icon: LayoutDashboard },
  { href: "/intimacoes", label: "Intimações", icon: Inbox },
  { href: "/processos", label: "Central de Processos", icon: BriefcaseBusiness },
  { href: "/buscar-processos", label: "Buscar processos", icon: FileSearch },
  { href: "/clientes", label: "Clientes", icon: Users },
  { href: "/comunicacoes", label: "Comunicações", icon: Send },
  { href: "/parceiros", label: "Parceiros", icon: Handshake },
  { href: "/monitoramento", label: "Monitoramento e IA", icon: Radar },
  { href: "/notificacoes", label: "Notificações", icon: Bell },
];

/** Versão web (celular): cliente de leitura do Google Agenda, só com o calendário. */
export const WEB_ITEMS = ["/calendario", "/sobre"];

export const FOOTER_ITEMS: NavItem[] = [
  { href: "/configuracoes/perfil", label: "Configurações", icon: Settings },
  { href: "/sobre", label: "Sobre", icon: Info },
];
