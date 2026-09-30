import { useCallback, useMemo, type ReactNode } from "react";
import { useSearchParams } from "react-router-dom";
import { useQuery } from "@tanstack/react-query";
import { supabase } from "@/lib/supabase";
import { Badge, State } from "@/lib/ui";
import { AccScopeCtx, fmtMonth, shiftMonth, STATUS_LABEL, STATUS_TONE, type AccContext, type PeriodStatus } from "./accLib";

export const StatusBadge = ({ status }: { status: PeriodStatus }) => <Badge tone={STATUS_TONE[status]}>{STATUS_LABEL[status]}</Badge>;

/** Escopo do app Contábil: organização (cliente da plataforma) → unidade operacional → competência. Vive na URL
 *  (?u=&m=) para que links, filtros do dashboard e o botão voltar preservem a seleção. */
export const AccScopeProvider = ({ children }: { children: ReactNode }) => {
  const [sp, setSp] = useSearchParams();
  const q = useQuery({ queryKey: ["acc", "context"], queryFn: async () => { const { data, error } = await supabase.rpc("acc_context"); if (error) throw error; return data as AccContext; } });
  const ctx = q.data;
  const unit = useMemo(() => ctx?.units.find((u) => u.id === sp.get("u")) ?? ctx?.units[0], [ctx, sp]);
  const cur = ctx?.current_month ?? new Date().toISOString().slice(0, 8) + "01";
  const monthParam = sp.get("m");
  const month = monthParam && /^\d{4}-\d{2}-01$/.test(monthParam) ? monthParam : shiftMonth(cur, -1);
  const months = useMemo(() => Array.from({ length: 14 }, (_, i) => { const v = shiftMonth(cur, -i); return { value: v, label: fmtMonth(v) + (i === 0 ? " (em andamento)" : "") }; }), [cur]);

  const setUnit = useCallback((id: string) => setSp((p) => { const n = new URLSearchParams(p); n.set("u", id); return n; }, { replace: true }), [setSp]);
  const setMonth = useCallback((m: string) => setSp((p) => { const n = new URLSearchParams(p); n.set("m", m); return n; }, { replace: true }), [setSp]);
  const link = useCallback((path: string, extra: Record<string, string> = {}) => {
    const n = new URLSearchParams(extra); if (unit) n.set("u", unit.id); n.set("m", month);
    return `${path}?${n.toString()}`;
  }, [unit, month]);

  if (q.isLoading || q.error) return <State loading={q.isLoading} error={q.error} />;
  if (!ctx || !unit) return <State empty emptyText="Nenhuma unidade com acesso ao módulo Contábil para o seu perfil." />;
  return <AccScopeCtx.Provider value={{ ctx, unit, month, months, setUnit, setMonth, link }}>{children}</AccScopeCtx.Provider>;
};
