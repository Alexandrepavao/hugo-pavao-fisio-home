import { Users, Award, MapPin, Heart } from "lucide-react";

const Stats = () => {
  const stats = [
    { icon: Users, value: "500+", label: "Pacientes atendidos" },
    { icon: Award, value: "5+", label: "Anos de experiência" },
    { icon: MapPin, value: "ABC + SP", label: "Área de atendimento" },
    { icon: Heart, value: "100%", label: "Atendimento humanizado" },
  ];

  return (
    <section className="bg-navy text-primary-foreground">
      <div className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8 py-14 lg:py-16">
        <div className="grid grid-cols-2 lg:grid-cols-4 gap-8">
          {stats.map((s, i) => (
            <div key={i} className="text-center lg:text-left">
              <div className="inline-flex items-center justify-center w-12 h-12 rounded-xl bg-accent/15 text-accent mb-4">
                <s.icon className="w-6 h-6" />
              </div>
              <p className="font-display font-bold text-3xl lg:text-4xl text-white">{s.value}</p>
              <p className="text-sm text-white/70 mt-1">{s.label}</p>
            </div>
          ))}
        </div>
      </div>
    </section>
  );
};

export default Stats;
