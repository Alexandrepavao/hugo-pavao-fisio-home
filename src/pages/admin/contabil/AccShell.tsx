import type { ReactNode } from "react";
import { Grid2x2, GraduationCap, Handshake, KanbanSquare, MessageCircleQuestion, Table2, Wallet } from "lucide-react";
import ContextualAppShell, { type AppLink } from "@/components/hp/ContextualAppShell";
import { ACC_NAV } from "./accNav";
import { AccScopeProvider } from "./accShared";

const OTHER_APPS: AppLink[] = [
  { to: "/admin", label: "Início (Hub)", icon: Grid2x2 },
  { to: "/admin/adm", label: "ADM", icon: Table2 },
  { to: "/admin/crm", label: "CRM", icon: KanbanSquare },
  { to: "/admin/financeiro", label: "Financeiro", icon: Wallet },
  { to: "/admin/academy", label: "Academy", icon: GraduationCap },
  { to: "/admin/parceiros", label: "Parceiros", icon: Handshake },
  { to: "/admin/captacao-leads", label: "Captação de leads", icon: MessageCircleQuestion },
];

/** Shell do app Contábil: reaproveita o ContextualAppShell (sidebar exclusiva, seletor de apps, retorno ao Hub) e
 *  injeta o escopo organização → unidade → competência para todas as telas. */
const AccShell = ({ children }: { children: ReactNode }) => (
  <ContextualAppShell appId="contabil" appLabel="Contábil" nav={ACC_NAV} managerRoles={["manager", "ops_admin"]} otherApps={OTHER_APPS}>
    <AccScopeProvider>{children}</AccScopeProvider>
  </ContextualAppShell>
);
export default AccShell;
