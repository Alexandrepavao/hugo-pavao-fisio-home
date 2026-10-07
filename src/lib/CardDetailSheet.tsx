import { useQuery } from "@tanstack/react-query";
import { Link } from "react-router-dom";
import { supabase } from "@/lib/supabase";
import { brl, fmtDate, fmtDateTime } from "@/lib/format";
import { Sheet, SheetContent, SheetDescription, SheetHeader, SheetTitle } from "@/components/ui/sheet";
import { Badge, State, btnGhost, btnPrimary } from "@/lib/ui";

export type CardKind =
  | "receipts" | "overdue" | "new_patients" | "evaluations_scheduled" | "win_rate" | "overdue_tasks"
  | "attended" | "active_students" | "average_ticket" | "attendance_rate"
  | "sales_confirmed" | "forecast_receivables_30d" | "forecast_payables_30d" | "cash_result"
  | "leads_sem_retorno" | "pacotes_fim" | "duplicidades" | "eventos_falhos"
  | "mrr_month" | "recurring_clients" | "churn_clients"
  | "active_packages" | "active_partners"
  | "crm_new_leads" | "crm_open_deals" | "crm_open_value" | "crm_won_deals" | "crm_win_rate" | "crm_stale_deals" | "crm_commission_potential";

interface DetailItem { id: string; title: string; subtitle?: string; amount_cents?: number; date?: string; tag?: string }
interface CardDetail {
  kind: string; label: string; value: number | null; available: boolean; basis: string; is_current_snapshot: boolean;
  period: { from: string; to: string }; items: DetailItem[]; total_items: number; list_route: string;
}

const FMT: Record<CardKind, "brl" | "pct" | "int"> = {
  receipts: "brl", overdue: "brl", new_patients: "int", evaluations_scheduled: "int", win_rate: "pct", overdue_tasks: "int",
  attended: "int", active_students: "int", average_ticket: "brl", attendance_rate: "pct",
  sales_confirmed: "int", forecast_receivables_30d: "brl", forecast_payables_30d: "brl", cash_result: "brl",
  leads_sem_retorno: "int", pacotes_fim: "int", duplicidades: "int", eventos_falhos: "int",
  mrr_month: "brl", recurring_clients: "int", churn_clients: "int",
  active_packages: "int", active_partners: "int",
  crm_new_leads: "int", crm_open_deals: "int", crm_open_value: "brl", crm_won_deals: "int", crm_win_rate: "pct", crm_stale_deals: "int", crm_commission_potential: "brl",
};
// "Situação atual" (hoje) — decidido estaticamente, sem esperar a resposta do servidor: evita disparar (e
// exibir) uma comparação com "período anterior" que não faz sentido para um saldo/fila sempre calculado em cima de agora.
const SNAPSHOT_KINDS = new Set<CardKind>([
  "overdue", "overdue_tasks", "active_students", "forecast_receivables_30d", "forecast_payables_30d",
  "leads_sem_retorno", "pacotes_fim", "duplicidades", "eventos_falhos", "active_packages", "active_partners",
  "crm_open_deals", "crm_open_value", "crm_stale_deals", "crm_commission_potential",
]);
// Cartões que usam a RPC do CRM (crm_card_detail, escopo private.crm_units/crm_effective_owner) em vez da
// RPC geral do painel administrativo (dashboard_card_detail, escopo private.dash_units).
const CRM_KINDS = new Set<CardKind>(["crm_new_leads", "crm_open_deals", "crm_open_value", "crm_won_deals", "crm_win_rate", "crm_stale_deals", "crm_commission_potential"]);
const fmtValue = (kind: CardKind, v: number | null) => {
  if (v == null) return "Indisponível";
  if (FMT[kind] === "brl") return brl(v);
  if (FMT[kind] === "pct") return `${v.toString().replace(".", ",")}%`;
  return v.toLocaleString("pt-BR");
};

export interface CardDetailTrigger { kind: CardKind; from: string; to: string; unit: string; unitLabel: string; prevFrom?: string; prevTo?: string; owner?: string; pipeline?: string }

/** Painel lateral de detalhamento de um cartão de indicador (Início/Financeiro/CRM): reconcilia com o mesmo
 * escopo (data/unidade/permissão/responsável) do cartão que o abriu — nunca uma consulta separada e divergente.
 * Cartões do CRM usam crm_card_detail (escopo próprio, inclui "sales" vendo os próprios negócios); os demais
 * usam dashboard_card_detail (escopo manager/ops_admin/unit_manager/finance). */
