import { useState } from "react";
import { useQuery } from "@tanstack/react-query";
import { Activity, CalendarCheck, CalendarX2, Gauge, HeartPulse, MessageSquareHeart, Percent, Repeat, Users, Wallet } from "lucide-react";
import { supabase } from "@/lib/supabase";
import { brl, fmtDate } from "@/lib/format";
import { Badge, inputCls, KpiGrid, LevelSection, State, StatCard, Table, Td, type Tone } from "@/lib/ui";
import MySummary from "@/pages/admin/MySummary";
import { PortalPage } from "./AppShell";

interface Kpis {
  from: string; to: string;
  agenda: { scheduled: number; attended: number; no_show: number; cancelled: number; attendance_rate: number | null };
  occupancy: { booked_min: number; available_min: number; pct: number } | null;
  portfolio: { active: number; new_in_period: number; plans_active: number; near_end: number; with_specialty: number };
  continuity: { decisions: number; continuity: number; discharged: number; continuity_rate: number | null };
  outcome: { patients_with_pain_series: number; avg_pain_change: number | null };
  quality: { answers: number; avg_score: number | null; nps: number | null };
  revenue_generated_cents: number; adherence: number | null; adherence_note: string;
}
interface Stmt {
  from: string; to: string; basis: string;
  totals: { pending_cents: number; authorized_cents: number; paid_cents: number; net_cents: number; sessions: number };
  entries: { id: string; at: string; kind: string; amount_cents: number; status: "pending" | "authorized" | "paid" | "void"; product: string | null; reason: string | null }[];
  upcoming: { product: string; remaining_sessions: number; share_cents: number; expected_cents: number }[];
}
const PERIODS: [string, string][] = [["7", "Últimos 7 dias"], ["30", "Últimos 30 dias"], ["mes", "Mês atual"], ["90", "Últimos 90 dias"]];
const range = (p: string) => { const t = new Date(); const iso = (d: Date) => d.toLocaleDateString("sv-SE", { timeZone: "America/Sao_Paulo" }); const f = new Date(t);
  if (p === "mes") f.setDate(1); else f.setDate(f.getDate() - (Number(p) - 1)); return { from: iso(f), to: iso(t) }; };
const KIND: Record<string, string> = { session: "Sessão atendida", residual: "Sessões pagas e não atendidas", adjustment: "Ajuste", reversal: "Estorno de sessão devolvida" };
const ST: Record<string, [string, Tone]> = { pending: ["Pendente", "warning"], authorized: ["Autorizado", "info"], paid: ["Pago", "success"], void: ["Anulado", "neutral"] };
const pct = (v: number | null | undefined) => (v == null ? "—" : `${String(v).replace(".", ",")}%`);

