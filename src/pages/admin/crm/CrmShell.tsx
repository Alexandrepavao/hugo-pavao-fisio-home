import { Link } from "react-router-dom";
import { Settings } from "lucide-react";
import type { ReactNode } from "react";
import { useAuth } from "@/auth/AuthProvider";
import { DropdownMenuItem } from "@/components/ui/dropdown-menu";
import AppFrame from "@/components/hp/AppFrame";
import { CRM_NAV, CRM_MANAGER_ROLES } from "./crmNav";

/** Shell exclusivo do app CRM — sidebar própria (nunca a geral do Hub), só com a navegação comercial. */
const CrmShell = ({ children }: { children: ReactNode }) => {
  const { hasRole } = useAuth();
  return (
    <AppFrame appId="crm" nav={CRM_NAV} managerRoles={CRM_MANAGER_ROLES}
      profileExtra={hasRole(...CRM_MANAGER_ROLES) ? <DropdownMenuItem asChild><Link to="/admin/configuracoes"><Settings className="mr-2 h-4 w-4" aria-hidden />Configurações</Link></DropdownMenuItem> : undefined}>
      {children}
    </AppFrame>
  );
};

export default CrmShell;
