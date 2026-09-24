import { useEffect, useMemo, useState, type ReactNode } from "react";
import { Link, NavLink, useLocation } from "react-router-dom";
import { ChevronsLeft, ChevronsRight, GraduationCap, Grid2x2, Handshake, LayoutDashboard, LogOut, Menu, MessageCircleQuestion, Search, Settings, Wallet, type LucideIcon } from "lucide-react";
import logo from "@/assets/hp-logo.png";
import { useAuth } from "@/auth/AuthProvider";
import { Sheet, SheetContent, SheetDescription, SheetTitle } from "@/components/ui/sheet";
import { DropdownMenu, DropdownMenuContent, DropdownMenuItem, DropdownMenuLabel, DropdownMenuSeparator, DropdownMenuTrigger } from "@/components/ui/dropdown-menu";
import CommandMenu from "@/components/hp/CommandMenu";
import { useAppTheme } from "@/components/hp/AppShell";
import { ROLE_LABEL } from "@/components/hp/nav";
import { CRM_NAV, CRM_MANAGER_ROLES, type CrmNavItem } from "./crmNav";

const STORAGE_KEY = "hp-crm-sidebar-collapsed";
const readCollapsed = () => { try { return localStorage.getItem(STORAGE_KEY) === "1"; } catch { return false; } };

interface AppLink { to: string; label: string; icon: LucideIcon }
const OTHER_APPS: AppLink[] = [
  { to: "/admin", label: "Início (Hub)", icon: Grid2x2 },
  { to: "/admin/financeiro", label: "Financeiro", icon: Wallet },
  { to: "/admin/academy", label: "Academy", icon: GraduationCap },
  { to: "/admin/parceiros", label: "Parceiros", icon: Handshake },
  { to: "/admin/captacao-leads", label: "Captação de leads", icon: MessageCircleQuestion },
];

const CrmSidebarNav = ({ collapsed, onNavigate }: { collapsed: boolean; onNavigate?: () => void }) => {
  const { hasRole } = useAuth();
  const isManagerLike = hasRole(...CRM_MANAGER_ROLES);
  const sections = useMemo(() => CRM_NAV.map((s) => ({ ...s, items: s.items.filter((i) => !i.managerOnly || isManagerLike) })).filter((s) => s.items.length), [isManagerLike]);
  return (
    <nav aria-label="Navegação do CRM" className="hp-sb-nav">
      {sections.map((s, si) => (
        <div key={si} className="hp-sb-group">
          <p className="hp-sb-group-label">{s.label}</p>
          {s.items.map((i: CrmNavItem) => (
            <NavLink key={i.to} to={i.to} end={i.end} onClick={onNavigate} title={collapsed ? i.label : undefined} aria-label={collapsed ? i.label : undefined} className="hp-sb-link">
              <i.icon aria-hidden /><span className="hp-sb-text">{i.label}</span>
            </NavLink>
          ))}
        </div>
      ))}
    </nav>
  );
};

/** Shell exclusivo do app CRM — sidebar própria (nunca a geral do Hub), com "Voltar ao Hub" e troca de app.
 *  Estrutura e classes CSS iguais ao AppShell (mesmo tema/acabamento), só a navegação muda. */
