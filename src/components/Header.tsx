
import { Button } from "@/components/ui/button";
import { Heart, Phone, Menu, X, Instagram } from "lucide-react";
import { useState } from "react";

const Header = () => {
  const [mobileMenuOpen, setMobileMenuOpen] = useState(false);
  
  const scrollToSection = (sectionId: string) => {
    const element = document.getElementById(sectionId);
    element?.scrollIntoView({ behavior: 'smooth' });
    setMobileMenuOpen(false);
  };

  const handleWhatsAppClick = () => {
    window.open('https://wa.me/5511959075351', '_blank');
  };

  const handleInstagramClick = () => {
    window.open('https://instagram.com/hugopavaoo', '_blank');
  };

  return (
    <header className="bg-background/95 backdrop-blur-sm border-b border-border sticky top-0 z-40">
      <div className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8">
        <div className="flex items-center justify-between h-16">
          {/* Logo */}
          <div className="flex items-center space-x-2">
            <div className="flex items-center justify-center w-8 h-8 sm:w-10 sm:h-10 rounded-full bg-primary">
              <Heart className="w-4 h-4 sm:w-5 sm:h-5 text-primary-foreground" />
            </div>
            <div>
              <h1 className="text-base sm:text-lg font-bold text-foreground">Hugo Pavão</h1>
              <p className="text-xs text-muted-foreground hidden sm:block">Fisioterapia Especializada</p>
            </div>
          </div>

          {/* Desktop Navigation */}
          <nav className="hidden lg:flex items-center space-x-6">
            <button
              onClick={() => scrollToSection('inicio')}
              className="text-sm text-foreground hover:text-primary transition-colors duration-200"
            >
              Início
            </button>
            <button
              onClick={() => scrollToSection('sobre')}
              className="text-sm text-foreground hover:text-primary transition-colors duration-200"
            >
              Sobre
            </button>
            <button
              onClick={() => scrollToSection('servicos')}
              className="text-sm text-foreground hover:text-primary transition-colors duration-200"
            >
              Serviços
            </button>
            <button
              onClick={() => scrollToSection('depoimentos')}
              className="text-sm text-foreground hover:text-primary transition-colors duration-200"
            >
              Depoimentos
            </button>
            <button
              onClick={() => scrollToSection('contato')}
              className="text-sm text-foreground hover:text-primary transition-colors duration-200"
            >
              Contato
            </button>
          </nav>

          {/* Desktop Actions */}
          <div className="hidden md:flex items-center space-x-3">
            <Button
              onClick={handleInstagramClick}
              variant="outline"
              size="sm"
              className="h-9 w-9 p-0"
            >
              <Instagram className="w-4 h-4" />
            </Button>
            <Button 
              onClick={handleWhatsAppClick}
              variant="default"
              size="sm"
              className="bg-whatsapp hover:bg-whatsapp-hover text-whatsapp-foreground"
            >
              <Phone className="w-4 h-4 mr-2" />
              <span className="hidden lg:inline">Agendar</span>
            </Button>
          </div>

          {/* Mobile Menu Button */}
          <Button
            onClick={() => setMobileMenuOpen(!mobileMenuOpen)}
            variant="outline"
            size="sm"
            className="md:hidden h-9 w-9 p-0"
          >
            {mobileMenuOpen ? <X className="w-4 h-4" /> : <Menu className="w-4 h-4" />}
          </Button>
        </div>

        {/* Mobile Menu - Fixed with solid background */}
        {mobileMenuOpen && (
          <div className="md:hidden absolute left-0 right-0 top-16 bg-background border-b border-border shadow-xl z-50">
            <div className="px-4 py-6 space-y-4">
              <button
                onClick={() => scrollToSection('inicio')}
                className="block w-full text-left py-3 text-foreground hover:text-primary hover:bg-muted rounded-lg px-4 transition-colors duration-200"
              >
                Início
              </button>
              <button
                onClick={() => scrollToSection('sobre')}
                className="block w-full text-left py-3 text-foreground hover:text-primary hover:bg-muted rounded-lg px-4 transition-colors duration-200"
              >
                Sobre
              </button>
              <button
                onClick={() => scrollToSection('servicos')}
                className="block w-full text-left py-3 text-foreground hover:text-primary hover:bg-muted rounded-lg px-4 transition-colors duration-200"
              >
                Serviços
              </button>
              <button
                onClick={() => scrollToSection('depoimentos')}
                className="block w-full text-left py-3 text-foreground hover:text-primary hover:bg-muted rounded-lg px-4 transition-colors duration-200"
              >
                Depoimentos
              </button>
              <button
                onClick={() => scrollToSection('contato')}
                className="block w-full text-left py-3 text-foreground hover:text-primary hover:bg-muted rounded-lg px-4 transition-colors duration-200"
              >
                Contato
              </button>
              
              <div className="flex space-x-3 pt-4 border-t border-border">
                <Button
                  onClick={handleInstagramClick}
                  variant="outline"
                  size="sm"
                  className="flex-1"
                >
                  <Instagram className="w-4 h-4 mr-2" />
                  Instagram
                </Button>
                <Button 
                  onClick={handleWhatsAppClick}
                  size="sm"
                  className="flex-1 bg-whatsapp hover:bg-whatsapp-hover text-whatsapp-foreground"
                >
                  <Phone className="w-4 h-4 mr-2" />
                  WhatsApp
                </Button>
              </div>
            </div>
          </div>
        )}
      </div>
    </header>
  );
};

export default Header;
