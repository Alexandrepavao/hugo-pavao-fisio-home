import { Button } from "@/components/ui/button";
import { Heart, Phone } from "lucide-react";

const Header = () => {
  const scrollToSection = (sectionId: string) => {
    const element = document.getElementById(sectionId);
    element?.scrollIntoView({ behavior: 'smooth' });
  };

  const handleWhatsAppClick = () => {
    window.open('https://wa.me/5511959075351', '_blank');
  };

  return (
    <header className="bg-background/95 backdrop-blur-sm border-b border-border sticky top-0 z-40">
      <div className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8">
        <div className="flex items-center justify-between h-16">
          {/* Logo */}
          <div className="flex items-center space-x-2">
            <div className="flex items-center justify-center w-10 h-10 rounded-full bg-primary">
              <Heart className="w-5 h-5 text-primary-foreground" />
            </div>
            <div>
              <h1 className="text-lg font-bold text-foreground">Hugo Pavão</h1>
              <p className="text-xs text-muted-foreground">Fisioterapia Especializada</p>
            </div>
          </div>

          {/* Navigation */}
          <nav className="hidden md:flex items-center space-x-8">
            <button
              onClick={() => scrollToSection('inicio')}
              className="text-foreground hover:text-primary transition-colors duration-200"
            >
              Início
            </button>
            <button
              onClick={() => scrollToSection('sobre')}
              className="text-foreground hover:text-primary transition-colors duration-200"
            >
              Sobre
            </button>
            <button
              onClick={() => scrollToSection('servicos')}
              className="text-foreground hover:text-primary transition-colors duration-200"
            >
              Serviços
            </button>
            <button
              onClick={() => scrollToSection('depoimentos')}
              className="text-foreground hover:text-primary transition-colors duration-200"
            >
              Depoimentos
            </button>
            <button
              onClick={() => scrollToSection('contato')}
              className="text-foreground hover:text-primary transition-colors duration-200"
            >
              Contato
            </button>
          </nav>

          {/* CTA Button */}
          <Button 
            onClick={handleWhatsAppClick}
            variant="default"
            size="sm"
            className="bg-whatsapp hover:bg-whatsapp-hover text-whatsapp-foreground"
          >
            <Phone className="w-4 h-4 mr-2" />
            <span className="hidden sm:inline">Agendar</span>
          </Button>
        </div>
      </div>
    </header>
  );
};

export default Header;