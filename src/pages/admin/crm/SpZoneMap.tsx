import { SP_MAP } from "@/lib/spMapData";
import { SP_ZONES, SP_ZONE_LABEL, type SpZone } from "@/lib/spZones";

/** Mapa da cidade de São Paulo dividido nas 5 zonas (distritos da Prefeitura agrupados por subprefeitura). Cada zona é pintada pela quantidade de contatos que a informaram
 *  (quanto mais, mais escuro) e é clicável (mouse, toque ou teclado). Geometria estática embutida: nenhum serviço externo, nenhum dado enviado para fora. */
export const SpZoneMap = ({ counts, selected, onSelect }: { counts: Record<string, number>; selected: string | null; onSelect: (zone: SpZone | null) => void }) => {
  const max = Math.max(1, ...SP_ZONES.map((z) => counts[z.id] ?? 0));
  const alpha = (n: number) => (n <= 0 ? 0.06 : 0.22 + 0.68 * (n / max));
  return (
    <svg viewBox={`0 0 ${SP_MAP.w} ${SP_MAP.h}`} role="group" aria-label="Mapa de São Paulo por zona" className="w-full h-auto max-h-[28rem]" data-testid="sp-mapa">
      {SP_ZONES.map((z) => {
        const n = counts[z.id] ?? 0; const on = selected === z.id; const [lx, ly] = SP_MAP.labels[z.id]; const dark = alpha(n) > 0.55;
        const toggle = () => onSelect(on ? null : z.id);
        return (
          <g key={z.id} role="button" tabIndex={0} aria-pressed={on} aria-label={`${SP_ZONE_LABEL[z.id]}: ${n} contato${n === 1 ? "" : "s"}. ${on ? "Mostrar todas as zonas" : "Filtrar a lista por esta zona"}`} data-testid={`sp-mapa-${z.id}`}
            onClick={toggle} onKeyDown={(e) => { if (e.key === "Enter" || e.key === " ") { e.preventDefault(); toggle(); } }} className="cursor-pointer group" style={{ outline: "none" }}>
            <path d={SP_MAP.paths[z.id]} fillRule="evenodd" fill="hsl(var(--primary))" fillOpacity={alpha(n)} stroke={on ? "hsl(var(--foreground))" : "hsl(var(--card))"} strokeWidth={on ? 2.2 : 0.8} strokeLinejoin="round" className="group-hover:stroke-[hsl(var(--foreground))] group-focus-visible:stroke-[hsl(var(--ring))]" />
            <text x={lx} y={ly - 8} textAnchor="middle" fontSize={z.id === "centro" ? 13 : 19} fontWeight={700} fill={dark ? "hsl(var(--primary-foreground))" : "hsl(var(--foreground))"} pointerEvents="none" paintOrder="stroke" stroke="hsl(var(--card))" strokeWidth={dark ? 0 : 3} strokeLinejoin="round" style={{ letterSpacing: ".01em" }}>{z.id === "centro" ? "Centro" : z.label.replace("Zona ", "")}</text>
            <text x={lx} y={ly + (z.id === "centro" ? 9 : 18)} textAnchor="middle" fontSize={z.id === "centro" ? 16 : 28} fontWeight={800} fill={dark ? "hsl(var(--primary-foreground))" : "hsl(var(--foreground))"} pointerEvents="none" className="tabular">{n}</text>
          </g>);
      })}
    </svg>
  );
};
