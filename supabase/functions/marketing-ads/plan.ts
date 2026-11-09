// Planejamento da janela de sincronização (puro, testável). Datas "AAAA-MM-DD" no fuso da CONTA de anúncios.
export interface Coverage { okDays: string[]; failedDays: string[] }
export interface Settings { backfill_days: number; reprocess_days: number }
export interface Plan { from: string; to: string; kind: "backfill" | "reprocess"; chunks: { from: string; to: string }[]; includesCatchup: boolean }

const dayMs = 86400000;
const parse = (d: string) => { const [y, m, dd] = d.split("-").map(Number); return Date.UTC(y, m - 1, dd); };
export const fmt = (t: number) => new Date(t).toISOString().slice(0, 10);
export const addDays = (d: string, n: number) => fmt(parse(d) + n * dayMs);
export const daysBetween = (from: string, to: string) => Math.round((parse(to) - parse(from)) / dayMs) + 1;
export const eachDay = (from: string, to: string) => Array.from({ length: Math.max(0, daysBetween(from, to)) }, (_, i) => addDays(from, i));

/** "Hoje" na timezone da conta (a plataforma fecha o dia nesse fuso). */
export function todayIn(tz: string, now = new Date()) {
  try { return new Intl.DateTimeFormat("en-CA", { timeZone: tz, year: "numeric", month: "2-digit", day: "2-digit" }).format(now); }
  catch { return new Intl.DateTimeFormat("en-CA", { timeZone: "America/Sao_Paulo", year: "numeric", month: "2-digit", day: "2-digit" }).format(now); }
}

/** Sem nenhum dia coletado → histórico inicial (backfill_days). Com histórico → reprocessa os últimos reprocess_days (revisões da plataforma) e recupera dias que falharam antes. */
export function planWindow(today: string, s: Settings, cov: Coverage, chunkDays = 31): Plan {
  const first = cov.okDays.length === 0;
  const floor = addDays(today, -(s.backfill_days - 1));
  let from = first ? floor : addDays(today, -(s.reprocess_days - 1));
  let catchup = false;
  if (!first) { const old = cov.failedDays.filter((d) => d >= floor && d < from).sort()[0]; if (old) { from = old; catchup = true; } }
  if (from < floor) from = floor;
  const chunks: Plan["chunks"] = []; let cur = from;
  while (cur <= today) { const end = addDays(cur, chunkDays - 1) < today ? addDays(cur, chunkDays - 1) : today; chunks.push({ from: cur, to: end }); cur = addDays(end, 1); }
  return { from, to: today, kind: first ? "backfill" : "reprocess", chunks, includesCatchup: catchup };
}
