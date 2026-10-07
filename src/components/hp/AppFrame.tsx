import { useEffect, useMemo, useState, type ReactNode } from "react";
import { Link, useLocation } from "react-router-dom";
import { ChevronsUpDown, LayoutDashboard, type LucideIcon } from "lucide-react";
import { useAuth, type AppRole } from "@/auth/AuthProvider";
import { Sheet, SheetContent, SheetDescription, SheetTitle } from "@/components/ui/sheet";
import { DropdownMenu, DropdownMenuContent, DropdownMenuItem, DropdownMenuLabel, DropdownMenuSeparator, DropdownMenuTrigger } from "@/components/ui/dropdown-menu";
import { featureOn, type FeatureKey } from "@/lib/release";
import CommandMenu from "./CommandMenu";
import HeaderBar, { AppTile } from "./HeaderBar";
import { APPS, appById, type AppId } from "./apps";
import { useAppTheme } from "./theme";

export interface FrameNavItem { to: string; label: string; icon: LucideIcon; end?: boolean; managerOnly?: boolean; roles?: AppRole[]; feature?: FeatureKey; keywords?: string }
export interface FrameNavSection { label?: string; items: FrameNavItem[] }

/** Moldura única dos aplicativos: cabeçalho em largura total (marca HP, aplicativo ▸ seção, busca, notificações, tema, perfil) e, abaixo, a sidebar CONTEXTUAL do
 *  aplicativo atual (nunca a de outro aplicativo) — identidade do app com seletor, “Voltar ao Hub”, grupos, item ativo em destaque, recolhimento no desktop e
 *  gaveta no celular. Cada aplicativo só passa a própria navegação. */
