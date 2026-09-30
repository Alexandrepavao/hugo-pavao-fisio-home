import { useState } from "react";
import { useQuery } from "@tanstack/react-query";
import { supabase } from "@/lib/supabase";
import { PageHead, State, StatCard } from "@/lib/ui";
import { PeriodFilter } from "@/lib/PeriodFilter";
import { presetRange, toExclusive, usePeriodFilterState, useUnits } from "@/lib/period";
import { IndicatorSheet, type IndicatorTrigger } from "@/lib/IndicatorSheet";
import { BarBlock } from "@/lib/IndicatorCharts";
import Greeting from "../Greeting";

interface Metric { value: number | null; available: boolean; basis: string }
interface Dash {
  total: Metric; pf: Metric; pj: Metric; new: Metric; new_pf: number; new_pj: number; incomplete: Metric;
  status: { status: string; label: string; pf: number; pj: number }[];
  missing: { field: string; label: string; pf: number; pj: number }[];
  by_kind: { kind: string; n: number }[]; by_unit: { unit_id: string; unit: string; pf: number; pj: number }[];
}
const KIND_LABEL: Record<string, string> = { lead: "Lead", patient: "Paciente", partner: "Parceiro", student: "Aluno", staff: "Colaborador", contact: "Contato" };

/** Painel do Administrativo: totais, novos por período, status cadastral, incompletos (e campos faltantes), vínculo e unidade.
 *  Cada cartão e cada barra abre a lista de registros correspondente (mesma regra e mesmo escopo do número). Fórmulas em docs/indicadores.md. */
const AdmDashboard = () => {
  const { preset, custom, unit, onPreset, onFrom, onTo, onUnit, onClear } = usePeriodFilterState();
  const { from, to } = preset === "personalizado" ? custom : presetRange(preset);
  const range = { from: `${from}T00:00:00.000Z`, to: toExclusive(to) };
  const units = useUnits();
  const [sheet, setSheet] = useState<IndicatorTrigger | null>(null);
  const unitName = units.data?.find((u) => u.id === unit)?.name ?? "Todas as unidades";

  const dash = useQuery({ queryKey: ["adm-dashboard", range.from, range.to, unit], queryFn: async () => {
    const { data, error } = await supabase.rpc("adm_dashboard", { p_from: range.from, p_to: range.to, p_unit: unit || null });
    if (error) throw error; return data as Dash;
  } });
  const d = dash.data;
  const open = (kind: string, value?: string) => setSheet({ rpc: "adm_indicator_detail", params: { p_kind: kind, p_value: value ?? null, p_from: range.from, p_to: range.to, p_unit: unit || null },
    scope: `${unitName}${kind === "new" ? ` · ${from} a ${to}` : ""}` });
  const statusSum = (s: string) => { const r = d?.status.find((x) => x.status === s); return (r?.pf ?? 0) + (r?.pj ?? 0); };
  const n = (v: number) => v.toLocaleString("pt-BR");

  return (
    <div>
      <div className="mb-5"><Greeting /><p className="text-muted-foreground max-w-2xl">Resumo administrativo — cadastro central (pessoas físicas e jurídicas).</p></div>
      <PageHead eyebrow="Administrativo" title="Visão geral"
        actions={<PeriodFilter preset={preset} from={custom.from} to={custom.to} unit={unit} units={units.data} onPreset={onPreset} onFrom={onFrom} onTo={onTo} onUnit={onUnit} onClear={onClear} />} />
      <State loading={dash.isLoading} error={dash.error} />
      {d && (<>
        <ul className="grid gap-3 sm:grid-cols-2 lg:grid-cols-4">
          <StatCard label="Total de cadastros" value={n(d.total.value ?? 0)} basis={d.total.basis} onClick={() => open("total")} />
          <StatCard label="Pessoas físicas" value={n(d.pf.value ?? 0)} basis={d.pf.basis} onClick={() => open("pf")} />
          <StatCard label="Pessoas jurídicas" value={n(d.pj.value ?? 0)} basis={d.pj.basis} onClick={() => open("pj")} />
          <StatCard label="Novos no período" value={n(d.new.value ?? 0)} basis={`${d.new.basis} · PF ${d.new_pf} · PJ ${d.new_pj}`} onClick={() => open("new")} />
          <StatCard label="Ativos" value={n(statusSum("ativo"))} basis="status cadastral “ativo” (PF + PJ)" onClick={() => open("status", "ativo")} />
          <StatCard label="Pendentes" value={n(statusSum("pendente"))} basis="status cadastral “pendente” (PF + PJ)" onClick={() => open("status", "pendente")} />
          <StatCard label="Inativos" value={n(statusSum("inativo"))} basis="status cadastral “inativo” (PF + PJ)" onClick={() => open("status", "inativo")} />
          <StatCard label="Cadastros incompletos" value={n(d.incomplete.value ?? 0)} basis={d.incomplete.basis} tone={(d.incomplete.value ?? 0) > 0 ? "danger" : undefined} onClick={() => open("incomplete")} />
        </ul>
        <div className="grid gap-4 lg:grid-cols-2 mt-5">
          <BarBlock title="Campos faltantes" hint="Cadastros sem cada dado mínimo (um cadastro pode faltar em vários campos). Clique numa barra para ver os registros."
            data={d.missing.map((m) => ({ campo: m.label, field: m.field, PF: m.pf, PJ: m.pj }))} xKey="campo" stacked
            series={[{ key: "PF", label: "Pessoas físicas" }, { key: "PJ", label: "Pessoas jurídicas" }]} onBarClick={(r) => open("missing", String(r.field))} empty="Nenhum campo faltante." />
          <BarBlock title="Status cadastral" hint="Ativo, pendente ou inativo — é o status do cadastro, não atividade comercial."
            data={d.status.map((s) => ({ status: s.label, key: s.status, PF: s.pf, PJ: s.pj }))} xKey="status" stacked
            series={[{ key: "PF", label: "Pessoas físicas" }, { key: "PJ", label: "Pessoas jurídicas" }]} onBarClick={(r) => open("status", String(r.key))} />
          <BarBlock title="Distribuição por vínculo (pessoas físicas)" hint="Uma pessoa pode ter mais de um vínculo: a soma pode exceder o total de PF."
            data={d.by_kind.map((k) => ({ vinculo: KIND_LABEL[k.kind] ?? k.kind, kind: k.kind, Pessoas: k.n }))} xKey="vinculo"
            series={[{ key: "Pessoas", label: "Pessoas" }]} onBarClick={(r) => open("kind", String(r.kind))} />
          <BarBlock title="Distribuição por unidade" hint="PF pela unidade principal; PJ em cada unidade vinculada (uma PJ em duas unidades aparece nas duas)."
            data={d.by_unit.map((u) => ({ unidade: u.unit, id: u.unit_id, PF: u.pf, PJ: u.pj }))} xKey="unidade" stacked
            series={[{ key: "PF", label: "Pessoas físicas" }, { key: "PJ", label: "Pessoas jurídicas" }]} onBarClick={(r) => open("unit", String(r.id))} />
        </div>
      </>)}
      <IndicatorSheet trigger={sheet} onClose={() => setSheet(null)} />
    </div>
  );
};

export default AdmDashboard;
