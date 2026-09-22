import { Building2, CalendarDays, ClipboardList, FileText, GraduationCap, Handshake, HeartPulse, KanbanSquare, LayoutDashboard, ListChecks, ScrollText, ShieldCheck, Sunrise, Users, Wallet, type LucideIcon } from "lucide-react";
import type { AppRole } from "@/auth/AuthProvider";

export interface NavChild { to: string; label: string; end?: boolean }
export interface NavItem { to: string; label: string; icon: LucideIcon; roles?: AppRole[]; end?: boolean; keywords?: string; children?: NavChild[] }
export interface NavSection { label?: string; items: NavItem[] }

// Destaques na navegação do header quando dentro de uma seção com "children" (os demais ficam em "Mais").
export const HEADER_PRIMARY = 6;

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
    { to: "/admin/pesquisas", label: "Pesquisas", icon: ClipboardList, roles: ["manager", "ops_admin"], keywords: "perguntas respostas enquete satisfação" },
  ] },
  { label: "Operação", items: [
    { to: "/admin/agenda", label: "Agenda", icon: CalendarDays, roles: ["manager", "ops_admin", "unit_manager", "sales", "physio"], keywords: "atendimentos horários pacotes" },
    { to: "/admin/acompanhamento", label: "Acompanhamento", icon: HeartPulse, roles: ["manager", "ops_admin", "unit_manager", "physio"], keywords: "pacientes vínculo conteúdos" },
  ] },
  { label: "Financeiro", items: [
    { to: "/admin/financeiro", label: "Financeiro", icon: Wallet, roles: ["manager", "ops_admin", "unit_manager", "finance", "sales"], keywords: "vendas recebimentos contas comissões mrr arr dre conciliação", children: [
      { to: "/admin/financeiro", label: "Visão geral", end: true },
      { to: "/admin/financeiro/vendas", label: "Vendas" },
      { to: "/admin/financeiro/fluxo-caixa", label: "Fluxo de caixa" },
      { to: "/admin/financeiro/recorrencia", label: "Recorrência" },
      { to: "/admin/financeiro/dre", label: "DRE" },
      { to: "/admin/financeiro/conciliacao", label: "Conciliação" },
      { to: "/admin/financeiro/pagar", label: "Contas a pagar" },
      { to: "/admin/financeiro/comissoes", label: "Comissões e repasses" },
      { to: "/admin/financeiro/relatorios", label: "Relatórios" },
      { to: "/admin/financeiro/config", label: "Configurações" },
    ] },
    { to: "/admin/parceiros", label: "Parceiros", icon: Handshake, roles: ["manager", "ops_admin", "unit_manager", "finance", "sales"], keywords: "indicações repasses" },
    { to: "/admin/contas-corporativas", label: "Contas corporativas", icon: Building2, roles: ["manager", "ops_admin", "unit_manager", "finance"], keywords: "empresas contratos corporativo convênio" },
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
