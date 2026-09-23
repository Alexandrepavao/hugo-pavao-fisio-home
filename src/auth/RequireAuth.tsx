import type { ReactNode } from "react";
import { Navigate, useLocation } from "react-router-dom";
import { useAuth, type AppRole } from "./AuthProvider";

/** Guarda de rota de interface. A proteção real de dados é feita por RLS no banco. */
const RequireAuth = ({ children, roles }: { children: ReactNode; roles?: AppRole[] }) => {
  const { loading, session, noAccess, hasRole } = useAuth();
  const location = useLocation();

  if (loading) return <div className="min-h-screen flex items-center justify-center text-navy-400" role="status">Carregando…</div>;
  if (!session) return <Navigate to="/login" replace state={{ from: location.pathname }} />;
  if (noAccess)
    return (
      <div className="min-h-screen flex items-center justify-center px-6 text-center">
        <div className="max-w-md">
          <h1 className="text-2xl text-navy-900 mb-3">Acesso não liberado</h1>
          <p className="text-navy-400">Sua conta ainda não possui permissões. Peça um convite ao responsável do HP Group.</p>
        </div>
      </div>
    );
  if (roles && !hasRole(...roles))
    return (
      <div className="min-h-[60vh] flex items-center justify-center px-6 text-center" role="alert">
        <div><h2 className="text-2xl text-navy-900 mb-2">Sem permissão</h2><p className="text-navy-400">Seu perfil não tem acesso a esta área.</p></div>
      </div>
    );
  return <>{children}</>;
};

export default RequireAuth;
