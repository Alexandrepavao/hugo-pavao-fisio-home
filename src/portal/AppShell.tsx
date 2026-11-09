import type { ReactNode } from "react";
import { Link, NavLink, Outlet } from "react-router-dom";
import { Download, LogOut, type LucideIcon } from "lucide-react";
import logo from "@/assets/hp-logo.png";
import { useAuth } from "@/auth/AuthProvider";
import { useAppTheme } from "@/components/hp/theme";
import { ROLE_LABEL } from "@/components/hp/nav";
import { DropdownMenu, DropdownMenuContent, DropdownMenuItem, DropdownMenuLabel, DropdownMenuSeparator, DropdownMenuTrigger } from "@/components/ui/dropdown-menu";
import { usePwaInstall } from "./usePwaInstall";

export interface ShellItem { to: string; label: string; icon: LucideIcon; end?: boolean; /** false = só na barra lateral do computador (a barra inferior do celular tem no máximo 5 abas) */ mobile?: boolean }
export interface ShellLink { to: string; label: string }

/** Casca única dos portais: barra INFERIOR no celular (como um app) e barra LATERAL no computador. O conteúdo vem das rotas filhas (Outlet).
 *  A autorização real continua nas rotas (RequireAuth), no RLS e nas funções do banco; a casca só organiza a navegação. */
const AppShell = ({ brand, items, links = [], menuExtra, banner, children }: { brand: string; items: ShellItem[]; links?: ShellLink[]; menuExtra?: ReactNode; banner?: ReactNode; children?: ReactNode }) => {
  useAppTheme();
  const { user, roles, signOut } = useAuth(); const pwa = usePwaInstall();
  const mobileItems = items.filter((i) => i.mobile !== false);
  const side = ({ isActive }: { isActive: boolean }) => `flex items-center gap-3 rounded-lg px-3 py-2.5 text-sm font-medium transition-colors ${isActive ? "bg-primary/10 text-primary" : "text-muted-foreground hover:bg-muted hover:text-foreground"}`;
  const tab = ({ isActive }: { isActive: boolean }) => `flex min-h-[3.5rem] flex-col items-center justify-center gap-0.5 text-[11px] font-medium ${isActive ? "text-primary" : "text-muted-foreground"}`;
  const Account = ({ className = "" }: { className?: string }) => (
    <DropdownMenu>
      <DropdownMenuTrigger asChild><button type="button" className={`hp-btn hp-btn-ghost hp-btn-sm ${className}`} aria-label="Menu do usuário" data-testid="portal-conta">{(user?.email ?? "?").slice(0, 1).toUpperCase()}</button></DropdownMenuTrigger>
      <DropdownMenuContent align="end" className="w-64">
        <DropdownMenuLabel className="font-normal"><span className="block truncate text-sm text-foreground">{user?.email}</span><span className="block text-xs text-muted-foreground">{[...new Set(roles.map((r) => ROLE_LABEL[r.role]))].join(", ")}</span></DropdownMenuLabel>
        <DropdownMenuSeparator />
        <DropdownMenuItem asChild><Link to="/boas-vindas" data-testid="menu-tutorial">Tutorial</Link></DropdownMenuItem>
        {links.map((l) => <DropdownMenuItem asChild key={l.to}><Link to={l.to}>{l.label}</Link></DropdownMenuItem>)}
        {menuExtra}
        {pwa.canInstall && <DropdownMenuItem onSelect={() => void pwa.install()}><Download size={14} aria-hidden className="mr-2" />Instalar o app</DropdownMenuItem>}
        {pwa.ios && <p className="px-2 py-1.5 text-xs text-muted-foreground">No iPhone: toque em Compartilhar e em “Adicionar à Tela de Início”.</p>}
        <DropdownMenuSeparator />
        <DropdownMenuItem onSelect={() => void signOut()}><LogOut size={14} aria-hidden className="mr-2" />Sair</DropdownMenuItem>
      </DropdownMenuContent>
    </DropdownMenu>
  );
  return (
    <div className="min-h-screen bg-background md:flex">
      <a href="#conteudo" className="sr-only focus:not-sr-only focus:fixed focus:left-2 focus:top-2 focus:z-50 focus:rounded focus:bg-card focus:px-3 focus:py-2">Ir para o conteúdo</a>
      <aside className="sticky top-0 hidden h-screen w-60 shrink-0 flex-col border-r border-border bg-card md:flex" aria-label={`Menu ${brand}`}>
        <div className="flex items-center gap-3 border-b border-border px-4 py-4"><Link to="/" aria-label="Site HP Fisioterapia"><img src={logo} alt="HP Fisioterapia" style={{ height: "2rem", width: "auto" }} /></Link><span className="text-sm font-semibold">{brand}</span></div>
        <nav className="flex-1 space-y-1 overflow-y-auto p-3" aria-label="Seções">{items.map((i) => <NavLink key={i.to} to={i.to} end={i.end} className={side}><i.icon size={18} aria-hidden />{i.label}</NavLink>)}</nav>
        <div className="border-t border-border p-3"><Account className="w-full justify-start" /></div>
      </aside>
      <div className="flex min-w-0 flex-1 flex-col">
        <header className="sticky top-0 z-30 flex h-12 items-center gap-3 border-b border-border bg-card px-4 md:hidden">
          <Link to="/" aria-label="Site HP Fisioterapia"><img src={logo} alt="HP Fisioterapia" style={{ height: "1.5rem", width: "auto" }} /></Link>
          <span className="text-sm font-semibold">{brand}</span><span className="ml-auto"><Account /></span>
        </header>
        <main id="conteudo" tabIndex={-1} className="mx-auto w-full max-w-6xl flex-1 px-4 py-5 pb-28 md:px-8 md:pb-10">{banner}{children ?? <Outlet />}</main>
      </div>
      <nav aria-label="Seções" className="fixed inset-x-0 bottom-0 z-30 grid border-t border-border bg-card md:hidden" style={{ gridTemplateColumns: `repeat(${mobileItems.length}, minmax(0, 1fr))`, paddingBottom: "env(safe-area-inset-bottom)" }}>
        {mobileItems.map((i) => <NavLink key={i.to} to={i.to} end={i.end} className={tab}><i.icon size={22} aria-hidden />{i.label}</NavLink>)}
      </nav>
    </div>
  );
};
export default AppShell;

/** Cabeçalho de página dentro dos portais. */
export const PortalPage = ({ title, subtitle, actions, children }: { title: string; subtitle?: string; actions?: ReactNode; children: ReactNode }) => (
  <>
    <div className="mb-5 flex flex-wrap items-start justify-between gap-3"><div><h1 className="text-2xl">{title}</h1>{subtitle && <p className="mt-1 max-w-2xl text-[13px] text-muted-foreground">{subtitle}</p>}</div>{actions}</div>
    {children}
  </>
);
