import { useEffect, useState, type ReactNode } from "react";
import { Link } from "react-router-dom";
import { Bell, ChevronDown, ChevronRight, GraduationCap, LogOut, Menu, Moon, PanelLeftClose, PanelLeftOpen, Search, Settings, Sun, UserCog } from "lucide-react";
import logo from "@/assets/hp-logo.png";
import { useAuth } from "@/auth/AuthProvider";
import { initialsOf, shownName, useMyAccount } from "./useMyAccount";
import { DropdownMenu, DropdownMenuContent, DropdownMenuItem, DropdownMenuLabel, DropdownMenuSeparator, DropdownMenuTrigger } from "@/components/ui/dropdown-menu";
import { Popover, PopoverContent, PopoverTrigger } from "@/components/ui/popover";
import { BUILD_INFO, IS_PRODUCTION } from "@/lib/release";
import { ROLE_LABEL } from "./nav";
import { useAttention } from "./attention";
import { applyTheme, readTheme, THEME_KEY, type ThemeMode } from "./theme";
import type { HpApp } from "./apps";

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
      <span aria-hidden className="hp-env-dot" />
      <span className="hidden xl:inline">AMBIENTE DE TESTE · {BUILD_INFO.backend}</span><span className="xl:hidden" aria-hidden>TESTE</span>
      <span className="sr-only xl:hidden">AMBIENTE DE TESTE · {BUILD_INFO.backend}</span>
    </span>
  );
};

