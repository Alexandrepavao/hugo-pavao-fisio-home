import { useEffect, useMemo, useState, type ReactNode } from "react";
import { Link, NavLink, useLocation } from "react-router-dom";
import { ChevronsLeft, ChevronsRight, GraduationCap, LogOut, Menu, Search } from "lucide-react";
import logo from "@/assets/hp-logo.png";
import { useAuth } from "@/auth/AuthProvider";
import { Sheet, SheetContent, SheetDescription, SheetTitle } from "@/components/ui/sheet";
import { DropdownMenu, DropdownMenuContent, DropdownMenuItem, DropdownMenuLabel, DropdownMenuSeparator, DropdownMenuTrigger } from "@/components/ui/dropdown-menu";
import CommandMenu from "./CommandMenu";
import { NAV, ROLE_LABEL, type NavItem } from "./nav";

/** Aplica o escopo visual da área logada no <html> (portais do Radix renderizam fora do container). */
export const useAppTheme = () => {
  useEffect(() => {
    document.documentElement.classList.add("hp-app");
    return () => document.documentElement.classList.remove("hp-app");
  }, []);
};

const STORAGE_KEY = "hp-sidebar-collapsed";
const readCollapsed = () => { try { return localStorage.getItem(STORAGE_KEY) === "1"; } catch { return false; } };

const SidebarNav = ({ collapsed, onNavigate }: { collapsed: boolean; onNavigate?: () => void }) => {
  const { hasRole } = useAuth();
  const sections = useMemo(() => NAV.map((s) => ({ ...s, items: s.items.filter((i) => !i.roles || hasRole(...i.roles)) })).filter((s) => s.items.length), [hasRole]);
  return (
    <nav aria-label="Navegação principal" className="hp-sb-nav">
      {sections.map((s, si) => (
        <div key={si} className="hp-sb-group">
          {s.label && <p className="hp-sb-group-label">{s.label}</p>}
          {s.items.map((i: NavItem) => (
            <NavLink key={i.to} to={i.to} end={i.end} onClick={onNavigate} title={collapsed ? i.label : undefined} aria-label={collapsed ? i.label : undefined} className="hp-sb-link">
              <i.icon aria-hidden /><span className="hp-sb-text">{i.label}</span>
            </NavLink>
          ))}
        </div>
      ))}
    </nav>
  );
};

const SidebarFoot = ({ collapsed }: { collapsed: boolean }) => (
  <div className="hp-sb-foot">
    <Link to="/academy" className="hp-sb-link" title={collapsed ? "Área do aluno" : undefined}><GraduationCap aria-hidden /><span className="hp-sb-text">Área do aluno</span></Link>
  </div>
);

