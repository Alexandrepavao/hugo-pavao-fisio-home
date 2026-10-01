import { useState } from "react";
import { useQuery } from "@tanstack/react-query";
import { supabase } from "@/lib/supabase";
import { brl } from "@/lib/format";
import { KpiGrid, LevelSection, PageHead, State, StatCard, Table, Td } from "@/lib/ui";
import { AlertTriangle, Repeat, Stethoscope, Users } from "lucide-react";
import { RANGE_LABEL } from "@/lib/period";
import { PeriodFilter } from "./PeriodFilter";
import EfficiencyLineSection from "./EfficiencyByLine";
import { useLineFilter } from "./lineFilter";
import { useEfficiencyByLine } from "./lineReports";
import { mfmt, presetRange, toExclusive, useUnits, type Metric, type RangePreset } from "./shared";

interface ProductShare { product_name: string; received_cents: number; share_pct: number }
interface Efficiency {
  receita_por_paciente_pagante_cents: Metric; receita_por_sessao_cents: Metric; taxa_recompra_pct: Metric;
  concentracao_por_produto: ProductShare[]; cac_cents: Metric; ltv_cents: Metric; cac_payback_months: Metric;
}

const csvDownload = (filename: string, rows: (string | number)[][]) => {
  const csv = rows.map((r) => r.map((c) => `"${String(c).replace(/"/g, '""')}"`).join(";")).join("\r\n");
  const blob = new Blob(["﻿" + csv], { type: "text/csv;charset=utf-8" });
  const url = URL.createObjectURL(blob); const a = document.createElement("a"); a.href = url; a.download = filename; a.click(); URL.revokeObjectURL(url);
};

const FinanceReports = () => {
  const [preset, setPreset] = useState<RangePreset>("mes");
  const [custom, setCustom] = useState(presetRange("mes"));
  const [unit, setUnit] = useState(""); const [compare, setCompare] = useState(false);
  const { from, to } = preset === "personalizado" ? custom : presetRange(preset);
  const units = useUnits();
  const per = RANGE_LABEL[preset];
  const [line, setLine] = useLineFilter();
  const effLine = useEfficiencyByLine(`${from}T00:00:00.000Z`, toExclusive(to), unit);
  const eff = useQuery({ queryKey: ["eff", from, to, unit], queryFn: async () => {
    const { data, error } = await supabase.rpc("efficiency_report", { p_from: `${from}T00:00:00.000Z`, p_to: toExclusive(to), p_unit: unit || null }); if (error) throw error; return data as Efficiency;
  } });
  const exportPayments = async () => {
    const { data } = await supabase.from("payments").select("paid_at, kind, amount_cents, method").gte("paid_at", `${from}T00:00:00.000Z`).lt("paid_at", toExclusive(to)).order("paid_at");
    csvDownload(`recebimentos_${from}_a_${to}.csv`, [["Data", "Tipo", "Valor (R$)", "Forma"], ...(data ?? []).map((p) => [new Date(p.paid_at).toLocaleString("pt-BR"), p.kind === "payment" ? "Recebimento" : "Estorno", (p.amount_cents / 100).toFixed(2), p.method ?? ""])]);
  };

  return (
    <div>
      <PageHead eyebrow="Financeiro" title="Relatórios" hint="Eficiência do negócio: só indicadores com base cadastrada real. CAC/LTV ficam indisponíveis sem dados de investimento em mídia."
        actions={
          <PeriodFilter preset={preset} from={custom.from} to={custom.to} unit={unit} units={units.data} compare={compare}
            onPreset={(p) => { setPreset(p); if (p !== "personalizado") setCustom(presetRange(p)); }} onFrom={(v) => setCustom((c) => ({ ...c, from: v }))} onTo={(v) => setCustom((c) => ({ ...c, to: v }))}
            onUnit={setUnit} onCompare={setCompare} onClear={() => { setPreset("mes"); setCustom(presetRange("mes")); setUnit(""); setCompare(false); setLine("geral"); }} line={line} onLine={setLine} />
        } />
      <State loading={eff.isLoading} error={eff.error} />
      {eff.data && (<>
        <LevelSection level="summary" title="Eficiência do negócio" hint="Consolidado (Geral) do período selecionado, só com base cadastrada real.">
          <KpiGrid kind="hero">
            <StatCard level="hero" icon={Users} period={per} label="Receita por paciente pagante" value={mfmt(eff.data.receita_por_paciente_pagante_cents)} basis={eff.data.receita_por_paciente_pagante_cents.basis} />
            <StatCard level="hero" icon={Stethoscope} period={per} label="Receita por sessão realizada" value={mfmt(eff.data.receita_por_sessao_cents)} basis={eff.data.receita_por_sessao_cents.basis} />
            <StatCard level="hero" icon={Repeat} period={per} label="Taxa de recompra" value={mfmt(eff.data.taxa_recompra_pct, "pct")} basis={eff.data.taxa_recompra_pct.basis} />
          </KpiGrid>
        </LevelSection>
        <LevelSection level="attention" title="Sem base de dados" hint="Indicadores que dependem de dados que ainda não existem no sistema — o motivo está em cada cartão.">
          <KpiGrid kind="lg">
            <StatCard icon={AlertTriangle} period="Indisponível" label="CAC" value={mfmt(eff.data.cac_cents)} basis={eff.data.cac_cents.basis} unavailable />
            <StatCard icon={AlertTriangle} period="Indisponível" label="LTV estimado" value={mfmt(eff.data.ltv_cents)} basis={eff.data.ltv_cents.basis} unavailable />
            <StatCard icon={AlertTriangle} period="Indisponível" label="Prazo de recuperação do CAC" value={mfmt(eff.data.cac_payback_months)} basis={eff.data.cac_payback_months.basis} unavailable />
          </KpiGrid>
        </LevelSection>
        <div className="flex flex-wrap items-center justify-between gap-3 mb-3">
          <p className="text-xs text-muted-foreground">Os cartões acima são o consolidado (Geral). Abaixo, a mesma leitura por linha de negócio — escolha a linha em Filtros ▸ Linha de negócio.</p>
        </div>
        <EfficiencyLineSection q={effLine} line={line} />
        <section className="mb-8"><h2 className="text-[1.0625rem] font-bold mb-3">Concentração de receita por produto — Geral</h2>
          <State empty={eff.data.concentracao_por_produto.length === 0} emptyText="Sem recebimentos no período." />
          {eff.data.concentracao_por_produto.length > 0 && <Table head={["Produto", "Recebido", "Participação"]} right={[1, 2]}>
            {eff.data.concentracao_por_produto.map((p) => <tr key={p.product_name}><Td>{p.product_name}</Td><Td num>{brl(p.received_cents)}</Td><Td num>{p.share_pct}%</Td></tr>)}</Table>}
        </section>
        <section><h2 className="text-[1.0625rem] font-bold mb-3">Exportações</h2>
          <button className="hp-btn hp-btn-outline" onClick={() => void exportPayments()}>Baixar recebimentos do período (CSV)</button>
        </section>
      </>)}
    </div>
  );
};

export default FinanceReports;