export const CardDetailSheet = ({ trigger, onClose }: { trigger: CardDetailTrigger | null; onClose: () => void }) => {
  const { kind, from, to, unit, unitLabel, prevFrom, prevTo, owner, pipeline } = trigger ?? { kind: "receipts" as CardKind, from: "", to: "", unit: "", unitLabel: "" };
  const open = !!trigger;
  const rpc = kind && CRM_KINDS.has(kind) ? "crm_card_detail" : "dashboard_card_detail";
  const params = (f: string, t: string) => rpc === "crm_card_detail"
    ? { p_kind: kind, p_from: f, p_to: t, p_unit: unit || null, p_owner: owner || null, p_pipeline: pipeline || null }
    : { p_kind: kind, p_from: f, p_to: t, p_unit: unit || null };

  const detail = useQuery({
    queryKey: ["card-detail", rpc, kind, from, to, unit, owner, pipeline],
    enabled: open,
    queryFn: async () => {
      const { data, error } = await supabase.rpc(rpc, params(from, to));
      if (error) throw error;
      return data as CardDetail;
    },
  });
  const prev = useQuery({
    queryKey: ["card-detail-prev", rpc, kind, prevFrom, prevTo, unit, owner, pipeline],
    enabled: open && !!prevFrom && !!prevTo && !SNAPSHOT_KINDS.has(kind),
    queryFn: async () => {
      const { data, error } = await supabase.rpc(rpc, params(prevFrom!, prevTo!));
      if (error) throw error;
      return data as CardDetail;
    },
  });

  const d = detail.data;
  const delta = !SNAPSHOT_KINDS.has(kind) && d && prev.data && d.available && prev.data.available && d.value != null && prev.data.value != null && prev.data.value !== 0
    ? Math.round(((d.value - prev.data.value) / prev.data.value) * 1000) / 10 : null;

  return (
    <Sheet open={open} onOpenChange={(o) => { if (!o) onClose(); }}>
      <SheetContent side="right" className="w-full sm:max-w-lg p-0 flex flex-col gap-0">
        {trigger && (<>
          <SheetHeader className="px-5 pt-5 pb-3 border-b border-border text-left space-y-1.5">
            <SheetTitle className="text-[1.0625rem]">{d?.label ?? "Detalhamento"}</SheetTitle>
            <SheetDescription>
              {unitLabel}{d?.is_current_snapshot ? " · situação de hoje" : from && to ? ` · ${fmtDate(from)} – ${fmtDate(to)}` : ""}
            </SheetDescription>
            {d?.is_current_snapshot && <Badge tone="warning">Situação atual — não muda com o período selecionado</Badge>}
          </SheetHeader>

          <div className="flex-1 overflow-y-auto px-5 py-5">
            <State loading={detail.isLoading} error={detail.error} />
            {d && !d.available && (
              <div className="hp-card p-4 text-sm text-muted-foreground">Indisponível: {d.basis}</div>
            )}
            {d && d.available && (<>
              <p className="text-[2rem] leading-9 font-bold tabular" style={{ fontFamily: "Inter, system-ui, sans-serif" }}>{fmtValue(kind, d.value)}</p>
              <p className="text-[13px] text-muted-foreground mt-1.5">{d.basis}</p>
              {delta != null && (
                <p className="text-[13px] mt-2">{delta >= 0 ? "▲" : "▼"} {Math.abs(delta).toString().replace(".", ",")}% vs. período anterior</p>
              )}
              {prev.isFetching && <p className="text-xs text-muted-foreground mt-1">Calculando comparação…</p>}

              <div className="mt-6">
                <p className="text-xs font-medium text-muted-foreground mb-2">
                  Registros relacionados {d.total_items > d.items.length ? `(${d.items.length} de ${d.total_items})` : d.items.length > 0 ? `(${d.items.length})` : ""}
                </p>
                {d.items.length === 0 ? (
                  <p className="text-sm text-muted-foreground">Nenhum registro no critério deste cartão.</p>
                ) : (
                  <ul className="grid gap-2">
                    {d.items.map((it) => (
                      <li key={it.id} className="hp-card p-3 text-sm flex items-start justify-between gap-3">
                        <div className="min-w-0">
                          <p className="font-medium truncate">{it.title}</p>
                          {it.subtitle && <p className="text-xs text-muted-foreground truncate">{it.subtitle}</p>}
                          {it.date && <p className="text-xs text-muted-foreground">{fmtDateTime(it.date)}</p>}
                        </div>
                        <div className="text-right shrink-0">
                          {it.amount_cents != null && <p className="tabular font-medium">{brl(it.amount_cents)}</p>}
                          {it.tag && <Badge>{it.tag}</Badge>}
                        </div>
                      </li>
                    ))}
                  </ul>
                )}
              </div>
            </>)}
          </div>

          <div className="px-5 py-4 border-t border-border flex justify-between gap-2">
            <button type="button" className={btnGhost} onClick={onClose}>Fechar</button>
            {d && <Link to={d.list_route} className={btnPrimary}>Ver todos</Link>}
          </div>
        </>)}
      </SheetContent>
    </Sheet>
  );
};
