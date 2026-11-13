import type { CityGeo, Zone } from "@/lib/capitals";

/** Mapa de uma capital dividido nas zonas oficiais da cidade. Cada zona é pintada pela quantidade de contatos que a informaram (quanto mais, mais escuro) e é clicável (mouse, toque ou teclado).
 *  Geometria estática embutida no site: nenhum serviço externo, nenhum dado enviado para fora. */
export const CityZoneMap = ({ map, zones, counts, selected, onSelect, cityName }: {
  map: CityGeo["map"]; zones: Zone[]; counts: Record<string, number>; selected: string | null; onSelect: (zone: string | null) => void; cityName: string;
}) => {
  const max = Math.max(1, ...zones.map((z) => counts[z.id] ?? 0));
  const alpha = (n: number) => (n <= 0 ? 0.06 : 0.22 + 0.68 * (n / max));
  return (
    <svg viewBox={`0 0 ${map.w} ${map.h}`} role="group" aria-label={`Mapa de ${cityName} por zona`} className="w-full h-auto max-h-[28rem]" data-testid="sp-mapa">
      {zones.map((z) => {
        const n = counts[z.id] ?? 0; const on = selected === z.id; if (!map.paths[z.id]) return null;
        const toggle = () => onSelect(on ? null : z.id);
        return (
          <g key={z.id} role="button" tabIndex={0} aria-pressed={on} aria-label={`${z.label}: ${n} contato${n === 1 ? "" : "s"}. ${on ? "Mostrar todas as zonas" : "Filtrar a lista por esta zona"}`} data-testid={`sp-mapa-${z.id}`}
            onClick={toggle} onKeyDown={(e) => { if (e.key === "Enter" || e.key === " ") { e.preventDefault(); toggle(); } }} className="cursor-pointer group" style={{ outline: "none" }}>
            <path d={map.paths[z.id]} fillRule="evenodd" fill="hsl(var(--primary))" fillOpacity={alpha(n)} stroke={on ? "hsl(var(--foreground))" : "hsl(var(--card))"} strokeWidth={on ? 2.2 : 0.8} strokeLinejoin="round" className="group-hover:stroke-[hsl(var(--foreground))] group-focus-visible:stroke-[hsl(var(--ring))]" />
          </g>);
      })}
      {/* rótulos por cima de TODAS as zonas (uma zona pintada depois não pode esconder o nome da anterior) */}
      {zones.map((z) => {
        const n = counts[z.id] ?? 0; const lab = map.labels[z.id]; if (!lab || !map.paths[z.id]) return null; const [lx, ly] = lab;
        const small = z.id === "centro" || z.id.endsWith("-centro"); const short = z.label.replace("Zona ", "");
        return (
          <g key={`l-${z.id}`} pointerEvents="none" aria-hidden>
            <text x={lx} y={ly - 8} textAnchor="middle" fontSize={small ? 13 : 19} fontWeight={700} fill="hsl(var(--foreground))" paintOrder="stroke" stroke="hsl(var(--card))" strokeWidth={3.5} strokeLinejoin="round">{short}</text>
            <text x={lx} y={ly + (small ? 9 : 18)} textAnchor="middle" fontSize={small ? 16 : 28} fontWeight={800} fill="hsl(var(--foreground))" paintOrder="stroke" stroke="hsl(var(--card))" strokeWidth={3.5} strokeLinejoin="round" className="tabular">{n}</text>
          </g>);
      })}
    </svg>
  );
};
export default CityZoneMap;
