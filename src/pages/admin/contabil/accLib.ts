import { createContext, useCallback, useContext } from "react";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { supabase } from "@/lib/supabase";
import { errText, type Tone } from "@/lib/ui";

export interface AccUnit {
  id: string; name: string; timezone: string; can_close: boolean; can_reopen: boolean; can_see_names: boolean;
  legal_entity: { id: string; name: string; cnpj: string | null } | null;
}
export interface AccContext { org: { id: string; name: string }; is_admin: boolean; units: AccUnit[]; current_month: string | null }
export type PeriodStatus = "open" | "in_review" | "closed";
export type Basis = "competencia" | "caixa";

export const MONTHS = ["jan", "fev", "mar", "abr", "mai", "jun", "jul", "ago", "set", "out", "nov", "dez"];
export const fmtMonth = (m: string) => `${MONTHS[Number(m.slice(5, 7)) - 1]}/${m.slice(0, 4)}`;
export const fmtMonthLong = (m: string) => `${["janeiro", "fevereiro", "março", "abril", "maio", "junho", "julho", "agosto", "setembro", "outubro", "novembro", "dezembro"][Number(m.slice(5, 7)) - 1]} de ${m.slice(0, 4)}`;
export const shiftMonth = (m: string, delta: number) => { const d = new Date(Date.UTC(Number(m.slice(0, 4)), Number(m.slice(5, 7)) - 1 + delta, 1)); return d.toISOString().slice(0, 10); };
export const fmtDay = (d: string | null | undefined) => (d ? `${d.slice(8, 10)}/${d.slice(5, 7)}/${d.slice(0, 4)}` : "—");

export const STATUS_LABEL: Record<PeriodStatus, string> = { open: "Aberta", in_review: "Em revisão", closed: "Fechada" };
export const STATUS_TONE: Record<PeriodStatus, Tone> = { open: "neutral", in_review: "info", closed: "success" };
export const BASIS_LABEL: Record<Basis, string> = { competencia: "Competência", caixa: "Caixa" };
export const BASIS_HINT: Record<Basis, string> = {
  competencia: "Pelo mês a que o fato pertence (competência do recebível/da conta), não pela data do pagamento.",
  caixa: "Pela data em que o dinheiro entrou ou saiu (recebimentos, estornos e contas pagas).",
};

export interface AccScope {
  ctx: AccContext; unit: AccUnit; month: string; months: { value: string; label: string }[];
  setUnit: (id: string) => void; setMonth: (m: string) => void;
  /** Monta um link interno preservando unidade e competência selecionadas. */
  link: (path: string, extra?: Record<string, string>) => string;
}
export const AccScopeCtx = createContext<AccScope | null>(null);
export const useAccScope = () => { const v = useContext(AccScopeCtx); if (!v) throw new Error("useAccScope fora do AccScopeProvider"); return v; };

/** Consulta de RPC do Contábil já escopada por unidade/competência; a chave começa com "acc" para invalidar tudo de uma vez. */
export function useAccQuery<T>(name: string, args: Record<string, unknown>, deps: unknown[] = [], enabled = true) {
  return useQuery({ queryKey: ["acc", name, ...deps], enabled, queryFn: async () => { const { data, error } = await supabase.rpc(name, args); if (error) throw error; return data as T; } });
}
export const useAccInvalidate = () => { const qc = useQueryClient(); return useCallback(() => qc.invalidateQueries({ queryKey: ["acc"] }), [qc]); };

export const signedBrl = (cents: number) => {
  const s = new Intl.NumberFormat("pt-BR", { style: "currency", currency: "BRL" }).format(Math.abs(cents) / 100);
  return cents < 0 ? `−${s}` : s;
};

export const NOT_OFFICIAL = "Preparação gerencial da competência para o contador. Não é escrituração contábil oficial, apuração de tributos nem emissão fiscal.";

export const DOC_KINDS: Record<string, string> = { comprovante: "Comprovante", nota_fiscal: "Nota fiscal (arquivo)", contrato: "Contrato", extrato: "Extrato", outro: "Outro" };

/** Abre um documento com URL assinada de 60 s, depois de o servidor autorizar e auditar o acesso. Devolve mensagem de erro ou null. */
export async function openAccDocument(id: string): Promise<string | null> {
  const { data, error } = await supabase.rpc("acc_documents_access", { p_ids: [id] });
  if (error || !data?.[0]) return errText(error, "Sem permissão para abrir este documento.");
  const s = await supabase.storage.from("accounting-private").createSignedUrl(data[0].path, 60);
  if (s.error || !s.data) return "Não foi possível gerar o link seguro do arquivo.";
  window.open(s.data.signedUrl, "_blank", "noopener,noreferrer");
  return null;
}
