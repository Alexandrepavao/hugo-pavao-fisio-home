import { useQuery } from "@tanstack/react-query";
import { supabase } from "@/lib/supabase";

/** Finanças pessoais: tudo passa por funções do banco (security definer) que exigem o acesso individual do proprietário; nada aqui decide permissão. */
export const pfRpc = async <T,>(fn: string, args: Record<string, unknown> = {}): Promise<T> => {
  const { data, error } = await supabase.rpc(fn, args);
  if (error) throw error;
  return data as T;
};

/** Acesso do usuário logado às finanças pessoais (concedido só pela operação; gestor NÃO tem por ser gestor). Erro (ex.: recurso não instalado) = sem acesso. */
export const usePfAccess = () => useQuery({
  queryKey: ["pf-access"], staleTime: 5 * 60_000, retry: false,
  queryFn: async () => { try { return (await pfRpc<{ enabled: boolean }>("pf_my_access")).enabled; } catch { return false; } },
});

// ---------------------------------------------------------------- tipos
export type PfKind = "income" | "expense";
export type PfStatus = "planned" | "open" | "partial" | "settled" | "cancelled";
export interface PfItem {
  key: string; source: "entry" | "virtual" | "invoice"; entry_id: string | null; series_id: string | null; occurrence_date: string | null; invoice_id: string | null; kind: PfKind;
  description: string; category_id: string | null; category_name: string | null; account_id: string | null; card_id: string | null; cal_date: string; due_date: string; cash_date: string | null; competence_date: string;
  amount_cents: number; settled_cents: number; remaining_cents: number; status: PfStatus; nature: "fixed" | "variable"; repetition: "single" | "recurring" | "installment"; is_estimate: boolean;
  installment: string | null; essential: boolean; cash_in: number; cash_out: number; is_card: boolean; no_estimate: boolean; overdue: boolean;
}
export interface PfRef { entry_id?: string; series_id?: string; occurrence_date?: string }
export const refOf = (i: Pick<PfItem, "entry_id" | "series_id" | "occurrence_date">): PfRef => (i.entry_id ? { entry_id: i.entry_id } : { series_id: i.series_id!, occurrence_date: i.occurrence_date! });
export interface PfCategory { id: string; name: string; kind: PfKind; parent_id: string | null; essential: boolean; active: boolean }
export interface PfAccount { id: string; name: string; kind: string; opening_balance_cents: number; opening_date: string; counts_for_reserve: boolean; active: boolean; balance_cents?: number }
export interface Kpi { value: number | null; available: boolean; basis?: string; formula?: string; detail?: string | null; [k: string]: unknown }

export const STATUS_LABEL: Record<PfStatus, string> = { planned: "Previsto", open: "Em aberto", partial: "Parcialmente liquidado", settled: "Liquidado", cancelled: "Cancelado" };
export const statusLabel = (i: Pick<PfItem, "status" | "kind">) => (i.status === "settled" ? (i.kind === "income" ? "Recebido" : "Pago") : i.status === "partial" ? (i.kind === "income" ? "Recebido em parte" : "Pago em parte") : STATUS_LABEL[i.status]);
export const FREQ_LABEL: Record<string, string> = { weekly: "Semanal (a cada 7 dias)", biweekly: "A cada 14 dias", semimonthly: "Duas vezes por mês", monthly: "Mensal", quarterly: "Trimestral", semiannual: "Semestral", annual: "Anual" };
export const ACCOUNT_KIND: Record<string, string> = { checking: "Conta corrente", savings: "Poupança/reserva", cash: "Dinheiro", wallet: "Carteira digital", investment: "Investimento" };

// ---------------------------------------------------------------- datas financeiras (sem fuso: sempre "AAAA-MM-DD")
export const todayYmd = (): string => new Intl.DateTimeFormat("sv-SE", { timeZone: "America/Sao_Paulo" }).format(new Date());
export const fmtYmd = (s: string | null | undefined): string => (s ? `${s.slice(8, 10)}/${s.slice(5, 7)}/${s.slice(0, 4)}` : "—");
export const fmtYmdShort = (s: string): string => `${s.slice(8, 10)}/${s.slice(5, 7)}`;
export const monthOf = (ymd: string): string => ymd.slice(0, 7);
export const monthBounds = (ym: string): { from: string; to: string } => {
  const [y, m] = ym.split("-").map(Number); const last = new Date(Date.UTC(y, m, 0)).getUTCDate();
  return { from: `${ym}-01`, to: `${ym}-${String(last).padStart(2, "0")}` };
};
export const addMonthsYm = (ym: string, n: number): string => { const [y, m] = ym.split("-").map(Number); const d = new Date(Date.UTC(y, m - 1 + n, 1)); return `${d.getUTCFullYear()}-${String(d.getUTCMonth() + 1).padStart(2, "0")}`; };
export const addDaysYmd = (s: string, n: number): string => { const d = new Date(`${s}T12:00:00Z`); d.setUTCDate(d.getUTCDate() + n); return d.toISOString().slice(0, 10); };
export const monthLabel = (ym: string): string => new Date(`${ym}-01T12:00:00Z`).toLocaleDateString("pt-BR", { month: "long", year: "numeric", timeZone: "UTC" });
export const monthShort = (ym: string): string => new Date(`${ym}-01T12:00:00Z`).toLocaleDateString("pt-BR", { month: "short", year: "2-digit", timeZone: "UTC" }).replace(".", "");
export const weekdayOf = (ymd: string): number => new Date(`${ymd}T12:00:00Z`).getUTCDay();

/** Valor em reais para gráficos (os totais continuam em centavos inteiros). */
export const reais = (cents: number): number => Math.round(cents) / 100;
