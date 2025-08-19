import { Card } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Award, Clock, Heart, MapPin } from "lucide-react";
import hugoProfile from "@/assets/hugo-pavao-profile.jpg";

const About = () => {
  const highlights = [
    { icon: Award, label: "Especialista em Fisioterapia" },
    { icon: Clock, label: "Flexibilidade de Horários" },
    { icon: Heart, label: "Atendimento Humanizado" },
    { icon: MapPin, label: "Grande ABC e São Paulo" }
  ];

  return (
    <section id="sobre" className="section-padding-lg bg-soft-gradient">
      <div className="max-w-7xl mx-auto">
        <div className="text-center mb-16">
          <h2 className="text-3xl sm:text-4xl lg:text-5xl font-bold text-foreground mb-4">
            Sobre o Profissional
          </h2>
          <p className="text-lg text-muted-foreground max-w-2xl mx-auto">
            Conheça o especialista que cuidará da sua saúde com dedicação e experiência
          </p>
        </div>

        <div className="grid lg:grid-cols-2 gap-8 lg:gap-12 items-center">
          {/* Photo */}
          <div className="flex justify-center lg:justify-end order-2 lg:order-1">
            <div className="relative">
              <div className="w-64 h-64 sm:w-72 sm:h-72 md:w-80 md:h-80 rounded-2xl overflow-hidden shadow-xl">
                <img 
                  src={hugoProfile} 
                  alt="Hugo Pavão - Fisioterapeuta" 
                  className="w-full h-full object-cover"
                />
              </div>
              <div className="absolute -bottom-4 -right-4 sm:-bottom-6 sm:-right-6 bg-primary text-primary-foreground p-3 sm:p-4 rounded-xl shadow-lg">
                <Award className="w-6 h-6 sm:w-8 sm:h-8" />
              </div>
            </div>
          </div>

          {/* Content */}
          <div className="space-y-6 sm:space-y-8 order-1 lg:order-2">
            <div>
              <h3 className="text-2xl font-bold text-foreground mb-4">
                Hugo Pavão
              </h3>
              <p className="text-lg text-muted-foreground leading-relaxed mb-6">
                Sou Hugo Pavão, fisioterapeuta especializado em atendimentos personalizados em domicílio, 
                com foco em recuperação funcional, reabilitação pós-cirúrgica, dores musculoesqueléticas 
                e qualidade de vida.
              </p>
              <p className="text-lg text-muted-foreground leading-relaxed">
                Atendo pacientes na região do Grande ABC e São Paulo, sempre com dedicação e atenção 
                individualizada para cada caso.
              </p>
            </div>

            {/* Highlights */}
            <div className="grid grid-cols-1 sm:grid-cols-2 gap-3 sm:gap-4">
              {highlights.map((highlight, index) => (
                <div key={index} className="flex items-center space-x-3">
                  <div className="flex items-center justify-center w-8 h-8 sm:w-10 sm:h-10 rounded-full bg-primary/10 flex-shrink-0">
                    <highlight.icon className="w-4 h-4 sm:w-5 sm:h-5 text-primary" />
                  </div>
                  <span className="text-xs sm:text-sm font-medium text-foreground">
                    {highlight.label}
                  </span>
                </div>
              ))}
            </div>

            {/* Badges */}
            <div className="flex flex-wrap gap-2">
              <Badge variant="secondary" className="text-sm">
                Fisioterapia Domiciliar
              </Badge>
              <Badge variant="secondary" className="text-sm">
                Reabilitação Ortopédica
              </Badge>
              <Badge variant="secondary" className="text-sm">
                Dores Crônicas
              </Badge>
              <Badge variant="secondary" className="text-sm">
                Pós-Cirúrgica
              </Badge>
            </div>
          </div>
        </div>
      </div>
    </section>
  );
};

export default About;