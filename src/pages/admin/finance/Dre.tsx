import { useState } from "react";
import { useQuery } from "@tanstack/react-query";
import { supabase } from "@/lib/supabase";
import { brl } from "@/lib/format";
import { PageHead, State, StatCard, Table, Td } from "@/lib/ui";
import { PeriodFilter } from "./PeriodFilter";
import { mfmt, presetRange, toExclusive, useUnits, type Metric, type RangePreset } from "./shared";

interface Dre {
  receita_caixa_cents: Metric; receita_reconhecida_cents: Metric; estornos_cents: Metric;
  despesas_operacionais_totais_cents: Metric; despesas_por_categoria: { category: string; classification: string | null; amount_cents: number }[];
  resultado_caixa_cents: Metric; deducoes_cents: Metric; custos_diretos_cents: Metric; despesas_operacionais_cents: Metric;
  sem_classificacao_cents: { value: number; count: number; basis: string }; cobertura_classificacao_pct: Metric;
  margem_contribuicao_cents: Metric; resultado_operacional_cents: Metric;
}
interface MarginRow { product_id: string; product_name: string; recognized_cents: number; direct_cost_cents: number; margin_cents: number | null; available: boolean }

const CLASS_LABEL: Record<string, string> = { deducao: "Dedução", custo_direto: "Custo direto", despesa_operacional: "Despesa operacional" };

const Unavailable = ({ label, basis }: { label: string; basis: string }) => (
  <li className="hp-card p-4 list-none border-dashed">
    <p className="text-xs text-muted-foreground">{label}</p>
    <p className="mt-1 text-[1.5rem] leading-8 font-bold text-muted-foreground">Indisponível</p>
    <p className="text-[11px] leading-4 text-muted-foreground mt-2">{basis}</p>
  </li>
);

/** delta% vs. o período de comparação, ou "Sem base de comparação" quando o período anterior é zero/indisponível. */
const Delta = ({ curr, prev }: { curr?: Metric; prev?: Metric }) => {
  if (!curr?.available || curr.value == null) return null;
  if (!prev) return null;
  if (!prev.available || prev.value == null || Number(prev.value) === 0) return <span className="text-[11px] text-muted-foreground block mt-1">Sem base de comparação</span>;
  const d = Math.round(((Number(curr.value) - Number(prev.value)) / Number(prev.value)) * 1000) / 10;
  return <span className={`text-[11px] block mt-1 ${d >= 0 ? "text-[hsl(var(--success))]" : "text-destructive"}`}>{d >= 0 ? "▲" : "▼"} {Math.abs(d).toString().replace(".", ",")}% vs. período anterior</span>;
};