const CrmShell = ({ children }: { children: ReactNode }) => {
  useAppTheme();
  const { user, roles, signOut, hasRole } = useAuth();
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

  const activeItem = useMemo(() => {
    const items = CRM_NAV.flatMap((s) => s.items);
    return items.find((i) => (i.end ? location.pathname === i.to : location.pathname === i.to || location.pathname.startsWith(i.to + "/"))) ?? items[0];
  }, [location.pathname]);
  const title = `CRM · ${activeItem.label}`;
  const roleNames = [...new Set(roles.map((r) => ROLE_LABEL[r.role]))].join(", ");
  const initials = (user?.email ?? "?").slice(0, 2).toUpperCase();

  return (
    <div className="hp-shell">
      <a href="#conteudo" className="sr-only focus:not-sr-only focus:fixed focus:top-2 focus:left-2 focus:z-50 focus:bg-card focus:px-3 focus:py-2 focus:rounded">Ir para o conteúdo</a>
      <aside className="hp-sidebar hp-sidebar-desktop" data-collapsed={collapsed} aria-label="Barra lateral do CRM">
        <div className="hp-sb-brand" style={{ justifyContent: collapsed ? "center" : "flex-start" }}>
          <Link to="/admin/crm" aria-label="CRM — início"><img src={logo} alt="HP Fisioterapia" style={collapsed ? { height: "1.5rem" } : undefined} /></Link>
          {!collapsed && <span className="ml-2 text-xs font-semibold tracking-wide text-muted-foreground uppercase">CRM</span>}
        </div>
        <div className="px-2 pt-2">
          <Link to="/admin" className="hp-sb-link" title={collapsed ? "Voltar ao Hub" : undefined} aria-label="Voltar ao Hub">
            <LayoutDashboard aria-hidden /><span className="hp-sb-text">Voltar ao Hub</span>
          </Link>
        </div>
        <CrmSidebarNav collapsed={collapsed} />
      </aside>

      <Sheet open={drawer} onOpenChange={setDrawer}>
        <SheetContent side="left" className="hp-menu-mobile p-0 w-72 border-0" style={{ background: "hsl(var(--sb-bg))", color: "hsl(var(--sb-fg))" }}>
          <SheetTitle className="sr-only">Menu do CRM</SheetTitle><SheetDescription className="sr-only">Navegação do CRM</SheetDescription>
          <div className="hp-sb-brand"><Link to="/admin/crm" aria-label="CRM — início"><img src={logo} alt="HP Fisioterapia" /></Link><span className="ml-2 text-xs font-semibold tracking-wide text-muted-foreground uppercase">CRM</span></div>
          <div className="px-2 pt-2"><Link to="/admin" className="hp-sb-link" onClick={() => setDrawer(false)}><LayoutDashboard aria-hidden /><span className="hp-sb-text">Voltar ao Hub</span></Link></div>
          <CrmSidebarNav collapsed={false} onNavigate={() => setDrawer(false)} />
        </SheetContent>
      </Sheet>

      <div className="hp-main">
        <header className="hp-header">
          <button className="hp-btn hp-btn-ghost hp-menu-mobile" style={{ width: "2.25rem", padding: 0 }} onClick={() => setDrawer(true)} aria-label="Abrir menu" aria-expanded={drawer}><Menu size={18} /></button>
          <button className="hp-btn hp-btn-ghost hp-sidebar-desktop" style={{ width: "2.25rem", padding: 0 }} onClick={() => setCollapsed((v) => !v)} aria-label={collapsed ? "Expandir menu lateral" : "Recolher menu lateral"} aria-pressed={collapsed}>
            {collapsed ? <ChevronsRight size={18} /> : <ChevronsLeft size={18} />}</button>
          <h1 className="!text-[1rem] !leading-6" style={{ margin: 0 }} id="titulo-secao">{title}</h1>
          <div style={{ flex: 1 }} />
          <DropdownMenu>
            <DropdownMenuTrigger asChild>
              <button className="hp-btn hp-btn-outline hp-btn-sm" aria-label="Trocar de aplicativo"><Grid2x2 size={15} /><span className="hidden md:inline">Trocar de app</span></button>
            </DropdownMenuTrigger>
            <DropdownMenuContent align="end" className="w-56">
              <DropdownMenuLabel>Aplicativos</DropdownMenuLabel>
              <DropdownMenuSeparator />
              {OTHER_APPS.map((a) => <DropdownMenuItem key={a.to} asChild><Link to={a.to}><a.icon className="mr-2 h-4 w-4" aria-hidden />{a.label}</Link></DropdownMenuItem>)}
              {hasRole(...CRM_MANAGER_ROLES) && <DropdownMenuItem asChild><Link to="/admin/configuracoes"><Settings className="mr-2 h-4 w-4" aria-hidden />Configurações</Link></DropdownMenuItem>}
            </DropdownMenuContent>
          </DropdownMenu>
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
              <DropdownMenuItem asChild><Link to="/admin">Voltar ao Hub</Link></DropdownMenuItem>
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

export default CrmShell;
