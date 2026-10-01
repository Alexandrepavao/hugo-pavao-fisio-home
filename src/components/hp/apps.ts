import { Briefcase, CalendarDays, FileText, GraduationCap, Grid2x2, Handshake, KanbanSquare, Sunrise, Wallet, type LucideIcon } from "lucide-react";
import type { AppRole } from "@/auth/AuthProvider";

export type AppId = "hub" | "gestao" | "fin" | "crm" | "pages" | "operacao" | "academy" | "parceiros" | "produtividade";
export interface HpApp { id: AppId; label: string; description: string; to: string; icon: LucideIcon; /** cor de identidade do aplicativo (HSL sem hsl()) */ accent: string; roles?: AppRole[] }

// Papéis só controlam o que APARECE (Hub e seletor); a autorização real continua nas rotas, no RLS e nas funções do banco. Um aplicativo nunca concede permissão.
const PEOPLE: AppRole[] = ["manager", "ops_admin", "unit_manager", "sales"];
const FINANCE: AppRole[] = ["manager", "ops_admin", "unit_manager", "finance", "sales"];

/** Aplicativos do HP Group Hub. Cada um tem sidebar própria (appNav.ts) e uma cor de identidade (ícone, item ativo e destaques daquele app). */
export const APPS: HpApp[] = [
  { id: "hub", label: "Início (Hub)", description: "Visão consolidada da operação", to: "/admin", icon: Grid2x2, accent: "212 58% 28%" },
  { id: "gestao", label: "Gestão", description: "Cadastro, equipe, configurações e auditoria", to: "/admin/adm", icon: Briefcase, accent: "197 72% 30%", roles: PEOPLE },
  { id: "fin", label: "Financeiro", description: "Vendas, caixa, cartões, DRE e recorrência", to: "/admin/financeiro", icon: Wallet, accent: "158 62% 28%", roles: FINANCE },
  { id: "crm", label: "CRM", description: "Leads, funil, tarefas e metas", to: "/admin/crm", icon: KanbanSquare, accent: "228 52% 44%", roles: PEOPLE },
  { id: "pages", label: "Pages", description: "Páginas, captação e pesquisas", to: "/admin/paginas", icon: FileText, accent: "184 58% 30%", roles: PEOPLE },
  { id: "operacao", label: "Operação", description: "Agenda, atendimentos e acompanhamento", to: "/admin/agenda", icon: CalendarDays, accent: "28 78% 38%", roles: [...PEOPLE, "physio"] },
  { id: "academy", label: "Academy", description: "Administração de cursos e alunos", to: "/admin/academy", icon: GraduationCap, accent: "262 38% 44%", roles: ["manager", "ops_admin", "teacher"] },
  { id: "parceiros", label: "Parceiros", description: "Indicações, encaminhamentos e repasses", to: "/admin/parceiros", icon: Handshake, accent: "338 48% 40%", roles: FINANCE },
  { id: "produtividade", label: "Produtividade", description: "Meu dia, tarefas, calendário e Google Calendar", to: "/admin/meu-dia", icon: Sunrise, accent: "42 80% 34%" },
];

export const appById = (id: AppId): HpApp => APPS.find((a) => a.id === id) ?? APPS[0];

// A URL decide o aplicativo ativo (links diretos, recarregar e voltar/avançar sempre caem no app certo).
const PREFIXES: Record<Exclude<AppId, "hub">, string[]> = {
  gestao: ["/admin/adm", "/admin/pessoas", "/admin/equipe", "/admin/configuracoes", "/admin/auditoria", "/admin/status"],
  fin: ["/admin/financeiro", "/admin/contas-corporativas"],
  crm: ["/admin/crm"],
  pages: ["/admin/paginas", "/admin/captacao-leads", "/admin/pesquisas"],
  operacao: ["/admin/agenda", "/admin/acompanhamento"],
  academy: ["/admin/academy"],
  parceiros: ["/admin/parceiros"],
  produtividade: ["/admin/meu-dia"],
};
const under = (p: string, base: string) => p === base || p.startsWith(base + "/");
export const appForPath = (pathname: string): AppId =>
  ((Object.keys(PREFIXES) as Exclude<AppId, "hub">[]).find((id) => PREFIXES[id].some((b) => under(pathname, b))) ?? "hub");
