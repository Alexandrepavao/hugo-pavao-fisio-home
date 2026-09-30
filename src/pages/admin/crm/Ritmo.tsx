import { useQuery } from "@tanstack/react-query";
import { supabase } from "@/lib/supabase";
import { brl } from "@/lib/format";
import { PageHead, State, StatCard } from "@/lib/ui";

interface Progress { has_goal: boolean; daily_pace_cents?: number; business_days_left?: number }

/** Ritmo do dia: quanto falta vender HOJE para manter o ritmo necessário no mês. O CRM de referência mede
 *  ritmo por conversas de WhatsApp por hora — HP não tem log de mensagens (ver Conversas/Disparo, pendentes de
 *  provedor real), então o ritmo aqui é medido em negócios ganhos/valor, que é dado real que o sistema tem. */
const Ritmo = () => {
  const progress = useQuery({ queryKey: ["crm-my-goal-ritmo"], queryFn: async () => {
    const { data, error } = await supabase.rpc("crm_goal_progress", { p_user: null, p_month: null });
    if (error) throw error; return data as Progress;
  } });
  const today = useQuery({ queryKey: ["crm-ritmo-today"], queryFn: async () => {
    const { data: u } = await supabase.auth.getUser();
    const start = new Date(); start.setHours(0, 0, 0, 0);
    const { data, error } = await supabase.from("opportunities").select("value_cents").eq("owner_user_id", u.user?.id).eq("status", "won").gte("closed_at", start.toISOString());
    if (error) throw error;
    return (data ?? []).reduce((a, o) => a + o.value_cents, 0);
  } });
  const p = progress.data;
  const todayValue = today.data ?? 0;
  const target = p?.daily_pace_cents ?? 0;
  const restante = Math.max(0, target - todayValue);
  const pct = target > 0 ? Math.min(100, Math.round((todayValue / target) * 100)) : 0;

  return (
    <div>
      <PageHead eyebrow="CRM · Metas" title="Ritmo do dia" hint="Quanto falta vender hoje para manter o ritmo necessário até o fim do mês, com base na sua meta." />
      <State loading={progress.isLoading || today.isLoading} error={progress.error ?? today.error} />
      {p && !p.has_goal && (
        <div className="hp-card p-6 text-center"><p className="text-sm text-muted-foreground">Sem meta cadastrada este mês — fale com seu gestor para calcular seu ritmo diário.</p></div>
      )}
      {p && p.has_goal && (
        <div className="grid gap-6">
          <div className="hp-card p-5">
            <div className="flex items-baseline justify-between mb-2">
              <p className="text-sm text-muted-foreground">Ritmo de hoje</p>
              <p className="text-2xl font-bold tabular">{pct}%</p>
            </div>
            <div className="h-3 rounded-full bg-muted overflow-hidden"><div className="h-full bg-primary rounded-full transition-all" style={{ width: `${pct}%` }} /></div>
            <p className="text-xs text-muted-foreground mt-2">{brl(todayValue)} vendido hoje de {brl(target)} necessários — faltam {brl(restante)}</p>
          </div>
          <ul className="grid gap-3 sm:grid-cols-3">
            <StatCard label="Meta de hoje" value={brl(target)} basis="valor restante da meta do mês ÷ dias úteis restantes" />
            <StatCard label="Vendido hoje" value={brl(todayValue)} />
            <StatCard label="Dias úteis restantes no mês" value={(p.business_days_left ?? 0).toLocaleString("pt-BR")} />
          </ul>
        </div>
      )}
    </div>
  );
};

export default Ritmo;
