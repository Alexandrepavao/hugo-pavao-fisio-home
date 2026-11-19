import { NavLink, Outlet, Link } from "react-router-dom";
import { Building2, ClipboardList, Gauge, History, Layers, PlusCircle, ShieldCheck } from "lucide-react";
import { useAuth } from "@/auth/AuthProvider";
import { useOrg } from "@/org/OrgProvider";

const NAV = [
  { to: "/plataforma", label: "Organizações", icon: Building2, end: true },
  { to: "/plataforma/criar", label: "Criar aplicativo", icon: PlusCircle },
  { to: "/plataforma/solicitacoes", label: "Provisionamento", icon: ClipboardList },
  { to: "/plataforma/modelos", label: "Modelos e módulos", icon: Layers },
  { to: "/plataforma/planos", label: "Planos e consumo", icon: Gauge },
  { to: "/plataforma/auditoria", label: "Auditoria", icon: History },
];

/** Área da PLATAFORMA (operadora do produto). Não é a gestão de uma clínica: administrador da plataforma não lê dados de pacientes, finanças ou prontuários das organizações.
 *  A permissão é conferida no banco (cada função exige administrador da plataforma); aqui só se escolhe o que mostrar. */
const PlatformLayout = () => {
  const { session, loading } = useAuth();
  const org = useOrg();
  if (loading || org.loading) return <div className="min-h-screen flex items-center justify-center text-navy-400" role="status">Carregando…</div>;
  if (!session) return <div className="min-h-screen flex items-center justify-center"><Link to="/login" className="hp-btn hp-btn-primary">Entrar</Link></div>;
  if (!org.platformAdmin)
    return (
      <div className="min-h-screen flex items-center justify-center px-6 text-center" role="alert">
        <div><h1 className="text-2xl text-foreground mb-2">Sem permissão</h1><p className="text-muted-foreground">Esta área é exclusiva da administração da plataforma.</p><Link to="/admin" className="hp-btn hp-btn-outline mt-4 inline-flex">Voltar</Link></div>
      </div>
    );
  return (
    <div className="min-h-screen bg-background" data-testid="platform-area">
      <header className="border-b border-border bg-card">
        <div className="max-w-6xl mx-auto px-4 h-14 flex items-center gap-3">
          <ShieldCheck size={20} className="text-accent" aria-hidden />
          <strong className="text-foreground">Plataforma</strong>
          <span className="hp-badge hp-badge-gold">Administração da plataforma</span>
          <span className="ml-auto text-xs text-muted-foreground hidden sm:inline">Sem acesso a dados clínicos ou financeiros das organizações</span>
          <Link to="/admin" className="hp-btn hp-btn-outline h-8 text-xs">Ir para a gestão</Link>
        </div>
        <nav aria-label="Plataforma" className="max-w-6xl mx-auto px-4 flex gap-1 overflow-x-auto">
          {NAV.map((n) => (
            <NavLink key={n.to} to={n.to} end={n.end} className={({ isActive }) => `px-3 h-10 -mb-px border-b-2 text-sm font-medium whitespace-nowrap inline-flex items-center gap-1.5 transition-colors ${isActive ? "border-primary text-foreground" : "border-transparent text-muted-foreground hover:text-foreground"}`}>
              <n.icon size={15} aria-hidden />{n.label}
            </NavLink>
          ))}
        </nav>
      </header>
      <main className="max-w-6xl mx-auto px-4 py-8"><Outlet /></main>
    </div>
  );
};

export default PlatformLayout;
