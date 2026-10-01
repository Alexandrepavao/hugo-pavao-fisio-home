import { useMemo, type ReactNode } from "react";
import { Link } from "react-router-dom";
import { HeartPulse } from "lucide-react";
import { useAuth } from "@/auth/AuthProvider";
import { DropdownMenuItem } from "@/components/ui/dropdown-menu";
import AppFrame, { type FrameNavSection } from "./AppFrame";
import { NAV } from "./nav";

/** "Área do paciente" é o acompanhamento clínico (papel "member") — nada a ver com o Academy, que continua com "alunos".
 *  Só aparece para quem de fato tem o papel de paciente (mesmo critério já usado no PortalShell), então nunca leva
 *  a um "Sem permissão" nem precisa mostrar dado de outra pessoa como demonstração. */
const SidebarFoot = () => {
  const { hasRole } = useAuth();
  if (!hasRole("member")) return null;
  return (
    <div className="hp-sb-foot">
      <Link to="/paciente" className="hp-sb-link"><HeartPulse aria-hidden /><span className="hp-sb-text">Área do paciente</span></Link>
    </div>
  );
};

/** Shell do Hub e das telas gerais (Pessoas, Agenda, Academy, Parceiros…): sidebar geral do Hub. Financeiro, CRM e Administrativo têm shell próprio. */
const AppShell = ({ children }: { children: ReactNode }) => {
  const { hasRole } = useAuth();
  const nav = useMemo<FrameNavSection[]>(() => NAV.map((s) => ({ label: s.label, items: s.items.map(({ to, label, icon, end, roles, feature }) => ({ to, label, icon, end, roles, feature })) })), []);
  return (
    <AppFrame appId="hub" nav={nav} footer={<SidebarFoot />}
      profileExtra={<><DropdownMenuItem asChild><Link to="/academy">Academy</Link></DropdownMenuItem>{hasRole("member") && <DropdownMenuItem asChild><Link to="/paciente">Área do paciente</Link></DropdownMenuItem>}</>}>
      {children}
    </AppFrame>
  );
};

export default AppShell;
