import { Bone, Stethoscope, Hand, Wind, Dumbbell, Home, Heart } from "lucide-react";

const Services = () => {
  const services = [
    {
      icon: Bone,
      title: "Reabilitação Ortopédica e Pós-Cirúrgica",
      description:
        "Recuperação completa após cirurgias e lesões ortopédicas, com técnicas especializadas para restaurar função e mobilidade.",
    },
    {
      icon: Stethoscope,
      title: "Fisioterapia para Dores Crônicas",
      description:
        "Tratamento focado no alívio duradouro de dores musculares e articulares, com melhora real da qualidade de vida.",
    },
    {
      icon: Hand,
      title: "Liberação Miofascial",
      description:
        "Técnica avançada que alivia tensões profundas, melhora a mobilidade articular e restaura o movimento natural do corpo.",
    },
    {
      icon: Wind,
      title: "Fisioterapia Respiratória",
      description:
        "Técnicas específicas para melhorar a função pulmonar, ideais para recuperação pós-COVID e outras condições respiratórias.",
    },
    {
      icon: Dumbbell,
      title: "Exercícios de Fortalecimento",
      description:
        "Programas personalizados de fortalecimento muscular e prevenção de lesões, adaptados às suas necessidades.",
    },
    {
      icon: Home,
      title: "Atendimento Domiciliar",
      description:
        "Todo o cuidado fisioterapêutico no conforto da sua casa, com equipamentos profissionais e atenção dedicada.",
    },
    {
      icon: Heart,
      title: "Cuidado Humanizado",
      description:
        "Atendimento individualizado focado no bem-estar integral, respeitando seus limites e objetivos pessoais.",
    },
  ];

  return (
    <section id="servicos" className="section-padding-lg">
      <div className="max-w-7xl mx-auto">
        <div className="text-center mb-14 max-w-2xl mx-auto">
          <p className="text-accent font-semibold text-sm uppercase tracking-wider mb-3">Especialidades</p>
          <h2 className="font-display font-bold text-3xl sm:text-4xl lg:text-5xl text-primary mb-4">
            O que posso fazer por você
          </h2>
          <p className="text-lg text-muted-foreground">
            Tratamentos personalizados, baseados em evidência e entregues com cuidado humanizado.
          </p>
        </div>

        <div className="grid sm:grid-cols-2 lg:grid-cols-3 gap-6">
          {services.map((s, i) => (
            <div key={i} className="card-pro group">
              <div className="flex items-center justify-center w-12 h-12 rounded-xl bg-accent/10 text-accent group-hover:bg-accent group-hover:text-accent-foreground transition-colors mb-5">
                <s.icon className="w-6 h-6" />
              </div>
              <h3 className="font-display font-semibold text-lg text-primary mb-2">{s.title}</h3>
              <p className="text-muted-foreground leading-relaxed text-[15px]">{s.description}</p>
            </div>
          ))}
        </div>
      </div>
    </section>
  );
};

export default Services;