/** Desempenho do fisioterapeuta: indicadores dele (sem ranking com colegas), extrato de repasse por sessão (sem nome de paciente) e, abaixo, o resumo de atendimentos e repasses percentuais já existentes. */
const PhysioPerformance = () => {
  const [per, setPer] = useState("30"); const r = range(per);
  const k = useQuery({ queryKey: ["prof-kpis", per], retry: false, queryFn: async () => { const { data, error } = await supabase.rpc("prof_kpis", { p_from: r.from, p_to: r.to }); if (error) throw error; return data as Kpis; } });
  const s = useQuery({ queryKey: ["prof-stmt", per], retry: false, queryFn: async () => { const { data, error } = await supabase.rpc("prof_commission_statement", { p_from: r.from, p_to: r.to }); if (error) throw error; return data as Stmt; } });
  const d = k.data;
  return (
    <PortalPage title="Meu desempenho" subtitle="Seus números do período. Não há ranking com colegas; os valores vêm dos registros do sistema."
      actions={<div className="flex items-center gap-2 text-sm"><label htmlFor="pf-per" className="text-xs">Período</label><select id="pf-per" className={inputCls + " w-auto"} value={per} onChange={(e) => setPer(e.target.value)}>{PERIODS.map(([v, l]) => <option key={v} value={v}>{l}</option>)}</select></div>}>
      <State loading={k.isLoading} error={k.error} />
      {d && (<div className="grid gap-6" data-testid="physio-kpis">
        <LevelSection level="summary" title="Agenda" hint="Atendimentos pela data da consulta.">
          <KpiGrid>
            <StatCard label="Realizados" value={d.agenda.attended} icon={CalendarCheck} basis={`${d.agenda.scheduled} ainda agendados`} />
            <StatCard label="Faltas do paciente" value={d.agenda.no_show} icon={CalendarX2} tone={d.agenda.no_show > 0 ? "warning" : undefined} basis={`${d.agenda.cancelled} cancelamento(s)`} />
            <StatCard label="Comparecimento" value={pct(d.agenda.attendance_rate)} icon={Percent} unavailable={d.agenda.attendance_rate == null} basis="realizados ÷ (realizados + faltas)" />
            <StatCard label="Ocupação da agenda" value={pct(d.occupancy?.pct)} icon={Gauge} unavailable={!d.occupancy} basis={d.occupancy ? "horas marcadas ÷ horas de disponibilidade" : "cadastre a sua disponibilidade para calcular"} />
          </KpiGrid>
        </LevelSection>
        <LevelSection level="summary" title="Carteira e continuidade">
          <KpiGrid>
            <StatCard label="Pacientes ativos" value={d.portfolio.active} icon={Users} basis={`${d.portfolio.new_in_period} novo(s) no período`} />
            <StatCard label="Planos perto do fim" value={d.portfolio.near_end} icon={Repeat} basis={`${d.portfolio.plans_active} plano(s) ativo(s)`} tone={d.portfolio.near_end > 0 ? "warning" : undefined} />
            <StatCard label="Continuidade" value={pct(d.continuity.continuity_rate)} icon={Repeat} unavailable={d.continuity.continuity_rate == null} basis={`${d.continuity.continuity} de ${d.continuity.decisions} reavaliação(ões); ${d.continuity.discharged} alta(s)`} />
            <StatCard label="Planos com especialidade" value={d.portfolio.with_specialty} icon={HeartPulse} basis="define as medidas sugeridas" />
          </KpiGrid>
        </LevelSection>
        <LevelSection level="analysis" title="Resultado e qualidade" hint="Descritivo, sem ranking e sem interpretar causa. A variação de dor é a média (última − primeira) dos seus pacientes com 2 ou mais registros no período.">
          <KpiGrid>
            <StatCard label="Variação média de dor" value={d.outcome.avg_pain_change == null ? "—" : `${d.outcome.avg_pain_change > 0 ? "+" : ""}${String(d.outcome.avg_pain_change).replace(".", ",")}`} icon={Activity} unavailable={d.outcome.avg_pain_change == null} basis={`${d.outcome.patients_with_pain_series} paciente(s) com série de dor`} />
            <StatCard label="Nota média dos pacientes" value={d.quality.avg_score == null ? "—" : String(d.quality.avg_score).replace(".", ",")} icon={MessageSquareHeart} unavailable={d.quality.avg_score == null} basis={`${d.quality.answers} avaliação(ões) de 0 a 10`} />
            <StatCard label="NPS" value={d.quality.nps == null ? "—" : String(d.quality.nps)} icon={MessageSquareHeart} unavailable={d.quality.nps == null} basis="% notas 9–10 menos % notas 0–6" />
            <StatCard label="Adesão aos exercícios" value={d.adherence == null ? "—" : pct(d.adherence)} icon={Activity} unavailable={d.adherence == null} basis={d.adherence == null ? d.adherence_note : "treinos feitos ÷ prescritos"} />
          </KpiGrid>
        </LevelSection>
        <LevelSection level="summary" title="Financeiro (seu)" hint={s.data?.basis}>
          <KpiGrid>
            <StatCard label="Receita gerada" value={brl(d.revenue_generated_cents)} icon={Wallet} basis="valor das sessões que você atendeu (sem dados de paciente)" />
            <StatCard label="Repasse pendente" value={brl(s.data?.totals.pending_cents ?? 0)} icon={Wallet} tone={(s.data?.totals.pending_cents ?? 0) > 0 ? "warning" : undefined} basis={`${s.data?.totals.sessions ?? 0} sessão(ões) no período`} />
            <StatCard label="Autorizado" value={brl(s.data?.totals.authorized_cents ?? 0)} icon={Wallet} basis="aguardando pagamento" />
            <StatCard label="Pago" value={brl(s.data?.totals.paid_cents ?? 0)} icon={Wallet} basis="já pago a você" />
          </KpiGrid>
          {s.data && s.data.upcoming.length > 0 && <p className="mt-3 text-sm text-muted-foreground" data-testid="upcoming">Previsto (não é lançamento): {s.data.upcoming.map((u) => `${u.product}: ${u.remaining_sessions} sessão(ões) × ${brl(u.share_cents)} = ${brl(u.expected_cents)}`).join(" · ")}</p>}
        </LevelSection>
        {s.data && (<LevelSection level="analysis" title="Extrato do repasse por sessão" hint={`${fmtDate(s.data.from + "T12:00:00Z")} a ${fmtDate(s.data.to + "T12:00:00Z")} — sem o nome do paciente.`}>
          {s.data.entries.length === 0 ? <p className="text-sm text-muted-foreground">Nenhum lançamento no período.</p> : (
            <Table head={["Quando", "Origem", "Produto", "Valor", "Situação"]} right={[3]}>{s.data.entries.map((x) => { const [l, tone] = ST[x.status] ?? [x.status, "neutral" as Tone];
              return <tr key={x.id} data-testid="stmt-row"><Td>{fmtDate(x.at)}</Td><Td>{KIND[x.kind] ?? x.kind}{x.reason && <span className="block text-xs text-muted-foreground">{x.reason}</span>}</Td><Td>{x.product ?? "—"}</Td><Td num>{brl(x.amount_cents)}</Td><Td><Badge tone={tone}>{l}</Badge></Td></tr>; })}</Table>)}
        </LevelSection>)}
      </div>)}
      <div className="mt-10 border-t border-border pt-6"><MySummary /></div>
    </PortalPage>
  );
};
export default PhysioPerformance;
