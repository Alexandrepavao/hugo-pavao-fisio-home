
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { 
  MessageCircle, 
  Mail, 
  MapPin, 
  Clock,
  Phone,
  Instagram
} from "lucide-react";

const Contact = () => {
  const handleWhatsAppClick = () => {
    window.open('https://wa.me/5511959075351', '_blank');
  };

  const handleEmailClick = () => {
    window.open('mailto:hugopavaoo@gmail.com', '_blank');
  };

  const handleInstagramClick = () => {
    window.open('https://instagram.com/hugopavaoo', '_blank');
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

        <div className="grid lg:grid-cols-2 gap-8 lg:gap-12 items-start">
          {/* Contact Info */}
          <div className="space-y-6 sm:space-y-8">
            <Card className="card-professional">
              <CardHeader>
                <CardTitle className="flex items-center space-x-3 text-lg sm:text-xl">
                  <MessageCircle className="w-5 h-5 sm:w-6 sm:h-6 text-whatsapp flex-shrink-0" />
                  <span>WhatsApp - Contato Direto</span>
                </CardTitle>
              </CardHeader>
              <CardContent>
                <p className="text-muted-foreground mb-4 text-sm sm:text-base">
                  A forma mais rápida de agendar sua consulta. Respondo rapidamente!
                </p>
                <Button 
                  onClick={handleWhatsAppClick}
                  className="bg-whatsapp hover:bg-whatsapp-hover text-whatsapp-foreground w-full"
                  size="lg"
                >
                  <MessageCircle className="w-4 h-4 sm:w-5 sm:h-5 mr-2" />
                  <span className="text-sm sm:text-base">Conversar no WhatsApp</span>
                </Button>
              </CardContent>
            </Card>

            <Card className="card-professional">
              <CardHeader>
                <CardTitle className="flex items-center space-x-3 text-lg sm:text-xl">
                  <Instagram className="w-5 h-5 sm:w-6 sm:h-6 text-pink-500 flex-shrink-0" />
                  <span>Instagram</span>
                </CardTitle>
              </CardHeader>
              <CardContent>
                <p className="text-muted-foreground mb-4 text-sm sm:text-base">
                  Acompanhe dicas de saúde e conteúdos exclusivos
                </p>
                <Button 
                  onClick={handleInstagramClick}
                  variant="outline"
                  className="w-full border-pink-200 hover:bg-pink-50"
                  size="lg"
                >
                  <Instagram className="w-4 h-4 sm:w-5 sm:h-5 mr-2" />
                  <span className="text-sm sm:text-base">@hugopavaoo</span>
                </Button>
              </CardContent>
            </Card>

            <Card className="card-professional">
              <CardHeader>
                <CardTitle className="flex items-center space-x-3 text-lg sm:text-xl">
                  <Mail className="w-5 h-5 sm:w-6 sm:h-6 text-primary flex-shrink-0" />
                  <span>E-mail</span>
                </CardTitle>
              </CardHeader>
              <CardContent>
                <p className="text-muted-foreground mb-4 text-sm sm:text-base">
                  Para dúvidas e informações mais detalhadas
                </p>
                <Button 
                  onClick={handleEmailClick}
                  variant="outline"
                  className="w-full"
                  size="lg"
                >
                  <Mail className="w-4 h-4 sm:w-5 sm:h-5 mr-2" />
                  <span className="text-sm sm:text-base break-all">hugopavaoo@gmail.com</span>
                </Button>
              </CardContent>
            </Card>
          </div>

          {/* Service Areas & Info */}
          <div className="space-y-6 sm:space-y-8">
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
        <div className="text-center mt-12 sm:mt-16">
          <div className="bg-white/50 backdrop-blur-sm rounded-2xl p-6 sm:p-8 border border-border">
            <h3 className="text-xl sm:text-2xl font-bold text-foreground mb-4">
              Pronto para começar seu tratamento?
            </h3>
            <p className="text-muted-foreground mb-6 max-w-2xl mx-auto text-sm sm:text-base">
              Atendimento domiciliar humanizado e personalizado no Grande ABC e São Paulo
            </p>
            <Button 
              onClick={handleWhatsAppClick}
              size="lg"
              className="w-full sm:w-auto bg-whatsapp hover:bg-whatsapp-hover text-whatsapp-foreground text-base sm:text-lg px-6 sm:px-8 py-3 sm:py-4 h-auto font-semibold shadow-lg hover:shadow-xl transition-all duration-300 hover:scale-105"
            >
              <Phone className="w-5 h-5 sm:w-6 sm:h-6 mr-2 sm:mr-3" />
              <span className="text-sm sm:text-base">Agendar Consulta Agora</span>
            </Button>
          </div>
        </div>
      </div>
    </section>
  );
};

export default Contact;
