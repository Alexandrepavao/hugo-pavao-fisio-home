import { useSearchParams } from "react-router-dom";

export type LineFilter = "geral" | "physio" | "academy";

/** Seletor de linha de negócio na URL (?linha=geral|physio|academy) — o mesmo em Visão geral e DRE. */
export const useLineFilter = (): [LineFilter, (v: LineFilter) => void] => {
  const [sp, setSp] = useSearchParams();
  const raw = sp.get("linha"); const v: LineFilter = raw === "physio" || raw === "academy" ? raw : "geral";
  return [v, (n) => { const next = new URLSearchParams(sp); if (n === "geral") next.delete("linha"); else next.set("linha", n); setSp(next, { replace: true }); }];
};

/** Nome de cada linha/balde como aparece nas telas (um lugar só, para não divergir entre Financeiro, Recorrência, Eficiência e Conciliação). */
export const BUCKET_LABEL: Record<string, string> = { physio: "HP Fisioterapia", academy: "HP Academy", shared: "Compartilhado / não alocado", unclassified: "Não classificado", total: "Geral" };
export const lineFilterLabel = (l: LineFilter) => (l === "geral" ? "Geral" : BUCKET_LABEL[l]);
