import { useState } from "react";
import { useLocation, useNavigate } from "react-router-dom";
import { useQuery } from "@tanstack/react-query";
import { supabase } from "@/lib/supabase";
import { brl } from "@/lib/format";
import { PageHead, State, StatCard, Table, Td, Tabs } from "@/lib/ui";
import { PeriodFilter } from "@/lib/PeriodFilter";
import { presetRange, toExclusive, usePeriodFilterState, useUnits } from "@/lib/period";
import { IndicatorSheet, type IndicatorTrigger } from "@/lib/IndicatorSheet";
import { BarBlock } from "@/lib/IndicatorCharts";
import type { StaffUser } from "./types";

interface Metric { value: number | null; available: boolean; basis: string }
interface Analytics {
  pipeline_id: string; stalled_days: number; open_total: Metric; stalled: Metric; cohort: Metric; overall_conversion: Metric; win_rate_closed: Metric;
  won_in_period: Metric; lost_in_period: Metric; cycle_avg_days: Metric; cycle_median_days: Metric;
  stage_now: { stage_id: string; name: string; position: number; kind: string; n: number; avg_days: number | null; median_days: number | null; max_days: number | null }[];
  stage_history: { stage_id: string; name: string; position: number; n: number; avg_days: number | null; median_days: number | null }[];
  chain: { stage_id: string; name: string; position: number; reached: number; conv_prev_pct: number | null; conv_first_pct: number | null }[];
  won_step: { won: number; conv_prev_pct: number | null };
  loss_reasons: { reason_id: string | null; name: string; n: number; pct: number }[];
  by_owner: { owner_id: string | null; name: string; created: number; won: number; lost: number; open: number; conv_pct: number | null; won_value_cents: number }[];
  by_source: { source: string; created: number; won: number; lost: number; open: number; conv_pct: number | null; won_value_cents: number }[];
}
const days = (v: number | null | undefined) => (v == null ? "—" : `${v.toString().replace(".", ",")} d`);
const pct = (v: number | null | undefined) => (v == null ? "—" : `${v.toString().replace(".", ",")}%`);
const num = (m: Metric, f: (v: number) => string = (v) => v.toLocaleString("pt-BR")) => (m.available && m.value != null ? f(m.value) : "—");

/** Relatórios do CRM: Análises (tempo por etapa, parados, conversão, ciclo, motivos de perda) e Desempenho (por responsável e origem).
 *  Tudo calculado no servidor (crm_analytics), no mesmo escopo do dashboard; cartões, barras e números das tabelas abrem os registros.
 *  Fórmulas, período e denominadores em docs/indicadores.md (e no texto de cada cartão). */
