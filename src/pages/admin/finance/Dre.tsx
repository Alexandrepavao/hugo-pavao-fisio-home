import { useState } from "react";
import { useQuery } from "@tanstack/react-query";
import { supabase } from "@/lib/supabase";
import { brl } from "@/lib/format";
import { PageHead, State, StatCard, Table, Td } from "@/lib/ui";
import { PeriodFilter } from "./PeriodFilter";
import { mfmt, presetRange, toExclusive, useUnits, type Metric, type RangePreset } from "./shared";

interface Dre {
  receita_bruta_cents: Metric; estornos_cents: Metric; receita_liquida_cents: Metric; despesas_operacionais_cents: Metric;
  despesas_por_categoria: { category: string; amount_cents: number }[]; resultado_caixa_cents: Metric;
  deducoes_cents: Metric; custos_diretos_cents: Metric; margem_contribuicao_cents: Metric; resultado_operacional_cents: Metric;
}

const Unavailable = ({ label, basis }: { label: string; basis: string }) => (
  <li className="hp-card p-4 list-none border-dashed">
    <p className="text-xs text-muted-foreground">{label}</p>
    <p className="mt-1 text-[1.5rem] leading-8 font-bold text-muted-foreground">Indisponível</p>
    <p className="text-[11px] leading-4 text-muted-foreground mt-2">{basis}</p>
  </li>
);

const FinanceDre = () => {
  const [preset, setPreset] = useState<RangePreset>("mes");
  const [custom, setCustom] = useState(presetRange("mes"));
  const [unit, setUnit] = useState(""); const [compare, setCompare] = useState(false);
  const { from, to } = preset === "personalizado" ? custom : presetRange(preset);
  const units = useUnits();
  const dre = useQuery({ queryKey: ["dre", from, to, unit], queryFn: async () => {
    const { data, error } = await supabase.rpc("dre_report", { p_from: `${from}T00:00:00.000Z`, p_to: toExclusive(to), p_unit: unit || null }); if (error) throw error; return data as Dre;
  } });
  const revByUnit = useQuery({ queryKey: ["rev-unit", from, to, unit], queryFn: async () => {
    const { data, error } = await supabase.rpc("revenue_by_unit", { p_from: `${from}T00:00:00.000Z`, p_to: toExclusive(to), p_unit: unit || null }); if (error) throw error;
    return data as { unit_id: string; unit_name: string; received_cents: number }[];
  } });

  return (
    <div>
      <PageHead eyebrow="Financeiro" title="Rentabilidade e DRE" hint="Regime de caixa. Quando não há base cadastrada suficiente (ex.: custo direto por produto), o indicador aparece como Indisponível — nunca um número inventado." />
      <PeriodFilter preset={preset} from={custom.from} to={custom.to} unit={unit} units={units.data} compare={compare}
        onPreset={(p) => { setPreset(p); if (p !== "personalizado") setCustom(presetRange(p)); }} onFrom={(v) => setCustom((c) => ({ ...c, from: v }))} onTo={(v) => setCustom((c) => ({ ...c, to: v }))}
        onUnit={setUnit} onCompare={setCompare} onClear={() => { setPreset("mes"); setCustom(presetRange("mes")); setUnit(""); setCompare(false); }} />
      <State loading={dre.isLoading} error={dre.error} />
      {dre.data && (<>
        <ul className="grid gap-3 sm:grid-cols-2 lg:grid-cols-4 mb-6">
          <StatCard label="Receita bruta" value={mfmt(dre.data.receita_bruta_cents)} basis={dre.data.receita_bruta_cents.basis} />
          <StatCard label="Estornos" value={mfmt(dre.data.estornos_cents)} basis={dre.data.estornos_cents.basis} tone={Number(dre.data.estornos_cents.value) > 0 ? "warning" : undefined} />
          <StatCard label="Receita líquida" value={mfmt(dre.data.receita_liquida_cents)} basis={dre.data.receita_liquida_cents.basis} />
          <StatCard label="Despesas operacionais" value={mfmt(dre.data.despesas_operacionais_cents)} basis={dre.data.despesas_operacionais_cents.basis} />
          <StatCard label="Resultado de caixa" value={mfmt(dre.data.resultado_caixa_cents)} basis={dre.data.resultado_caixa_cents.basis} />
          <Unavailable label="Deduções (impostos)" basis={dre.data.deducoes_cents.basis} />
          <Unavailable label="Custos diretos" basis={dre.data.custos_diretos_cents.basis} />
          <Unavailable label="Margem de contribuição" basis={dre.data.margem_contribuicao_cents.basis} />
          <Unavailable label="Resultado operacional" basis={dre.data.resultado_operacional_cents.basis} />
        </ul>

        {dre.data.despesas_por_categoria.length > 0 && (
          <section className="mb-8"><h2 className="text-xl mb-3">Despesas por categoria</h2>
            <Table head={["Categoria", "Valor"]} right={[1]}>{dre.data.despesas_por_categoria.map((c) => <tr key={c.category}><Td>{c.category}</Td><Td num>{brl(c.amount_cents)}</Td></tr>)}</Table>
          </section>
        )}
        {revByUnit.data && revByUnit.data.length > 0 && (
          <section><h2 className="text-xl mb-1">Receita recebida por unidade</h2>
            <p className="text-sm text-muted-foreground mb-3">Só a parte com base real (recebido líquido de estorno). Rentabilidade por unidade com margem depende de custo direto, ainda não cadastrado.</p>
            <Table head={["Unidade", "Recebido"]} right={[1]}>{revByUnit.data.map((u) => <tr key={u.unit_id}><Td>{u.unit_name}</Td><Td num>{brl(u.received_cents)}</Td></tr>)}</Table>
          </section>
        )}
      </>)}
    </div>
  );
};

export default FinanceDre;
