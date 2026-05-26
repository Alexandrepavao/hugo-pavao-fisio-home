import { Button } from "@/components/ui/button";
import { MessageCircle } from "lucide-react";

const CTASection = () => {
  const whatsapp = () => window.open(
    "https://wa.me/5511959075351?text=Oi,+tudo+bem%3F+Vi+seu+site+e+tenho+interesse+em+saber+mais+sobre+os+atendimentos+de+fisioterapia.+Pode+me+orientar%3F",
    "_blank"
  );

  return (
    <section className="relative overflow-hidden bg-navy">
      <div className="absolute -top-32 -right-32 w-[500px] h-[500px] rounded-full bg-accent/15 blur-3xl pointer-events-none" />
      <div className="relative max-w-5xl mx-auto px-4 sm:px-6 lg:px-8 py-20 lg:py-24 text-center">
        <h2 className="font-display font-bold text-3xl sm:text-4xl lg:text-5xl text-white mb-5 leading-tight">
          Pronto para recuperar sua qualidade de vida?
        </h2>
        <p className="text-lg text-white/80 max-w-2xl mx-auto mb-8">
          Agende sua avaliação e comece um tratamento personalizado, no conforto da sua casa.
        </p>
        <Button
          onClick={whatsapp}
          size="lg"
          className="bg-whatsapp hover:bg-whatsapp-hover text-whatsapp-foreground font-semibold h-14 px-8 text-base shadow-2xl"
        >
          <MessageCircle className="w-5 h-5 mr-2" />
          Agendar pelo WhatsApp agora
        </Button>
        <p className="text-sm text-white/60 mt-5">
          Atendimento rápido · Resposta em até 1h · Grande ABC e SP
        </p>
      </div>
    </section>
  );
};

export default CTASection;
