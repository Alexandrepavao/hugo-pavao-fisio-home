import { useQuery } from "@tanstack/react-query";
import { Link } from "react-router-dom";
import { supabase } from "@/lib/supabase";
import { brl, fmtDateTime } from "@/lib/format";
import { Sheet, SheetContent, SheetDescription, SheetHeader, SheetTitle } from "@/components/ui/sheet";
import { Badge, State, btnGhost, btnPrimary } from "@/lib/ui";

type DetailRpc = "adm_indicator_detail" | "adm_central_detail" | "crm_indicator_detail" | "capture_indicator_detail";
interface DetailItem { id: string; title: string; subtitle?: string; amount_cents?: number; date?: string; tag?: string }
interface Detail { kind: string; label: string; value: number | null; basis: string; is_current_snapshot: boolean; items: DetailItem[]; total_items: number; list_route: string }

/** Qual RPC de detalhe chamar e com quais parâmetros. `scope` é só texto para o cabeçalho (unidade/período). */
export interface IndicatorTrigger { rpc: DetailRpc; params: Record<string, unknown>; scope?: string; title?: string }

/** Painel lateral com os REGISTROS por trás de um indicador (Administrativo, CRM, Captação). Consulta a mesma base e o mesmo escopo do
 *  indicador que o abriu — o número do cartão e o total daqui são calculados pela mesma regra. */
export const IndicatorSheet = ({ trigger, onClose }: { trigger: IndicatorTrigger | null; onClose: () => void }) => {
  const open = !!trigger;
  const detail = useQuery({
    queryKey: ["indicator-detail", trigger?.rpc, JSON.stringify(trigger?.params)], enabled: open,
    queryFn: async () => { const { data, error } = await supabase.rpc(trigger!.rpc, trigger!.params); if (error) throw error; return data as Detail; },
  });
  const d = detail.data;
  return (
    <Sheet open={open} onOpenChange={(o) => { if (!o) onClose(); }}>
      <SheetContent side="right" className="w-full sm:max-w-lg p-0 flex flex-col gap-0">
        {trigger && (<>
          <SheetHeader className="px-5 pt-5 pb-3 border-b border-border text-left space-y-1.5">
            <SheetTitle className="text-[1.0625rem]">{d?.label ?? trigger.title ?? "Detalhamento"}</SheetTitle>
            <SheetDescription>{trigger.scope ?? "Registros que compõem o indicador"}</SheetDescription>
            {d?.is_current_snapshot && <Badge tone="warning">Situação de hoje — não muda com o período selecionado</Badge>}
          </SheetHeader>
          <div className="flex-1 overflow-y-auto px-5 py-5">
            <State loading={detail.isLoading} error={detail.error} />
            {d && (<>
              <p className="text-[2rem] leading-9 font-bold tabular" style={{ fontFamily: "Inter, system-ui, sans-serif" }}>{d.total_items.toLocaleString("pt-BR")}</p>
              <p className="text-[13px] text-muted-foreground mt-1.5">{d.basis}</p>
              <div className="mt-6">
                <p className="text-xs font-medium text-muted-foreground mb-2">Registros {d.total_items > d.items.length ? `(${d.items.length} de ${d.total_items.toLocaleString("pt-BR")})` : d.items.length > 0 ? `(${d.items.length})` : ""}</p>
                {d.items.length === 0 ? <p className="text-sm text-muted-foreground">Nenhum registro neste critério.</p> : (
                  <ul className="grid gap-2">
                    {d.items.map((it) => (
                      <li key={it.id + (it.date ?? "")} className="hp-card p-3 text-sm flex items-start justify-between gap-3">
                        <div className="min-w-0">
                          <p className="font-medium break-words">{it.title}</p>
                          {it.subtitle && <p className="text-xs text-muted-foreground break-words">{it.subtitle}</p>}
                          {it.date && <p className="text-xs text-muted-foreground">{fmtDateTime(it.date)}</p>}
                        </div>
                        <div className="text-right shrink-0">
                          {it.amount_cents != null && it.amount_cents > 0 && <p className="tabular font-medium">{brl(it.amount_cents)}</p>}
                          {it.tag && <Badge>{it.tag}</Badge>}
                        </div>
                      </li>))}
                  </ul>)}
              </div>
            </>)}
          </div>
          <div className="px-5 py-4 border-t border-border flex justify-between gap-2">
            <button type="button" className={btnGhost} onClick={onClose}>Fechar</button>
            {d && <Link to={d.list_route} className={btnPrimary}>Abrir a lista completa</Link>}
          </div>
        </>)}
      </SheetContent>
    </Sheet>
  );
};
