import { useQuery } from "@tanstack/react-query";
import { Link } from "react-router-dom";
import { supabase } from "@/lib/supabase";
import { brl } from "@/lib/format";
import { LevelSection, State } from "@/lib/ui";
import { LEAD_TYPE, isLeadKind } from "./leadTypes";
import type { PipelineOverview } from "./types";

/** Quais oportunidades eu tenho, por tipo de lead (= funil): paciente, fisioterapeuta (equipe), fisioterapeuta (HP Academy) e empresa. Foto de agora, no escopo de acesso de quem vê;
 *  cada cartão abre o funil. Uma pessoa pode ter uma oportunidade em cada funil, então a soma das abertas pode passar do número de pessoas. */
const LeadTypesOverview = () => {
  const q = useQuery({ queryKey: ["crm-overview"], queryFn: async () => { const { data, error } = await supabase.rpc("crm_pipeline_overview"); if (error) throw error; return (data ?? []) as PipelineOverview[]; } });
  const rows = (q.data ?? []).filter((r) => isLeadKind(r.kind));
  const total = rows.reduce((a, r) => a + r.open_count, 0);
  return (
    <LevelSection level="summary" title="Oportunidades por tipo de lead" label="Hoje" hint={`${total.toLocaleString("pt-BR")} oportunidade(s) aberta(s) agora. Toque num tipo para abrir o funil.`}>
      <State loading={q.isLoading} error={q.error} />
      {q.data && (
        <ul className="grid gap-3 sm:grid-cols-2 xl:grid-cols-4" data-testid="tipos-de-lead">
          {rows.map((r) => {
            const t = LEAD_TYPE[r.kind as keyof typeof LEAD_TYPE]; const Icon = t.icon;
            return (
              <li key={r.pipeline_id}>
                <Link to={`/admin/crm/oportunidades?funil=${r.pipeline_id}`} data-kind={r.kind} className="hp-card block p-4 h-full transition-colors hover:border-primary/50">
                  <span className="flex items-center gap-2"><span className={`grid place-items-center h-8 w-8 rounded-full ${t.chip}`}><Icon size={16} aria-hidden /></span><span className="font-semibold text-[15px] leading-tight">{t.label}</span></span>
                  <span className="text-xs text-muted-foreground mt-1.5 block">{t.description}</span>
                  <span className="flex items-baseline gap-1.5 mt-3"><span className="text-3xl font-bold tabular" data-testid="tipo-abertas">{r.open_count.toLocaleString("pt-BR")}</span><span className="text-sm text-muted-foreground">{r.open_count === 1 ? "aberta" : "abertas"}</span></span>
                  <span className="mt-1 block text-xs text-muted-foreground">{r.open_value_cents > 0 ? `${brl(r.open_value_cents)} em aberto · ` : ""}{r.people_count.toLocaleString("pt-BR")} {r.people_count === 1 ? "pessoa" : "pessoas"}</span>
                  <span className="mt-2 flex flex-wrap gap-x-3 gap-y-1 text-xs"><span className={r.stale_count > 0 ? "text-destructive font-medium" : "text-muted-foreground"}>{r.stale_count} sem retorno</span><span className="text-muted-foreground">{r.won_count} ganhas</span><span className="text-muted-foreground">{r.lost_count} perdidas</span></span>
                </Link>
              </li>);
          })}
        </ul>)}
    </LevelSection>
  );
};

export default LeadTypesOverview;
