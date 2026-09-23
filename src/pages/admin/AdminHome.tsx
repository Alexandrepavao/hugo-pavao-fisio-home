import { useAuth } from "@/auth/AuthProvider";
import Dashboard from "./Dashboard";
import Overview from "./Overview";

/** Gestores veem o dashboard consolidado; demais perfis veem o estado dos módulos e seus atalhos. */
const AdminHome = () => {
  const { hasRole } = useAuth();
  return hasRole("manager", "ops_admin", "unit_manager") ? <Dashboard /> : <Overview />;
};
export default AdminHome;
