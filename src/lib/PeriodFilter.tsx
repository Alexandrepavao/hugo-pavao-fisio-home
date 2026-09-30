import { useState, type ReactNode } from "react";
import { CalendarDays, ChevronDown, SlidersHorizontal, X } from "lucide-react";
import { Popover, PopoverContent, PopoverTrigger } from "@/components/ui/popover";
import { Drawer, DrawerClose, DrawerContent, DrawerDescription, DrawerFooter, DrawerHeader, DrawerTitle, DrawerTrigger } from "@/components/ui/drawer";
import { useIsMobile } from "@/hooks/use-mobile";
import { RANGE_LABEL, RANGE_PRESETS, type RangePreset } from "@/lib/period";
import { btnGhost, btnPrimary } from "@/lib/ui";

export interface PeriodFilterProps {
  /** Omitir preset/from/to/onPreset/onFrom/onTo esconde a pílula de período (ex.: CRM, sem dimensão de data). */
  preset?: RangePreset; from?: string; to?: string; onPreset?: (p: RangePreset) => void; onFrom?: (v: string) => void; onTo?: (v: string) => void;
  compare?: boolean; onCompare?: (v: boolean) => void;
  /** Omitir unit/units/onUnit esconde o seletor de unidade. */
  unit?: string; units?: { id: string; name: string }[]; onUnit?: (v: string) => void;
  onClear: () => void;
  /** Filtros específicos da tela (Funil, Responsável, Status…), renderizados dentro do popover compartilhado. */
  extra?: ReactNode;
  /** Quantos filtros extras estão ativos — mostrado como contador no botão "Filtros". */
  extraCount?: number;
  /** Resumo curto dos filtros extras ativos, mostrado no celular. */
  extraSummary?: string;
}

const pillCls = "inline-flex h-9 items-center gap-1.5 rounded-full border border-input bg-card px-3.5 text-[13px] font-medium text-foreground hover:bg-muted transition-colors whitespace-nowrap";

/** Filtro compacto: pílula de período + seletor de unidade + botão "Filtros" (com contador), todos abrindo o
 * mesmo popover (drawer no celular) com atalhos de período, intervalo personalizado, comparação e os filtros
 * específicos da tela. Substitui o antigo card horizontal grande — reaproveitado em Início, Financeiro, CRM
 * e Captação (e nas demais telas que já usavam este componente: Pesquisas, Contas corporativas). Período e
 * unidade são opcionais: uma tela sem essas dimensões (ex. CRM) só mostra o botão "Filtros". */
