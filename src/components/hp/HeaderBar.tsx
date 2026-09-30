import { useEffect, useState, type ReactNode } from "react";
import { Link } from "react-router-dom";
import { Bell, ChevronsLeft, ChevronsRight, Grid2x2, LogOut, Menu, Moon, Search, Sun, type LucideIcon } from "lucide-react";
import logo from "@/assets/hp-logo.png";
import { useAuth } from "@/auth/AuthProvider";
import { DropdownMenu, DropdownMenuContent, DropdownMenuItem, DropdownMenuLabel, DropdownMenuSeparator, DropdownMenuTrigger } from "@/components/ui/dropdown-menu";
import { Popover, PopoverContent, PopoverTrigger } from "@/components/ui/popover";
import { BUILD_INFO, IS_PRODUCTION } from "@/lib/release";
import { ROLE_LABEL } from "./nav";
import { useAttention } from "./attention";
import { applyTheme, readTheme, THEME_KEY, type ThemeMode } from "./theme";

export interface HeaderAppLink { to: string; label: string; icon: LucideIcon }

const useThemeMode = () => {
  const [theme, setTheme] = useState<ThemeMode>(readTheme);
  useEffect(() => { applyTheme(theme); try { localStorage.setItem(THEME_KEY, theme); } catch { /* sem storage */ } }, [theme]);
  return [theme, () => setTheme((t) => (t === "dark" ? "light" : "dark"))] as const;
};

/** Selo do ambiente: fora de produção, teste/preview usa banco Dev com dados fictícios. Fica no cabeçalho (nunca sobre a barra lateral). */
const EnvPill = () => {
  useEffect(() => { document.documentElement.dataset.envInHeader = "1"; return () => { delete document.documentElement.dataset.envInHeader; }; }, []);
  if (IS_PRODUCTION) return null;
  return (
    <span data-testid="env-badge" title={`Ambiente de teste (${BUILD_INFO.backend}): dados fictícios`} className="hp-env-pill">
      <span className="hidden lg:inline">AMBIENTE DE TESTE · {BUILD_INFO.backend}</span><span className="lg:hidden" aria-hidden>TESTE</span>
      <span className="sr-only lg:hidden">AMBIENTE DE TESTE · {BUILD_INFO.backend}</span>
    </span>
  );
};

const Bell_ = () => {
  const { items, count, loading } = useAttention();
  return (
    <Popover>
      <PopoverTrigger asChild>
        <button className="hp-btn hp-btn-ghost hp-hd-icon" aria-label={count ? `Notificações: ${count} pendência(s) pedem atenção` : "Notificações"} style={{ position: "relative" }}>
          <Bell size={17} />{count > 0 && <span aria-hidden className="hp-hd-dot">{count > 9 ? "9+" : count}</span>}
        </button>
      </PopoverTrigger>
      <PopoverContent align="end" collisionPadding={12} className="w-80 p-0 max-h-[var(--radix-popover-content-available-height)] overflow-y-auto">
        <p className="px-3 py-2 text-sm font-semibold border-b border-border">Precisa da sua atenção</p>
        {loading && <p className="px-3 py-3 text-sm text-muted-foreground">Carregando…</p>}
        {!loading && items.length === 0 && <p className="px-3 py-4 text-sm text-muted-foreground">Nada atrasado sob a sua responsabilidade.</p>}
        <ul>{items.map((i) => (
          <li key={i.id} className="border-b border-border last:border-0">
            <Link to={i.to} className="block px-3 py-2 hover:bg-muted"><span className="block text-sm font-medium truncate">{i.label}</span><span className="block text-xs text-destructive">{i.detail}</span></Link>
          </li>))}
        </ul>
      </PopoverContent>
    </Popover>
  );
};

