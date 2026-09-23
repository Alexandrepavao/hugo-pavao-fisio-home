import { Navigate } from "react-router-dom";
import { useAuth } from "@/auth/AuthProvider";

/** Destino padrão após o login: leva cada perfil para a sua área. A autorização real continua no servidor. */
const Landing = () => {
  const { loading, session, noAccess, hasRole } = useAuth();
  if (loading) return <div className="min-h-screen flex items-center justify-center text-muted-foreground" role="status">Carregando…</div>;
  if (!session) return <Navigate to="/login" replace />;
  if (noAccess) return <Navigate to="/admin" replace />;         // exibe a mensagem "Acesso não liberado"
  if (hasRole("manager", "ops_admin", "unit_manager", "sales", "finance", "physio", "teacher")) return <Navigate to="/admin" replace />;
  if (hasRole("partner")) return <Navigate to="/parceiro" replace />;
  return <Navigate to="/paciente" replace />;
};
export default Landing;
