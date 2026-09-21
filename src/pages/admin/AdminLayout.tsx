import { useState } from "react";
import { NavLink, Outlet } from "react-router-dom";
import { CalendarDays, FileText, GraduationCap, Handshake, HeartPulse, KanbanSquare, LayoutDashboard, LogOut, Menu, ScrollText, ShieldCheck, Users, Wallet, X } from "lucide-react";
import Logo from "@/components/Logo";
import { useAuth, type AppRole } from "@/auth/AuthProvider";

interface NavItem { to: string; label: string; icon: typeof Users; roles?: AppRole[]; end?: boolean }

const NAV: NavItem[] = [
  { to: "/admin", label: "Início", icon: LayoutDashboard, end: true },
  { to: "/admin/pessoas", label: "Pessoas", icon: Users, roles: ["manager", "ops_admin", "unit_manager", "sales"] },
  { to: "/admin/crm", label: "CRM", icon: KanbanSquare, roles: ["manager", "ops_admin", "unit_manager", "sales"] },
  { to: "/admin/paginas", label: "Páginas", icon: FileText, roles: ["manager", "ops_admin", "unit_manager", "sales"] },
  { to: "/admin/agenda", label: "Agenda", icon: CalendarDays, roles: ["manager", "ops_admin", "unit_manager", "sales", "physio"] },
  { to: "/admin/financeiro", label: "Financeiro", icon: Wallet, roles: ["manager", "ops_admin", "unit_manager", "finance", "sales"] },
  { to: "/admin/academy", label: "Academy", icon: GraduationCap, roles: ["manager", "ops_admin", "teacher"] },
  { to: "/admin/acompanhamento", label: "Acompanhamento", icon: HeartPulse, roles: ["manager", "ops_admin", "unit_manager", "physio"] },
  { to: "/admin/parceiros", label: "Parceiros", icon: Handshake, roles: ["manager", "ops_admin", "unit_manager", "finance", "sales"] },
  { to: "/admin/equipe", label: "Equipe e acessos", icon: ShieldCheck, roles: ["manager", "ops_admin"] },
  { to: "/admin/status", label: "Estado dos módulos", icon: LayoutDashboard, roles: ["manager", "ops_admin"] },
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
          className={({ isActive }) => `flex items-center gap-3 px-4 py-2.5 text-[15px] transition-colors ${isActive ? "bg-primary text-primary-foreground" : "text-navy-700 hover:bg-muted"}`}>
          <Icon className="w-4 h-4" aria-hidden /> {label}
        </NavLink>
      ))}
      <NavLink to="/academy" className="flex items-center gap-3 px-4 py-2.5 text-[15px] text-navy-700 hover:bg-muted"><GraduationCap className="w-4 h-4" aria-hidden /> Área do aluno</NavLink>
    </nav>
  );

  return (
    <div className="min-h-screen bg-background lg:grid lg:grid-cols-[16rem_1fr]">
      <aside className="hidden lg:flex flex-col border-r border-border bg-card p-4 gap-6 sticky top-0 h-screen overflow-y-auto">
        <Logo className="h-12" />
        {links}
        <div className="mt-auto text-xs text-navy-400 space-y-2">
          <p className="break-all">{user?.email}</p><p>{roleNames}</p>
          <button onClick={() => void signOut()} className="flex items-center gap-2 text-accent hover:text-navy-900"><LogOut className="w-4 h-4" aria-hidden /> Sair</button>
        </div>
      </aside>
      <div className="flex flex-col min-w-0">
        <header className="lg:hidden flex items-center justify-between border-b border-border bg-card px-4 py-3">
          <Logo className="h-10" />
          <button onClick={() => setOpen(!open)} aria-label={open ? "Fechar menu" : "Abrir menu"} aria-expanded={open} className="p-2 text-navy-900">{open ? <X className="w-6 h-6" /> : <Menu className="w-6 h-6" />}</button>
        </header>
        {open && <div className="lg:hidden border-b border-border bg-card p-4 space-y-4">{links}<button onClick={() => void signOut()} className="flex items-center gap-2 text-accent"><LogOut className="w-4 h-4" aria-hidden /> Sair</button></div>}
        <main className="flex-1 p-6 sm:p-8 w-full max-w-7xl"><Outlet /></main>
      </div>
    </div>
  );
};

export default AdminLayout;
