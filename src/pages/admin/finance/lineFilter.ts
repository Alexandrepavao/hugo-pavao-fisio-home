import { useSearchParams } from "react-router-dom";

export type LineFilter = "geral" | "physio" | "academy";

/** Seletor de linha de negócio na URL (?linha=geral|physio|academy) — o mesmo em Visão geral e DRE. */
export const useLineFilter = (): [LineFilter, (v: LineFilter) => void] => {
  const [sp, setSp] = useSearchParams();
  const raw = sp.get("linha"); const v: LineFilter = raw === "physio" || raw === "academy" ? raw : "geral";
  return [v, (n) => { const next = new URLSearchParams(sp); if (n === "geral") next.delete("linha"); else next.set("linha", n); setSp(next, { replace: true }); }];
};
