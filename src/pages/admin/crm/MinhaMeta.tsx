import { useQuery } from "@tanstack/react-query";
import { supabase } from "@/lib/supabase";
import { brl } from "@/lib/format";
import { PageHead, State, StatCard } from "@/lib/ui";

interface Progress {
  has_goal: boolean; month: string; won_value_cents: number; won_deals: number; avg_ticket_cents: number;
  target_value_cents?: number; progress_pct?: number; remaining_value_cents?: number; deals_needed?: number;
  business_days_left?: number; daily_pace_cents?: number; expected_conversion_rate?: number;
}

/** Minha meta: progresso do mês contra a meta cadastrada pelo gestor, com ritmo diário necessário. Sem
 *  "conversas necessárias" (o CRM de referência usa contagem de mensagens de WhatsApp — HP não tem esse dado
 *  ainda; ver Conversas/Disparo). O ritmo aqui é sobre negócios/valor, que o sistema já tem de verdade. */
const MinhaMeta = () => {
  const progress = useQuery({ queryKey: ["crm-my-goal"], queryFn: async () => {
    const { data, error } = await supabase.rpc("crm_goal_progress", { p_user: null, p_month: null });
    if (error) throw error; return data as Progress;
  } });
  const p = progress.data;

  return (
    <div>
      <PageHead eyebrow="CRM · Metas" title="Minha meta" hint="Progresso do mês corrente. A meta é cadastrada pelo seu gestor." />
      <State loading={progress.isLoading} error={progress.error} />
      {p && !p.has_goal && (
        <div className="hp-card p-6 text-center">
          <p className="text-lg font-medium mb-1">Nenhuma meta cadastrada para este mês</p>
          <p className="text-sm text-muted-foreground">Fale com seu gestor para definir sua meta mensal. Enquanto isso, você já vendeu {brl(p.won_value_cents)} ({p.won_deals} negócio(s) ganho(s)) neste mês.</p>
        </div>
      )}
      {p && p.has_goal && (
        <div className="grid gap-6">
          <div className="hp-card p-5">
            <div className="flex items-baseline justify-between mb-2">
              <p className="text-sm text-muted-foreground">Progresso da meta</p>
              <p className="text-2xl font-bold tabular">{p.progress_pct}%</p>
            </div>
            <div className="h-3 rounded-full bg-muted overflow-hidden">
              <div className="h-full bg-primary rounded-full transition-all" style={{ width: `${Math.min(100, p.progress_pct ?? 0)}%` }} />
            </div>
            <p className="text-xs text-muted-foreground mt-2">{brl(p.won_value_cents)} vendido de {brl(p.target_value_cents ?? 0)} — faltam {brl(p.remaining_value_cents ?? 0)}</p>
          </div>
          <ul className="grid gap-3 sm:grid-cols-2 lg:grid-cols-4">
            <StatCard label="Negócios ganhos no mês" value={p.won_deals.toLocaleString("pt-BR")} />
            <StatCard label="Ticket médio" value={brl(p.avg_ticket_cents)} basis={p.won_deals === 0 ? "sem negócios ganhos ainda neste mês — valor de referência (R$ 5.000)" : undefined} />
            <StatCard label="Negócios necessários para bater a meta" value={(p.deals_needed ?? 0).toLocaleString("pt-BR")} basis={`estimado pelo ticket médio, sobre o valor restante`} />
            <StatCard label="Ritmo necessário (dias úteis restantes)" value={brl(p.daily_pace_cents ?? 0) + "/dia"} basis={`${p.business_days_left} dia(s) útil(eis) restante(s) no mês`} />
          </ul>
        </div>
      )}
    </div>
  );
};

export default MinhaMeta;
