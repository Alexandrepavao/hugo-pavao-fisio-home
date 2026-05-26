import { Button } from "@/components/ui/button";
import { MessageCircle, CheckCircle2 } from "lucide-react";

const About = () => {
  const whatsapp = () => window.open(
    "https://wa.me/5511959075351?text=Oi,+tudo+bem%3F+Vi+seu+site+e+tenho+interesse+em+saber+mais+sobre+os+atendimentos+de+fisioterapia.+Pode+me+orientar%3F",
    "_blank"
  );

  const items = [
    "Fisioterapeuta registrado no CREFITO",
    "Especialização em fisioterapia ortopédica e domiciliar",
    "Experiência em reabilitação pós-cirúrgica",
    "Atendimento exclusivo no Grande ABC e São Paulo",
  ];

  return (
    <section id="sobre" className="section-padding-lg bg-soft">
      <div className="max-w-7xl mx-auto">
        <div className="grid lg:grid-cols-2 gap-12 lg:gap-16 items-center">
          {/* Photo */}
          <div className="relative order-2 lg:order-1">
            <div className="relative rounded-3xl overflow-hidden shadow-2xl aspect-[4/5] max-w-md mx-auto lg:mx-0">
              <img
                src="/lovable-uploads/ca95074f-9b13-44f2-95db-74ab2e856e1c.png"
                alt="Hugo Pavão - Fisioterapeuta"
                className="w-full h-full object-cover object-center"
              />
            </div>
            <div className="absolute -bottom-5 -right-5 lg:right-10 bg-primary text-primary-foreground rounded-2xl px-5 py-4 shadow-xl">
              <p className="font-display font-bold text-xl">CREFITO</p>
              <p className="text-xs text-white/70">Profissional registrado</p>
            </div>
          </div>

          {/* Content */}
          <div className="order-1 lg:order-2">
            <p className="text-accent font-semibold text-sm uppercase tracking-wider mb-3">Sobre o profissional</p>
            <h2 className="font-display font-bold text-3xl sm:text-4xl lg:text-5xl text-primary mb-6">
              Quem é Hugo Pavão?
            </h2>

            <div className="space-y-4 text-muted-foreground text-[17px] leading-relaxed">
              <p>
                Sou Hugo Pavão, fisioterapeuta especializado em atendimentos personalizados em domicílio,
                com foco em recuperação funcional, reabilitação pós-cirúrgica, dores musculoesqueléticas
                e qualidade de vida.
              </p>
              <p>
                Atendo pacientes na região do Grande ABC e São Paulo, sempre com dedicação e atenção
                individualizada para cada caso.
              </p>
            </div>

            <ul className="mt-8 space-y-3">
              {items.map((item) => (
                <li key={item} className="flex items-start gap-3">
                  <CheckCircle2 className="w-5 h-5 text-accent flex-shrink-0 mt-0.5" />
                  <span className="text-foreground/85">{item}</span>
                </li>
              ))}
            </ul>

            <Button
              onClick={whatsapp}
              size="lg"
              className="mt-8 bg-whatsapp hover:bg-whatsapp-hover text-whatsapp-foreground font-semibold h-12 px-6"
            >
              <MessageCircle className="w-5 h-5 mr-2" />
              Fale comigo no WhatsApp
            </Button>
          </div>
        </div>
      </div>
    </section>
  );
};

export default About;
