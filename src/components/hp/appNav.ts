import { BarChart3, Building, Building2, CalendarDays, ClipboardCheck, ClipboardList, CreditCard, FileBarChart2, FileSignature, FileText, GraduationCap, Handshake, HeartPulse, Landmark, LayoutDashboard, ListChecks, MessageCircleQuestion, Package, Percent, Receipt, Repeat, ScrollText, Settings, ShieldCheck, ShoppingCart, Sunrise, Table2, TrendingUp, Users } from "lucide-react";
import type { AppRole } from "@/auth/AuthProvider";
import type { FrameNavSection } from "./AppFrame";
import { APPS, type AppId } from "./apps";
import { CRM_NAV } from "@/pages/admin/crm/crmNav";

// Cada aplicativo mostra SÓ a própria navegação. Só entram rotas e telas que existem de verdade (sem link para o que ainda não foi feito).
// `roles` só organiza o menu; a autorização real é da rota, do RLS e das funções do banco.
const PEOPLE: AppRole[] = ["manager", "ops_admin", "unit_manager", "sales"];
const FINANCE: AppRole[] = ["manager", "ops_admin", "unit_manager", "finance", "sales"];
const ADMINS: AppRole[] = ["manager", "ops_admin"];

export const GESTAO_NAV: FrameNavSection[] = [
  { label: "Principal", items: [
    { to: "/admin/adm", label: "Dashboard", icon: LayoutDashboard, end: true, keywords: "indicadores cadastro painel gestão administrativo" },
    { to: "/admin/adm/pendencias", label: "Pendências", icon: ClipboardList, end: true, keywords: "pendências documentos contatos requisitos" },
    { to: "/admin/adm/pendencias?aba=contratos", label: "Contratos", icon: FileSignature, keywords: "contratos assinatura vencimento" },
  ] },
  { label: "Cadastro", items: [
    { to: "/admin/adm/diretorio", label: "Planilha administrativa", icon: Table2, keywords: "pessoa física jurídica empresas planilha" },
    { to: "/admin/pessoas", label: "Pessoas", icon: Users, roles: PEOPLE, keywords: "pacientes leads contatos" },
  ] },
  { label: "Organização", items: [
    { to: "/admin/configuracoes?secao=org", label: "Unidades", icon: Building, roles: ADMINS, keywords: "unidades filiais cidade" },
    { to: "/admin/equipe", label: "Equipe e acessos", icon: ShieldCheck, roles: ADMINS, keywords: "convites papéis usuários" },
    { to: "/admin/configuracoes?secao=operacao", label: "Produtos e serviços", icon: Package, roles: ADMINS, keywords: "serviços produtos pacotes preços" },
    { to: "/admin/configuracoes", label: "Configurações", icon: Settings, roles: ADMINS, end: true, keywords: "parâmetros whatsapp captação financeiro" },
  ] },
  { label: "Controle", items: [
    { to: "/admin/auditoria", label: "Auditoria", icon: ScrollText, roles: ["manager"], keywords: "log histórico" },
    { to: "/admin/status", label: "Estado dos módulos", icon: ListChecks, roles: ADMINS, feature: "system_status" },
  ] },
];

export const FIN_NAV: FrameNavSection[] = [
  { label: "Visão", items: [
    { to: "/admin/financeiro", label: "Visão geral", icon: LayoutDashboard, end: true, keywords: "dashboard financeiro" },
    { to: "/admin/financeiro/relatorios", label: "Relatórios", icon: BarChart3, keywords: "eficiência exportações" },
  ] },
  { label: "Movimento", items: [
    { to: "/admin/financeiro/vendas?aba=vendas", label: "Vendas", icon: ShoppingCart, keywords: "vendas contratos" },
    { to: "/admin/financeiro/vendas?aba=recebiveis", label: "Contas a receber", icon: Receipt, keywords: "recebíveis recebimentos transações estornos" },
    { to: "/admin/financeiro/pagar", label: "Contas a pagar", icon: Receipt, keywords: "despesas fornecedores" },
    { to: "/admin/financeiro/cartoes", label: "Cartões", icon: CreditCard, keywords: "cartão corporativo fatura limite compras" },
    { to: "/admin/financeiro/fluxo-caixa", label: "Fluxo de caixa", icon: TrendingUp, keywords: "caixa projeção" },
    { to: "/admin/financeiro/conciliacao", label: "Conciliação", icon: Landmark, keywords: "extrato banco fatura" },
  ] },
  { label: "Resultados", items: [
    { to: "/admin/financeiro/recorrencia", label: "Recorrência", icon: Repeat, keywords: "mrr arr projeções mensalidades" },
    { to: "/admin/financeiro/dre", label: "DRE", icon: FileBarChart2, keywords: "resultado competência" },
    { to: "/admin/financeiro/comissoes", label: "Comissões e repasses", icon: Percent, keywords: "comissões repasses" },
  ] },
  { label: "Administração", items: [
    { to: "/admin/contas-corporativas", label: "Contas corporativas", icon: Building2, roles: ["manager", "ops_admin", "unit_manager", "finance"], keywords: "empresas convênio corporativo" },
    { to: "/admin/financeiro/config", label: "Configurações", icon: Settings, keywords: "contas categorias dre centros de custo" },
  ] },
];

