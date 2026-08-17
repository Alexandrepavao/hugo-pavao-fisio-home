import { MapPin, BadgeCheck, Package, HeartHandshake } from "lucide-react";

const items = [
  { icon: MapPin, title: "Brasil inteiro", label: "Rede de fisioterapeutas parceiros em expansão por todo o país" },
  { icon: BadgeCheck, title: "Seleção criteriosa", label: "Registro no CREFITO e experiência clínica comprovada" },
  { icon: Package, title: "Equipamentos inclusos", label: "O profissional leva tudo o que o seu tratamento precisa" },
  { icon: HeartHandshake, title: "Cuidado humanizado", label: "Plano individual, escuta atenta e acompanhamento próximo" },
];

const TrustBar = () => (
  <section className="border-y border-border bg-navy-900">
    <div className="container-hp px-6 sm:px-8 py-14 grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-px bg-background/10 border border-background/10">
      {items.map((it) => (
        <div key={it.title} className="bg-navy-900 flex flex-col gap-3 p-8">
          <it.icon className="w-6 h-6 text-accent" strokeWidth={1.25} />
          <p className="font-display text-lg text-background">{it.title}</p>
          <p className="text-[14px] leading-snug text-background/60">{it.label}</p>
        </div>
      ))}
    </div>
  </section>
);

export default TrustBar;
