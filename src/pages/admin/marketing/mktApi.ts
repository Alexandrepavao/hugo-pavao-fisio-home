import { useCallback, useMemo, useState } from "react";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { useSearchParams } from "react-router-dom";
import { supabase } from "@/lib/supabase";
import { presetRange, usePeriodFilterState } from "@/lib/period";

// ---------------------------------------------------------------- tipos devolvidos pelas funções mkt_* (migrations 104–112)
export interface Kpi { key: string; label: string; value: number | null; unit: string; available: boolean; reason?: string | null; formula: string; source: string; granularity: string; denominator?: string | null; detail?: string | null; warning?: string | null }
export interface Coverage { accounts: number; expected_days: number; ok_days: number; failed_days: number; missing_days: number; stale_accounts: number; last_ok_at: string | null; incomplete: boolean }
export interface KpisResp { period: { from: string; to: string }; previous_period: { from: string; to: string }; view: "event" | "cohort"; model: { name: string; window_days: string; config_version: string }; coverage: Coverage;
  currency: string; other_currencies: Record<string, { spend: number }>; kpis: Kpi[]; previous_kpis: Kpi[]; unlinked_paid_leads: number }
export interface FunnelStep { key: string; label: string; count: number | null; available: boolean; reason?: string | null; rate_from_previous: number | null; rate_from_first: number | null }
export interface FunnelResp { view: string; steps: FunnelStep[]; basis: string; model: { name: string; window_days: string }; hub_confirmed: { leads: number; sales: number; new_buyers: number; sold: number };
  provider_reported: { by_currency: Record<string, { reported_results: number | null }>; note: string }; coverage: Coverage }
export interface SeriesResp { granularity: "day" | "week"; currency: string; points: { day: string; spend: number | null; leads: number; qualified: number; sales: number; received: number }[]; note: string }
export interface CampaignRow { campaign_id: string; name: string; platform: string; account: string; external_id: string; origin: string; platform_objective: string | null; platform_status: string | null; class_state: string; include_in_hub: boolean;
  include_in_reports: boolean; front: string | null; purpose: string | null; primary_result: string | null; spend: number | null; impressions: number | null; clicks: number | null; reported_results: number | null; other_currency: string | null;
  ctr: number | null; cpc: number | null; leads: number; qualified: number; sales: number; sold: number; received: number; cpl: number | null; roas: number | null }
export interface AdRow { id: string; name: string; status: string | null; creative: string | null; campaign: string; spend: number | null; impressions: number | null; clicks: number | null; reported_results: number | null; ctr: number | null; cpc: number | null }
export interface Reconciliation { currency: string; total: number; parts: { key: string; label: string; spend: number; campaigns: number }[]; sum_of_parts: number; reconciles: boolean; other_currencies_not_summed: Record<string, number>; excluded_by_overlap: number; note: string }
export interface QualityItem { key: string; label: string; count: number; amount?: number; severity: "ok" | "info" | "warn" | "bad"; detail: string; hint: string }
export interface Option { id: string; name?: string; label?: string; platform?: string; enabled?: boolean; status?: string; origin?: string; account_id?: string; state?: string }
export interface FilterOptions { units: Option[]; fronts: Option[]; purposes: Option[]; platforms: Option[]; accounts: Option[]; campaigns: Option[]; products: Option[]; pipelines: Option[]; owners: Option[]; is_admin: boolean }

export const MKT_COLORS = ["hsl(var(--chart-1))", "hsl(var(--chart-2))", "hsl(var(--chart-4))", "hsl(var(--chart-5))", "hsl(var(--chart-6))"];   // sem o verde do tema
export const PLATFORM_LABEL: Record<string, string> = { meta: "Meta Ads", google: "Google Ads" };