const AppShell = ({ children }: { children: ReactNode }) => {
  useAppTheme();
  const { user, roles, signOut } = useAuth();
  const location = useLocation();
  const [collapsed, setCollapsed] = useState(readCollapsed);
  const [drawer, setDrawer] = useState(false);
  const [cmd, setCmd] = useState(false);

  useEffect(() => { try { localStorage.setItem(STORAGE_KEY, collapsed ? "1" : "0"); } catch { /* sem storage */ } }, [collapsed]);
  useEffect(() => { setDrawer(false); }, [location.pathname]);
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => { if ((e.ctrlKey || e.metaKey) && e.key.toLowerCase() === "k") { e.preventDefault(); setCmd((v) => !v); } };
    window.addEventListener("keydown", onKey); return () => window.removeEventListener("keydown", onKey);
  }, []);

  const title = useMemo(() => {
    const items = NAV.flatMap((s) => s.items);
    return (items.find((i) => (i.end ? location.pathname === i.to : location.pathname === i.to || location.pathname.startsWith(i.to + "/"))) ?? items[0]).label;
  }, [location.pathname]);
  const roleNames = [...new Set(roles.map((r) => ROLE_LABEL[r.role]))].join(", ");
  const initials = (user?.email ?? "?").slice(0, 2).toUpperCase();

  return (
    <div className="hp-shell">
      <a href="#conteudo" className="sr-only focus:not-sr-only focus:fixed focus:top-2 focus:left-2 focus:z-50 focus:bg-card focus:px-3 focus:py-2 focus:rounded">Ir para o conteúdo</a>
      <aside className="hp-sidebar hp-sidebar-desktop" data-collapsed={collapsed} aria-label="Barra lateral">
        <div className="hp-sb-brand" style={{ justifyContent: collapsed ? "center" : "flex-start" }}>
          <Link to="/admin" aria-label="HP — início do painel"><img src={logo} alt="HP Fisioterapia" style={collapsed ? { height: "1.5rem" } : undefined} /></Link>
        </div>
        <SidebarNav collapsed={collapsed} />
        <SidebarFoot collapsed={collapsed} />
      </aside>

      <Sheet open={drawer} onOpenChange={setDrawer}>
        <SheetContent side="left" className="hp-menu-mobile p-0 w-72 border-0" style={{ background: "hsl(var(--sb-bg))", color: "hsl(var(--sb-fg))" }}>
          <SheetTitle className="sr-only">Menu</SheetTitle><SheetDescription className="sr-only">Navegação do painel</SheetDescription>
          <div className="hp-sb-brand"><a href="/admin" aria-label="HP — início do painel"><img src={logo} alt="HP Fisioterapia" /></a></div>
          <SidebarNav collapsed={false} onNavigate={() => setDrawer(false)} />
          <SidebarFoot collapsed={false} />
        </SheetContent>
      </Sheet>

      <div className="hp-main">
        <header className="hp-header">
          <button className="hp-btn hp-btn-ghost hp-menu-mobile" style={{ width: "2.25rem", padding: 0 }} onClick={() => setDrawer(true)} aria-label="Abrir menu" aria-expanded={drawer}><Menu size={18} /></button>
          <button className="hp-btn hp-btn-ghost hp-sidebar-desktop" style={{ width: "2.25rem", padding: 0 }} onClick={() => setCollapsed((v) => !v)} aria-label={collapsed ? "Expandir menu lateral" : "Recolher menu lateral"} aria-pressed={collapsed}>
            {collapsed ? <ChevronsRight size={18} /> : <ChevronsLeft size={18} />}</button>
          <h1 className="!text-[1rem] !leading-6" style={{ margin: 0 }} id="titulo-secao">{title}</h1>
          <div style={{ flex: 1 }} />
          <button className="hp-btn hp-btn-outline hp-btn-sm" onClick={() => setCmd(true)} aria-label="Buscar (Ctrl+K)" style={{ color: "hsl(var(--muted-foreground))", minWidth: "2.25rem" }}>
            <Search size={15} /><span className="hidden md:inline">Buscar</span><kbd className="hidden md:inline text-[11px] border border-border rounded px-1 ml-1 text-muted-foreground">Ctrl K</kbd></button>
          <DropdownMenu>
            <DropdownMenuTrigger asChild>
              <button className="hp-btn hp-btn-ghost" style={{ padding: "0 .25rem", gap: ".5rem" }} aria-label="Menu do usuário">
                <span aria-hidden className="grid place-items-center rounded-full bg-primary text-primary-foreground text-xs font-semibold" style={{ width: "1.875rem", height: "1.875rem" }}>{initials}</span>
              </button>
            </DropdownMenuTrigger>
            <DropdownMenuContent align="end" className="w-64">
              <DropdownMenuLabel><span className="block text-sm font-medium break-all">{user?.email}</span><span className="block text-xs font-normal text-muted-foreground">{roleNames}</span></DropdownMenuLabel>
              <DropdownMenuSeparator />
              <DropdownMenuItem asChild><Link to="/academy">Área do aluno</Link></DropdownMenuItem>
              <DropdownMenuItem onSelect={() => void signOut()}><LogOut className="mr-2 h-4 w-4" aria-hidden />Sair</DropdownMenuItem>
            </DropdownMenuContent>
          </DropdownMenu>
        </header>
        <main id="conteudo" className="hp-content" tabIndex={-1} aria-labelledby="titulo-secao">{children}</main>
      </div>
      <CommandMenu open={cmd} onOpenChange={setCmd} />
    </div>
  );
};

export default AppShell;
