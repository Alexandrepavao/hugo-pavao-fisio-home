import { useState } from "react";
import { CalendarDays, ChevronLeft, ChevronRight } from "lucide-react";
import { Popover, PopoverContent, PopoverTrigger } from "@/components/ui/popover";

const MESES = ["jan", "fev", "mar", "abr", "mai", "jun", "jul", "ago", "set", "out", "nov", "dez"];
const MESES_LONGOS = ["janeiro", "fevereiro", "março", "abril", "maio", "junho", "julho", "agosto", "setembro", "outubro", "novembro", "dezembro"];
const hoje = (): string => new Intl.DateTimeFormat("sv-SE", { timeZone: "America/Sao_Paulo" }).format(new Date()).slice(0, 7);

/** Seletor de mês (AAAA-MM) com popover próprio: cantos arredondados, ano com setas, 12 meses em grade e atalho “Este mês”.
 *  Substitui o `<input type="month">` do navegador, cujo painel nativo não pode ser estilizado. Acessível por teclado (Tab/Enter/Esc). */
const MonthPicker = ({ value, onChange, label = "Mês" }: { value: string; onChange: (ym: string) => void; label?: string }) => {
  const [open, setOpen] = useState(false); const [ano, setAno] = useState(() => Number(value.slice(0, 4)));
  const [y, m] = value.split("-").map(Number); const atual = hoje(); const pick = (mi: number) => { onChange(`${ano}-${String(mi + 1).padStart(2, "0")}`); setOpen(false); };
  return (
    <Popover open={open} onOpenChange={(o) => { setOpen(o); if (o) setAno(y); }}>
      <PopoverTrigger asChild>
        <button type="button" aria-label={`${label}: ${MESES_LONGOS[m - 1]} de ${y}. Abrir seletor`} data-testid="month-picker"
          className="hp-pill inline-flex items-center justify-between gap-2 !rounded-full min-w-[11rem]"><span className="first-letter:uppercase">{MESES_LONGOS[m - 1]} de {y}</span><CalendarDays size={15} aria-hidden className="text-muted-foreground" /></button>
      </PopoverTrigger>
      <PopoverContent align="start" className="w-[17rem] !rounded-2xl p-3 shadow-lg" data-testid="month-picker-painel">
        <div className="flex items-center justify-between mb-2.5">
          <button type="button" onClick={() => setAno(ano - 1)} aria-label="Ano anterior" className="grid h-8 w-8 place-items-center rounded-full hover:bg-muted"><ChevronLeft size={16} aria-hidden /></button>
          <strong className="text-sm tabular" aria-live="polite">{ano}</strong>
          <button type="button" onClick={() => setAno(ano + 1)} aria-label="Próximo ano" className="grid h-8 w-8 place-items-center rounded-full hover:bg-muted"><ChevronRight size={16} aria-hidden /></button>
        </div>
        <div role="grid" aria-label={`Meses de ${ano}`} className="grid grid-cols-4 gap-1.5">
          {MESES.map((nome, i) => {
            const ym = `${ano}-${String(i + 1).padStart(2, "0")}`; const sel = ym === value; const cur = ym === atual;
            return (
              <button key={nome} type="button" role="gridcell" aria-selected={sel} aria-label={`${MESES_LONGOS[i]} de ${ano}`} onClick={() => pick(i)}
                className={`h-9 rounded-xl text-[13px] font-medium capitalize transition-colors ${sel ? "bg-primary text-primary-foreground shadow-sm" : cur ? "border border-primary/50 text-primary hover:bg-muted" : "hover:bg-muted"}`}>{nome}</button>);
          })}
        </div>
        <div className="mt-3 flex items-center justify-between border-t border-border pt-2.5 text-[13px]">
          <span className="text-muted-foreground">{MESES_LONGOS[m - 1]} de {y}</span>
          <button type="button" className="font-medium text-accent hover:underline" onClick={() => { onChange(atual); setOpen(false); }}>Este mês</button>
        </div>
      </PopoverContent>
    </Popover>
  );
};
export default MonthPicker;
