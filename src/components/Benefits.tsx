import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { 
  Home, 
  Clock, 
  User, 
  Award
} from "lucide-react";

const Benefits = () => {
  const benefits = [
    {
      icon: Home,
      title: "Atendimento no conforto da sua casa",
      description: "Receba cuidados profissionais sem sair de casa, em um ambiente familiar e relaxante.",
      gradient: "from-blue-500 to-cyan-500"
    },
    {
      icon: Clock,
      title: "Flexibilidade de horários",
      description: "Agendamentos que se adaptam à sua rotina, incluindo finais de semana e feriados.",
      gradient: "from-green-500 to-emerald-500"
    },
    {
      icon: User,
      title: "Atendimento individualizado",
      description: "Atenção exclusiva e personalizada, com foco nas suas necessidades específicas.",
      gradient: "from-purple-500 to-pink-500"
    },
    {
      icon: Award,
      title: "Experiência e dedicação",
      description: "Profissional qualificado com anos de experiência em fisioterapia domiciliar.",
      gradient: "from-orange-500 to-red-500"
    }
  ];

  return (
    <section className="section-padding-lg bg-soft-gradient">
      <div className="max-w-7xl mx-auto">
        <div className="text-center mb-16">
          <h2 className="text-3xl sm:text-4xl lg:text-5xl font-bold text-foreground mb-4">
            Por que escolher nossos serviços?
          </h2>
          <p className="text-lg text-muted-foreground max-w-2xl mx-auto">
            Vantagens exclusivas do atendimento fisioterapêutico domiciliar
          </p>
        </div>

        <div className="grid md:grid-cols-2 gap-8">
          {benefits.map((benefit, index) => (
            <Card key={index} className="card-professional group border-0 bg-white/50 backdrop-blur-sm">
              <CardHeader className="pb-4">
                <div className="flex items-start space-x-4">
                  <div className={`flex items-center justify-center w-14 h-14 rounded-xl bg-gradient-to-br ${benefit.gradient} text-white shadow-lg group-hover:scale-110 transition-transform duration-300`}>
                    <benefit.icon className="w-7 h-7" />
                  </div>
                  <div className="flex-1">
                    <CardTitle className="text-xl font-semibold text-foreground mb-2">
                      {benefit.title}
                    </CardTitle>
                  </div>
                </div>
              </CardHeader>
              <CardContent className="pl-18">
                <p className="text-muted-foreground leading-relaxed">
                  {benefit.description}
                </p>
              </CardContent>
            </Card>
          ))}
        </div>
      </div>
    </section>
  );
};

export default Benefits;