import type { ReactNode } from "react";
import { NavLink } from "react-router-dom";
import Logo from "@/components/Logo";
import { useAuth } from "@/auth/AuthProvider";

const PortalShell = ({ title, children }: { title: string; children: ReactNode }) => {
  const { user, hasRole, signOut } = useAuth();
  const link = ({ isActive }: { isActive: boolean }) => `px-3 py-2 text-sm ${isActive ? "text-navy-900 border-b-2 border-primary" : "text-navy-400"}`;
  return (
    <div className="min-h-screen bg-background">
      <header className="border-b border-border bg-card">
        <div className="container-hp flex flex-wrap items-center justify-between gap-3 px-6 py-3">
          <Logo className="h-11" />
          <nav aria-label="Áreas" className="flex items-center">
            <NavLink to="/academy" className={link}>Academy</NavLink>
            {hasRole("member") && <NavLink to="/paciente" className={link}>Meu acompanhamento</NavLink>}
            {hasRole("partner") && <NavLink to="/parceiro" className={link}>Parceiro</NavLink>}
            {hasRole("manager", "ops_admin", "unit_manager", "sales", "finance", "physio", "teacher") && <NavLink to="/admin" className={link}>Painel</NavLink>}
          </nav>
          <div className="text-xs text-navy-400 flex items-center gap-3"><span className="hidden sm:inline">{user?.email}</span><button onClick={() => void signOut()} className="text-accent">Sair</button></div>
        </div>
      </header>
      <main className="container-hp px-6 py-8"><p className="eyebrow mb-2">HP Group</p><h1 className="text-3xl text-navy-900 mb-6">{title}</h1>{children}</main>
    </div>
  );
};
export default PortalShell;
