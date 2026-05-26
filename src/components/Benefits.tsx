import { Home, UserCheck, Clock, Briefcase } from "lucide-react";

const Benefits = () => {
  const items = [
    {
      icon: Home,
      title: "Conforto da sua casa",
      description: "Tratamento em ambiente familiar e relaxante, sem o estresse de salas de espera.",
    },
    {
      icon: UserCheck,
      title: "Atendimento 100% individualizado",
      description: "Atenção exclusiva, plano de tratamento sob medida para os seus objetivos.",
    },
    {
      icon: Clock,
      title: "Sem deslocamento e sem espera",
      description: "Horários flexíveis que se adaptam à sua rotina e à sua família.",
    },
    {
      icon: Briefcase,
      title: "Equipamentos levados ao local",
      description: "Estrutura profissional completa entregue no conforto do seu lar.",
    },
  ];

  return (
    <section className="section-padding-lg bg-soft">
      <div className="max-w-7xl mx-auto">
        <div className="text-center mb-14 max-w-2xl mx-auto">
          <p className="text-accent font-semibold text-sm uppercase tracking-wider mb-3">Vantagens</p>
          <h2 className="font-display font-bold text-3xl sm:text-4xl lg:text-5xl text-primary mb-4">
            Por que escolher o atendimento domiciliar?
          </h2>
          <p className="text-lg text-muted-foreground">
            Mais conforto, mais resultado — fisioterapia entregue do jeito que você precisa.
          </p>
        </div>

        <div className="grid sm:grid-cols-2 lg:grid-cols-4 gap-6">
          {items.map((b, i) => (
            <div key={i} className="card-pro text-center">
              <div className="inline-flex items-center justify-center w-14 h-14 rounded-2xl bg-primary text-primary-foreground mb-5">
                <b.icon className="w-7 h-7" />
              </div>
              <h3 className="font-display font-semibold text-lg text-primary mb-2">{b.title}</h3>
              <p className="text-muted-foreground text-[15px] leading-relaxed">{b.description}</p>
            </div>
          ))}
        </div>
      </div>
    </section>
  );
};

export default Benefits;
