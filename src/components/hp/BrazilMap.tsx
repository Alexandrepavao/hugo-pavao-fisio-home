import { useMemo, useRef, useState, type KeyboardEvent, type PointerEvent } from "react";
import brazil from "@svg-maps/brazil";

export interface UfDatum { uf: string; count: number; pct: number | null }

/** Mapa coroplético do Brasil por UF, feito com a geometria estática do pacote @svg-maps/brazil (derivada do mapa do Brasil da MapSVG, CC BY 4.0 — atribuição em
 *  docs/creditos.md). Nenhuma chamada externa e nenhum dado de pessoa sai da página. Cores vêm dos tokens `--map-*` do HP (escala azul em 4 classes + cinza neutro
 *  para estado sem dado; a escala também muda de luminosidade, então não depende só de matiz). Cada estado é um botão acessível (teclado e leitor de tela);
 *  o balão mostra nome, quantidade e percentual ao passar o mouse, focar ou tocar. `onSelect` recebe a UF clicada (ou null ao clicar de novo). */
const BrazilMap = ({ data, selected, onSelect, noun = "cadastros", className = "" }: {
  data: UfDatum[]; selected?: string | null; onSelect?: (uf: string | null) => void; noun?: string; className?: string;
}) => {
  const box = useRef<HTMLDivElement>(null);
  const [tip, setTip] = useState<{ uf: string; x: number; y: number } | null>(null);
  const by = useMemo(() => new Map(data.map((d) => [d.uf.toUpperCase(), d])), [data]);
  const max = Math.max(0, ...data.map((d) => d.count));
  // 4 faixas iguais sobre o maior valor real (nunca escala inventada); 0 = sem dado
  const cuts = [Math.ceil(max / 4), Math.ceil(max / 2), Math.ceil((3 * max) / 4), max];
  const classOf = (count: number) => (count <= 0 || max <= 0 ? 0 : count <= cuts[0] ? 1 : count <= cuts[1] ? 2 : count <= cuts[2] ? 3 : 4);
  const legend = [1, 2, 3, 4].map((k) => { const lo = k === 1 ? 1 : cuts[k - 2] + 1; const hi = cuts[k - 1]; return { k, label: lo >= hi ? `${hi}` : `${lo}–${hi}` }; }).filter((l, i, a) => i === 0 || l.label !== a[i - 1].label);
  const n = (v: number) => v.toLocaleString("pt-BR");
  const pctTxt = (p: number | null) => (p == null ? "" : ` (${String(p).replace(".", ",")}%)`);
  const describe = (uf: string, name: string) => { const d = by.get(uf); return d && d.count > 0 ? `${name}: ${n(d.count)} ${noun}${pctTxt(d.pct)}` : `${name}: sem dados`; };

  const place = (e: { clientX: number; clientY: number }, uf: string) => {
    const r = box.current?.getBoundingClientRect(); if (!r) return;
    setTip({ uf, x: Math.min(Math.max(e.clientX - r.left, 70), r.width - 70), y: e.clientY - r.top });
  };
  const toggle = (uf: string) => onSelect?.(selected === uf ? null : uf);
  const key = (e: KeyboardEvent, uf: string) => { if (e.key === "Enter" || e.key === " ") { e.preventDefault(); toggle(uf); } };
  const focusTip = (uf: string) => (e: { currentTarget: SVGPathElement }) => {
    const r = box.current?.getBoundingClientRect(); const b = e.currentTarget.getBoundingClientRect(); if (!r) return;
    setTip({ uf, x: Math.min(Math.max(b.left + b.width / 2 - r.left, 70), r.width - 70), y: b.top - r.top });
  };
  // o estado selecionado é desenhado por último para o contorno não ficar escondido pelos vizinhos
  const locs = useMemo(() => [...brazil.locations].sort((a, b) => Number(a.id.toUpperCase() === selected) - Number(b.id.toUpperCase() === selected)), [selected]);
  const tipLoc = tip ? brazil.locations.find((l) => l.id.toUpperCase() === tip.uf) : null;
  const tipDatum = tip ? by.get(tip.uf) : undefined;

  return (
    <div className={className}>
      <div ref={box} className="relative" data-testid="brazil-map">
        <svg viewBox={brazil.viewBox} role="group" aria-label="Mapa do Brasil por estado" className="w-full h-auto max-h-[26rem] block touch-manipulation">
          <defs><pattern id="hp-nodata" width="6" height="6" patternUnits="userSpaceOnUse" patternTransform="rotate(45)"><rect width="6" height="6" fill="hsl(var(--map-none))" /><line x1="0" y1="0" x2="0" y2="6" stroke="hsl(var(--muted-foreground) / .28)" strokeWidth="1.4" /></pattern></defs>
          {locs.map((loc) => {
            const uf = loc.id.toUpperCase(); const d = by.get(uf); const c = d?.count ?? 0; const k = classOf(c); const isSel = selected === uf;
            return (
              <path key={loc.id} d={loc.path} data-uf={uf} data-class={k}
                fill={k === 0 ? "url(#hp-nodata)" : `hsl(var(--map-${k}))`}
                stroke={isSel ? "hsl(var(--accent))" : "hsl(var(--map-stroke))"} strokeWidth={isSel ? 2.5 : 0.75} strokeLinejoin="round"
                className={`${onSelect ? "cursor-pointer" : ""} outline-none focus-visible:[stroke:hsl(var(--ring))] focus-visible:[stroke-width:3px] transition-[filter] hover:brightness-110`}
                tabIndex={0} role="button" aria-pressed={onSelect ? isSel : undefined} aria-label={describe(uf, loc.name)}
                onPointerEnter={(e: PointerEvent) => place(e, uf)} onPointerMove={(e: PointerEvent) => place(e, uf)} onPointerLeave={() => setTip(null)}
                onFocus={focusTip(uf)} onBlur={() => setTip(null)}
                onClick={(e) => { place(e, uf); toggle(uf); }} onKeyDown={(e) => key(e, uf)} />
            );
          })}
        </svg>
        {tip && tipLoc && (
          <div role="tooltip" data-testid="brazil-map-tip" className="pointer-events-none absolute z-10 -translate-x-1/2 -translate-y-full rounded-md border border-border bg-popover px-2.5 py-1.5 text-xs text-popover-foreground shadow-md whitespace-nowrap" style={{ left: tip.x, top: Math.max(tip.y - 10, 0) }}>
            <p className="font-bold flex items-center gap-1.5"><i aria-hidden className="inline-block w-2.5 h-2.5 rounded-[3px] border border-border" style={{ background: tipDatum && tipDatum.count > 0 ? `hsl(var(--map-${classOf(tipDatum.count)}))` : "hsl(var(--map-none))" }} />{tipLoc.name} ({tip.uf})</p>
            {tipDatum && tipDatum.count > 0
              ? <p><span className="tabular font-semibold">{n(tipDatum.count)}</span> {noun}{tipDatum.pct != null && <span className="text-muted-foreground"> · {String(tipDatum.pct).replace(".", ",")}% do total</span>}</p>
              : <p className="text-muted-foreground">Sem dados</p>}
          </div>
        )}
      </div>
      <div className="mt-3 flex flex-wrap items-center gap-x-4 gap-y-1.5 text-[11px] text-muted-foreground" aria-label="Legenda do mapa">
        <span className="font-semibold text-foreground/80">{`Quantidade de ${noun}`}</span>
        <span className="inline-flex items-center gap-1.5"><span aria-hidden className="inline-block h-3.5 w-6 rounded border border-border" style={{ background: "repeating-linear-gradient(135deg, hsl(var(--map-none)) 0 3px, hsl(var(--muted-foreground) / .3) 3px 4px)" }} />Sem dados</span>
        {max > 0 && legend.map((l) => <span key={l.k} className="inline-flex items-center gap-1.5"><span aria-hidden className="inline-block h-3.5 w-6 rounded border border-border" style={{ background: `hsl(var(--map-${l.k}))` }} /><span className="tabular">{l.label}</span></span>)}
      </div>
    </div>
  );
};

export default BrazilMap;