const AppFrame = ({ appId, nav, managerRoles = ["manager", "ops_admin", "unit_manager"], footer, profileExtra, children }: {
  appId: AppId; nav: FrameNavSection[]; managerRoles?: AppRole[]; footer?: ReactNode; profileExtra?: ReactNode; children: ReactNode;
}) => {
  useAppTheme();
  const app = appById(appId);
  const { hasRole } = useAuth();
  const location = useLocation();
  const storageKey = `hp-sb-collapsed-${appId}`;
  const [collapsed, setCollapsed] = useState(() => { try { return localStorage.getItem(storageKey) === "1"; } catch { return false; } });
  const [drawer, setDrawer] = useState(false);
  const [cmd, setCmd] = useState(false);
  const isManagerLike = hasRole(...managerRoles);

  useEffect(() => { try { localStorage.setItem(storageKey, collapsed ? "1" : "0"); } catch { /* sem storage */ } }, [collapsed, storageKey]);
  useEffect(() => { setDrawer(false); }, [location.pathname]);
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => { if ((e.ctrlKey || e.metaKey) && e.key.toLowerCase() === "k") { e.preventDefault(); setCmd((v) => !v); } };
    window.addEventListener("keydown", onKey); return () => window.removeEventListener("keydown", onKey);
  }, []);

  const visible = (i: FrameNavItem) => (!i.managerOnly || isManagerLike) && (!i.roles || hasRole(...i.roles)) && (!i.feature || featureOn(i.feature));
  const sections = useMemo(() => nav.map((s) => ({ ...s, items: s.items.filter(visible) })).filter((s) => s.items.length), [nav, isManagerLike, hasRole]); // eslint-disable-line react-hooks/exhaustive-deps
  const flatItems = useMemo(() => nav.flatMap((s) => s.items), [nav]);
  // Item ativo = o que melhor casa com a URL (caminho e, quando o item tem parâmetros, os parâmetros: ex. Unidades × Configurações em /admin/configuracoes).
  const activeItem = useMemo(() => {
    const cur = new URLSearchParams(location.search);
    const scored = flatItems.map((i) => {
      const [path, qs] = i.to.split("?");
      const pathOk = i.end ? location.pathname === path : location.pathname === path || location.pathname.startsWith(path + "/");
      if (!pathOk) return null;
      const want = qs ? [...new URLSearchParams(qs)] : [];
      const queryOk = want.every(([k, v]) => cur.get(k) === v);
      return { i, queryOk, keys: want.length, len: path.length };
    }).filter(Boolean) as { i: FrameNavItem; queryOk: boolean; keys: number; len: number }[];
    const ok = scored.filter((x) => x.queryOk);
    const pool = ok.length ? ok : scored;
    pool.sort((a, b) => b.len - a.len || b.keys - a.keys);
    return pool[0]?.i ?? flatItems[0];
  }, [flatItems, location.pathname, location.search]);
  const apps = useMemo(() => APPS.filter((a) => a.id === "hub" || !a.roles || hasRole(...a.roles)), [hasRole]);
  const isHub = appId === "hub";

  const Switcher = ({ compact, onNavigate }: { compact: boolean; onNavigate?: () => void }) => (
    <DropdownMenu>
      <DropdownMenuTrigger asChild>
        <button className="hp-sb-app" aria-label={`Aplicativo atual: ${app.label}. Abrir a lista de aplicativos`} title={compact ? app.label : undefined}>
          <AppTile app={app} size="lg" />
          {!compact && <><span className="hp-sb-app-text"><strong>{app.label}</strong><small>{app.description}</small></span><ChevronsUpDown size={15} aria-hidden /></>}
        </button>
      </DropdownMenuTrigger>
      <DropdownMenuContent align="start" className="w-64">
        <DropdownMenuLabel>Aplicativos</DropdownMenuLabel>
        <DropdownMenuSeparator />
        {apps.map((a) => <DropdownMenuItem key={a.id} asChild><Link to={a.to} onClick={onNavigate} className="gap-2.5"><AppTile app={a} size="sm" /><span className="min-w-0"><span className="block text-sm font-medium leading-4">{a.label}</span><span className="block text-[11px] text-muted-foreground truncate">{a.description}</span></span></Link></DropdownMenuItem>)}
      </DropdownMenuContent>
    </DropdownMenu>
  );

  const SidebarBody = ({ compact, onNavigate }: { compact: boolean; onNavigate?: () => void }) => (<>
    <Switcher compact={compact} onNavigate={onNavigate} />
    {!isHub && (
      <div className="hp-sb-back">
        <Link to="/admin" className="hp-sb-link" onClick={onNavigate} title={compact ? "Voltar ao Hub" : undefined} aria-label="Voltar ao Hub"><LayoutDashboard aria-hidden /><span className="hp-sb-text">Voltar ao Hub</span></Link>
      </div>
    )}
    <nav aria-label={isHub ? "Navegação principal" : `Navegação do ${app.label}`} className="hp-sb-nav">
      {sections.map((s, si) => (
        <div key={si} className="hp-sb-group">
          {s.label && <p className="hp-sb-group-label">{s.label}</p>}
          {s.items.map((i) => (
            <Link key={i.to} to={i.to} onClick={onNavigate} title={compact ? i.label : undefined} aria-label={compact ? i.label : undefined} aria-current={activeItem === i ? "page" : undefined} className="hp-sb-link">
              <i.icon aria-hidden /><span className="hp-sb-text">{i.label}</span>
            </Link>
          ))}
        </div>
      ))}
    </nav>
    {footer}
  </>);

  return (
    <div className="hp-shell" data-collapsed={collapsed} data-app={app.id} style={{ ["--app-accent" as string]: app.accent }}>
      <a href="#conteudo" className="sr-only focus:not-sr-only focus:fixed focus:top-2 focus:left-2 focus:z-50 focus:bg-card focus:px-3 focus:py-2 focus:rounded">Ir para o conteúdo</a>
      <HeaderBar app={app} section={activeItem?.label ?? ""} apps={apps} collapsed={collapsed} onToggleCollapsed={() => setCollapsed((v) => !v)} drawerOpen={drawer}
        onOpenDrawer={() => setDrawer(true)} onSearch={() => setCmd(true)} homeTo={flatItems[0]?.to ?? "/admin"}
        profileExtra={<>{!isHub && <DropdownMenuItem asChild><Link to="/admin">Voltar ao Hub</Link></DropdownMenuItem>}{profileExtra}</>} />

      <aside className="hp-sidebar hp-sidebar-desktop" data-collapsed={collapsed} aria-label={isHub ? "Barra lateral" : `Barra lateral do ${app.label}`}>
        <SidebarBody compact={collapsed} />
      </aside>

      <Sheet open={drawer} onOpenChange={setDrawer}>
        <SheetContent side="left" className="hp-menu-mobile hp-sidebar hp-sidebar-sheet p-0 w-80 border-0" style={{ ["--app-accent" as string]: app.accent }}>
          <SheetTitle className="sr-only">{`Menu do ${app.label}`}</SheetTitle><SheetDescription className="sr-only">{`Navegação do ${app.label}`}</SheetDescription>
          <SidebarBody compact={false} onNavigate={() => setDrawer(false)} />
        </SheetContent>
      </Sheet>

      <div className="hp-main">
        <main id="conteudo" className="hp-content" tabIndex={-1} aria-labelledby="titulo-secao">{children}</main>
      </div>
      <CommandMenu open={cmd} onOpenChange={setCmd} />
    </div>
  );
};

export default AppFrame;
