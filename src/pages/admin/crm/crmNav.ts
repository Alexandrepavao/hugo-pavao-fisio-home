import { BarChart3, CalendarClock, Contact, KanbanSquare, LayoutDashboard, ListChecks, MessageCircle, Send, Settings, Target, Timer, Users, type LucideIcon } from "lucide-react";
import type { AppRole } from "@/auth/AuthProvider";

export interface CrmNavItem { to: string; label: string; icon: LucideIcon; end?: boolean; managerOnly?: boolean }
export interface CrmNavSection { label: string; items: CrmNavItem[] }

// O CRM é uma área própria dentro do Hub — sidebar exclusiva (ver CrmShell), navegação nunca mistura com
// Financeiro/Academy/outros apps (troca-se de app pelo seletor no cabeçalho, não por aqui).
export const CRM_NAV: CrmNavSection[] = [
  { label: "Principal", items: [
    { to: "/admin/crm", label: "Dashboard", icon: LayoutDashboard, end: true },
  ] },
  { label: "Comercial", items: [
    { to: "/admin/crm/leads", label: "Gestão de leads", icon: Users },
    { to: "/admin/crm/contatos", label: "Contatos", icon: Contact },
    { to: "/admin/crm/listas", label: "Listas", icon: ListChecks },
    { to: "/admin/crm/oportunidades", label: "Pipeline", icon: KanbanSquare },
    { to: "/admin/crm/tarefas", label: "Tarefas", icon: CalendarClock },
  ] },
  { label: "Metas", items: [
    { to: "/admin/crm/metas", label: "Minha meta", icon: Target, end: true },
    { to: "/admin/crm/metas/ritmo", label: "Ritmo do dia", icon: Timer },
    { to: "/admin/crm/metas/time", label: "Time", icon: Users, managerOnly: true },
  ] },
  { label: "Comunicação", items: [
    { to: "/admin/crm/conversas", label: "Conversas", icon: MessageCircle },
    { to: "/admin/crm/mensagens-agendadas", label: "Mensagens agendadas", icon: CalendarClock },
    { to: "/admin/crm/disparo", label: "Disparo de mensagens", icon: Send },
  ] },
  { label: "Relatórios", items: [
    { to: "/admin/crm/relatorios", label: "Análises", icon: BarChart3, end: true },
    { to: "/admin/crm/relatorios/desempenho", label: "Desempenho comercial", icon: Users },
  ] },
  { label: "Administração", items: [
    { to: "/admin/crm/configuracoes", label: "Configurações do CRM", icon: Settings, managerOnly: true },
  ] },
];

export const CRM_MANAGER_ROLES: AppRole[] = ["manager", "ops_admin", "unit_manager"];
