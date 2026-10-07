import { useState } from "react";
import brazil from "@svg-maps/brazil";

// Mapa do site: geometria real dos 26 estados + DF (@svg-maps/brazil, CC BY 4.0 — atribuição em docs/creditos.md) e as cidades da rede.
// As posições vêm da latitude/longitude de cada cidade (projeção Mercator calibrada nos extremos do mapa) e foram conferidas para cair dentro do estado certo;
// Belém e Florianópolis, litorâneas, foram encostadas para dentro do contorno simplificado.
const cidades = [
  { nome: "São Paulo", uf: "SP", x: 427, y: 458 }, { nome: "Rio de Janeiro", uf: "RJ", x: 481, y: 447 },
  { nome: "Belo Horizonte", uf: "MG", x: 469, y: 398 }, { nome: "Salvador", uf: "BA", x: 554, y: 285 },
  { nome: "Recife", uf: "PE", x: 611, y: 207 }, { nome: "Fortaleza", uf: "CE", x: 554, y: 140 },
  { nome: "Belém", uf: "PA", x: 395, y: 105 }, { nome: "Manaus", uf: "AM", x: 218, y: 131 },
  { nome: "Brasília", uf: "DF", x: 407, y: 330 }, { nome: "Goiânia", uf: "GO", x: 387, y: 345 },
  { nome: "Campo Grande", uf: "MS", x: 303, y: 407 }, { nome: "Curitiba", uf: "PR", x: 386, y: 490 },
  { nome: "Florianópolis", uf: "SC", x: 396, y: 528 }, { nome: "Porto Alegre", uf: "RS", x: 356, y: 571 },
  { nome: "Cuiabá", uf: "MT", x: 280, y: 327 }, { nome: "Rio Branco", uf: "AC", x: 97, y: 238 },
];

const BrazilMap = ({ className = "" }: { className?: string }) => {
  const [ativa, setAtiva] = useState<string | null>(null);
  const alvo = cidades.find((c) => c.nome === ativa);

  return (
    <div className={`relative overflow-hidden border border-border bg-card px-5 py-7 sm:px-10 sm:py-10 ${className}`}
      style={{ backgroundImage: "radial-gradient(ellipse at 50% 38%, hsl(var(--accent) / 0.10), transparent 62%)" }}>
      <svg viewBox={brazil.viewBox} role="img" aria-label="Mapa do Brasil com as cidades onde a HP Fisio Group tem fisioterapeutas da rede" className="mx-auto block h-auto w-full max-h-[34rem] overflow-visible">
        <defs>
          <filter id="hp-terra" x="-10%" y="-10%" width="120%" height="125%">
            <feDropShadow dx="0" dy="7" stdDeviation="8" floodColor="hsl(var(--primary))" floodOpacity="0.20" />
          </filter>
        </defs>
        <g filter="url(#hp-terra)">
          {brazil.locations.map((loc) => (
            <path key={loc.id} d={loc.path} fill="hsl(var(--primary) / 0.09)" stroke="hsl(var(--card))" strokeWidth="1.6" strokeLinejoin="round"
              className="transition-colors duration-200 hover:[fill:hsl(var(--primary)/0.2)]">
              <title>{loc.name}</title>
            </path>
          ))}
        </g>

        {cidades.map((c) => {
          const on = ativa === c.nome; const dim = ativa !== null && !on;
          return (
            <g key={c.nome} tabIndex={0} role="img" aria-label={`${c.nome}, ${c.uf}`} className="cursor-pointer outline-none transition-opacity duration-200"
              style={{ opacity: dim ? 0.4 : 1 }}
              onMouseEnter={() => setAtiva(c.nome)} onMouseLeave={() => setAtiva(null)} onFocus={() => setAtiva(c.nome)} onBlur={() => setAtiva(null)}>
              <circle cx={c.x} cy={c.y} r="16" fill="transparent" />
              <circle cx={c.x} cy={c.y} r="9" fill="hsl(var(--accent) / 0.28)" className="origin-center [transform-box:fill-box] motion-safe:animate-ping" style={{ animationDuration: "3.2s" }} />
              <circle cx={c.x} cy={c.y} r={on ? 7.5 : 5.5} fill="hsl(var(--accent))" stroke="hsl(var(--card))" strokeWidth="2.2" className="transition-all duration-200" />
            </g>
          );
        })}

        {alvo && (() => {
          const w = alvo.nome.length * 6.6 + 22; const esquerda = alvo.x > 380; const x0 = esquerda ? alvo.x - 14 - w : alvo.x + 14;
          return (
            <g pointerEvents="none" aria-hidden="true">
              <rect x={x0} y={alvo.y - 13} width={w} height="26" rx="13" fill="hsl(var(--primary))" />
              <text x={x0 + w / 2} y={alvo.y + 4.5} textAnchor="middle" fontSize="12.5" fontWeight="600" fill="hsl(var(--primary-foreground))" style={{ fontFamily: "inherit" }}>{alvo.nome}</text>
            </g>
          );
        })()}
      </svg>

      <ul className="mt-6 flex flex-wrap justify-center gap-2" aria-label="Cidades da rede">
        {cidades.map((c) => (
          <li key={c.nome}>
            <button type="button" aria-pressed={ativa === c.nome} onMouseEnter={() => setAtiva(c.nome)} onMouseLeave={() => setAtiva(null)} onFocus={() => setAtiva(c.nome)} onBlur={() => setAtiva(null)} onClick={() => setAtiva(c.nome)}
              className={`rounded-full border px-3.5 py-1.5 text-[12px] transition-colors ${ativa === c.nome ? "border-accent bg-accent text-accent-foreground" : "border-border bg-background/60 text-navy-700 hover:border-accent/60"}`}>
              {c.nome}<span className="ml-1.5 opacity-60">{c.uf}</span>
            </button>
          </li>
        ))}
      </ul>

      <div className="mt-6 flex flex-wrap items-center justify-center gap-x-8 gap-y-2 text-[11px] uppercase tracking-[0.14em] text-navy-400 sm:text-[12px] sm:tracking-[0.16em]">
        <span className="flex items-center gap-2">
          <span className="h-[8px] w-[8px] shrink-0 rounded-full bg-accent ring-4 ring-accent/20" />
          Cidades com fisioterapeutas da rede
        </span>
        <span>26 estados + DF</span>
      </div>
    </div>
  );
};

export default BrazilMap;
