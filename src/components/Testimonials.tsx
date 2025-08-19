import { Card, CardContent } from "@/components/ui/card";
import { Star, Quote } from "lucide-react";

const Testimonials = () => {
  const testimonials = [
    {
      name: "Maria S.",
      text: "O Hugo me ajudou a recuperar após minha cirurgia de joelho, super atencioso e profissional. Em poucos meses consegui andar normalmente novamente.",
      rating: 5,
      treatment: "Reabilitação Pós-Cirúrgica"
    },
    {
      name: "João P.",
      text: "Atendimento em casa fez toda a diferença no meu tratamento. Recomendo muito! Além de conveniente, o Hugo é muito competente.",
      rating: 5,
      treatment: "Fisioterapia Domiciliar"
    },
    {
      name: "Ana L.",
      text: "Excelente profissional! Me ajudou muito com as dores nas costas. Agora posso trabalhar sem desconforto graças ao tratamento.",
      rating: 5,
      treatment: "Dores Crônicas"
    }
  ];

  return (
    <section id="depoimentos" className="section-padding-lg">
      <div className="max-w-7xl mx-auto">
        <div className="text-center mb-16">
          <h2 className="text-3xl sm:text-4xl lg:text-5xl font-bold text-foreground mb-4">
            O que dizem nossos pacientes
          </h2>
          <p className="text-lg text-muted-foreground max-w-2xl mx-auto">
            Depoimentos reais de pessoas que confiaram em nossos cuidados
          </p>
        </div>

        <div className="grid sm:grid-cols-2 lg:grid-cols-3 gap-6 sm:gap-8">
          {testimonials.map((testimonial, index) => (
            <Card key={index} className="card-professional relative overflow-hidden">
              <CardContent className="p-6">
                {/* Quote Icon */}
                <div className="absolute top-4 right-4 opacity-10">
                  <Quote className="w-12 h-12 text-primary" />
                </div>

                {/* Stars */}
                <div className="flex items-center space-x-1 mb-4">
                  {[...Array(testimonial.rating)].map((_, i) => (
                    <Star key={i} className="w-5 h-5 fill-yellow-400 text-yellow-400" />
                  ))}
                </div>

                {/* Testimonial Text */}
                <blockquote className="text-muted-foreground leading-relaxed mb-6 relative z-10">
                  "{testimonial.text}"
                </blockquote>

                {/* Author */}
                <div className="border-t border-border pt-4">
                  <div className="flex items-center justify-between">
                    <div>
                      <p className="font-semibold text-foreground">
                        {testimonial.name}
                      </p>
                      <p className="text-sm text-muted-foreground">
                        {testimonial.treatment}
                      </p>
                    </div>
                    <div className="w-12 h-12 bg-primary/10 rounded-full flex items-center justify-center">
                      <span className="text-primary font-bold text-lg">
                        {testimonial.name.charAt(0)}
                      </span>
                    </div>
                  </div>
                </div>
              </CardContent>
            </Card>
          ))}
        </div>
      </div>
    </section>
  );
};

export default Testimonials;