import { useEffect, useRef, type ReactNode } from "react";
import { NavLink, Outlet } from "react-router-dom";
import { useQueryClient } from "@tanstack/react-query";
import { Lock } from "lucide-react";
import { State } from "@/lib/ui";
import { pfRpc, usePfAccess } from "./pf";

export const PF_SECTIONS: { to: string; label: string; end?: boolean }[] = [
  { to: "/admin/financeiro/pessoal", label: "Visão geral", end: true },
  { to: "/admin/financeiro/pessoal/lancamentos", label: "Receitas e despesas" },
  { to: "/admin/financeiro/pessoal/contas", label: "Contas e cartões" },
  { to: "/admin/financeiro/pessoal/calendario", label: "Calendário financeiro" },
  { to: "/admin/financeiro/pessoal/orcamento", label: "Orçamento e custo de vida" },
  { to: "/admin/financeiro/pessoal/reserva", label: "Reserva e metas" },
  { to: "/admin/financeiro/pessoal/importacao", label: "Importação e conciliação" },
  { to: "/admin/financeiro/pessoal/configuracoes", label: "Configurações pessoais" },
];

/** Porta das finanças pessoais: sem o acesso individual (concedido pela operação) a tela é a mesma de uma área sem permissão. A autoridade real é do banco; isto só evita mostrar o que não funcionaria. */
export const PfGate = ({ children }: { children: ReactNode }) => {
  const access = usePfAccess(); const qc = useQueryClient(); const booted = useRef(false);
  useEffect(() => { if (access.data && !booted.current) { booted.current = true; void pfRpc("pf_bootstrap").then(() => qc.invalidateQueries({ queryKey: ["pf", "categories"] })).catch(() => undefined); } }, [access.data, qc]);
  if (access.isLoading) return <State loading error={undefined} />;
  if (!access.data) return <div className="min-h-[60vh] flex items-center justify-center px-6 text-center" role="alert"><div><h2 className="text-2xl mb-2">Sem permissão</h2><p className="text-muted-foreground">Seu perfil não tem acesso a esta área.</p></div></div>;
  return <>{children}</>;
};

const PersonalLayout = () => (
  <PfGate>
    <nav aria-label="Finanças pessoais" className="mb-5 -mx-1 overflow-x-auto" data-testid="pf-subnav">
      <ul className="flex gap-1 items-center min-w-max px-1">
        <li className="mr-2 inline-flex items-center gap-1.5 text-[11px] uppercase tracking-wide text-muted-foreground"><Lock size={12} aria-hidden />Privado</li>
        {PF_SECTIONS.map((s) => (
          <li key={s.to}><NavLink to={s.to} end={s.end} className={({ isActive }) => `inline-flex h-8 items-center rounded-full px-3 text-[13px] whitespace-nowrap border ${isActive ? "bg-primary text-primary-foreground border-primary" : "border-border text-muted-foreground hover:text-foreground"}`}>{s.label}</NavLink></li>))}
      </ul>
    </nav>
    <Outlet />
  </PfGate>
);
export default PersonalLayout;
