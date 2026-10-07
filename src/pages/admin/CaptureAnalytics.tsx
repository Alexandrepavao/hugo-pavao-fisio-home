import { useState } from "react";
import { useQuery } from "@tanstack/react-query";
import { supabase } from "@/lib/supabase";
import { State, StatCard, Table, Td } from "@/lib/ui";
import { IndicatorSheet, type IndicatorTrigger } from "@/lib/IndicatorSheet";
import { BarBlock, LineBlock } from "@/lib/IndicatorCharts";

interface Metric { value: number | null; available: boolean; basis: string }
interface Analytics {
  granularity: "day" | "week"; responses: Metric; people: Metric; opportunities: Metric; whatsapp_clicks: Metric;
  by_source: { source_key: string; label: string; family: string; responses: number; people: number; opportunities: number }[];
  quiz: { started: number; completed: number; abandoned: number; in_progress: number; completion_rate_pct: number | null; abandon_rate_pct: number | null; basis: string;
          abandoned_by_step: { step: number; n: number }[]; by_journey: { source_key: string; label: string; started: number; completed: number; abandoned: number }[] };
  by_origin: { origin: string; responses: number; people: number; opportunities: number }[];
  by_campaign: { campaign: string; responses: number; people: number; opportunities: number }[];
  series: { day: string; responses: number; quiz_completed: number }[];
  funnel: { basis: string; captured: number; opportunity: number; scheduled: number; attended: number; sold: number };
}
const n = (v: number | null | undefined) => (v == null ? "—" : v.toLocaleString("pt-BR"));
const pct = (v: number | null | undefined) => (v == null ? "—" : `${v.toString().replace(".", ",")}%`);
const ratio = (a: number, b: number) => (b > 0 ? `${(Math.round((1000 * a) / b) / 10).toString().replace(".", ",")}%` : "—");

/** Aba "Indicadores" da Captação. Diferencia RESPOSTAS (quizzes iniciados + formulários enviados), PESSOAS distintas e OPORTUNIDADES distintas.
 *  Cliques no WhatsApp não são mensagens enviadas. Sem histórico retroativo inventado: o abandono é calculado na leitura. Fórmulas: docs/indicadores.md. */