const FinanceDre = () => {
  const [preset, setPreset] = useState<RangePreset>("mes");
  const [custom, setCustom] = useState(presetRange("mes"));
  const [unit, setUnit] = useState(""); const [compare, setCompare] = useState(false);
  const { from, to } = preset === "personalizado" ? custom : presetRange(preset);
  const units = useUnits();
  const prevRange = (() => {
    const f = new Date(from + "T00:00:00"); const t = new Date(to + "T00:00:00");
    const days = Math.max(1, Math.round((t.getTime() - f.getTime()) / 864e5) + 1);
    const pf = new Date(f.getTime() - days * 864e5);
    return { from: pf.toISOString().slice(0, 10), to: new Date(f.getTime() - 864e5).toISOString().slice(0, 10) };
  })();

  const dre = useQuery({ queryKey: ["dre", from, to, unit], queryFn: async () => {
    const { data, error } = await supabase.rpc("dre_report", { p_from: `${from}T00:00:00.000Z`, p_to: toExclusive(to), p_unit: unit || null }); if (error) throw error; return data as Dre;
  } });
  const drePrev = useQuery({ queryKey: ["dre-prev", prevRange.from, prevRange.to, unit], enabled: compare, queryFn: async () => {
    const { data, error } = await supabase.rpc("dre_report", { p_from: `${prevRange.from}T00:00:00.000Z`, p_to: toExclusive(prevRange.to), p_unit: unit || null }); if (error) throw error; return data as Dre;
  } });
  const revByUnit = useQuery({ queryKey: ["rev-unit", from, to, unit], queryFn: async () => {
    const { data, error } = await supabase.rpc("revenue_by_unit", { p_from: `${from}T00:00:00.000Z`, p_to: toExclusive(to), p_unit: unit || null }); if (error) throw error;
    return data as { unit_id: string; unit_name: string; received_cents: number }[];
  } });
  const margin = useQuery({ queryKey: ["margin-by-product", from, to, unit], queryFn: async () => {
    const { data, error } = await supabase.rpc("margin_by_product", { p_from: `${from}T00:00:00.000Z`, p_to: toExclusive(to), p_unit: unit || null }); if (error) throw error; return data as MarginRow[];
  } });
  const lines = useQuery({ queryKey: ["dre-lines", from, to, unit], queryFn: async () => {
    let q = supabase.from("payables").select("id, description, amount_cents, paid_at, status, category:finance_categories(name, dre_classification)")
      .gte("paid_at", `${from}T00:00:00.000Z`).lt("paid_at", toExclusive(to)).order("paid_at", { ascending: false });
    if (unit) q = q.eq("unit_id", unit);
    const { data, error } = await q; if (error) throw error;
    return data as unknown as { id: string; description: string; amount_cents: number; paid_at: string; status: string; category: { name: string; dre_classification: string | null } | null }[];
  } });

  return (
    <div>
      <PageHead eyebrow="Financeiro" title="Rentabilidade e DRE" hint="Receita de caixa ≠ receita reconhecida. Quando faltar classificação, o lançamento aparece separado como 'sem classificação' — nunca vira despesa operacional por padrão, e o total consolidado não é travado por isso." />
      <PeriodFilter preset={preset} from={custom.from} to={custom.to} unit={unit} units={units.data} compare={compare}
        onPreset={(p) => { setPreset(p); if (p !== "personalizado") setCustom(presetRange(p)); }} onFrom={(v) => setCustom((c) => ({ ...c, from: v }))} onTo={(v) => setCustom((c) => ({ ...c, to: v }))}
        onUnit={setUnit} onCompare={setCompare} onClear={() => { setPreset("mes"); setCustom(presetRange("mes")); setUnit(""); setCompare(false); }} />
      <State loading={dre.isLoading} error={dre.error} />
      {dre.data && (<>
        {dre.data.cobertura_classificacao_pct.available && (
          <p className={`text-sm mb-4 px-3 py-2 rounded-md ${Number(dre.data.cobertura_classificacao_pct.value) < 70 ? "bg-[hsl(var(--warning-soft))] text-[hsl(var(--warning))]" : "bg-muted text-muted-foreground"}`}>
            <strong>{dre.data.cobertura_classificacao_pct.value}%</strong> das contas pagas do período estão classificadas na DRE
            {dre.data.sem_classificacao_cents.count > 0 && <> — {dre.data.sem_classificacao_cents.count} lançamento(s) somando {brl(dre.data.sem_classificacao_cents.value)} ainda sem classificação</>}.
          </p>
        )}
        <ul className="grid gap-3 sm:grid-cols-2 lg:grid-cols-4 mb-6">
          <li className="hp-card p-4 list-none"><p className="text-xs text-muted-foreground">Receita de caixa</p><p className="mt-1 text-[1.5rem] leading-8 font-bold tabular">{mfmt(dre.data.receita_caixa_cents)}</p><p className="text-[11px] text-muted-foreground mt-2">{dre.data.receita_caixa_cents.basis}</p>{compare && <Delta curr={dre.data.receita_caixa_cents} prev={drePrev.data?.receita_caixa_cents} />}</li>
          <li className="hp-card p-4 list-none"><p className="text-xs text-muted-foreground">Receita reconhecida</p><p className="mt-1 text-[1.5rem] leading-8 font-bold tabular">{mfmt(dre.data.receita_reconhecida_cents)}</p><p className="text-[11px] text-muted-foreground mt-2">{dre.data.receita_reconhecida_cents.basis}</p>{compare && <Delta curr={dre.data.receita_reconhecida_cents} prev={drePrev.data?.receita_reconhecida_cents} />}</li>
          <StatCard label="Estornos" value={mfmt(dre.data.estornos_cents)} basis={dre.data.estornos_cents.basis} tone={Number(dre.data.estornos_cents.value) > 0 ? "warning" : undefined} />
          <StatCard label="Resultado de caixa" value={mfmt(dre.data.resultado_caixa_cents)} basis={dre.data.resultado_caixa_cents.basis} />
          {dre.data.deducoes_cents.available ? <StatCard label="Deduções" value={mfmt(dre.data.deducoes_cents)} basis={dre.data.deducoes_cents.basis} /> : <Unavailable label="Deduções" basis={dre.data.deducoes_cents.basis} />}
          {dre.data.custos_diretos_cents.available ? <StatCard label="Custos diretos" value={mfmt(dre.data.custos_diretos_cents)} basis={dre.data.custos_diretos_cents.basis} /> : <Unavailable label="Custos diretos" basis={dre.data.custos_diretos_cents.basis} />}
          {dre.data.despesas_operacionais_cents.available ? <StatCard label="Despesas operacionais (classificadas)" value={mfmt(dre.data.despesas_operacionais_cents)} basis={dre.data.despesas_operacionais_cents.basis} /> : <Unavailable label="Despesas operacionais (classificadas)" basis={dre.data.despesas_operacionais_cents.basis} />}
          {dre.data.margem_contribuicao_cents.available ? <li className="hp-card p-4 list-none"><p className="text-xs text-muted-foreground">Margem de contribuição</p><p className="mt-1 text-[1.5rem] leading-8 font-bold tabular">{mfmt(dre.data.margem_contribuicao_cents)}</p><p className="text-[11px] text-muted-foreground mt-2">{dre.data.margem_contribuicao_cents.basis}</p>{compare && <Delta curr={dre.data.margem_contribuicao_cents} prev={drePrev.data?.margem_contribuicao_cents} />}</li> : <Unavailable label="Margem de contribuição" basis={dre.data.margem_contribuicao_cents.basis} />}
          {dre.data.resultado_operacional_cents.available ? <li className="hp-card p-4 list-none"><p className="text-xs text-muted-foreground">Resultado operacional</p><p className={`mt-1 text-[1.5rem] leading-8 font-bold tabular ${Number(dre.data.resultado_operacional_cents.value) < 0 ? "text-destructive" : ""}`}>{mfmt(dre.data.resultado_operacional_cents)}</p><p className="text-[11px] text-muted-foreground mt-2">{dre.data.resultado_operacional_cents.basis}</p>{compare && <Delta curr={dre.data.resultado_operacional_cents} prev={drePrev.data?.resultado_operacional_cents} />}</li> : <Unavailable label="Resultado operacional" basis={dre.data.resultado_operacional_cents.basis} />}
        </ul>
        {!dre.data.deducoes_cents.available && (
          <p className="text-sm text-muted-foreground mb-6 hp-card p-3">Nenhuma categoria financeira tem classificação DRE ainda. Configure em <strong>Financeiro → Configurações → Categorias de despesa</strong> para liberar deduções, custos diretos, despesas operacionais, margem e resultado.</p>
        )}

        {dre.data.despesas_por_categoria.length > 0 && (
          <section className="mb-8"><h2 className="text-xl mb-3">Despesas por categoria</h2>
            <Table head={["Categoria", "Classificação DRE", "Valor"]} right={[2]}>{dre.data.despesas_por_categoria.map((c) => <tr key={c.category}><Td>{c.category}</Td><Td>{c.classification ? CLASS_LABEL[c.classification] : <span className="text-muted-foreground">Sem classificar</span>}</Td><Td num>{brl(c.amount_cents)}</Td></tr>)}</Table>
          </section>
        )}

        <section className="mb-8"><h2 className="text-xl mb-1">Margem por produto</h2>
          <p className="text-sm text-muted-foreground mb-3">Só disponível para o produto que tiver custo direto atribuído a ele especificamente (campo "Produto" em Contas a pagar). Os demais mostram a receita reconhecida, mas a margem fica indisponível — nunca estimada.</p>
          <State loading={margin.isLoading} error={margin.error} empty={margin.data?.length === 0} emptyText="Sem receita reconhecida no período." />
          {margin.data && margin.data.length > 0 && <Table head={["Produto", "Receita reconhecida", "Custo direto", "Margem"]} right={[1, 2, 3]}>
            {margin.data.map((p) => <tr key={p.product_id}><Td>{p.product_name}</Td><Td num>{brl(p.recognized_cents)}</Td><Td num>{p.available ? brl(p.direct_cost_cents) : "—"}</Td><Td num className={!p.available ? "text-muted-foreground" : ""}>{p.available ? brl(p.margin_cents ?? 0) : "Indisponível"}</Td></tr>)}</Table>}
        </section>

        <section className="mb-8"><h2 className="text-xl mb-1">Lançamentos do período</h2>
          <State loading={lines.isLoading} error={lines.error} empty={lines.data?.length === 0} emptyText="Nenhuma conta paga no período." />
          {lines.data && lines.data.length > 0 && <Table head={["Data", "Descrição", "Categoria", "Classificação", "Valor"]} right={[4]}>
            {lines.data.map((l) => <tr key={l.id}><Td>{new Date(l.paid_at).toLocaleDateString("pt-BR")}</Td><Td>{l.description}</Td><Td>{l.category?.name ?? <span className="text-muted-foreground">Sem categoria</span>}</Td>
              <Td>{l.category?.dre_classification ? CLASS_LABEL[l.category.dre_classification] : <span className="text-muted-foreground">Sem classificar</span>}</Td><Td num>{brl(l.amount_cents)}</Td></tr>)}</Table>}
        </section>

        {revByUnit.data && revByUnit.data.length > 0 && (
          <section><h2 className="text-xl mb-1">Receita recebida por unidade</h2>
            <p className="text-sm text-muted-foreground mb-3">Recebido líquido de estorno. Rentabilidade por unidade com margem depende de custo direto atribuído por unidade, que este relatório ainda não separa.</p>
            <Table head={["Unidade", "Recebido"]} right={[1]}>{revByUnit.data.map((u) => <tr key={u.unit_id}><Td>{u.unit_name}</Td><Td num>{brl(u.received_cents)}</Td></tr>)}</Table>
          </section>
        )}
      </>)}
    </div>
  );
};

export default FinanceDre;