// ---------------------------------------------------------------- formatação
const cur = (v: number, c: string, dec = 2) => new Intl.NumberFormat("pt-BR", { style: "currency", currency: c, minimumFractionDigits: dec, maximumFractionDigits: dec }).format(v);
export const money = (v: number | null | undefined, c = "BRL", dec = 2) => (v == null ? "—" : cur(v, c, dec));
export const num = (v: number | null | undefined) => (v == null ? "—" : Number(v).toLocaleString("pt-BR", { maximumFractionDigits: 1 }));
export const fmtKpi = (k: Kpi, c = "BRL") => {
  if (!k.available || k.value == null) return "Não disponível";
  if (k.unit === "%") return `${Number(k.value).toLocaleString("pt-BR", { maximumFractionDigits: 2 })}%`;
  if (k.unit === "x") return `${Number(k.value).toLocaleString("pt-BR", { maximumFractionDigits: 2 })}x`;
  if (k.unit === "min") return `${Number(k.value).toLocaleString("pt-BR", { maximumFractionDigits: 1 })} min`;
  if (k.unit === "n") return Number(k.value).toLocaleString("pt-BR", { maximumFractionDigits: 1 });
  return cur(Number(k.value), k.unit || c, ["spend", "sold", "received", "payouts_pending", "payouts_authorized", "payouts_paid"].includes(k.key) ? 0 : 2);
};
export const fmtDay = (iso: string) => new Date(iso.slice(0, 10) + "T12:00:00Z").toLocaleDateString("pt-BR", { day: "2-digit", month: "2-digit" });
export const when = (iso: string | null | undefined) => (iso ? new Date(iso).toLocaleString("pt-BR", { day: "2-digit", month: "2-digit", hour: "2-digit", minute: "2-digit", timeZone: "America/Sao_Paulo" }) : "nunca");
export const delta = (cur_: Kpi | undefined, prev: Kpi | undefined) => {
  if (!cur_?.available || !prev?.available || cur_.value == null || prev.value == null || prev.value === 0) return null;
  const d = ((cur_.value - prev.value) / Math.abs(prev.value)) * 100; return { dir: d > 0.05 ? "up" : d < -0.05 ? "down" : "flat" as "up" | "down" | "flat", text: `${d > 0 ? "+" : ""}${d.toLocaleString("pt-BR", { maximumFractionDigits: 1 })}% vs. período anterior` };
};
export const kpiOf = (r: KpisResp | undefined, key: string) => r?.kpis.find((k) => k.key === key);
export const prevOf = (r: KpisResp | undefined, key: string) => r?.previous_kpis.find((k) => k.key === key);

// ---------------------------------------------------------------- filtros compartilhados (URL como fonte de estado)
export const FILTER_KEYS = { frente: "front", plataforma: "platform", conta: "account", campanha: "campaign", finalidade: "purpose", produto: "product", funil: "pipeline", resp: "owner" } as const;
export function useMktFilters(defaultView: "event" | "cohort" = "event", scope: "hub" | "reports" | "all" = "hub") {
  const period = usePeriodFilterState(); const [sp, setSp] = useSearchParams();
  const range = period.preset === "personalizado" ? period.custom : presetRange(period.preset);
  const view = (sp.get("visao") === "coorte" ? "cohort" : sp.get("visao") === "evento" ? "event" : defaultView) as "event" | "cohort";
  const set = useCallback((k: string, v: string) => { const n = new URLSearchParams(sp); if (v) n.set(k, v); else n.delete(k); setSp(n, { replace: true }); }, [sp, setSp]);
  const filters = useMemo(() => {
    const f: Record<string, string> = { scope }; if (period.unit) f.unit = period.unit;
    for (const [url, key] of Object.entries(FILTER_KEYS)) { const v = sp.get(url); if (v) f[key] = v; }
    return f;
  }, [sp, period.unit, scope]);
  const extraCount = Object.keys(FILTER_KEYS).filter((k) => sp.get(k)).length;
  const clear = () => { period.onClear(); };
  return { period, range, view, setView: (v: "event" | "cohort") => set("visao", v === "cohort" ? "coorte" : "evento"), filters, get: (k: string) => sp.get(k) ?? "", set, extraCount, clear };
}
export type MktFilters = ReturnType<typeof useMktFilters>;

// ---------------------------------------------------------------- consultas
export function useMktRpc<T>(name: string, args: Record<string, unknown>, enabled = true) {
  return useQuery({ queryKey: ["mkt", name, JSON.stringify(args)], enabled, queryFn: async () => { const { data, error } = await supabase.rpc(name, args); if (error) throw error; return data as T; } });
}
export const useMktOptions = () => useMktRpc<FilterOptions>("mkt_filters", {});
export const rpcArgs = (f: MktFilters, extra: Record<string, unknown> = {}) => ({ p_from: f.range.from, p_to: f.range.to, p_filters: f.filters, ...extra });
export function useMktInvalidate() { const qc = useQueryClient(); return () => qc.invalidateQueries({ queryKey: ["mkt"] }); }

/** Chama a Edge Function marketing-ads com o JWT do usuário. */
export async function callMarketingFn<T = Record<string, unknown>>(route: string, method: "GET" | "POST", body?: unknown): Promise<{ ok: boolean; status: number; data: T }> {
  const { data: s } = await supabase.auth.getSession();
  const base = `${import.meta.env.VITE_SUPABASE_URL}/functions/v1/marketing-ads/${route}`;
  const r = await fetch(base, { method, headers: { Authorization: `Bearer ${s.session?.access_token ?? ""}`, apikey: String(import.meta.env.VITE_SUPABASE_PUBLISHABLE_KEY ?? import.meta.env.VITE_SUPABASE_ANON_KEY ?? ""), "Content-Type": "application/json" }, body: body ? JSON.stringify(body) : undefined });
  let data = {} as T; try { data = (await r.json()) as T; } catch { /* sem corpo */ }
  return { ok: r.ok, status: r.status, data };
}

/** Mensagem de resultado de uma ação (ok/erro) para o componente Msg. */
export function useNote() { const [msg, setMsg] = useState<{ kind: "ok" | "err"; text: string } | null>(null); return { msg, setMsg }; }
