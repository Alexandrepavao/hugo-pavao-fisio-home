import { useState, type FormEvent } from "react";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { supabase } from "@/lib/supabase";
import { brl, parseCents } from "@/lib/format";
import { PageHead, State, Table, Td, errText, Msg, useMsg } from "@/lib/ui";
import type { StaffUser } from "./types";

interface Snap {
  user_id: string; name: string; has_goal: boolean; won_value_cents: number; won_deals: number;
  target_value_cents?: number; progress_pct?: number; daily_pace_cents?: number; business_days_left?: number;
}

/** Time: retrato do mês de cada vendedor com meta cadastrada, e onde o gestor cadastra/edita a meta de cada um.
 *  Só quem gerencia (manager/ops_admin/unit_manager) acessa esta rota (gate no roteador + reforçado no banco). */
const CrmTeam = () => {
  const qc = useQueryClient(); const [msg, m] = useMsg();
  const [userId, setUserId] = useState(""); const [target, setTarget] = useState(""); const [rate, setRate] = useState("20");

  const users = useQuery({ queryKey: ["assignable"], queryFn: async () => ((await supabase.rpc("list_assignable_users", {})).data ?? []) as StaffUser[] });
  const snapshot = useQuery({ queryKey: ["crm-team-snapshot"], queryFn: async () => {
    const { data, error } = await supabase.rpc("crm_team_snapshot", { p_month: null });
    if (error) throw error; return data as Snap[];
  } });

  const setGoal = async (e: FormEvent) => {
    e.preventDefault();
    const cents = parseCents(target || "0,00");
    const r = Number(rate.replace(",", "."));
    if (!userId) return m.err("Selecione um vendedor.");
    if (cents == null || cents <= 0) return m.err("Informe a meta do mês (R$).");
    if (!Number.isFinite(r) || r < 0 || r > 100) return m.err("Taxa de conversão esperada deve ser entre 0 e 100.");
    const { data: org } = await supabase.from("organizations").select("id").single();
    const month = new Date(); month.setDate(1);
    const { error } = await supabase.from("crm_goals").upsert(
      { org_id: org?.id, user_id: userId, period_start: month.toISOString().slice(0, 10), target_value_cents: cents, expected_conversion_rate: r },
      { onConflict: "org_id,user_id,period_start" },
    );
    if (error) return m.err(errText(error));
    m.ok("Meta salva."); setTarget("");
    void qc.invalidateQueries({ queryKey: ["crm-team-snapshot"] });
  };

  const usersWithoutGoal = (users.data ?? []).filter((u) => !snapshot.data?.some((s) => s.user_id === u.user_id));

  return (
    <div>
      <PageHead eyebrow="CRM · Metas" title="Time" hint="Meta e progresso do mês corrente de cada vendedor." />
      <Msg m={msg} />
      <form onSubmit={setGoal} className="hp-card p-4 mb-6 grid gap-3 sm:grid-cols-4 items-end" noValidate>
        <div><label htmlFor="tg-user" className="block text-xs mb-1">Vendedor</label><select id="tg-user" value={userId} onChange={(e) => setUserId(e.target.value)}><option value="">Selecione…</option>{(users.data ?? []).map((u) => <option key={u.user_id} value={u.user_id}>{u.name}</option>)}</select></div>
        <div><label htmlFor="tg-target" className="block text-xs mb-1">Meta do mês (R$)</label><input id="tg-target" inputMode="decimal" value={target} onChange={(e) => setTarget(e.target.value)} placeholder="0,00" /></div>
        <div><label htmlFor="tg-rate" className="block text-xs mb-1">Conversão esperada (%)</label><input id="tg-rate" inputMode="decimal" value={rate} onChange={(e) => setRate(e.target.value)} /></div>
        <button className="hp-btn hp-btn-primary w-fit">Salvar meta</button>
      </form>

      <State loading={snapshot.isLoading} error={snapshot.error} empty={snapshot.data?.length === 0} emptyText="Nenhuma meta cadastrada ainda para este mês." />
      {snapshot.data && snapshot.data.length > 0 && (
        <Table head={["Vendedor", "Meta", "Vendido", "%", "Negócios ganhos", "Ritmo necessário/dia útil"]} right={[1, 2, 3, 4, 5]}>
          {snapshot.data.map((s) => (
            <tr key={s.user_id}>
              <Td>{s.name}</Td>
              <Td num>{brl(s.target_value_cents ?? 0)}</Td>
              <Td num>{brl(s.won_value_cents)}</Td>
              <Td num>{s.progress_pct}%</Td>
              <Td num>{s.won_deals}</Td>
              <Td num>{brl(s.daily_pace_cents ?? 0)}</Td>
            </tr>
          ))}
        </Table>
      )}
      {usersWithoutGoal.length > 0 && (
        <p className="text-xs text-muted-foreground mt-3">Sem meta cadastrada este mês: {usersWithoutGoal.map((u) => u.name).join(", ")}.</p>
      )}
    </div>
  );
};

export default CrmTeam;
