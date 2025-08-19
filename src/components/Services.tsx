import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { 
  Bone, 
  Heart, 
  Wind, 
  Dumbbell, 
  Home,
  Stethoscope
} from "lucide-react";

const Services = () => {
  const services = [
    {
      icon: Bone,
      title: "Reabilitação Ortopédica e Pós-Cirúrgica",
      description: "Recuperação completa após cirurgias e lesões ortopédicas, com técnicas especializadas para restaurar a função e mobilidade."
    },
    {
      icon: Stethoscope,
      title: "Fisioterapia para Dores Crônicas",
      description: "Tratamento especializado para dores musculares e articulares crônicas, focando no alívio duradouro e melhoria da qualidade de vida."
    },
    {
      icon: Wind,
      title: "Fisioterapia Respiratória",
      description: "Técnicas específicas para melhorar a função pulmonar, ideal para recuperação pós-COVID e outras condições respiratórias."
    },
    {
      icon: Dumbbell,
      title: "Exercícios de Fortalecimento",
      description: "Programas personalizados de fortalecimento muscular e prevenção de lesões, adaptados às necessidades individuais."
    },
    {
      icon: Home,
      title: "Atendimento Domiciliar",
      description: "Todo o cuidado fisioterapêutico no conforto da sua casa, com equipamentos profissionais e atenção personalizada."
    },
    {
      icon: Heart,
      title: "Cuidado Humanizado",
      description: "Atendimento individualizado com foco no bem-estar integral do paciente, respeitando limitações e objetivos pessoais."
    }
  ];

  return (
    <section id="servicos" className="section-padding-lg">
      <div className="max-w-7xl mx-auto">
        <div className="text-center mb-16">
          <h2 className="text-3xl sm:text-4xl lg:text-5xl font-bold text-foreground mb-4">
            Serviços Especializados
          </h2>
          <p className="text-lg text-muted-foreground max-w-2xl mx-auto">
            Tratamentos personalizados para sua recuperação e bem-estar
          </p>
        </div>

        <div className="grid md:grid-cols-2 lg:grid-cols-3 gap-8">
          {services.map((service, index) => (
            <Card key={index} className="card-professional group cursor-pointer">
              <CardHeader className="text-center pb-4">
                <div className="flex justify-center mb-4">
                  <div className="flex items-center justify-center w-16 h-16 rounded-xl bg-primary/10 group-hover:bg-primary group-hover:text-primary-foreground transition-all duration-300">
                    <service.icon className="w-8 h-8 text-primary group-hover:text-primary-foreground transition-colors duration-300" />
                  </div>
                </div>
                <CardTitle className="text-xl font-semibold text-foreground group-hover:text-primary transition-colors duration-300">
                  {service.title}
                </CardTitle>
              </CardHeader>
              <CardContent>
                <p className="text-muted-foreground text-center leading-relaxed">
                  {service.description}
                </p>
              </CardContent>
            </Card>
          ))}
        </div>
      </div>
    </section>
  );
};

export default Services;