import { MapPin, BadgeCheck, Package, HeartHandshake } from "lucide-react";

const items = [
  { icon: MapPin, label: "Cobertura em todo o Brasil" },
  { icon: BadgeCheck, label: "Profissionais selecionados e qualificados em cada região" },
  { icon: Package, label: "Equipamentos inclusos sem custo extra" },
  { icon: HeartHandshake, label: "Atendimento humanizado" },
];

const TrustBar = () => (
  <section className="border-y border-border bg-card">
    <div className="container-hp px-6 sm:px-8 py-12 grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-10">
      {items.map((it) => (
        <div key={it.label} className="flex flex-col items-center text-center gap-3">
          <it.icon className="w-6 h-6 text-accent" strokeWidth={1.25} />
          <p className="text-[14px] leading-snug text-navy-700 max-w-[15rem]">{it.label}</p>
        </div>
      ))}
    </div>
  </section>
);

export default TrustBar;
