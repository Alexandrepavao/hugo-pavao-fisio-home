import { Navigate } from "react-router-dom";
import { useAuth } from "@/auth/AuthProvider";
import Dashboard from "./Dashboard";
import Overview from "./Overview";

/** Gestores veem o dashboard consolidado; demais perfis veem o estado dos módulos e seus atalhos. */
const AdminHome = () => {
  const { hasRole } = useAuth();
  // contador(a) sem outro papel de equipe: a "casa" é o app Contábil (não há dashboard geral para ele)
  if (hasRole("accountant") && !hasRole("manager", "ops_admin", "unit_manager", "finance", "sales", "physio", "teacher")) return <Navigate to="/admin/contabil" replace />;
  return hasRole("manager", "ops_admin", "unit_manager") ? <Dashboard /> : <Overview />;
};
export default AdminHome;
