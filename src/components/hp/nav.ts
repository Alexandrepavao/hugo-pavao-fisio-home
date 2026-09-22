import { CalendarDays, FileText, GraduationCap, Handshake, HeartPulse, KanbanSquare, LayoutDashboard, ListChecks, ScrollText, ShieldCheck, Sunrise, Users, Wallet, type LucideIcon } from "lucide-react";
import type { AppRole } from "@/auth/AuthProvider";

export interface NavItem { to: string; label: string; icon: LucideIcon; roles?: AppRole[]; end?: boolean; keywords?: string }
export interface NavSection { label?: string; items: NavItem[] }

// Papéis apenas controlam a exibição do menu. A autorização real é feita no banco (RLS e funções).
export const NAV: NavSection[] = [
  { items: [
    { to: "/admin", label: "Início", icon: LayoutDashboard, end: true, keywords: "dashboard indicadores painel" },
    { to: "/admin/meu-dia", label: "Meu dia", icon: Sunrise, keywords: "tarefas foco produtividade agenda pessoal" },
  ] },
  { label: "Comercial", items: [
    { to: "/admin/pessoas", label: "Pessoas", icon: Users, roles: ["manager", "ops_admin", "unit_manager", "sales"], keywords: "pacientes leads contatos" },
    { to: "/admin/crm", label: "CRM", icon: KanbanSquare, roles: ["manager", "ops_admin", "unit_manager", "sales"], keywords: "oportunidades funil kanban tarefas" },
    { to: "/admin/paginas", label: "Páginas", icon: FileText, roles: ["manager", "ops_admin", "unit_manager", "sales"], keywords: "landing formulários site" },
  ] },
  { label: "Operação", items: [
    { to: "/admin/agenda", label: "Agenda", icon: CalendarDays, roles: ["manager", "ops_admin", "unit_manager", "sales", "physio"], keywords: "atendimentos horários pacotes" },
    { to: "/admin/acompanhamento", label: "Acompanhamento", icon: HeartPulse, roles: ["manager", "ops_admin", "unit_manager", "physio"], keywords: "pacientes vínculo conteúdos" },
  ] },
  { label: "Financeiro", items: [
    { to: "/admin/financeiro", label: "Financeiro", icon: Wallet, roles: ["manager", "ops_admin", "unit_manager", "finance", "sales"], keywords: "vendas recebimentos contas comissões" },
    { to: "/admin/parceiros", label: "Parceiros", icon: Handshake, roles: ["manager", "ops_admin", "unit_manager", "finance", "sales"], keywords: "indicações repasses" },
  ] },
  { label: "Educação", items: [
    { to: "/admin/academy", label: "Academy", icon: GraduationCap, roles: ["manager", "ops_admin", "teacher"], keywords: "cursos aulas mentoria comunidade" },
  ] },
  { label: "Sistema", items: [
    { to: "/admin/equipe", label: "Equipe e acessos", icon: ShieldCheck, roles: ["manager", "ops_admin"], keywords: "convites papéis usuários" },
    { to: "/admin/status", label: "Estado dos módulos", icon: ListChecks, roles: ["manager", "ops_admin"] },
    { to: "/admin/auditoria", label: "Auditoria", icon: ScrollText, roles: ["manager"], keywords: "log histórico" },
  ] },
];

export const ROLE_LABEL: Record<AppRole, string> = {
  manager: "Gestor", ops_admin: "Administrador operacional", unit_manager: "Gestor de unidade",
  sales: "Comercial", finance: "Financeiro", physio: "Fisioterapeuta", teacher: "Professor/mentor",
  partner: "Parceiro", member: "Paciente/aluno",
};

export const flatNav = (allowed: (item: NavItem) => boolean) => NAV.flatMap((s) => s.items).filter(allowed);