export const PAGES_NAV: FrameNavSection[] = [
  { label: "Conteúdo", items: [
    { to: "/admin/paginas", label: "Páginas", icon: FileText, roles: PEOPLE, keywords: "landing formulários site templates editor" },
  ] },
  { label: "Captação", items: [
    { to: "/admin/captacao-leads", label: "Captação de leads", icon: MessageCircleQuestion, roles: PEOPLE, keywords: "quiz avaliação parceria whatsapp resultados indicadores" },
    { to: "/admin/pesquisas", label: "Pesquisas", icon: ClipboardCheck, roles: ADMINS, keywords: "perguntas respostas satisfação nps" },
  ] },
];

export const OPERACAO_NAV: FrameNavSection[] = [
  { label: "Atendimento", items: [
    { to: "/admin/agenda", label: "Agenda", icon: CalendarDays, keywords: "atendimentos horários pacotes sessões lista de espera" },
    { to: "/admin/acompanhamento", label: "Acompanhamento", icon: HeartPulse, roles: ["manager", "ops_admin", "unit_manager", "physio"], keywords: "pacientes vínculo conteúdos jornada" },
  ] },
];

export const ACADEMY_NAV: FrameNavSection[] = [
  { label: "Administração", items: [
    { to: "/admin/academy", label: "Cursos e alunos", icon: GraduationCap, keywords: "cursos módulos aulas turmas matrículas comunidade progresso" },
  ] },
];

export const PARCEIROS_NAV: FrameNavSection[] = [
  { label: "Rede", items: [
    { to: "/admin/parceiros", label: "Parceiros", icon: Handshake, keywords: "indicações encaminhamentos repasses" },
  ] },
];

export const PRODUTIVIDADE_NAV: FrameNavSection[] = [
  { label: "Pessoal", items: [
    { to: "/admin/meu-dia", label: "Meu dia", icon: Sunrise, keywords: "tarefas calendário agenda foco google" },
    { to: "/admin/meu-resumo", label: "Meu resumo", icon: BarChart3, roles: ["physio", "manager", "ops_admin", "unit_manager"], keywords: "atendimentos realizados faltas cancelamentos pacientes atendidos repasses desempenho" },
  ] },
];

const STATIC_NAV: Record<Exclude<AppId, "hub">, FrameNavSection[]> = {
  gestao: GESTAO_NAV, fin: FIN_NAV, crm: CRM_NAV, pages: PAGES_NAV, operacao: OPERACAO_NAV, academy: ACADEMY_NAV, parceiros: PARCEIROS_NAV, produtividade: PRODUTIVIDADE_NAV,
};

/** Navegação do Hub: o início e os aplicativos (o menu de cada app só aparece depois de entrar nele). */
export const HUB_NAV: FrameNavSection[] = [
  { items: [{ to: "/admin", label: "Início", icon: LayoutDashboard, end: true, keywords: "dashboard indicadores painel hub" }] },
  { label: "Aplicativos", items: APPS.filter((a) => a.id !== "hub").map((a) => ({ to: a.to, label: a.label, icon: a.icon, roles: a.roles, keywords: a.description })) },
];

export const navForApp = (id: AppId): FrameNavSection[] => (id === "hub" ? HUB_NAV : STATIC_NAV[id]);
