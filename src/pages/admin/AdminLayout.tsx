import { Outlet, useLocation } from "react-router-dom";
import AppShell from "@/components/hp/AppShell";
import CrmShell from "./crm/CrmShell";

/** Layout da área de gestão: sidebar geral do Hub (sidebar persistente e recolhível, header compacto, drawer
 *  no mobile), exceto dentro de /admin/crm — ali o CRM é um app próprio com sua própria sidebar exclusiva
 *  (CrmShell); a troca entre apps acontece pelo seletor no cabeçalho de cada shell, nunca misturando as duas
 *  navegações na mesma tela. */
const AdminLayout = () => {
  const location = useLocation();
  const isCrm = location.pathname === "/admin/crm" || location.pathname.startsWith("/admin/crm/");
  return isCrm ? <CrmShell><Outlet /></CrmShell> : <AppShell><Outlet /></AppShell>;
};

export default AdminLayout;