const Notifications = () => {
  const { items, count, loading } = useAttention();
  return (
    <Popover>
      <PopoverTrigger asChild>
        <button className="hp-hd-iconbtn" aria-label={count ? `Notificações: ${count} pendência(s) pedem atenção` : "Notificações"}>
          <Bell size={18} />{count > 0 && <span aria-hidden className="hp-hd-dot">{count > 9 ? "9+" : count}</span>}
        </button>
      </PopoverTrigger>
      <PopoverContent align="end" collisionPadding={12} className="w-80 p-0 max-h-[var(--radix-popover-content-available-height)] overflow-y-auto">
        <p className="px-3 py-2.5 text-sm font-semibold border-b border-border">Precisa da sua atenção</p>
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

/** Ícone quadrado colorido com a identidade do aplicativo. */
export const AppTile = ({ app, size = "md" }: { app: HpApp; size?: "sm" | "md" | "lg" }) => (
  <span aria-hidden className={`hp-app-tile hp-app-tile-${size}`} style={{ ["--tile" as string]: app.accent }}><app.icon /></span>
);

/** Cabeçalho do produto, em largura total: marca HP (alinhada à barra lateral) · localização (aplicativo ▸ seção) · busca · notificações · tema · perfil. */
const HeaderBar = ({ app, section, apps, collapsed, onToggleCollapsed, drawerOpen, onOpenDrawer, onSearch, homeTo = "/admin", profileExtra }: {
  app: HpApp; section: string; apps: HpApp[]; collapsed: boolean; onToggleCollapsed: () => void; drawerOpen: boolean; onOpenDrawer: () => void; onSearch: () => void;
  homeTo?: string; profileExtra?: ReactNode;
}) => {
  const { user, roles, signOut, hasRole } = useAuth();
  const [theme, toggleTheme] = useThemeMode();
  const account = useMyAccount();
  const roleNames = [...new Set(roles.map((r) => ROLE_LABEL[r.role]))].join(", ");
  const who = shownName(account.data, user?.email);
  const initials = initialsOf(who);
  return (
    <header className="hp-header">
      <div className="hp-hd-brandcol">
        <button className="hp-hd-iconbtn hp-menu-mobile" onClick={onOpenDrawer} aria-label="Abrir menu" aria-expanded={drawerOpen}><Menu size={19} /></button>
        <Link to={homeTo} className="hp-hd-brand" aria-label="HP Group — início do aplicativo"><img src={logo} alt="" /></Link>
      </div>
      <button className="hp-hd-iconbtn hp-sidebar-desktop" onClick={onToggleCollapsed} aria-label={collapsed ? "Expandir menu lateral" : "Recolher menu lateral"} aria-pressed={collapsed}>
        {collapsed ? <PanelLeftOpen size={19} /> : <PanelLeftClose size={19} />}</button>

      <nav aria-label="Localização" className="hp-crumb">
        <DropdownMenu>
          <DropdownMenuTrigger asChild>
            <button className="hp-crumb-app" aria-label="Trocar de aplicativo" title="Trocar de aplicativo"><AppTile app={app} size="sm" /><span className="hp-crumb-appname">{app.label}</span><ChevronDown size={14} aria-hidden /></button>
          </DropdownMenuTrigger>
          <DropdownMenuContent align="start" className="w-64">
            <DropdownMenuLabel>Aplicativos</DropdownMenuLabel>
            <DropdownMenuSeparator />
            {apps.map((a) => <DropdownMenuItem key={a.id} asChild><Link to={a.to} className="gap-2.5"><AppTile app={a} size="sm" /><span className="min-w-0"><span className="block text-sm font-medium leading-4">{a.label}</span><span className="block text-[11px] text-muted-foreground truncate">{a.description}</span></span></Link></DropdownMenuItem>)}
          </DropdownMenuContent>
        </DropdownMenu>
        <ChevronRight size={14} aria-hidden className="hp-crumb-sep" />
        <h1 className="hp-crumb-section" id="titulo-secao"><span className="sr-only">{app.label} · </span>{section}</h1>
      </nav>

      <div style={{ flex: 1 }} />
      <EnvPill />
      <button className="hp-hd-search hidden md:flex" onClick={onSearch} aria-label="Buscar (Ctrl+K)">
        <Search size={15} aria-hidden /><span>Buscar…</span><kbd>Ctrl K</kbd>
      </button>
      <button className="hp-hd-iconbtn md:hidden" onClick={onSearch} aria-label="Buscar"><Search size={18} /></button>
      <Notifications />
      <button className="hp-hd-iconbtn hidden sm:inline-flex" onClick={toggleTheme} aria-label={theme === "dark" ? "Usar tema claro" : "Usar tema escuro"} aria-pressed={theme === "dark"} title={theme === "dark" ? "Tema claro" : "Tema escuro"}>
        {theme === "dark" ? <Sun size={18} /> : <Moon size={18} />}</button>
      <DropdownMenu>
        <DropdownMenuTrigger asChild>
          <button className="hp-hd-user" aria-label="Menu do usuário">
            <span aria-hidden className="hp-hd-avatar">{initials}</span>
            <span className="hp-hd-who hidden xl:block"><span className="block truncate">{who}</span><span className="block truncate">{roleNames.split(",")[0]}</span></span>
            <ChevronDown size={14} aria-hidden className="hidden xl:block text-muted-foreground" />
          </button>
        </DropdownMenuTrigger>
        <DropdownMenuContent align="end" className="w-64">
          <DropdownMenuLabel><span className="block text-sm font-medium break-words">{who}</span><span className="block text-xs font-normal text-muted-foreground break-all">{user?.email}</span><span className="block text-xs font-normal text-muted-foreground">{roleNames}</span></DropdownMenuLabel>
          <DropdownMenuSeparator />
          <DropdownMenuItem asChild><Link to="/admin/conta" data-testid="menu-configuracoes-conta"><UserCog className="mr-2 h-4 w-4" aria-hidden />Configurações da conta</Link></DropdownMenuItem>
          <DropdownMenuItem asChild><Link to="/boas-vindas" data-testid="menu-tutorial"><GraduationCap className="mr-2 h-4 w-4" aria-hidden />Tutorial do sistema</Link></DropdownMenuItem>
          {hasRole("manager", "ops_admin") && <DropdownMenuItem asChild><Link to="/admin/configuracoes" data-testid="menu-configuracoes-sistema"><Settings className="mr-2 h-4 w-4" aria-hidden />Configurações do sistema</Link></DropdownMenuItem>}
          <DropdownMenuSeparator />
          {profileExtra}
          <DropdownMenuItem className="sm:hidden" onSelect={toggleTheme}>{theme === "dark" ? <Sun className="mr-2 h-4 w-4" aria-hidden /> : <Moon className="mr-2 h-4 w-4" aria-hidden />}{theme === "dark" ? "Tema claro" : "Tema escuro"}</DropdownMenuItem>
          <DropdownMenuItem onSelect={() => void signOut()}><LogOut className="mr-2 h-4 w-4" aria-hidden />Sair</DropdownMenuItem>
        </DropdownMenuContent>
      </DropdownMenu>
    </header>
  );
};

export { EnvPill };
export default HeaderBar;
