import { supabase } from "@/lib/supabase";
import { errText } from "@/lib/ui";

/** Chamada de função do banco da PLATAFORMA. Cada função confere no servidor se quem chama é administrador da plataforma; o front só exibe. */
export const prpc = async <T,>(fn: string, args?: Record<string, unknown>): Promise<T> => {
  const { data, error } = await supabase.rpc(fn, args);
  if (error) throw new Error(errText(error));
  return data as T;
};

export interface Segment { key: string; name: string; status: "available" | "planned"; description: string }
export interface Module { key: string; name: string; description: string; status: "available" | "experimental" | "planned"; core: boolean; segments: string[]; requires: string[]; enforcement: string; version: string }
export interface Template { segment_key: string; version: number; status: string; default_modules: string[]; optional_modules: string[]; vocabulary: Record<string, string>; checklist: { key: string; label: string }[]; roles: { role: string; label: string }[]; notes?: string }
export interface Plan { key: string; name: string; description: string | null; status: "draft" | "active" | "retired"; version: number; implementation_fee_cents: number | null; monthly_fee_cents: number | null; included_modules: string[]; limits: Record<string, unknown> }
export interface Catalog { segments: Segment[]; modules: Module[]; templates: Template[]; plans: Plan[] }
export interface OrgRow { id: string; name: string; slug: string; status: string; segment: string | null; template_version: number | null; created_at: string; provisioned_at: string | null; plan: string | null; subscription: string | null; implementation: string | null; units: number; staff_users: number; modules: number; domains: string[] }

export const ORG_STATUS: Record<string, string> = { active: "Ativa", provisioning: "Em preparação", suspended: "Suspensa", archived: "Arquivada" };
export const REQ_STATUS: Record<string, { label: string; tone: "neutral" | "success" | "warning" | "danger" | "info" }> = {
  draft: { label: "Rascunho", tone: "neutral" }, queued: { label: "Na fila", tone: "info" }, preparing: { label: "Preparando", tone: "info" }, verifying: { label: "Verificando", tone: "info" },
  available: { label: "Disponível", tone: "success" }, available_with_pending: { label: "Disponível com pendências", tone: "warning" }, failed_recoverable: { label: "Falha recuperável", tone: "danger" }, failed: { label: "Falhou", tone: "danger" },
};
export const STEP_LABEL: Record<string, string> = {
  template: "Aplicar modelo do segmento", units: "Unidades e configurações", modules: "Módulos e permissões", brand: "Marca", admin: "Administrador (convite preparado)", domain: "Endereço de acesso", verify: "Verificações",
};
export const fmtMs = (ms?: number | null) => (ms == null ? "—" : ms < 1000 ? `${Math.round(ms)} ms` : `${(ms / 1000).toFixed(1).replace(".", ",")} s`);
export const fmtMoney = (cents?: number | null) => (cents == null ? "a definir" : (cents / 100).toLocaleString("pt-BR", { style: "currency", currency: "BRL" }));
