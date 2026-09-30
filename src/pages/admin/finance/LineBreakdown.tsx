import { Link } from "react-router-dom";
import { useQuery } from "@tanstack/react-query";
import { CheckCircle2, AlertTriangle } from "lucide-react";
import { supabase } from "@/lib/supabase";
import { brl } from "@/lib/format";
import { State, StatCard } from "@/lib/ui";

import type { LineFilter } from "./lineFilter";
interface Bucket {
  key: string; label: string; sales_cents: number; receipts_cents: number; refunds_cents: number; net_receipts_cents: number; forecast_receivables_cents: number;
  recognized_cents: number; commissions_cents: number; expenses_paid_cents: number; expenses_competence_cents: number; expenses_forecast_cents: number;
  deducoes_cents: number; custos_diretos_cents: number; despesas_operacionais_cents: number; sem_classificacao_cents: number; resultado_operacional_cents: number; resultado_caixa_cents: number;
}
interface ByLine {
  lines: Bucket[]; total: Bucket; unclassified_products: number; unclassified_payables_open_or_paid: number; shared_without_allocation: number;
  reconciliation: { ok: boolean; checks: { metric: string; lines_total_cents: number; direct_cents: number; ok: boolean }[] };
}
const COLS: { key: "physio" | "academy" | "shared" | "unclassified" | "total"; label: string }[] = [
  { key: "physio", label: "HP Fisioterapia" }, { key: "academy", label: "HP Academy" }, { key: "shared", label: "Compartilhado / não alocado" }, { key: "unclassified", label: "Não classificado" }, { key: "total", label: "Geral" },
];
const OVERVIEW_ROWS: { field: keyof Bucket; label: string; basis: string }[] = [
  { field: "sales_cents", label: "Vendas confirmadas", basis: "competência comercial: total das vendas confirmadas no período" },
  { field: "receipts_cents", label: "Recebimentos", basis: "caixa: pagamentos recebidos no período" },
  { field: "refunds_cents", label: "Estornos", basis: "caixa: estornos registrados no período" },
  { field: "net_receipts_cents", label: "Recebido líquido", basis: "caixa: recebimentos − estornos" },
  { field: "forecast_receivables_cents", label: "A receber (previsão)", basis: "previsão: saldo em aberto das parcelas que vencem no período" },
  { field: "recognized_cents", label: "Receita reconhecida", basis: "competência do serviço: mesma regra da DRE (pacote = sessões realizadas × valor/sessão)" },
  { field: "commissions_cents", label: "Comissões", basis: "atribuídas pela venda que gerou o pagamento (estorno = negativo)" },
  { field: "expenses_paid_cents", label: "Despesas pagas", basis: "caixa: contas pagas no período" },
  { field: "expenses_competence_cents", label: "Despesas (competência)", basis: "competência: contas não canceladas com mês de competência no período" },
  { field: "expenses_forecast_cents", label: "Despesas a pagar (previsão)", basis: "previsão: contas em aberto que vencem no período" },
  { field: "resultado_caixa_cents", label: "Resultado de caixa", basis: "recebido líquido − despesas pagas (NÃO é lucro contábil)" },
];
const DRE_ROWS: { field: keyof Bucket; label: string; basis: string }[] = [
  { field: "recognized_cents", label: "Receita reconhecida", basis: "mesma regra da DRE consolidada" },
  { field: "deducoes_cents", label: "Deduções", basis: "contas pagas de categoria classificada como dedução" },
  { field: "custos_diretos_cents", label: "Custos diretos", basis: "contas pagas de categoria classificada como custo direto" },
  { field: "despesas_operacionais_cents", label: "Despesas operacionais", basis: "contas pagas de categoria classificada como despesa operacional" },
  { field: "sem_classificacao_cents", label: "Despesas sem classificação na DRE", basis: "contas pagas sem categoria ou com categoria ainda sem classificação — ficam fora do resultado operacional" },
  { field: "resultado_operacional_cents", label: "Resultado operacional", basis: "receita reconhecida − deduções − custos diretos − despesas operacionais (as compartilhadas/não classificadas aparecem nas próprias colunas)" },
];

export const LineSelector = ({ value, onChange }: { value: LineFilter; onChange: (v: LineFilter) => void }) => (
  <div role="group" aria-label="Linha de negócio" className="inline-flex rounded-full border border-input overflow-hidden">
    {([["geral", "Geral"], ["physio", "HP Fisioterapia"], ["academy", "HP Academy"]] as [LineFilter, string][]).map(([k, l]) => (
      <button key={k} aria-pressed={value === k} onClick={() => onChange(k)} className={`hp-btn hp-btn-sm rounded-none border-0 ${value === k ? "hp-btn-primary" : "hp-btn-outline"}`}>{l}</button>))}
  </div>
);

/** Quadro por linha de negócio (mesma organização): HP Fisioterapia, HP Academy, compartilhado/não alocado e não classificado, com o consolidado ("Geral")
 *  e a conferência de que Geral = soma das partes (vs. os totais diretos das tabelas). `mode="dre"` mostra a estrutura da DRE; `overview` mostra caixa, competência e previsão separados. */
