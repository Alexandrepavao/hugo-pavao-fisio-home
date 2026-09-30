import { useEffect, useMemo, useState, type ReactNode } from "react";
import { Link, NavLink, useLocation } from "react-router-dom";
import { LayoutDashboard, type LucideIcon } from "lucide-react";
import logo from "@/assets/hp-logo.png";
import { useAuth, type AppRole } from "@/auth/AuthProvider";
import { Sheet, SheetContent, SheetDescription, SheetTitle } from "@/components/ui/sheet";
import { DropdownMenuItem } from "@/components/ui/dropdown-menu";
import CommandMenu from "./CommandMenu";
import { useAppTheme } from "./AppShell";
import HeaderBar from "./HeaderBar";

export interface ContextualNavItem { to: string; label: string; icon: LucideIcon; end?: boolean; managerOnly?: boolean }
export interface ContextualNavSection { label: string; items: ContextualNavItem[] }
export interface AppLink { to: string; label: string; icon: LucideIcon }

const STORAGE_PREFIX = "hp-app-sidebar-collapsed-";

/** Shell genérico reaproveitado por cada app com navegação contextual (CRM, ADM, e os apps seguintes: Contábil,
 *  Marketing, Jurídico, RH) — sidebar exclusiva do app (nunca a geral do Hub junto), "Voltar ao Hub" e "Trocar
 *  de app". Mesmas classes CSS do AppShell geral (hp-shell/hp-sidebar/...), só a navegação muda por app. */
const ContextualAppShell = ({ appId, appLabel, nav, managerRoles, otherApps, children }: {
  appId: string; appLabel: string; nav: ContextualNavSection[]; managerRoles: AppRole[]; otherApps: AppLink[]; children: ReactNode;
}) => {
  useAppTheme();
  const { hasRole } = useAuth();
  const location = useLocation();
  const storageKey = STORAGE_PREFIX + appId;
  const readCollapsed = () => { try { return localStorage.getItem(storageKey) === "1"; } catch { return false; } };
  const [collapsed, setCollapsed] = useState(readCollapsed);
  const [drawer, setDrawer] = useState(false);
  const [cmd, setCmd] = useState(false);
  const isManagerLike = hasRole(...managerRoles);

  useEffect(() => { try { localStorage.setItem(storageKey, collapsed ? "1" : "0"); } catch { /* sem storage */ } }, [collapsed, storageKey]);
  useEffect(() => { setDrawer(false); }, [location.pathname]);
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => { if ((e.ctrlKey || e.metaKey) && e.key.toLowerCase() === "k") { e.preventDefault(); setCmd((v) => !v); } };
    window.addEventListener("keydown", onKey); return () => window.removeEventListener("keydown", onKey);
  }, []);

  const sections = useMemo(() => nav.map((s) => ({ ...s, items: s.items.filter((i) => !i.managerOnly || isManagerLike) })).filter((s) => s.items.length), [nav, isManagerLike]);
  const flatItems = useMemo(() => nav.flatMap((s) => s.items), [nav]);
  const activeItem = useMemo(() => flatItems.find((i) => (i.end ? location.pathname === i.to : location.pathname === i.to || location.pathname.startsWith(i.to + "/"))) ?? flatItems[0], [flatItems, location.pathname]);
  const title = `${appLabel} · ${activeItem?.label ?? ""}`;

  const SidebarNav = ({ collapsedNow, onNavigate }: { collapsedNow: boolean; onNavigate?: () => void }) => (
    <nav aria-label={`Navegação do ${appLabel}`} className="hp-sb-nav">
      {sections.map((s, si) => (
        <div key={si} className="hp-sb-group">
          <p className="hp-sb-group-label">{s.label}</p>
          {s.items.map((i) => (
            <NavLink key={i.to} to={i.to} end={i.end} onClick={onNavigate} title={collapsedNow ? i.label : undefined} aria-label={collapsedNow ? i.label : undefined} className="hp-sb-link">
              <i.icon aria-hidden /><span className="hp-sb-text">{i.label}</span>
            </NavLink>
          ))}
        </div>
      ))}
    </nav>
  );

  return (
    <div className="hp-shell">
      <a href="#conteudo" className="sr-only focus:not-sr-only focus:fixed focus:top-2 focus:left-2 focus:z-50 focus:bg-card focus:px-3 focus:py-2 focus:rounded">Ir para o conteúdo</a>
      <aside className="hp-sidebar hp-sidebar-desktop" data-collapsed={collapsed} aria-label={`Barra lateral do ${appLabel}`}>
        <div className="hp-sb-brand" style={{ justifyContent: collapsed ? "center" : "flex-start" }}>
          <Link to={flatItems[0]?.to ?? "/admin"} aria-label={`${appLabel} — início`}><img src={logo} alt="HP Fisioterapia" style={collapsed ? { height: "1.5rem" } : undefined} /></Link>
          {!collapsed && <span className="ml-2 text-xs font-semibold tracking-wide text-muted-foreground uppercase">{appLabel}</span>}
        </div>
        <div className="px-2 pt-2">
          <Link to="/admin" className="hp-sb-link" title={collapsed ? "Voltar ao Hub" : undefined} aria-label="Voltar ao Hub">
            <LayoutDashboard aria-hidden /><span className="hp-sb-text">Voltar ao Hub</span>
          </Link>
        </div>
        <SidebarNav collapsedNow={collapsed} />
      </aside>

      <Sheet open={drawer} onOpenChange={setDrawer}>
        <SheetContent side="left" className="hp-menu-mobile p-0 w-72 border-0" style={{ background: "hsl(var(--sb-bg))", color: "hsl(var(--sb-fg))" }}>
          <SheetTitle className="sr-only">{`Menu do ${appLabel}`}</SheetTitle><SheetDescription className="sr-only">{`Navegação do ${appLabel}`}</SheetDescription>
          <div className="hp-sb-brand"><Link to={flatItems[0]?.to ?? "/admin"} aria-label={`${appLabel} — início`}><img src={logo} alt="HP Fisioterapia" /></Link><span className="ml-2 text-xs font-semibold tracking-wide text-muted-foreground uppercase">{appLabel}</span></div>
          <div className="px-2 pt-2"><Link to="/admin" className="hp-sb-link" onClick={() => setDrawer(false)}><LayoutDashboard aria-hidden /><span className="hp-sb-text">Voltar ao Hub</span></Link></div>
          <SidebarNav collapsedNow={false} onNavigate={() => setDrawer(false)} />
        </SheetContent>
      </Sheet>

      <div className="hp-main">
        <HeaderBar title={title} collapsed={collapsed} onToggleCollapsed={() => setCollapsed((v) => !v)} drawerOpen={drawer} onOpenDrawer={() => setDrawer(true)} onSearch={() => setCmd(true)}
          homeTo={flatItems[0]?.to ?? "/admin"} otherApps={otherApps} profileExtra={<DropdownMenuItem asChild><Link to="/admin">Voltar ao Hub</Link></DropdownMenuItem>} />
        <main id="conteudo" className="hp-content" tabIndex={-1} aria-labelledby="titulo-secao">{children}</main>
      </div>
      <CommandMenu open={cmd} onOpenChange={setCmd} />
    </div>
  );
};

export default ContextualAppShell;
