import { useQuery } from "@tanstack/react-query";
import { supabase } from "@/lib/supabase";
import { BUCKET_LABEL } from "./lineFilter";

/** Conferência devolvida pelas funções por linha: soma das linhas × total direto da base original. */
export interface Conference { ok: boolean; checks: { metric: string; lines_total_cents: number; direct_cents: number; ok: boolean }[] }

// ---------------------------------------------------------------- Recorrência (mrr_by_line / mrr_history_by_line)
export interface MrrLine {
  key: string; label: string; mrr_inicial_cents: number; novo_cents: number; expansao_cents: number; reativacao_cents: number; contracao_cents: number; cancelamento_cents: number;
  mrr_cents: number; arr_cents: number; contratos: number; clientes: number; clientes_inicial: number; clientes_perdidos: number; ponte_fecha: boolean;
  churn_receita_pct: number | null; retencao_bruta_pct: number | null; retencao_liquida_pct: number | null; churn_clientes_pct: number | null; receita_media_cliente_cents: number | null;
}
export interface MrrByLine {
  month: string; lines: MrrLine[]; unclassified_contracts: number; reconciliation: Conference;
  total: { mrr_inicial_cents: number; novo_cents: number; expansao_cents: number; reativacao_cents: number; contracao_cents: number; cancelamento_cents: number; mrr_cents: number; arr_cents: number; contratos: number; clientes: number };
}
export interface MrrHistoryByLine { month: string; physio: number; academy: number; unclassified: number; total: number }

// Consultas tolerantes: sem a migration 060 a tela principal continua funcionando e só a parte por linha mostra o erro.
export const useMrrByLine = (month: string, unit: string) => useQuery({ queryKey: ["mrr-by-line", month, unit], retry: false, queryFn: async () => {
  const { data, error } = await supabase.rpc("mrr_by_line", { p_month: `${month}-01`, p_unit: unit || null }); if (error) throw error; return data as MrrByLine;
} });
export const useMrrHistoryByLine = (unit: string) => useQuery({ queryKey: ["mrr-hist-by-line", unit], retry: false, queryFn: async () => {
  const { data, error } = await supabase.rpc("mrr_history_by_line", { p_months: 12, p_unit: unit || null }); if (error) throw error; return data as MrrHistoryByLine[];
} });
/** product_id → linha do produto (para separar a projeção de mensalidades, que já devolve o produto). */
export const useProductLines = () => useQuery({ queryKey: ["product-lines"], retry: false, queryFn: async () => {
  const { data, error } = await supabase.from("products").select("id, business_line"); if (error) throw error;
  return Object.fromEntries((data ?? []).map((p) => [p.id as string, p.business_line as string])) as Record<string, string>;
} });

// ---------------------------------------------------------------- Eficiência (efficiency_by_line)
export interface EffLine {
  key: string; label: string; net_received_cents: number; paying_patients: number; attended_sessions: number; buyers: number; repeat_buyers: number;
  revenue_per_patient_cents: number | null; revenue_per_session_cents: number | null; repurchase_pct: number | null;
}
export interface EffByLine {
  lines: EffLine[]; reconciliation: Conference;
  general: { net_received_cents: number; attended_sessions: number; paying_patients: number; buyers: number; repeat_buyers: number; revenue_per_patient_cents: number | null; revenue_per_session_cents: number | null; repurchase_pct: number | null };
  concentration: { product_name: string; business_line: string; received_cents: number; share_pct_of_line: number | null }[];
}
export const useEfficiencyByLine = (fromIso: string, toIso: string, unit: string) => useQuery({ queryKey: ["eff-by-line", fromIso, toIso, unit], retry: false, queryFn: async () => {
  const { data, error } = await supabase.rpc("efficiency_by_line", { p_from: fromIso, p_to: toIso, p_unit: unit || null }); if (error) throw error; return data as EffByLine;
} });

// ---------------------------------------------------------------- Conciliação (bank_by_line / bank_line_shares)
export interface BankBucket { key: string; label: string; inflow_cents: number; outflow_cents: number; net_cents: number; movements: number; from_entries: number; manual_allocations: number }
export interface BankByLine {
  lines: BankBucket[]; total: { inflow_cents: number; outflow_cents: number; net_cents: number };
  statement: { inflow_cents: number; outflow_cents: number; net_cents: number; movements: number; matched: number; ignored: number; unmatched: number };
  unallocated_movements: number; reconciliation: Conference;
}
export const useBankByLine = (from: string, to: string, unit: string, account: string) => useQuery({ queryKey: ["bank-by-line", from, to, unit, account], retry: false, queryFn: async () => {
  const { data, error } = await supabase.rpc("bank_by_line", { p_from: from, p_to: to, p_unit: unit || null, p_account: account || null }); if (error) throw error; return data as BankByLine;
} });

export interface BankShare { bucket: string; cents: number; origin: "recebimento" | "conta_a_pagar" | "alocacao_manual" | "sem_alocacao" }
export const ORIGIN_LABEL: Record<BankShare["origin"], string> = { recebimento: "do recebimento conciliado", conta_a_pagar: "da conta paga conciliada", alocacao_manual: "alocação manual", sem_alocacao: "sem alocação" };
/** Linha(s) efetiva(s) de cada movimento do extrato — o extrato original não é alterado; isto é uma camada à parte. */
export const useBankShares = (ids: string[]) => {
  const key = [...new Set(ids)].sort().join(",");
  return useQuery({ queryKey: ["bank-shares", key], enabled: ids.length > 0, retry: false, queryFn: async () => {
    const uniq = [...new Set(ids)]; const out: Record<string, BankShare[]> = {};
    for (let i = 0; i < uniq.length; i += 100) {
      const { data, error } = await supabase.rpc("bank_line_shares", { p_line_ids: uniq.slice(i, i + 100) }); if (error) throw error;
      for (const r of data as { line_id: string; bucket: string; cents: number; origin: BankShare["origin"] }[]) (out[r.line_id] ??= []).push({ bucket: r.bucket, cents: Number(r.cents), origin: r.origin });
    }
    return out;
  } });
};

/** Texto curto da(s) linha(s) de um movimento: uma só → o nome; mais de uma → a proporção de cada. */
export const sharesLabel = (shares?: BankShare[]) => {
  if (!shares || shares.length === 0) return "—";
  const pos = shares.filter((s) => s.cents !== 0); if (pos.length === 0) return "—";
  if (pos.length === 1) return BUCKET_LABEL[pos[0].bucket] ?? pos[0].bucket;
  const total = pos.reduce((a, s) => a + Math.abs(s.cents), 0);
  return pos.map((s) => `${BUCKET_LABEL[s.bucket] ?? s.bucket} ${(Math.round((1000 * Math.abs(s.cents)) / total) / 10).toString().replace(".", ",")}%`).join(" / ");
};