const LineBreakdown = ({ fromIso, toIso, unit, mode, line }: { fromIso: string; toIso: string; unit: string; mode: "overview" | "dre"; line: LineFilter }) => {
  const q = useQuery({ queryKey: ["finance-by-line", fromIso, toIso, unit], queryFn: async () => {
    const { data, error } = await supabase.rpc("finance_by_line", { p_from: fromIso, p_to: toIso, p_unit: unit || null });
    if (error) throw error; return data as ByLine;
  } });
  const d = q.data; const rows = mode === "dre" ? DRE_ROWS : OVERVIEW_ROWS;
  const bucket = (k: string) => (k === "total" ? d?.total : d?.lines.find((l) => l.key === k));
  const cur = line === "geral" ? d?.total : bucket(line);
  const cards: { label: string; field: keyof Bucket }[] = mode === "dre"
    ? [{ label: "Receita reconhecida", field: "recognized_cents" }, { label: "Custos diretos", field: "custos_diretos_cents" }, { label: "Despesas operacionais", field: "despesas_operacionais_cents" }, { label: "Resultado operacional", field: "resultado_operacional_cents" }]
    : [{ label: "Recebido líquido (caixa)", field: "net_receipts_cents" }, { label: "Vendas confirmadas", field: "sales_cents" }, { label: "Despesas pagas (caixa)", field: "expenses_paid_cents" }, { label: "Resultado de caixa", field: "resultado_caixa_cents" }];
  const lineLabel = line === "geral" ? "Geral" : line === "physio" ? "HP Fisioterapia" : "HP Academy";

  return (
    <section aria-label="Por linha de negócio" className="grid gap-4">
      <State loading={q.isLoading} error={q.error} />
      {d && cur && (<>
        <ul className="grid gap-3 sm:grid-cols-2 lg:grid-cols-4">
          {cards.map((c) => <StatCard key={c.field} label={`${c.label} — ${lineLabel}`} value={brl(Number(cur[c.field]))} basis={[...rows, ...OVERVIEW_ROWS].find((r) => r.field === c.field)?.basis} />)}
        </ul>
        {(d.unclassified_products > 0 || d.unclassified_payables_open_or_paid > 0 || d.shared_without_allocation > 0) && (
          <div className="hp-card p-3 text-sm flex gap-2 items-start" role="note">
            <AlertTriangle size={16} aria-hidden className="mt-0.5 shrink-0" style={{ color: "hsl(var(--warning, 38 90% 45%))" }} />
            <p className="text-muted-foreground">
              {d.unclassified_products > 0 && <>{d.unclassified_products} produto(s) ativo(s) ainda <b>não classificado(s)</b> (a receita deles aparece em “Não classificado”) — classifique em <Link className="text-accent underline" to="/admin/configuracoes">Configurações › Operação</Link>. </>}
              {d.unclassified_payables_open_or_paid > 0 && <>{d.unclassified_payables_open_or_paid} despesa(s) sem linha — classifique em <Link className="text-accent underline" to="/admin/financeiro/contas-a-pagar">Contas a pagar</Link>. </>}
              {d.shared_without_allocation > 0 && <>{d.shared_without_allocation} despesa(s) compartilhada(s) sem rateio (ficam em “Compartilhado / não alocado”).</>}
            </p>
          </div>)}
        <div className="overflow-x-auto hp-card">
          <table className="w-full text-sm">
            <thead><tr className="text-left text-xs text-muted-foreground border-b border-border"><th className="p-3 font-medium">{mode === "dre" ? "DRE por linha" : "Indicador"}</th>
              {COLS.map((c) => <th key={c.key} className={`p-3 font-medium text-right whitespace-nowrap ${c.key === line ? "text-foreground" : ""}`}>{c.label}</th>)}</tr></thead>
            <tbody>
              {rows.map((r) => (
                <tr key={r.field} className="border-b border-border last:border-0" title={r.basis}>
                  <td className="p-3">{r.label}</td>
                  {COLS.map((c) => { const b = bucket(c.key); const v = b ? Number(b[r.field]) : 0;
                    return <td key={c.key} className={`p-3 text-right tabular ${c.key === line || (line === "geral" && c.key === "total") ? "font-semibold" : ""} ${v < 0 ? "text-destructive" : ""}`}>{brl(v)}</td>; })}
                </tr>))}
            </tbody>
          </table>
        </div>
        <p className="text-[11px] leading-4 text-muted-foreground">
          Geral = HP Fisioterapia + HP Academy + Compartilhado/não alocado + Não classificado. Vendas com itens das duas linhas são divididas pelo líquido de cada item (desconto diluído), em centavos exatos.
          Despesa compartilhada só é dividida quando há rateio explícito. Caixa, competência e previsão são apresentados separados — a linha só atribui os valores.
        </p>
        <div className="hp-card p-3" role="status" aria-label="Conferência com o consolidado">
          <p className="text-sm font-medium flex items-center gap-2">
            {d.reconciliation.ok ? <><CheckCircle2 size={16} aria-hidden style={{ color: "hsl(var(--success))" }} />Conferido: o total das linhas bate com os totais diretos das tabelas</>
              : <><AlertTriangle size={16} aria-hidden style={{ color: "hsl(var(--destructive))" }} />Divergência entre o total das linhas e os totais diretos — não use estes números até revisar</>}
          </p>
          <ul className="mt-2 grid gap-1 text-xs text-muted-foreground sm:grid-cols-2">
            {d.reconciliation.checks.map((c) => (
              <li key={c.metric} className="flex justify-between gap-2"><span>{c.ok ? "✓" : "✗"} {c.metric}</span><span className="tabular">{brl(Number(c.lines_total_cents))} {c.ok ? "=" : "≠"} {brl(Number(c.direct_cents))}</span></li>))}
          </ul>
        </div>
      </>)}
    </section>
  );
};

export default LineBreakdown;
