import { Outlet, useLocation } from "react-router-dom";
import AppShell from "@/components/hp/AppShell";
import CrmShell from "./crm/CrmShell";
import AdmShell from "./adm/AdmShell";
import AccShell from "./contabil/AccShell";

/** Layout da área de gestão: sidebar geral do Hub (sidebar persistente e recolhível, header compacto, drawer
 *  no mobile), exceto dentro de /admin/crm ou /admin/adm — ali cada um é um app próprio com sua própria
 *  sidebar exclusiva; a troca entre apps acontece pelo seletor no cabeçalho de cada shell, nunca misturando
 *  duas navegações na mesma tela. Os próximos apps (Contábil, Marketing, Jurídico, RH) entram no mesmo padrão. */
const AdminLayout = () => {
  const location = useLocation();
  const under = (base: string) => location.pathname === base || location.pathname.startsWith(base + "/");
  if (under("/admin/crm")) return <CrmShell><Outlet /></CrmShell>;
  if (under("/admin/adm")) return <AdmShell><Outlet /></AdmShell>;
  if (under("/admin/contabil")) return <AccShell><Outlet /></AccShell>;
  return <AppShell><Outlet /></AppShell>;
};

export default AdminLayout;
