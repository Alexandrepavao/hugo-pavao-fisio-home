import { Navigate } from "react-router-dom";
import { useAuth } from "@/auth/AuthProvider";
import { hasSeenTour, homeFor, shouldAutoTour } from "@/lib/tour";

/** Destino padrão após o login: leva cada perfil para a sua área. A autorização real continua no servidor. */
const Landing = () => {
  const { loading, session, user, noAccess, hasRole } = useAuth();
  if (loading) return <div className="min-h-screen flex items-center justify-center text-muted-foreground" role="status">Carregando…</div>;
  if (!session) return <Navigate to="/login" replace />;
  if (noAccess) return <Navigate to="/admin" replace />;         // exibe a mensagem "Acesso não liberado"
  if (user && shouldAutoTour(hasRole) && !hasSeenTour(user.id)) return <Navigate to="/boas-vindas" replace />;   // primeiro login: tutorial do sistema
  return <Navigate to={homeFor(hasRole)} replace />;
};
export default Landing;