export const PeriodFilter = (props: PeriodFilterProps) => {
  const { preset, from, to, onPreset, onFrom, onTo, compare, onCompare, unit, units, onUnit, onClear, extra, extraCount = 0, extraSummary } = props;
  const showPeriod = preset !== undefined && from !== undefined && to !== undefined && !!onPreset && !!onFrom && !!onTo;
  const showUnit = units !== undefined && !!onUnit;
  const isMobile = useIsMobile();
  const [open, setOpen] = useState(false);
  // intervalo personalizado só é aplicado ao clicar "Aplicar" — evita disparar consultas a cada tecla digitada
  const [draftFrom, setDraftFrom] = useState(from ?? ""); const [draftTo, setDraftTo] = useState(to ?? "");
  const syncDraft = (o: boolean) => { if (o) { setDraftFrom(from ?? ""); setDraftTo(to ?? ""); } setOpen(o); };
  const apply = () => { if (showPeriod && preset === "personalizado") { onFrom!(draftFrom); onTo!(draftTo); } setOpen(false); };
  const clear = () => { onClear(); setOpen(false); };

  const totalActive = extraCount + (compare ? 1 : 0);
  const periodLabel = showPeriod ? RANGE_LABEL[preset!] : "";
  const unitLabel = showUnit ? (units!.find((u) => u.id === unit)?.name ?? "Todas as unidades") : "";
  const rangeText = showPeriod ? `${new Date(from! + "T12:00:00Z").toLocaleDateString("pt-BR")} – ${new Date(to! + "T12:00:00Z").toLocaleDateString("pt-BR")}` : "";

  const body = (
    <div className="grid gap-4">
      {showPeriod && (
        <div>
          <p className="text-xs font-medium text-muted-foreground mb-1.5">Período</p>
          <div className="flex flex-wrap gap-1.5">
            {RANGE_PRESETS.map((p) => (
              <button key={p} type="button" aria-pressed={preset === p} onClick={() => onPreset!(p)}
                className={`hp-btn hp-btn-sm ${preset === p ? "hp-btn-primary" : "hp-btn-outline"}`}>{RANGE_LABEL[p]}</button>
            ))}
          </div>
          {preset === "personalizado" && (
            <div className="grid grid-cols-2 gap-2 mt-2">
              <div><label htmlFor="pf-from" className="block text-xs text-muted-foreground mb-1">De</label><input id="pf-from" type="date" value={draftFrom} onChange={(e) => setDraftFrom(e.target.value)} /></div>
              <div><label htmlFor="pf-to" className="block text-xs text-muted-foreground mb-1">Até</label><input id="pf-to" type="date" value={draftTo} onChange={(e) => setDraftTo(e.target.value)} /></div>
            </div>
          )}
          <p className="text-[11px] text-muted-foreground mt-1.5">{rangeText}</p>
        </div>
      )}
      {showPeriod && onCompare && <label className="flex items-center gap-2 text-sm !font-normal"><input type="checkbox" checked={!!compare} onChange={(e) => onCompare(e.target.checked)} />Comparar com período anterior</label>}
      {extra && <div className={showPeriod ? "border-t border-border pt-3" : ""}><p className="text-xs font-medium text-muted-foreground mb-2">Filtros</p>{extra}</div>}
    </div>
  );

  if (isMobile) {
    return (
      <div className="flex items-center gap-2">
        <Drawer open={open} onOpenChange={syncDraft}>
          <DrawerTrigger asChild>
            <button type="button" className={pillCls}><SlidersHorizontal size={14} aria-hidden />Filtrar{totalActive > 0 && <span className="hp-badge">{totalActive}</span>}</button>
          </DrawerTrigger>
          <DrawerContent>
            <DrawerHeader className="text-left"><DrawerTitle>Filtros</DrawerTitle>
              <DrawerDescription>{[periodLabel, showUnit && unit ? unitLabel : "", extraSummary].filter(Boolean).join(" · ") || "Nenhum filtro ativo"}</DrawerDescription></DrawerHeader>
            <div className="px-4 pb-2">{body}
              {showUnit && (
                <div className="mt-3">
                  <label htmlFor="pf-unit-m" className="block text-xs text-muted-foreground mb-1">Unidade</label>
                  <select id="pf-unit-m" value={unit} onChange={(e) => onUnit!(e.target.value)} className="w-full"><option value="">Todas</option>{units!.map((u) => <option key={u.id} value={u.id}>{u.name}</option>)}</select>
                </div>
              )}
            </div>
            <DrawerFooter className="flex-row gap-2">
              <button type="button" className={btnGhost + " flex-1"} onClick={clear}>Limpar</button>
              <DrawerClose asChild><button type="button" className={btnPrimary + " flex-1"} onClick={apply}>Aplicar</button></DrawerClose>
            </DrawerFooter>
          </DrawerContent>
        </Drawer>
        {(periodLabel || unitLabel) && <p className="text-[12px] text-muted-foreground truncate">{periodLabel}{showUnit && unit ? ` · ${unitLabel}` : ""}</p>}
      </div>
    );
  }

  return (
    <Popover open={open} onOpenChange={syncDraft}>
      <div className="flex flex-wrap items-center gap-2 justify-end">
        {showPeriod && (
          <PopoverTrigger asChild>
            <button type="button" className={pillCls}><CalendarDays size={14} aria-hidden />{periodLabel}<ChevronDown size={13} aria-hidden /></button>
          </PopoverTrigger>
        )}

        {showUnit && (<>
          <label className="sr-only" htmlFor="pf-unit">Unidade</label>
          <select id="pf-unit" value={unit} onChange={(e) => onUnit!(e.target.value)} className="!h-9 rounded-full !py-0 text-[13px]" aria-label="Unidade">
            <option value="">Todas as unidades</option>{units!.map((u) => <option key={u.id} value={u.id}>{u.name}</option>)}
          </select>
        </>)}

        {(extra || !showPeriod) && (
          <PopoverTrigger asChild>
            <button type="button" className={pillCls}><SlidersHorizontal size={14} aria-hidden />Filtros{totalActive > 0 && <span className="hp-badge">{totalActive}</span>}</button>
          </PopoverTrigger>
        )}
      </div>
      <PopoverContent align="end" className="w-80">
        {body}
        <div className="flex justify-between gap-2 mt-4 pt-3 border-t border-border">
          <button type="button" className={btnGhost + " hp-btn-sm"} onClick={clear}><X size={13} aria-hidden />Limpar</button>
          <button type="button" className={btnPrimary + " hp-btn-sm"} onClick={apply}>Aplicar</button>
        </div>
      </PopoverContent>
    </Popover>
  );
};