/** Cabeçalho único dos aplicativos: marca + aplicativo atual + seção, busca discreta, troca de app, notificações, tema e perfil. */
const HeaderBar = ({ title, collapsed, onToggleCollapsed, drawerOpen, onOpenDrawer, onSearch, otherApps, homeTo = "/admin", profileExtra }: {
  title: string; collapsed: boolean; onToggleCollapsed: () => void; drawerOpen: boolean; onOpenDrawer: () => void; onSearch: () => void;
  otherApps?: HeaderAppLink[]; homeTo?: string; profileExtra?: ReactNode;
}) => {
  const { user, roles, signOut } = useAuth();
  const [theme, toggleTheme] = useThemeMode();
  const roleNames = [...new Set(roles.map((r) => ROLE_LABEL[r.role]))].join(", ");
  const initials = (user?.email ?? "?").slice(0, 2).toUpperCase();
  return (
    <header className="hp-header">
      <button className="hp-btn hp-btn-ghost hp-menu-mobile hp-hd-icon" onClick={onOpenDrawer} aria-label="Abrir menu" aria-expanded={drawerOpen}><Menu size={18} /></button>
      <button className="hp-btn hp-btn-ghost hp-sidebar-desktop hp-hd-icon" onClick={onToggleCollapsed} aria-label={collapsed ? "Expandir menu lateral" : "Recolher menu lateral"} aria-pressed={collapsed}>
        {collapsed ? <ChevronsRight size={18} /> : <ChevronsLeft size={18} />}</button>
      <Link to={homeTo} className="hp-hd-brand hp-menu-mobile" aria-label="HP Group — início"><img src={logo} alt="" /></Link>
      <h1 className="hp-hd-title" id="titulo-secao">{title}</h1>
      <div style={{ flex: 1 }} />
      <EnvPill />
      <button className="hp-hd-search hidden md:flex" onClick={onSearch} aria-label="Buscar (Ctrl+K)">
        <Search size={15} aria-hidden /><span>Buscar…</span><kbd>Ctrl K</kbd>
      </button>
      <button className="hp-btn hp-btn-ghost hp-hd-icon md:hidden" onClick={onSearch} aria-label="Buscar"><Search size={17} /></button>
      {otherApps && otherApps.length > 0 && (
        <DropdownMenu>
          <DropdownMenuTrigger asChild>
            <button className="hp-btn hp-btn-ghost hp-hd-icon hidden sm:inline-flex" aria-label="Trocar de aplicativo" title="Trocar de aplicativo"><Grid2x2 size={17} /></button>
          </DropdownMenuTrigger>
          <DropdownMenuContent align="end" className="w-56">
            <DropdownMenuLabel>Aplicativos</DropdownMenuLabel>
            <DropdownMenuSeparator />
            {otherApps.map((a) => <DropdownMenuItem key={a.to} asChild><Link to={a.to}><a.icon className="mr-2 h-4 w-4" aria-hidden />{a.label}</Link></DropdownMenuItem>)}
          </DropdownMenuContent>
        </DropdownMenu>
      )}
      <Bell_ />
      <button className="hp-btn hp-btn-ghost hp-hd-icon hidden sm:inline-flex" onClick={toggleTheme} aria-label={theme === "dark" ? "Usar tema claro" : "Usar tema escuro"} aria-pressed={theme === "dark"} title={theme === "dark" ? "Tema claro" : "Tema escuro"}>
        {theme === "dark" ? <Sun size={17} /> : <Moon size={17} />}</button>
      <DropdownMenu>
        <DropdownMenuTrigger asChild>
          <button className="hp-btn hp-btn-ghost" style={{ padding: "0 .25rem" }} aria-label="Menu do usuário">
            <span aria-hidden className="grid place-items-center rounded-full bg-primary text-primary-foreground text-xs font-semibold" style={{ width: "1.875rem", height: "1.875rem" }}>{initials}</span>
          </button>
        </DropdownMenuTrigger>
        <DropdownMenuContent align="end" className="w-64">
          <DropdownMenuLabel><span className="block text-sm font-medium break-all">{user?.email}</span><span className="block text-xs font-normal text-muted-foreground">{roleNames}</span></DropdownMenuLabel>
          <DropdownMenuSeparator />
          {profileExtra}
          <DropdownMenuItem className="sm:hidden" onSelect={toggleTheme}>{theme === "dark" ? <Sun className="mr-2 h-4 w-4" aria-hidden /> : <Moon className="mr-2 h-4 w-4" aria-hidden />}{theme === "dark" ? "Tema claro" : "Tema escuro"}</DropdownMenuItem>
          {otherApps?.map((a) => <DropdownMenuItem key={`m-${a.to}`} asChild className="sm:hidden"><Link to={a.to}><a.icon className="mr-2 h-4 w-4" aria-hidden />{a.label}</Link></DropdownMenuItem>)}
          <DropdownMenuItem onSelect={() => void signOut()}><LogOut className="mr-2 h-4 w-4" aria-hidden />Sair</DropdownMenuItem>
        </DropdownMenuContent>
      </DropdownMenu>
    </header>
  );
};

export { EnvPill };
export default HeaderBar;
