import { Search } from "lucide-react";
import { PeriodFilter, type PeriodFilterProps } from "@/lib/PeriodFilter";

/** Linha padrão de filtros das listas: busca à esquerda (opcional) + filtro único (PeriodFilter) à direita.
 * Mesmo padrão de Pessoas: o que é essencial fica visível (busca, unidade, período) e o resto vai para o botão “Filtros”, com contador e “Limpar filtros”. */
export const ListFilterBar = ({ search, ...filter }: { search?: { id: string; label: string; placeholder: string; value: string; onChange: (v: string) => void } } & PeriodFilterProps) => (
  <div className="flex flex-wrap items-start justify-between gap-3 mb-4">
    {search ? (
      <div className="relative w-full sm:w-80"><label htmlFor={search.id} className="sr-only">{search.label}</label><Search size={14} aria-hidden className="absolute left-2.5 top-1/2 -translate-y-1/2 text-muted-foreground" />
        <input id={search.id} type="search" style={{ paddingLeft: "2rem" }} placeholder={search.placeholder} value={search.value} onChange={(e) => search.onChange(e.target.value)} onKeyDown={(e) => e.key === "Escape" && filter.onClear()} /></div>
    ) : <span />}
    {(filter.extra || filter.units || filter.onPreset || filter.onLine || filter.onMonth || filter.onDay) ? <PeriodFilter {...filter} /> : <span />}
  </div>
);
