import { Button } from "@/components/ui/button";
import { MessageCircle } from "lucide-react";
import heroImage from "@/assets/hero-fisioterapia.jpg";

const Hero = () => {
  const handleWhatsAppClick = () => {
    window.open('https://wa.me/5511959075351', '_blank');
  };

  const scrollToAbout = () => {
    const element = document.getElementById('sobre');
    element?.scrollIntoView({ behavior: 'smooth' });
  };

  return (
    <section id="inicio" className="relative min-h-screen flex items-center">
      {/* Background Image with Overlay */}
      <div 
        className="absolute inset-0 bg-cover bg-center bg-no-repeat"
        style={{ backgroundImage: `url(${heroImage})` }}
      >
        <div className="absolute inset-0 hero-gradient"></div>
      </div>

      {/* Content */}
      <div className="relative z-10 max-w-7xl mx-auto px-4 sm:px-6 lg:px-8 text-center text-white">
        <div className="max-w-4xl mx-auto">
          <h1 className="text-3xl sm:text-4xl md:text-5xl lg:text-6xl font-bold mb-4 sm:mb-6 leading-tight">
            Hugo Pavão
            <span className="block text-xl sm:text-2xl md:text-3xl lg:text-4xl font-normal mt-2 opacity-95">
              Fisioterapia Especializada
            </span>
          </h1>
          
          <p className="text-base sm:text-lg md:text-xl lg:text-2xl mb-6 sm:mb-8 opacity-90 max-w-3xl mx-auto leading-relaxed px-4">
            Cuidando da sua saúde com atenção e dedicação no conforto da sua casa.
          </p>

          <div className="flex flex-col sm:flex-row gap-3 sm:gap-4 justify-center items-center px-4">
            <Button 
              onClick={handleWhatsAppClick}
              size="lg"
              className="w-full sm:w-auto bg-whatsapp hover:bg-whatsapp-hover text-whatsapp-foreground text-base sm:text-lg px-6 sm:px-8 py-3 sm:py-4 h-auto font-semibold shadow-lg hover:shadow-xl transition-all duration-300 hover:scale-105"
            >
              <MessageCircle className="w-5 h-5 sm:w-6 sm:h-6 mr-2 sm:mr-3" />
              <span className="text-sm sm:text-base">Agende sua sessão no WhatsApp</span>
            </Button>
            
            <Button 
              onClick={scrollToAbout}
              variant="outline"
              size="lg"
              className="w-full sm:w-auto bg-white/10 hover:bg-white/20 text-white border-white/30 hover:border-white/50 text-base sm:text-lg px-6 sm:px-8 py-3 sm:py-4 h-auto backdrop-blur-sm transition-all duration-300"
            >
              Saiba Mais
            </Button>
          </div>
        </div>
      </div>

      {/* Scroll Indicator */}
      <div className="absolute bottom-8 left-1/2 transform -translate-x-1/2 text-white opacity-70">
        <div className="animate-bounce">
          <svg className="w-6 h-6" fill="none" stroke="currentColor" viewBox="0 0 24 24">
            <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M19 14l-7 7m0 0l-7-7m7 7V3" />
          </svg>
        </div>
      </div>
    </section>
  );
};

export default Hero;