const Reports = () => {
  const location = useLocation(); const navigate = useNavigate();
  const tab = location.pathname.endsWith("/desempenho") ? "desempenho" : "analises";
  const { preset, custom, unit, onPreset, onFrom, onTo, onUnit, onClear } = usePeriodFilterState();
  const { from, to } = preset === "personalizado" ? custom : presetRange(preset);
  const range = { from: `${from}T00:00:00.000Z`, to: toExclusive(to) };
  const [owner, setOwner] = useState(""); const [pipeline, setPipeline] = useState(""); const [stalledDays, setStalledDays] = useState(7);
  const [sheet, setSheet] = useState<IndicatorTrigger | null>(null);

  const units = useUnits();
  const users = useQuery({ queryKey: ["assignable"], queryFn: async () => ((await supabase.rpc("list_assignable_users", {})).data ?? []) as StaffUser[] });
  const pipes = useQuery({ queryKey: ["pipelines-reports"], queryFn: async () => (await supabase.from("pipelines").select("id, name, kind").eq("active", true).order("name")).data ?? [] });

  const a = useQuery({ queryKey: ["crm-analytics", range.from, range.to, unit, owner, pipeline, stalledDays], queryFn: async () => {
    const { data, error } = await supabase.rpc("crm_analytics", { p_from: range.from, p_to: range.to, p_unit: unit || null, p_owner: owner || null, p_pipeline: pipeline || null, p_stalled_days: stalledDays });
    if (error) throw error; return data as Analytics;
  } });
  const d = a.data;
  const pipeName = pipes.data?.find((p) => p.id === (pipeline || d?.pipeline_id))?.name ?? "";
  const open = (kind: "created" | "won" | "lost" | "open" | "stalled", dim?: "owner" | "source" | "reason" | "stage", value?: string) => setSheet({
    rpc: "crm_indicator_detail", scope: `${pipeName}${kind === "open" || kind === "stalled" ? " · situação de hoje" : ` · ${from} a ${to}`}`,
    params: { p_kind: kind, p_dim: dim ?? null, p_value: value ?? null, p_from: range.from, p_to: range.to, p_unit: unit || null, p_owner: owner || null, p_pipeline: pipeline || d?.pipeline_id || null, p_stalled_days: stalledDays } });
  const clickBtn = (n: number, onClick: () => void) => n > 0 ? <button className="text-accent font-medium hover:underline tabular" onClick={onClick}>{n.toLocaleString("pt-BR")}</button> : <span className="tabular text-muted-foreground">0</span>;

  const filterExtra = (
    <div className="grid gap-3">
      <div><label htmlFor="rp-pipe" className="block text-xs mb-1">Funil</label>
        <select id="rp-pipe" value={pipeline} onChange={(e) => setPipeline(e.target.value)}><option value="">Padrão (pacientes)</option>{(pipes.data ?? []).map((p) => <option key={p.id} value={p.id}>{p.name}</option>)}</select></div>
      <div><label htmlFor="rp-owner" className="block text-xs mb-1">Responsável</label>
        <select id="rp-owner" value={owner} onChange={(e) => setOwner(e.target.value)}><option value="">Todos</option>{(users.data ?? []).map((u) => <option key={u.user_id} value={u.user_id}>{u.name}</option>)}</select></div>
      <div><label htmlFor="rp-stall" className="block text-xs mb-1">“Parada” = sem movimento há mais de (dias)</label>
        <input id="rp-stall" type="number" min={1} max={365} value={stalledDays} onChange={(e) => setStalledDays(Math.min(365, Math.max(1, Number(e.target.value) || 7)))} /></div>
    </div>
  );

  return (
    <div>
      <PageHead eyebrow="CRM" title="Relatórios" hint="Indicadores calculados no servidor, no seu escopo de unidade. Cada cartão explica a fórmula; clique para abrir os registros."
        actions={<PeriodFilter preset={preset} from={custom.from} to={custom.to} unit={unit} units={units.data} onPreset={onPreset} onFrom={onFrom} onTo={onTo} onUnit={onUnit}
          onClear={() => { onClear(); setOwner(""); setPipeline(""); setStalledDays(7); }} extraCount={(owner ? 1 : 0) + (pipeline ? 1 : 0) + (stalledDays !== 7 ? 1 : 0)} extra={filterExtra} />} />
      <Tabs tabs={[["analises", "Análises"], ["desempenho", "Desempenho comercial"]]} value={tab} onChange={(v) => navigate(v === "desempenho" ? "/admin/crm/relatorios/desempenho" : "/admin/crm/relatorios")} />
      <State loading={a.isLoading} error={a.error} />

      {d && tab === "analises" && (
        <div className="grid gap-5">
          <ul className="grid gap-3 sm:grid-cols-2 lg:grid-cols-4">
            <StatCard label="Em aberto agora" value={num(d.open_total)} basis={d.open_total.basis} onClick={() => open("open")} />
            <StatCard label="Paradas" value={num(d.stalled)} basis={d.stalled.basis} tone={(d.stalled.value ?? 0) > 0 ? "danger" : undefined} onClick={() => open("stalled")} />
            <StatCard label="Criadas no período" value={num(d.cohort)} basis={d.cohort.basis} onClick={() => open("created")} />
            <StatCard label="Conversão geral" value={num(d.overall_conversion, pct)} basis={d.overall_conversion.basis} unavailable={!d.overall_conversion.available} onClick={() => open("created")} />
            <StatCard label="Taxa de ganho (fechadas)" value={num(d.win_rate_closed, pct)} basis={d.win_rate_closed.basis} unavailable={!d.win_rate_closed.available} onClick={() => open("won")} />
            <StatCard label="Ganhas no período" value={num(d.won_in_period)} basis={d.won_in_period.basis} onClick={() => open("won")} />
            <StatCard label="Ciclo de venda — média" value={num(d.cycle_avg_days, days)} basis={d.cycle_avg_days.basis} unavailable={!d.cycle_avg_days.available} onClick={() => open("won")} />
            <StatCard label="Ciclo de venda — mediana" value={num(d.cycle_median_days, days)} basis={d.cycle_median_days.basis} unavailable={!d.cycle_median_days.available} onClick={() => open("won")} />
          </ul>

          <div className="grid gap-4 lg:grid-cols-2">
            <BarBlock title="Tempo na etapa atual (oportunidades em aberto)" hint="Dias desde a última entrada na etapa, média e mediana. Clique numa barra para ver as oportunidades da etapa."
              data={d.stage_now.filter((s) => s.kind === "open").map((s) => ({ etapa: s.name, id: s.stage_id, Média: s.avg_days, Mediana: s.median_days }))} xKey="etapa"
              series={[{ key: "Média", label: "Média (dias)" }, { key: "Mediana", label: "Mediana (dias)" }]} onBarClick={(r) => open("open", "stage", String(r.id))} empty="Nenhuma oportunidade em aberto." />
            <BarBlock title="Oportunidades da coorte que chegaram a cada etapa" hint="Coorte = criadas no período. “Chegou” = esteve nessa etapa ou em uma posterior (nunca contando etapas de perda)."
              data={d.chain.map((c) => ({ etapa: c.name, Chegaram: c.reached }))} xKey="etapa" series={[{ key: "Chegaram", label: "Chegaram à etapa" }]} empty="Nenhuma oportunidade criada no período." />
          </div>

          <section>
            <h2 className="text-xl mb-1">Conversão entre etapas</h2>
            <p className="text-xs text-muted-foreground mb-2">Denominador: quem chegou à etapa anterior (mesma coorte de {num(d.cohort)} oportunidades criadas no período). “Sobre a 1ª etapa” divide pelo total da primeira etapa.</p>
            {d.chain.length === 0 ? <p className="text-sm text-muted-foreground">Sem etapas abertas neste funil.</p> : (
              <Table head={["Etapa", "Chegaram", "Conversão da etapa anterior", "Sobre a 1ª etapa"]} right={[1, 2, 3]}>
                {d.chain.map((c) => <tr key={c.stage_id}><Td>{c.name}</Td><Td num>{c.reached}</Td><Td num>{pct(c.conv_prev_pct)}</Td><Td num>{pct(c.conv_first_pct)}</Td></tr>)}
                <tr><Td><b>Ganho</b></Td><Td num>{d.won_step.won}</Td><Td num>{pct(d.won_step.conv_prev_pct)}</Td><Td num>{pct(d.chain[0]?.reached ? Math.round((1000 * d.won_step.won) / d.chain[0].reached) / 10 : null)}</Td></tr>
              </Table>)}
          </section>

          <section>
            <h2 className="text-xl mb-1">Duração por etapa (histórico)</h2>
            <p className="text-xs text-muted-foreground mb-2">Passagens já concluídas que terminaram no período, a partir do registro de eventos do CRM. Oportunidades sem evento de criação não têm a duração da 1ª etapa; não há retroativo inventado.</p>
            <Table head={["Etapa", "Passagens", "Média", "Mediana"]} right={[1, 2, 3]}>
              {d.stage_history.map((h) => <tr key={h.stage_id}><Td>{h.name}</Td><Td num>{h.n}</Td><Td num>{days(h.avg_days)}</Td><Td num>{days(h.median_days)}</Td></tr>)}
            </Table>
          </section>

          <section>
            <h2 className="text-xl mb-1">Motivos de perda (período)</h2>
            <p className="text-xs text-muted-foreground mb-2">Perdidas fechadas no período; % = motivo ÷ total de perdidas do período.</p>
            {d.loss_reasons.length === 0 ? <p className="text-sm text-muted-foreground">Nenhuma oportunidade perdida no período.</p> : (
              <Table head={["Motivo", "Quantidade", "%"]} right={[1, 2]}>
                {d.loss_reasons.map((r) => <tr key={r.reason_id ?? "none"}><Td>{r.name}</Td><Td num>{clickBtn(r.n, () => open("lost", "reason", r.reason_id ?? "none"))}</Td><Td num>{pct(r.pct)}</Td></tr>)}
              </Table>)}
          </section>
        </div>
      )}

      {d && tab === "desempenho" && (
        <div className="grid gap-6">
          <section>
            <h2 className="text-xl mb-1">Por responsável</h2>
            <p className="text-xs text-muted-foreground mb-2">Criadas e fechadas (ganhas/perdidas) no período; “Em aberto” é a situação de hoje; conversão = ganhas ÷ (ganhas + perdidas) fechadas no período. Quem não vê o time enxerga só os próprios números.</p>
            {d.by_owner.length === 0 ? <p className="text-sm text-muted-foreground">Sem movimentação no período.</p> : (
              <Table head={["Responsável", "Criadas", "Ganhas", "Perdidas", "Em aberto", "Conversão", "Valor ganho"]} right={[1, 2, 3, 4, 5, 6]}>
                {d.by_owner.map((r) => { const v = r.owner_id ?? "none"; return <tr key={v}><Td>{r.name}</Td>
                  <Td num>{clickBtn(r.created, () => open("created", "owner", v))}</Td><Td num>{clickBtn(r.won, () => open("won", "owner", v))}</Td><Td num>{clickBtn(r.lost, () => open("lost", "owner", v))}</Td>
                  <Td num>{clickBtn(r.open, () => open("open", "owner", v))}</Td><Td num>{pct(r.conv_pct)}</Td><Td num>{brl(r.won_value_cents)}</Td></tr>; })}
              </Table>)}
          </section>
          <section>
            <h2 className="text-xl mb-1">Por origem</h2>
            <p className="text-xs text-muted-foreground mb-2">Mesmas regras, agrupadas pela origem registrada na oportunidade (“Sem origem” quando vazia).</p>
            {d.by_source.length === 0 ? <p className="text-sm text-muted-foreground">Sem movimentação no período.</p> : (
              <Table head={["Origem", "Criadas", "Ganhas", "Perdidas", "Em aberto", "Conversão", "Valor ganho"]} right={[1, 2, 3, 4, 5, 6]}>
                {d.by_source.map((r) => <tr key={r.source}><Td>{r.source}</Td>
                  <Td num>{clickBtn(r.created, () => open("created", "source", r.source))}</Td><Td num>{clickBtn(r.won, () => open("won", "source", r.source))}</Td><Td num>{clickBtn(r.lost, () => open("lost", "source", r.source))}</Td>
                  <Td num>{clickBtn(r.open, () => open("open", "source", r.source))}</Td><Td num>{pct(r.conv_pct)}</Td><Td num>{brl(r.won_value_cents)}</Td></tr>)}
              </Table>)}
          </section>
        </div>
      )}
      <IndicatorSheet trigger={sheet} onClose={() => setSheet(null)} />
    </div>
  );
};

export default Reports;
