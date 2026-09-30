export type CalView = "semana" | "mes";
export const pad = (n: number) => String(n).padStart(2, "0");
export const dayKey = (d: Date) => `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`;
export const parseDay = (s: string) => { const [y, m, d] = s.split("-").map(Number); return new Date(y, m - 1, d); };
export const addDays = (d: Date, n: number) => new Date(d.getFullYear(), d.getMonth(), d.getDate() + n);
const mondayOf = (d: Date) => addDays(d, -((d.getDay() + 6) % 7));
export const hhmm = (iso: string) => new Date(iso).toLocaleTimeString("pt-BR", { hour: "2-digit", minute: "2-digit" });
export const WD = ["seg", "ter", "qua", "qui", "sex", "sáb", "dom"];

/** Intervalo exibido (segunda a domingo; no mês, a grade completa de 6 semanas). */
export const calRange = (view: CalView, date: string) => {
  const d = parseDay(date);
  const start = view === "semana" ? mondayOf(d) : mondayOf(new Date(d.getFullYear(), d.getMonth(), 1));
  return { start, end: addDays(start, view === "semana" ? 7 : 42) };
};
export const calTitle = (view: CalView, date: string) => { const d = parseDay(date); return view === "mes" ? d.toLocaleDateString("pt-BR", { month: "long", year: "numeric" }) : (() => { const { start } = calRange("semana", date); const e = addDays(start, 6); return `${start.toLocaleDateString("pt-BR", { day: "2-digit", month: "short" })} – ${e.toLocaleDateString("pt-BR", { day: "2-digit", month: "short", year: "numeric" })}`; })(); };

