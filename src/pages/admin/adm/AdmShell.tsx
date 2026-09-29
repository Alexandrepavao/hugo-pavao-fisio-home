import type { ReactNode } from "react";
import { Grid2x2, GraduationCap, Handshake, KanbanSquare, MessageCircleQuestion, Wallet } from "lucide-react";
import ContextualAppShell, { type AppLink } from "@/components/hp/ContextualAppShell";
import { ADM_NAV } from "./admNav";

const OTHER_APPS: AppLink[] = [
  { to: "/admin", label: "Início (Hub)", icon: Grid2x2 },
  { to: "/admin/crm", label: "CRM", icon: KanbanSquare },
  { to: "/admin/financeiro", label: "Financeiro", icon: Wallet },
  { to: "/admin/academy", label: "Academy", icon: GraduationCap },
  { to: "/admin/parceiros", label: "Parceiros", icon: Handshake },
  { to: "/admin/captacao-leads", label: "Captação de leads", icon: MessageCircleQuestion },
];

const AdmShell = ({ children }: { children: ReactNode }) => (
  <ContextualAppShell appId="adm" appLabel="ADM" nav={ADM_NAV} managerRoles={["manager", "ops_admin"]} otherApps={OTHER_APPS}>
    {children}
  </ContextualAppShell>
);

export default AdmShell;
