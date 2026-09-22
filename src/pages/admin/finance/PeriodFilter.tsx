import { FilterBar, FilterField } from "@/lib/ui";
import { RANGE_LABEL, RANGE_PRESETS, type RangePreset } from "./shared";

/** Filtro de período com atalhos + unidade + comparação com período anterior — reaproveitado no Início e no Financeiro. */
export const PeriodFilter = ({ preset, from, to, unit, units, compare, onPreset, onFrom, onTo, onUnit, onCompare, onClear }: {
  preset: RangePreset; from: string; to: string; unit: string; units: { id: string; name: string }[] | undefined; compare: boolean;
  onPreset: (p: RangePreset) => void; onFrom: (v: string) => void; onTo: (v: string) => void; onUnit: (v: string) => void; onCompare: (v: boolean) => void; onClear: () => void;
}) => (
  <FilterBar>
    <FilterField label="Período" htmlFor="pf-preset" className="min-w-[10rem]">
      <select id="pf-preset" value={preset} onChange={(e) => onPreset(e.target.value as RangePreset)}>
        {RANGE_PRESETS.map((p) => <option key={p} value={p}>{RANGE_LABEL[p]}</option>)}
      </select>
    </FilterField>
    {preset === "personalizado" && (<>
      <FilterField label="De" htmlFor="pf-from"><input id="pf-from" type="date" value={from} onChange={(e) => onFrom(e.target.value)} /></FilterField>
      <FilterField label="Até" htmlFor="pf-to"><input id="pf-to" type="date" value={to} onChange={(e) => onTo(e.target.value)} /></FilterField>
    </>)}
    <FilterField label="Unidade" htmlFor="pf-unit">
      <select id="pf-unit" value={unit} onChange={(e) => onUnit(e.target.value)}><option value="">Todas</option>{units?.map((u) => <option key={u.id} value={u.id}>{u.name}</option>)}</select>
    </FilterField>
    <label className="flex items-center gap-2 text-sm self-end pb-1.5 !font-normal"><input type="checkbox" checked={compare} onChange={(e) => onCompare(e.target.checked)} />Comparar com período anterior</label>
    {preset !== "mes" && <button className="hp-btn hp-btn-outline hp-btn-sm self-end" onClick={onClear}>Limpar filtros</button>}
    <p className="text-xs text-muted-foreground ml-auto self-center max-w-[16rem]">{new Date(from + "T12:00:00Z").toLocaleDateString("pt-BR")} – {new Date(to + "T12:00:00Z").toLocaleDateString("pt-BR")}</p>
  </FilterBar>
);
