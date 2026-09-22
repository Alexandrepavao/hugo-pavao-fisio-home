import { useQuery } from "@tanstack/react-query";
import { supabase } from "@/lib/supabase";

export interface Sale { id: string; status: string; total_cents: number; discount_cents: number; installments: number; sold_at: string | null; created_at: string; unit_id: string; person: { full_name: string } | null }
export interface Rec { id: string; installment_no: number; installments_total: number; due_date: string; amount_cents: number; status: string; sale_id: string; person: { full_name: string } | null }
export interface Pay { id: string; kind: string; amount_cents: number; paid_at: string; method: string | null; receivable_id: string; refund_of: string | null }
export interface Account { id: string; name: string }
export const SALE_ST: Record<string, string> = { pending: "Pendente", confirmed: "Confirmada", cancelled: "Cancelada" };
export const REC_ST: Record<string, string> = { open: "Em aberto", partial: "Parcial", paid: "Paga", cancelled: "Cancelada", refunded: "Estornada" };

/** {value, available, basis} — o mesmo formato usado em toda função de indicador no banco (nunca zero fictício). */
export interface Metric { value: number | string | null; available: boolean; basis: string; [k: string]: unknown }
export const mfmt = (m: Metric | undefined, kind: "brl" | "pct" | "int" | "num" = "brl"): string => {
  if (!m || !m.available || m.value == null) return "Indisponível";
  const v = Number(m.value);
  if (kind === "brl") return new Intl.NumberFormat("pt-BR", { style: "currency", currency: "BRL" }).format(v / 100);
  if (kind === "pct") return `${v.toString().replace(".", ",")}%`;
  return v.toLocaleString("pt-BR");
};

export const useUnits = () => useQuery({ queryKey: ["units-fin"], queryFn: async () => (await supabase.from("units").select("id, name").eq("active", true)).data ?? [] });

/** Intervalo de datas com atalhos comuns — reaproveitado em todas as telas de Financeiro que filtram por período. */
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
