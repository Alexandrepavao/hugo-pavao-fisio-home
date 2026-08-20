const outline =
  "M228 60 L268 95 L300 80 L320 120 L360 150 L400 140 L440 175 L470 200 L492 235 L480 275 L462 320 L470 370 L500 405 L486 450 L455 470 L420 500 L400 540 L378 580 L340 600 L300 565 L295 520 L270 505 L255 470 L230 455 L215 415 L180 390 L160 350 L120 340 L90 320 L75 300 L105 285 L120 255 L150 225 L150 180 L190 150 L180 110 L210 95 Z";

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

    <div className="flex flex-wrap items-center gap-x-8 gap-y-2 mt-2 text-[12px] uppercase tracking-[0.16em] text-navy-400">
      <span className="flex items-center gap-2">
        <span className="h-[7px] w-[7px] rounded-full bg-accent" />
        Cidades com fisioterapeutas da rede
      </span>
      <span>26 estados + DF</span>
    </div>
  </div>
);

export default BrazilMap;
