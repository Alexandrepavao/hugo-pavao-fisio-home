import { useQuery } from "@tanstack/react-query";
import { supabase } from "@/lib/supabase";

export interface SaleLines { physio: number; academy: number; unclassified: number }
export type SaleLineFilter = "" | "physio" | "academy" | "mixed" | "unclassified";
export const SALE_LINE_FILTERS: [SaleLineFilter, string][] = [["", "Todas as linhas"], ["physio", "Contém HP Fisioterapia"], ["academy", "Contém HP Academy"], ["mixed", "Mista (Fisioterapia + Academy)"], ["unclassified", "Contém não classificado"]];

/** Linha(s) de cada venda, vindas do servidor (sale_line_shares): valor da venda dividido pelo líquido dos itens de cada linha, em centavos exatos. */
export const useSaleLines = (ids: string[]) => {
  const key = [...new Set(ids)].sort().join(",");
  return useQuery({ queryKey: ["sale-lines", key], enabled: ids.length > 0, queryFn: async () => {
    const uniq = [...new Set(ids)]; const out: Record<string, SaleLines> = {};
    for (let i = 0; i < uniq.length; i += 100) {
      const { data, error } = await supabase.rpc("sale_line_shares", { p_sale_ids: uniq.slice(i, i + 100) });
      if (error) throw error;
      for (const r of data as { sale_id: string; line: keyof SaleLines; cents: number }[]) { const o = (out[r.sale_id] ??= { physio: 0, academy: 0, unclassified: 0 }); o[r.line] += Number(r.cents); }
    }
    return out;
  } });
};

const pct = (v: number, t: number) => `${(Math.round((1000 * v) / t) / 10).toString().replace(".", ",")}%`;
/** Texto curto: uma linha só → o nome; mais de uma → “Mista” com a proporção de cada uma. */
export const saleLineLabel = (l?: SaleLines) => {
  if (!l) return "—";
  const parts = ([["physio", "Fisioterapia"], ["academy", "Academy"], ["unclassified", "Não classificado"]] as [keyof SaleLines, string][]).filter(([k]) => l[k] > 0);
  const total = l.physio + l.academy + l.unclassified;
  if (parts.length === 0) return "—";
  if (parts.length === 1) return parts[0][1] === "Fisioterapia" ? "HP Fisioterapia" : parts[0][1] === "Academy" ? "HP Academy" : "Não classificado";
  return `Mista: ${parts.map(([k, n]) => `${n} ${pct(l[k], total)}`).join(" / ")}`;
};
export const saleLineMatches = (l: SaleLines | undefined, f: SaleLineFilter) => {
  if (!f) return true; if (!l) return false;
  if (f === "mixed") return l.physio > 0 && l.academy > 0;
  return l[f] > 0;
};
