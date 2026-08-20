import { Activity, Home, Stethoscope } from "lucide-react";

const chips = [
  { icon: Home, label: "Sessão na casa do paciente" },
  { icon: Stethoscope, label: "Equipamentos inclusos" },
  { icon: Activity, label: "Plano individualizado" },
];

const HeroVisual = () => (
  <div className="relative">
    <div className="absolute -inset-3 border border-border hidden sm:block" aria-hidden="true" />

    <div className="relative overflow-hidden bg-navy-900 aspect-[4/5] flex items-center justify-center">
      {/* ondas de bem-estar */}
      <svg
        viewBox="0 0 400 500"
        className="absolute inset-0 h-full w-full"
        aria-hidden="true"
        preserveAspectRatio="xMidYMid slice"
      >
        {[0, 1, 2, 3, 4, 5].map((i) => (
          <circle
            key={i}
            cx="200"
            cy="250"
            r={40 + i * 42}
            fill="none"
            stroke="hsl(var(--accent))"
            strokeOpacity={0.22 - i * 0.03}
            strokeWidth="1"
          />
        ))}
        <path
          d="M-20 400 C 80 350, 140 450, 240 395 S 380 340, 430 385"
          fill="none"
          stroke="hsl(var(--accent))"
          strokeOpacity="0.35"
          strokeWidth="1"
        />
        <path
          d="M-20 430 C 90 385, 150 480, 250 425 S 390 372, 430 415"
          fill="none"
          stroke="hsl(var(--accent))"
          strokeOpacity="0.18"
          strokeWidth="1"
        />
      </svg>

      {/* atendimento em traço */}
      <svg
        viewBox="0 0 220 200"
        className="relative w-[62%] max-w-[16rem]"
        role="img"
        aria-label="Ilustração de fisioterapeuta atendendo um paciente em casa"
      >
        <g
          fill="none"
          stroke="hsl(var(--background))"
          strokeWidth="2.2"
          strokeLinecap="round"
          strokeLinejoin="round"
          opacity="0.9"
        >
          {/* paciente deitado */}
          <path d="M30 150 H190" strokeOpacity="0.35" />
          <circle cx="52" cy="128" r="10" />
          <path d="M64 134 C 92 126, 118 130, 146 140" />
          <path d="M146 140 C 158 132, 168 128, 178 132" />
          <path d="M120 136 L 128 118" />
          {/* fisioterapeuta */}
          <circle cx="132" cy="52" r="13" stroke="hsl(var(--accent))" />
          <path d="M132 66 V 100" stroke="hsl(var(--accent))" />
          <path d="M132 76 C 118 86, 112 104, 118 118" stroke="hsl(var(--accent))" />
          <path d="M132 78 C 148 88, 152 106, 142 120" stroke="hsl(var(--accent))" />
        </g>
        <circle cx="128" cy="118" r="4" fill="hsl(var(--accent))" />
      </svg>
    </div>

    <div className="absolute -bottom-6 left-6 right-6 sm:left-auto sm:right-6 sm:max-w-[16rem] bg-card border border-border p-6 shadow-[var(--shadow-card)]">
      <p className="font-display text-3xl text-navy-900">100%</p>
      <p className="text-[13px] text-navy-400 mt-1">
        das sessões realizadas na casa do paciente, com equipamentos inclusos
      </p>
    </div>

    <ul className="mt-14 space-y-3 sm:pr-[17rem]">
      {chips.map((c) => (
        <li key={c.label} className="flex items-center gap-3 text-[13px] text-navy-400">
          <c.icon className="w-4 h-4 text-accent" strokeWidth={1.5} />
          {c.label}
        </li>
      ))}
    </ul>
  </div>
);

export default HeroVisual;
