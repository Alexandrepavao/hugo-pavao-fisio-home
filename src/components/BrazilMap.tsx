const outline =
  "M236 46 L262 74 L286 62 L300 96 L316 78 L336 104 L372 132 L404 128 L436 150 L462 172 L488 196 L508 226 L500 258 L482 286 L470 318 L478 352 L498 386 L512 416 L494 448 L466 466 L436 486 L414 512 L404 544 L382 578 L352 604 L322 586 L302 552 L298 518 L272 502 L258 470 L232 456 L216 418 L182 392 L162 352 L120 342 L92 322 L74 300 L104 284 L118 254 L148 224 L150 178 L192 150 L182 108 L212 92 Z";

const pontos = [
  { x: 452, y: 470, nome: "São Paulo" },
  { x: 478, y: 447, nome: "Rio de Janeiro" },
  { x: 440, y: 420, nome: "Belo Horizonte" },
  { x: 452, y: 322, nome: "Salvador" },
  { x: 478, y: 273, nome: "Recife" },
  { x: 452, y: 205, nome: "Fortaleza" },
  { x: 395, y: 155, nome: "Belém" },
  { x: 205, y: 250, nome: "Manaus" },
  { x: 350, y: 380, nome: "Brasília" },
  { x: 300, y: 400, nome: "Goiânia" },
  { x: 255, y: 430, nome: "Campo Grande" },
  { x: 415, y: 495, nome: "Curitiba" },
  { x: 397, y: 535, nome: "Florianópolis" },
  { x: 350, y: 578, nome: "Porto Alegre" },
  { x: 280, y: 350, nome: "Cuiabá" },
  { x: 140, y: 330, nome: "Rio Branco" },
];

const BrazilMap = ({ className = "" }: { className?: string }) => (
  <div className={`relative bg-card border border-border p-6 sm:p-8 ${className}`}>
    <svg
      viewBox="0 0 600 640"
      role="img"
      aria-label="Mapa do Brasil com pontos de atendimento da HP Fisio Group em todos os estados"
      className="w-full h-auto"
    >
      <path
        d={outline}
        fill="hsl(var(--primary) / 0.06)"
        stroke="hsl(var(--primary) / 0.45)"
        strokeWidth="1.5"
        strokeLinejoin="round"
      />
      {pontos.map((p) => (
        <g key={p.nome}>
          <circle cx={p.x} cy={p.y} r="14" fill="hsl(var(--accent) / 0.14)">
            <animate
              attributeName="r"
              values="8;16;8"
              dur="3.6s"
              repeatCount="indefinite"
              begin={`${(p.x % 7) * 0.35}s`}
            />
            <animate
              attributeName="opacity"
              values="0.55;0;0.55"
              dur="3.6s"
              repeatCount="indefinite"
              begin={`${(p.x % 7) * 0.35}s`}
            />
          </circle>
          <circle cx={p.x} cy={p.y} r="4.5" fill="hsl(var(--accent))" />
        </g>
      ))}
    </svg>

    <div className="flex flex-wrap items-center gap-x-8 gap-y-2 mt-4 text-[11px] sm:text-[12px] uppercase tracking-[0.14em] sm:tracking-[0.16em] text-navy-400">
      <span className="flex items-start gap-2">
        <span className="h-[7px] w-[7px] rounded-full bg-accent shrink-0 mt-1" />
        Cidades com fisioterapeutas da rede
      </span>

      <span>26 estados + DF</span>
    </div>
  </div>
);

export default BrazilMap;
