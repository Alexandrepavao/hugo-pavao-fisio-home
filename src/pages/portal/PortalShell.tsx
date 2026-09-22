import type { ReactNode } from "react";
import { Link, NavLink } from "react-router-dom";
import { LogOut } from "lucide-react";
import logo from "@/assets/hp-logo.png";
import { useAuth } from "@/auth/AuthProvider";
import { useAppTheme } from "@/components/hp/AppShell";
import { ROLE_LABEL } from "@/components/hp/nav";

/** Layout da área do aluno/paciente/parceiro: mesma identidade da gestão, navegação superior simples. */
const PortalShell = ({ title, subtitle, actions, children }: { title: string; subtitle?: string; actions?: ReactNode; children: ReactNode }) => {
  useAppTheme();
  const { user, roles, hasRole, signOut } = useAuth();
  const link = ({ isActive }: { isActive: boolean }) => `px-3 h-[3.5rem] inline-flex items-center text-sm font-medium border-b-2 ${isActive ? "border-primary text-foreground" : "border-transparent text-muted-foreground hover:text-foreground"}`;
  const isStaff = hasRole("manager", "ops_admin", "unit_manager", "sales", "finance", "physio", "teacher");
  return (
    <div className="min-h-screen" style={{ background: "hsl(var(--background))" }}>
      <a href="#conteudo" className="sr-only focus:not-sr-only focus:fixed focus:top-2 focus:left-2 focus:z-50 focus:bg-card focus:px-3 focus:py-2 focus:rounded">Ir para o conteúdo</a>
      <header className="sticky top-0 z-30 bg-card border-b border-border">
        <div className="flex items-center gap-4 px-4 sm:px-6 h-14 max-w-7xl mx-auto">
          <Link to="/" aria-label="Site HP Fisioterapia" className="inline-flex"><img src={logo} alt="HP Fisioterapia" style={{ height: "1.75rem", width: "auto" }} /></Link>
          <nav aria-label="Áreas" className="flex items-center overflow-x-auto">
            <NavLink to="/academy" className={link}>Academy</NavLink>
            {hasRole("member") && <NavLink to="/paciente" className={link}>Meu acompanhamento</NavLink>}
            {hasRole("partner") && <NavLink to="/parceiro" className={link}>Parceiro</NavLink>}
            <NavLink to="/pesquisas" className={link}>Pesquisas</NavLink>
            {isStaff && <NavLink to="/admin" className={link}>Painel</NavLink>}
          </nav>
          <div className="ml-auto flex items-center gap-3 text-xs text-muted-foreground">
            <span className="hidden sm:block text-right leading-tight"><span className="block text-foreground">{user?.email}</span>{[...new Set(roles.map((r) => ROLE_LABEL[r.role]))].join(", ")}</span>
            <button onClick={() => void signOut()} className="hp-btn hp-btn-ghost hp-btn-sm"><LogOut size={14} aria-hidden />Sair</button>
          </div>
        </div>
      </header>
      <main id="conteudo" tabIndex={-1} className="max-w-7xl mx-auto px-4 sm:px-6 py-6">
        <div className="flex flex-wrap items-start justify-between gap-3 mb-5">
          <div><h1>{title}</h1>{subtitle && <p className="text-muted-foreground text-[13px] mt-1 max-w-2xl">{subtitle}</p>}</div>{actions}
        </div>
        {children}
      </main>
    </div>
  );
};
export default PortalShell;
