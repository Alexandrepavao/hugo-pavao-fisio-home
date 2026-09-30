import type { CardDelta } from "@/lib/ui";

interface MetricLike { value: number | string | null; available: boolean }

/** Comparação com o período anterior — SÓ com base real: precisa das duas medições disponíveis e de base anterior diferente de zero.
 *  `prev` indefinido (comparação desligada ou ainda carregando) → sem linha de comparação. `lowerIsBetter`: para números em que cair é bom (ex.: inadimplência). */
export const makeDelta = (cur: MetricLike | undefined, prev: MetricLike | undefined, o: { lowerIsBetter?: boolean } = {}): CardDelta | null => {
  if (prev === undefined) return null;
  if (!cur || !cur.available || cur.value == null || !prev.available || prev.value == null || Number(prev.value) === 0) return { dir: "flat", text: "Sem base de comparação" };
  const pct = Math.round(((Number(cur.value) - Number(prev.value)) / Math.abs(Number(prev.value))) * 1000) / 10;
  if (pct === 0) return { dir: "flat", text: "igual ao período anterior" };
  return { dir: pct > 0 ? "up" : "down", text: `${Math.abs(pct).toString().replace(".", ",")}% vs. período anterior`, good: (pct > 0) !== !!o.lowerIsBetter };
};
