import { useState } from "react";
import { useSearchParams } from "react-router-dom";
import { useQuery } from "@tanstack/react-query";
import { supabase } from "@/lib/supabase";

/** {value, available, basis} — o mesmo formato usado em toda função de indicador no banco (nunca zero fictício).
 * Compartilhado entre módulos (Financeiro, Pesquisas, …) — não é particularidade de nenhum deles. */
export interface Metric { value: number | string | null; available: boolean; basis: string; [k: string]: unknown }
export const mfmt = (m: Metric | undefined, kind: "brl" | "pct" | "int" | "num" = "brl"): string => {
  if (!m || !m.available || m.value == null) return "Indisponível";
  const v = Number(m.value);
  if (kind === "brl") return new Intl.NumberFormat("pt-BR", { style: "currency", currency: "BRL" }).format(v / 100);
  if (kind === "pct") return `${v.toString().replace(".", ",")}%`;
  return v.toLocaleString("pt-BR");
};

export const useUnits = () => useQuery({ queryKey: ["units-shared"], queryFn: async () => (await supabase.from("units").select("id, name").eq("active", true)).data ?? [] });

/** Intervalo de datas com atalhos comuns — reaproveitado em qualquer tela que filtre por período (Início, Financeiro, Pesquisas, …). */
export const iso = (d: Date) => d.toISOString().slice(0, 10);
export const monthStart = (d = new Date()) => new Date(d.getFullYear(), d.getMonth(), 1);
export const RANGE_PRESETS = ["hoje", "7dias", "mes", "mes_anterior", "ano", "personalizado"] as const;
export type RangePreset = (typeof RANGE_PRESETS)[number];
export const RANGE_LABEL: Record<RangePreset, string> = { hoje: "Hoje", "7dias": "Últimos 7 dias", mes: "Mês atual", mes_anterior: "Mês anterior", ano: "Ano atual", personalizado: "Personalizado" };
export const presetRange = (p: RangePreset): { from: string; to: string } => {
  const today = new Date();
  if (p === "hoje") return { from: iso(today), to: iso(today) };
  if (p === "7dias") return { from: iso(new Date(today.getTime() - 6 * 864e5)), to: iso(today) };
  if (p === "mes") return { from: iso(monthStart(today)), to: iso(today) };
  if (p === "mes_anterior") { const f = new Date(today.getFullYear(), today.getMonth() - 1, 1); const t = new Date(today.getFullYear(), today.getMonth(), 0); return { from: iso(f), to: iso(t) }; }
  if (p === "ano") return { from: iso(new Date(today.getFullYear(), 0, 1)), to: iso(today) };
  return { from: iso(monthStart(today)), to: iso(today) };
};
/** Formata eixo de gráfico em reais compactos, sem casas quebradas em valores pequenos (0,001k). */
export const axisBrl = (v: number) => (v === 0 ? "0" : Math.abs(v) >= 1000 ? `${Math.round(v / 1000)}k` : Math.round(v).toString());

/** Fim exclusivo (00:00 do dia seguinte) para consultas timestamptz [from, to). */
export const toExclusive = (dateStr: string) => new Date(new Date(dateStr + "T00:00:00").getTime() + 864e5).toISOString();
export const fromInclusive = (dateStr: string) => new Date(dateStr + "T00:00:00").toISOString();

/** Estado do filtro de período/unidade/comparação persistido na URL (?periodo=&de=&ate=&unidade=&comparar=) —
 * sobrevive a reload, voltar/avançar e a compartilhar o link. Usado por qualquer tela com o PeriodFilter compacto. */
export const usePeriodFilterState = () => {
  const [sp, setSp] = useSearchParams();
  const spPreset = sp.get("periodo") as RangePreset | null;
  const [preset, setPresetState] = useState<RangePreset>(spPreset && RANGE_PRESETS.includes(spPreset) ? spPreset : "mes");
  const [custom, setCustom] = useState(preset === "personalizado" && sp.get("de") && sp.get("ate") ? { from: sp.get("de")!, to: sp.get("ate")! } : presetRange(preset));
  const [unit, setUnit] = useState(sp.get("unidade") ?? "");
  const [compare, setCompare] = useState(sp.get("comparar") === "1");

  const sync = (next: { preset?: RangePreset; from?: string; to?: string; unit?: string; compare?: boolean }) => {
    const p = next.preset ?? preset; const u = next.unit ?? unit; const c = next.compare ?? compare;
    const range = p === "personalizado" ? { from: next.from ?? custom.from, to: next.to ?? custom.to } : presetRange(p);
    const params: Record<string, string> = { periodo: p };
    if (p === "personalizado") { params.de = range.from; params.ate = range.to; }
    if (u) params.unidade = u;
    if (c) params.comparar = "1";
    setSp(params, { replace: true });
  };
  const onPreset = (p: RangePreset) => { setPresetState(p); if (p !== "personalizado") setCustom(presetRange(p)); sync({ preset: p }); };
  const onFrom = (v: string) => { setCustom((c) => ({ ...c, from: v })); sync({ preset: "personalizado", from: v }); };
  const onTo = (v: string) => { setCustom((c) => ({ ...c, to: v })); sync({ preset: "personalizado", to: v }); };
  const onUnit = (v: string) => { setUnit(v); sync({ unit: v }); };
  const onCompare = (v: boolean) => { setCompare(v); sync({ compare: v }); };
  const onClear = () => { setPresetState("mes"); setCustom(presetRange("mes")); setUnit(""); setCompare(false); setSp({}, { replace: true }); };

  return { preset, custom, unit, compare, onPreset, onFrom, onTo, onUnit, onCompare, onClear };
};
