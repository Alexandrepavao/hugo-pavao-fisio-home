export interface Sale { id: string; status: string; total_cents: number; discount_cents: number; installments: number; sold_at: string | null; created_at: string; unit_id: string; person: { full_name: string } | null }
export interface Rec { id: string; installment_no: number; installments_total: number; due_date: string; amount_cents: number; status: string; sale_id: string; person: { full_name: string } | null }
export interface Pay { id: string; kind: string; amount_cents: number; paid_at: string; method: string | null; receivable_id: string; refund_of: string | null }
export interface Account { id: string; name: string }
export const SALE_ST: Record<string, string> = { pending: "Pendente", confirmed: "Confirmada", cancelled: "Cancelada" };
export const REC_ST: Record<string, string> = { open: "Em aberto", partial: "Parcial", paid: "Paga", cancelled: "Cancelada", refunded: "Estornada" };

// Utilitários de período/unidade/métrica: uso geral (não é particularidade do Financeiro) — vivem em @/lib/period.
// Reexportados aqui para não quebrar os imports existentes das telas de Financeiro.
export type { Metric, RangePreset } from "@/lib/period";
export { mfmt, useUnits, iso, monthStart, RANGE_PRESETS, RANGE_LABEL, presetRange, axisBrl, toExclusive, fromInclusive } from "@/lib/period";
