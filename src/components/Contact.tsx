import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { 
  MessageCircle, 
  Mail, 
  MapPin, 
  Clock,
  Phone
} from "lucide-react";

const Contact = () => {
  const handleWhatsAppClick = () => {
    window.open('https://wa.me/5511959075351', '_blank');
  };

  const handleEmailClick = () => {
    window.open('mailto:hugo.pavao@fisio.com.br', '_blank');
  };

  return (
    <section id="contato" className="section-padding-lg bg-soft-gradient">
      <div className="max-w-7xl mx-auto">
        <div className="text-center mb-16">
          <h2 className="text-3xl sm:text-4xl lg:text-5xl font-bold text-foreground mb-4">
            Agende sua avaliação
          </h2>
          <p className="text-lg text-muted-foreground max-w-2xl mx-auto">
            Entre em contato e inicie seu tratamento personalizado hoje mesmo
          </p>
        </div>

        <div className="grid lg:grid-cols-2 gap-12 items-start">
          {/* Contact Info */}
          <div className="space-y-8">
            <Card className="card-professional">
              <CardHeader>
                <CardTitle className="flex items-center space-x-3">
                  <MessageCircle className="w-6 h-6 text-whatsapp" />
                  <span>WhatsApp - Contato Direto</span>
                </CardTitle>
              </CardHeader>
              <CardContent>
                <p className="text-muted-foreground mb-4">
                  A forma mais rápida de agendar sua consulta. Respondo rapidamente!
                </p>
                <Button 
                  onClick={handleWhatsAppClick}
                  className="bg-whatsapp hover:bg-whatsapp-hover text-whatsapp-foreground w-full"
                  size="lg"
                >
                  <MessageCircle className="w-5 h-5 mr-2" />
                  Conversar no WhatsApp
                </Button>
              </CardContent>
            </Card>

            <Card className="card-professional">
              <CardHeader>
                <CardTitle className="flex items-center space-x-3">
                  <Mail className="w-6 h-6 text-primary" />
                  <span>E-mail</span>
                </CardTitle>
              </CardHeader>
              <CardContent>
                <p className="text-muted-foreground mb-4">
                  Para dúvidas e informações mais detalhadas
                </p>
                <Button 
                  onClick={handleEmailClick}
                  variant="outline"
                  className="w-full"
                  size="lg"
                >
                  <Mail className="w-5 h-5 mr-2" />
                  hugo.pavao@fisio.com.br
                </Button>
              </CardContent>
            </Card>
          </div>

          {/* Service Areas & Info */}
          <div className="space-y-8">
            <Card className="card-professional">
              <CardHeader>
                <CardTitle className="flex items-center space-x-3">
                  <MapPin className="w-6 h-6 text-primary" />
                  <span>Área de Atendimento</span>
                </CardTitle>
              </CardHeader>
              <CardContent>
                <div className="space-y-3">
                  <div className="flex items-center space-x-3">
                    <div className="w-2 h-2 bg-primary rounded-full"></div>
                    <span className="text-foreground font-medium">Grande ABC</span>
                  </div>
                  <div className="flex items-center space-x-3">
                    <div className="w-2 h-2 bg-primary rounded-full"></div>
                    <span className="text-foreground font-medium">São Paulo (Capital)</span>
                  </div>
                  <p className="text-muted-foreground text-sm mt-4">
                    Atendimento domiciliar em toda a região metropolitana
                  </p>
                </div>
              </CardContent>
            </Card>

            <Card className="card-professional">
              <CardHeader>
                <CardTitle className="flex items-center space-x-3">
                  <Clock className="w-6 h-6 text-primary" />
                  <span>Horário de Atendimento</span>
                </CardTitle>
              </CardHeader>
              <CardContent>
                <div className="space-y-2">
                  <div className="flex justify-between">
                    <span className="text-foreground">Segunda a Sexta</span>
                    <span className="text-muted-foreground">8h às 18h</span>
                  </div>
                  <div className="flex justify-between">
                    <span className="text-foreground">Sábados</span>
                    <span className="text-muted-foreground">8h às 14h</span>
                  </div>
                  <div className="flex justify-between">
                    <span className="text-foreground">Emergências</span>
                    <span className="text-muted-foreground">Sob consulta</span>
                  </div>
                </div>
              </CardContent>
            </Card>
          </div>
        </div>

        {/* CTA Final */}
        <div className="text-center mt-16">
          <div className="bg-white/50 backdrop-blur-sm rounded-2xl p-8 border border-border">
            <h3 className="text-2xl font-bold text-foreground mb-4">
              Pronto para começar seu tratamento?
            </h3>
            <p className="text-muted-foreground mb-6 max-w-2xl mx-auto">
              Atendimento domiciliar humanizado e personalizado no Grande ABC e São Paulo
            </p>
            <Button 
              onClick={handleWhatsAppClick}
              size="lg"
              className="bg-whatsapp hover:bg-whatsapp-hover text-whatsapp-foreground text-lg px-8 py-4 h-auto font-semibold shadow-lg hover:shadow-xl transition-all duration-300 hover:scale-105"
            >
              <Phone className="w-6 h-6 mr-3" />
              Agendar Consulta Agora
            </Button>
          </div>
        </div>
      </div>
    </section>
  );
};

export default Contact;