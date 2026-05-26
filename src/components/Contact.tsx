import { Button } from "@/components/ui/button";
import { MessageCircle, MapPin, Clock, Mail, Instagram } from "lucide-react";

const Contact = () => {
  const whatsapp = () => window.open(
    "https://wa.me/5511959075351?text=Oi,+tudo+bem%3F+Vi+seu+site+e+tenho+interesse+em+saber+mais+sobre+os+atendimentos+de+fisioterapia.+Pode+me+orientar%3F",
    "_blank"
  );
  const email = () => window.open("mailto:hugopavaoo@gmail.com", "_blank");
  const instagram = () => window.open("https://www.instagram.com/hugopavaofisio/", "_blank");

  const areas = ["Granja Viana - Cotia", "Grande ABC", "São Paulo (Capital)"];
  const schedule = [
    ["Segunda a Sexta", "8h às 18h"],
    ["Sábados", "8h às 14h"],
    ["Emergências", "Sob consulta"],
  ];

  return (
    <section id="contato" className="section-padding-lg bg-soft">
      <div className="max-w-7xl mx-auto">
        <div className="text-center mb-14 max-w-2xl mx-auto">
          <p className="text-accent font-semibold text-sm uppercase tracking-wider mb-3">Contato</p>
          <h2 className="font-display font-bold text-3xl sm:text-4xl lg:text-5xl text-primary mb-4">
            Agende sua avaliação
          </h2>
          <p className="text-lg text-muted-foreground">
            Entre em contato e inicie seu tratamento personalizado hoje mesmo.
          </p>
        </div>

        <div className="grid lg:grid-cols-2 gap-8">
          {/* Channels */}
          <div className="space-y-5">
            <div className="card-pro">
              <div className="flex items-center gap-3 mb-3">
                <div className="w-11 h-11 rounded-xl bg-whatsapp/10 text-whatsapp flex items-center justify-center">
                  <MessageCircle className="w-5 h-5" />
                </div>
                <h3 className="font-display font-semibold text-lg text-primary">WhatsApp</h3>
              </div>
              <p className="text-muted-foreground mb-4">
                A forma mais rápida de agendar. Respondo em até 1 hora.
              </p>
              <Button
                onClick={whatsapp}
                className="w-full bg-whatsapp hover:bg-whatsapp-hover text-whatsapp-foreground font-semibold"
                size="lg"
              >
                <MessageCircle className="w-5 h-5 mr-2" />
                Conversar no WhatsApp
              </Button>
            </div>

            <div className="card-pro">
              <div className="flex items-center gap-3 mb-3">
                <div className="w-11 h-11 rounded-xl bg-accent/10 text-accent flex items-center justify-center">
                  <Instagram className="w-5 h-5" />
                </div>
                <h3 className="font-display font-semibold text-lg text-primary">Instagram</h3>
              </div>
              <p className="text-muted-foreground mb-4">Dicas de saúde e conteúdo exclusivo.</p>
              <Button onClick={instagram} variant="outline" size="lg" className="w-full">
                <Instagram className="w-5 h-5 mr-2" />
                @hugopavaofisio
              </Button>
            </div>

            <div className="card-pro">
              <div className="flex items-center gap-3 mb-3">
                <div className="w-11 h-11 rounded-xl bg-primary/10 text-primary flex items-center justify-center">
                  <Mail className="w-5 h-5" />
                </div>
                <h3 className="font-display font-semibold text-lg text-primary">E-mail</h3>
              </div>
              <p className="text-muted-foreground mb-4">Para dúvidas e informações detalhadas.</p>
              <Button onClick={email} variant="outline" size="lg" className="w-full">
                <Mail className="w-5 h-5 mr-2" />
                <span className="break-all">hugopavaoo@gmail.com</span>
              </Button>
            </div>
          </div>

          {/* Info */}
          <div className="space-y-5">
            <div className="card-pro">
              <div className="flex items-center gap-3 mb-5">
                <div className="w-11 h-11 rounded-xl bg-accent/10 text-accent flex items-center justify-center">
                  <MapPin className="w-5 h-5" />
                </div>
                <h3 className="font-display font-semibold text-lg text-primary">Área de atendimento</h3>
              </div>
              <ul className="space-y-3">
                {areas.map((a) => (
                  <li key={a} className="flex items-center gap-3">
                    <span className="w-1.5 h-1.5 rounded-full bg-accent" />
                    <span className="text-foreground font-medium">{a}</span>
                  </li>
                ))}
              </ul>
              <p className="text-sm text-muted-foreground mt-4">
                Atendimento domiciliar em toda a região metropolitana.
              </p>
            </div>

            <div className="card-pro">
              <div className="flex items-center gap-3 mb-5">
                <div className="w-11 h-11 rounded-xl bg-primary/10 text-primary flex items-center justify-center">
                  <Clock className="w-5 h-5" />
                </div>
                <h3 className="font-display font-semibold text-lg text-primary">Horário de atendimento</h3>
              </div>
              <div className="space-y-3">
                {schedule.map(([day, hours]) => (
                  <div key={day} className="flex justify-between">
                    <span className="text-foreground">{day}</span>
                    <span className="text-muted-foreground">{hours}</span>
                  </div>
                ))}
              </div>
            </div>
          </div>
        </div>
      </div>
    </section>
  );
};

export default Contact;
