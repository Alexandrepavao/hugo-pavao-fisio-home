import { Button } from "@/components/ui/button";
import { MessageCircle, ArrowRight, ShieldCheck, Clock3, MapPin } from "lucide-react";

const Hero = () => {
  const whatsapp = () => window.open(
    "https://wa.me/5511959075351?text=Oi,+tudo+bem%3F+Vi+seu+site+e+tenho+interesse+em+saber+mais+sobre+os+atendimentos+de+fisioterapia.+Pode+me+orientar%3F",
    "_blank"
  );
  const toServices = () => document.getElementById("servicos")?.scrollIntoView({ behavior: "smooth" });

  return (
    <section id="inicio" className="relative overflow-hidden bg-soft">
      {/* Decorative shape */}
      <div className="absolute -top-40 -right-40 w-[520px] h-[520px] rounded-full bg-accent/10 blur-3xl pointer-events-none" />
      <div className="absolute -bottom-32 -left-32 w-[420px] h-[420px] rounded-full bg-primary/10 blur-3xl pointer-events-none" />

      <div className="relative max-w-7xl mx-auto px-4 sm:px-6 lg:px-8 pt-14 pb-20 lg:pt-24 lg:pb-28">
        <div className="grid lg:grid-cols-2 gap-12 lg:gap-16 items-center">
          {/* Text */}
          <div className="animate-fade-in">
            <span className="inline-flex items-center gap-2 px-3 py-1.5 rounded-full bg-accent/10 text-accent text-xs font-semibold tracking-wide uppercase">
              <span className="w-1.5 h-1.5 rounded-full bg-accent" />
              Fisioterapia em domicílio
            </span>

            <h1 className="font-display font-bold text-4xl sm:text-5xl lg:text-6xl text-primary mt-5 leading-[1.05]">
              Cuidado fisioterapêutico que vai até você.
            </h1>

            <p className="text-lg text-muted-foreground mt-6 leading-relaxed max-w-xl">
              Hugo Pavão atende no Grande ABC e em São Paulo com fisioterapia
              domiciliar especializada — reabilitação, dores crônicas, pós-cirúrgico
              e tratamento humanizado no conforto da sua casa.
            </p>

            <div className="flex flex-col sm:flex-row gap-3 mt-8">
              <Button
                onClick={whatsapp}
                size="lg"
                className="bg-whatsapp hover:bg-whatsapp-hover text-whatsapp-foreground font-semibold h-12 px-6 text-base shadow-lg"
              >
                <MessageCircle className="w-5 h-5 mr-2" />
                Agendar Consulta pelo WhatsApp
              </Button>
              <Button
                onClick={toServices}
                variant="outline"
                size="lg"
                className="h-12 px-6 text-base border-primary/20 hover:bg-primary hover:text-primary-foreground"
              >
                Conheça os Serviços
                <ArrowRight className="w-4 h-4 ml-2" />
              </Button>
            </div>

            <div className="flex flex-wrap gap-x-6 gap-y-3 mt-8 text-sm text-foreground/80">
              <div className="flex items-center gap-2">
                <ShieldCheck className="w-4 h-4 text-accent" />
                CREFITO Registrado
              </div>
              <div className="flex items-center gap-2">
                <Clock3 className="w-4 h-4 text-accent" />
                Atendimento no mesmo dia
              </div>
              <div className="flex items-center gap-2">
                <MapPin className="w-4 h-4 text-accent" />
                Grande ABC e SP
              </div>
            </div>
          </div>

          {/* Image */}
          <div className="relative animate-fade-in">
            <div className="relative rounded-3xl overflow-hidden shadow-2xl aspect-[4/5] max-w-md mx-auto lg:max-w-none">
              <img
                src="https://images.unsplash.com/photo-1576091160550-2173dba999ef?auto=format&fit=crop&w=1200&q=80"
                alt="Fisioterapeuta realizando atendimento domiciliar"
                className="w-full h-full object-cover"
                loading="eager"
              />
              <div className="absolute inset-0 bg-gradient-to-t from-primary/40 via-transparent to-transparent" />
            </div>

            {/* Floating card */}
            <div className="hidden sm:flex absolute -bottom-6 -left-6 lg:-left-10 bg-background rounded-2xl shadow-xl p-4 items-center gap-3 border border-border">
              <div className="w-12 h-12 rounded-xl bg-accent/15 flex items-center justify-center">
                <ShieldCheck className="w-6 h-6 text-accent" />
              </div>
              <div>
                <p className="font-display font-bold text-primary">+500 pacientes</p>
                <p className="text-xs text-muted-foreground">atendidos com excelência</p>
              </div>
            </div>
          </div>
        </div>
      </div>
    </section>
  );
};

export default Hero;
