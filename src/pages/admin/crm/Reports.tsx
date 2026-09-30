import { useLocation, useNavigate } from "react-router-dom";
import { useQuery } from "@tanstack/react-query";
import { Bar, BarChart, CartesianGrid, ResponsiveContainer, Tooltip, XAxis, YAxis } from "recharts";
import { supabase } from "@/lib/supabase";
import { brl } from "@/lib/format";
import { PageHead, State, Table, Td, Tabs } from "@/lib/ui";
import { usePeriodFilterState, presetRange, toExclusive, axisBrl } from "../finance/shared";
import { PeriodFilter } from "@/lib/PeriodFilter";
import type { StaffUser } from "./types";

/** Análises (funil + motivos de perda) e Desempenho comercial (por responsável) — as duas seções do CRM Pro
 *  de referência, aqui como abas da mesma tela (rotas /relatorios e /relatorios/desempenho abrem a aba certa). */
const Reports = () => {
  const location = useLocation(); const navigate = useNavigate();
  const tab = location.pathname.endsWith("/desempenho") ? "desempenho" : "analises";
  const { preset, custom, onPreset, onFrom, onTo, onClear } = usePeriodFilterState();
  const { from, to } = preset === "personalizado" ? custom : presetRange(preset);
  const range = { from: `${from}T00:00:00.000Z`, to: toExclusive(to) };

  const users = useQuery({ queryKey: ["assignable"], queryFn: async () => ((await supabase.rpc("list_assignable_users", {})).data ?? []) as StaffUser[] });

  const funnel = useQuery({ queryKey: ["crm-report-funnel", range.from, range.to], queryFn: async () => {
    const { data: stages, error: e1 } = await supabase.from("pipeline_stages").select("id, name, position, pipeline_id").order("position");
    if (e1) throw e1;
    const { data: opps, error: e2 } = await supabase.from("opportunities").select("stage_id, status").gte("created_at", range.from).lt("created_at", range.to);
    if (e2) throw e2;
    return (stages ?? []).map((s) => ({ etapa: s.name, Quantidade: (opps ?? []).filter((o) => o.stage_id === s.id).length }));
  } });

  const lossReasons = useQuery({ queryKey: ["crm-report-loss", range.from, range.to], queryFn: async () => {
    const { data, error } = await supabase.from("opportunities").select("lost_reason_id, loss_reasons(name)").eq("status", "lost").gte("closed_at", range.from).lt("closed_at", range.to);
    if (error) throw error;
    const by = new Map<string, number>();
    for (const o of data as unknown as { lost_reason_id: string | null; loss_reasons: { name: string } | null }[]) { const k = o.loss_reasons?.name ?? "Sem motivo"; by.set(k, (by.get(k) ?? 0) + 1); }
    const total = [...by.values()].reduce((a, b) => a + b, 0);
    return [...by.entries()].map(([motivo, n]) => ({ motivo, n, pct: total > 0 ? Math.round((n / total) * 1000) / 10 : 0 })).sort((a, b) => b.n - a.n);
  } });

  const byRep = useQuery({ queryKey: ["crm-report-by-rep", range.from, range.to], enabled: tab === "desempenho", queryFn: async () => {
    const { data, error } = await supabase.from("opportunities").select("owner_user_id, status, value_cents, closed_at").gte("closed_at", range.from).lt("closed_at", range.to).in("status", ["won", "lost"]);
    if (error) throw error;
    const by = new Map<string, { won: number; lost: number; value: number }>();
    for (const o of data ?? []) { const key = o.owner_user_id ?? "none"; if (!by.has(key)) by.set(key, { won: 0, lost: 0, value: 0 }); const b = by.get(key)!; if (o.status === "won") { b.won++; b.value += o.value_cents; } else b.lost++; }
    return [...by.entries()].map(([id, v]) => ({ nome: users.data?.find((u) => u.user_id === id)?.name ?? "Sem responsável", ...v, conv: v.won + v.lost > 0 ? Math.round((v.won / (v.won + v.lost)) * 1000) / 10 : 0 })).sort((a, b) => b.value - a.value);
  } });

  return (
    <div>
      <PageHead eyebrow="CRM" title="Relatórios" actions={<PeriodFilter preset={preset} from={custom.from} to={custom.to} onPreset={onPreset} onFrom={onFrom} onTo={onTo} onClear={onClear} />} />
      <Tabs tabs={[["analises", "Análises"], ["desempenho", "Desempenho comercial"]]} value={tab} onChange={(v) => navigate(v === "desempenho" ? "/admin/crm/relatorios/desempenho" : "/admin/crm/relatorios")} />

      {tab === "analises" && (
        <div className="grid gap-6 mt-4">
          <section><h2 className="text-xl mb-3">Negócios criados por etapa (período)</h2>
            <State loading={funnel.isLoading} error={funnel.error} />
            {funnel.data && funnel.data.length > 0 && (
              <div className="hp-card p-4" style={{ height: 260 }}><ResponsiveContainer width="100%" height="100%">
                <BarChart data={funnel.data}><CartesianGrid strokeDasharray="3 3" stroke="hsl(var(--border))" /><XAxis dataKey="etapa" fontSize={11} interval={0} angle={-15} textAnchor="end" height={50} /><YAxis fontSize={12} allowDecimals={false} />
                  <Tooltip /><Bar dataKey="Quantidade" fill="hsl(var(--primary))" radius={[3, 3, 0, 0]} /></BarChart></ResponsiveContainer></div>
            )}
          </section>
          <section><h2 className="text-xl mb-3">Motivos de perda (período)</h2>
            <State loading={lossReasons.isLoading} error={lossReasons.error} empty={lossReasons.data?.length === 0} emptyText="Nenhuma oportunidade perdida no período." />
            {lossReasons.data && lossReasons.data.length > 0 && (
              <Table head={["Motivo", "Quantidade", "%"]} right={[1, 2]}>
                {lossReasons.data.map((r) => <tr key={r.motivo}><Td>{r.motivo}</Td><Td num>{r.n}</Td><Td num>{r.pct}%</Td></tr>)}
              </Table>
            )}
          </section>
        </div>
      )}

      {tab === "desempenho" && (
        <div className="mt-4">
          <h2 className="text-xl mb-3">Desempenho por responsável (fechados no período)</h2>
          <State loading={byRep.isLoading} error={byRep.error} empty={byRep.data?.length === 0} emptyText="Nenhum negócio fechado no período." />
          {byRep.data && byRep.data.length > 0 && (
            <Table head={["Responsável", "Ganhos", "Perdidos", "Conversão", "Valor ganho"]} right={[1, 2, 3, 4]}>
              {byRep.data.map((r) => <tr key={r.nome}><Td>{r.nome}</Td><Td num>{r.won}</Td><Td num>{r.lost}</Td><Td num>{r.conv}%</Td><Td num>{brl(r.value)}</Td></tr>)}
            </Table>
          )}
        </div>
      )}
    </div>
  );
};

export default Reports;
