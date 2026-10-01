import { CalendarDays, GraduationCap, Grid2x2, Handshake, KanbanSquare, MessageCircleQuestion, Table2, Wallet, type LucideIcon } from "lucide-react";
import type { AppRole } from "@/auth/AuthProvider";

export type AppId = "hub" | "adm" | "crm" | "fin" | "agenda" | "academy" | "parceiros" | "captacao";
export interface HpApp { id: AppId; label: string; description: string; to: string; icon: LucideIcon; /** cor de identidade do aplicativo (HSL sem hsl()) */ accent: string; roles?: AppRole[] }

const COMMERCIAL: AppRole[] = ["manager", "ops_admin", "unit_manager", "sales"];
const FINANCE: AppRole[] = ["manager", "ops_admin", "unit_manager", "finance", "sales"];

/** Aplicativos do HP Group Hub. Cada um tem sidebar própria e uma cor de identidade (usada no ícone, no item ativo e nos destaques daquele app).
 *  Papéis só controlam o que aparece no seletor; a autorização real continua no banco (RLS e funções). */
export const APPS: HpApp[] = [
  { id: "hub", label: "Início (Hub)", description: "Visão geral da operação", to: "/admin", icon: Grid2x2, accent: "212 58% 28%" },
  { id: "adm", label: "Administrativo", description: "Cadastro central e pendências", to: "/admin/adm", icon: Table2, accent: "197 72% 30%", roles: COMMERCIAL },
  { id: "crm", label: "CRM", description: "Leads, funil e metas", to: "/admin/crm", icon: KanbanSquare, accent: "228 52% 44%", roles: COMMERCIAL },
  { id: "fin", label: "Financeiro", description: "Vendas, caixa, DRE e recorrência", to: "/admin/financeiro", icon: Wallet, accent: "158 62% 28%", roles: FINANCE },
  { id: "agenda", label: "Agenda", description: "Atendimentos e pacotes", to: "/admin/agenda", icon: CalendarDays, accent: "28 78% 38%", roles: [...COMMERCIAL, "physio"] },
  { id: "academy", label: "Academy", description: "Cursos e mentoria", to: "/admin/academy", icon: GraduationCap, accent: "262 38% 44%", roles: ["manager", "ops_admin", "teacher"] },
  { id: "parceiros", label: "Parceiros", description: "Indicações e repasses", to: "/admin/parceiros", icon: Handshake, accent: "338 48% 40%", roles: FINANCE },
  { id: "captacao", label: "Captação de leads", description: "Quizzes e páginas", to: "/admin/captacao-leads", icon: MessageCircleQuestion, accent: "184 58% 30%", roles: COMMERCIAL },
];

export const appById = (id: AppId): HpApp => APPS.find((a) => a.id === id) ?? APPS[0];