const CaptureAnalytics = ({ from, to, fromIso, toIso, unit }: { from: string; to: string; fromIso: string; toIso: string; unit: string }) => {
  const [sheet, setSheet] = useState<IndicatorTrigger | null>(null);
  const q = useQuery({ queryKey: ["capture-analytics", fromIso, toIso, unit], queryFn: async () => {
    const { data, error } = await supabase.rpc("capture_analytics", { p_from: fromIso, p_to: toIso, p_unit: unit || null });
    if (error) throw error; return data as Analytics;
  } });
  const d = q.data;
  const open = (kind: string, dim?: "source" | "origin" | "campaign", value?: string) => setSheet({ rpc: "capture_indicator_detail", scope: `${from} a ${to}`,
    params: { p_kind: kind, p_dim: dim ?? null, p_value: value ?? null, p_from: fromIso, p_to: toIso, p_unit: unit || null } });
  const link = (v: number, onClick: () => void) => v > 0 ? <button className="text-accent font-medium hover:underline tabular" onClick={onClick}>{v.toLocaleString("pt-BR")}</button> : <span className="tabular text-muted-foreground">0</span>;

  return (
    <div className="grid gap-5">
      <State loading={q.isLoading} error={q.error} />
      {d && (<>
        <ul className="grid gap-3 sm:grid-cols-2 lg:grid-cols-4">
          <StatCard label="Respostas" value={n(d.responses.value)} basis={d.responses.basis} onClick={() => open("responses")} />
          <StatCard label="Pessoas distintas" value={n(d.people.value)} basis={d.people.basis} onClick={() => open("funnel", undefined, "captured")} />
          <StatCard label="Oportunidades distintas" value={n(d.opportunities.value)} basis={d.opportunities.basis} onClick={() => open("funnel", undefined, "opportunity")} />
          <StatCard label="Cliques no WhatsApp" value={n(d.whatsapp_clicks.value)} basis={d.whatsapp_clicks.basis} onClick={() => open("whatsapp")} />
          <StatCard label="Quizzes iniciados" value={n(d.quiz.started)} basis="iniciados no período (todas as jornadas)" onClick={() => open("responses", "source", "quiz:atendimento")} />
          <StatCard label="Taxa de conclusão" value={pct(d.quiz.completion_rate_pct)} basis={`${d.quiz.basis}`} onClick={() => open("completed")} />
          <StatCard label="Taxa de abandono" value={pct(d.quiz.abandon_rate_pct)} basis={`${d.quiz.abandoned} abandonados · ${d.quiz.in_progress} em andamento (< 24 h)`} tone={(d.quiz.abandon_rate_pct ?? 0) > 50 ? "danger" : undefined} onClick={() => open("abandoned")} />
          <StatCard label="Quizzes em andamento" value={n(d.quiz.in_progress)} basis="sem conclusão e com atividade nas últimas 24 h" onClick={() => open("in_progress")} />
        </ul>

        <div className="grid gap-4 lg:grid-cols-2">
          <LineBlock title={`Evolução ${d.granularity === "week" ? "semanal" : "diária"}`} hint="Respostas e quizzes concluídos por dia (ou semana, em períodos longos)."
            data={d.series.map((s) => ({ dia: new Date(s.day + "T12:00:00Z").toLocaleDateString("pt-BR", { day: "2-digit", month: "2-digit" }), Respostas: s.responses, Concluídos: s.quiz_completed }))} xKey="dia"
            series={[{ key: "Respostas", label: "Respostas" }, { key: "Concluídos", label: "Quizzes concluídos" }]} />
          <BarBlock title="Entradas por formulário / quiz" hint="Respostas, pessoas distintas e oportunidades distintas por fonte. Clique para abrir os registros."
            data={d.by_source.map((s) => ({ fonte: s.label, key: s.source_key, Respostas: s.responses, Pessoas: s.people, Oportunidades: s.opportunities }))} xKey="fonte"
            series={[{ key: "Respostas", label: "Respostas" }, { key: "Pessoas", label: "Pessoas" }, { key: "Oportunidades", label: "Oportunidades" }]} onBarClick={(r) => open("responses", "source", String(r.key))} />
          <BarBlock title="Origem (utm_source)" hint="Origem registrada na URL de entrada; “(sem origem)” = acesso direto ou sem UTM."
            data={d.by_origin.map((o) => ({ origem: o.origin, Respostas: o.responses, Pessoas: o.people }))} xKey="origem" series={[{ key: "Respostas", label: "Respostas" }, { key: "Pessoas", label: "Pessoas" }]} onBarClick={(r) => open("responses", "origin", String(r.origem))} />
          <BarBlock title="Campanha (utm_campaign)" hint="“(sem campanha)” = entrada sem campanha marcada."
            data={d.by_campaign.map((o) => ({ campanha: o.campaign, Respostas: o.responses, Pessoas: o.people }))} xKey="campanha" series={[{ key: "Respostas", label: "Respostas" }, { key: "Pessoas", label: "Pessoas" }]} onBarClick={(r) => open("responses", "campaign", String(r.campanha))} />
          <BarBlock title="Abandono por etapa do quiz" hint="Em qual pergunta os quizzes abandonados pararam (sem atividade há mais de 24 h)."
            data={d.quiz.abandoned_by_step.map((s) => ({ etapa: `Pergunta ${s.step}`, Abandonos: s.n }))} xKey="etapa" series={[{ key: "Abandonos", label: "Abandonos" }]} onBarClick={() => open("abandoned")} empty="Nenhum abandono no período." />
        </div>

        <section>
          <h2 className="text-xl mb-1">Conversão das pessoas captadas</h2>
          <p className="text-xs text-muted-foreground mb-2">{d.funnel.basis}</p>
          <Table head={["Etapa", "Pessoas", "% das capturadas"]} right={[1, 2]}>
            <tr><Td>Capturadas (respostas com pessoa identificada)</Td><Td num>{link(d.funnel.captured, () => open("funnel", undefined, "captured"))}</Td><Td num>100%</Td></tr>
            <tr><Td>Com oportunidade no CRM</Td><Td num>{link(d.funnel.opportunity, () => open("funnel", undefined, "opportunity"))}</Td><Td num>{ratio(d.funnel.opportunity, d.funnel.captured)}</Td></tr>
            <tr><Td>Com atendimento agendado depois da captação</Td><Td num>{link(d.funnel.scheduled, () => open("funnel", undefined, "scheduled"))}</Td><Td num>{ratio(d.funnel.scheduled, d.funnel.captured)}</Td></tr>
            <tr><Td>Com atendimento realizado</Td><Td num>{link(d.funnel.attended, () => open("funnel", undefined, "attended"))}</Td><Td num>{ratio(d.funnel.attended, d.funnel.captured)}</Td></tr>
            <tr><Td>Com venda confirmada</Td><Td num>{link(d.funnel.sold, () => open("funnel", undefined, "sold"))}</Td><Td num>{ratio(d.funnel.sold, d.funnel.captured)}</Td></tr>
          </Table>
        </section>

        <section>
          <h2 className="text-xl mb-1">Quizzes por jornada</h2>
          <Table head={["Jornada", "Iniciados", "Concluídos", "Abandonados", "Conclusão"]} right={[1, 2, 3, 4]}>
            {d.quiz.by_journey.map((j) => <tr key={j.source_key}><Td>{j.label}</Td><Td num>{link(j.started, () => open("responses", "source", j.source_key))}</Td><Td num>{j.completed}</Td><Td num>{j.abandoned}</Td><Td num>{ratio(j.completed, j.started)}</Td></tr>)}
          </Table>
        </section>
      </>)}
      <IndicatorSheet trigger={sheet} onClose={() => setSheet(null)} />
    </div>
  );
};

export default CaptureAnalytics;
