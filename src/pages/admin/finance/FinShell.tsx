import type { ReactNode } from "react";
import { BarChart3, FileBarChart2, Landmark, LayoutDashboard, Percent, Receipt, Repeat, Settings, ShoppingCart, TrendingUp } from "lucide-react";
import AppFrame, { type FrameNavSection } from "@/components/hp/AppFrame";

// O Financeiro é um aplicativo próprio: a sidebar mostra só a navegação financeira (nunca CRM, Academy ou Operação).
// Quem pode abrir a rota já é decidido pela rota (e, de verdade, pelo banco); aqui só se organiza o menu.
export const FIN_NAV: FrameNavSection[] = [
  { label: "Visão", items: [
    { to: "/admin/financeiro", label: "Visão geral", icon: LayoutDashboard, end: true },
    { to: "/admin/financeiro/relatorios", label: "Relatórios", icon: BarChart3 },
  ] },
  { label: "Movimento", items: [
    { to: "/admin/financeiro/vendas", label: "Vendas", icon: ShoppingCart },
    { to: "/admin/financeiro/pagar", label: "Contas a pagar", icon: Receipt },
    { to: "/admin/financeiro/fluxo-caixa", label: "Fluxo de caixa", icon: TrendingUp },
    { to: "/admin/financeiro/conciliacao", label: "Conciliação", icon: Landmark },
  ] },
  { label: "Resultados", items: [
    { to: "/admin/financeiro/recorrencia", label: "Recorrência", icon: Repeat },
    { to: "/admin/financeiro/dre", label: "DRE", icon: FileBarChart2 },
    { to: "/admin/financeiro/comissoes", label: "Comissões e repasses", icon: Percent },
  ] },
  { label: "Administração", items: [
    { to: "/admin/financeiro/config", label: "Configurações", icon: Settings },
  ] },
];

const FinShell = ({ children }: { children: ReactNode }) => <AppFrame appId="fin" nav={FIN_NAV}>{children}</AppFrame>;

export default FinShell;
