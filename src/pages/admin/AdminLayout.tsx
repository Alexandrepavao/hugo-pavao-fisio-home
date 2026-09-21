import { useState } from "react";
import { NavLink, Outlet } from "react-router-dom";
import { LayoutDashboard, LogOut, Menu, Users, X, ScrollText, FileText } from "lucide-react";
import Logo from "@/components/Logo";
import { useAuth, type AppRole } from "@/auth/AuthProvider";

interface NavItem { to: string; label: string; icon: typeof Users; roles?: AppRole[]; end?: boolean }

// Só entram no menu módulos que já existem de verdade. O estado dos demais está em "Visão geral".
const NAV: NavItem[] = [
  { to: "/admin", label: "Visão geral", icon: LayoutDashboard, end: true },
  { to: "/admin/pessoas", label: "Pessoas", icon: Users, roles: ["manager", "ops_admin", "unit_manager", "sales"] },
  { to: "/admin/paginas", label: "Páginas", icon: FileText, roles: ["manager", "ops_admin", "unit_manager", "sales"] },
  { to: "/admin/auditoria", label: "Auditoria", icon: ScrollText, roles: ["manager"] },
];

const ROLE_LABEL: Record<AppRole, string> = {
  manager: "Gestor", ops_admin: "Administrador operacional", unit_manager: "Gestor de unidade",
  sales: "Comercial", finance: "Financeiro", physio: "Fisioterapeuta", teacher: "Professor/mentor",
  partner: "Parceiro", member: "Paciente/aluno",
};

const AdminLayout = () => {
  const { user, roles, hasRole, signOut } = useAuth();
  const [open, setOpen] = useState(false);
  const items = NAV.filter((n) => !n.roles || hasRole(...n.roles));
  const roleNames = [...new Set(roles.map((r) => ROLE_LABEL[r.role]))].join(", ");

  const links = (
    <nav aria-label="Navegação do painel" className="flex flex-col gap-1">
      {items.map(({ to, label, icon: Icon, end }) => (
        <NavLink key={to} to={to} end={end} onClick={() => setOpen(false)}
          className={({ isActive }) =>
            `flex items-center gap-3 px-4 py-3 text-[15px] transition-colors ${
              isActive ? "bg-primary text-primary-foreground" : "text-navy-700 hover:bg-muted"}`}>
          <Icon className="w-4 h-4" aria-hidden /> {label}
        </NavLink>
      ))}
    </nav>
  );

  return (
    <div className="min-h-screen bg-background lg:grid lg:grid-cols-[16rem_1fr]">
      <aside className="hidden lg:flex flex-col border-r border-border bg-card p-4 gap-6 sticky top-0 h-screen">
        <Logo className="h-12" />
        {links}
        <div className="mt-auto text-xs text-navy-400 space-y-2">
          <p className="break-all">{user?.email}</p>
          <p>{roleNames}</p>
          <button onClick={() => void signOut()} className="flex items-center gap-2 text-accent hover:text-navy-900">
            <LogOut className="w-4 h-4" aria-hidden /> Sair
          </button>
        </div>
      </aside>

      <div className="flex flex-col min-w-0">
        <header className="lg:hidden flex items-center justify-between border-b border-border bg-card px-4 py-3">
          <Logo className="h-10" />
          <button onClick={() => setOpen(!open)} aria-label={open ? "Fechar menu" : "Abrir menu"} aria-expanded={open} className="p-2 text-navy-900">
            {open ? <X className="w-6 h-6" /> : <Menu className="w-6 h-6" />}
          </button>
        </header>
        {open && (
          <div className="lg:hidden border-b border-border bg-card p-4 space-y-4">
            {links}
            <button onClick={() => void signOut()} className="flex items-center gap-2 text-accent"><LogOut className="w-4 h-4" aria-hidden /> Sair</button>
          </div>
        )}
        <main className="flex-1 p-6 sm:p-8 max-w-6xl w-full"><Outlet /></main>
      </div>
    </div>
  );
};

export default AdminLayout;
