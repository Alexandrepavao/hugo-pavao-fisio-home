import { Button } from "@/components/ui/button";
import { Menu, X, MessageCircle } from "lucide-react";
import { useState, useEffect } from "react";

const Header = () => {
  const [open, setOpen] = useState(false);
  const [scrolled, setScrolled] = useState(false);

  useEffect(() => {
    const onScroll = () => setScrolled(window.scrollY > 8);
    onScroll();
    window.addEventListener("scroll", onScroll);
    return () => window.removeEventListener("scroll", onScroll);
  }, []);

  const scrollTo = (id: string) => {
    document.getElementById(id)?.scrollIntoView({ behavior: "smooth" });
    setOpen(false);
  };

  const whatsapp = () => window.open(
    "https://wa.me/5511959075351?text=Oi,+tudo+bem%3F+Vi+seu+site+e+tenho+interesse+em+saber+mais+sobre+os+atendimentos+de+fisioterapia.+Pode+me+orientar%3F",
    "_blank"
  );

  const links = [
    { id: "servicos", label: "Serviços" },
    { id: "sobre", label: "Sobre" },
    { id: "depoimentos", label: "Depoimentos" },
    { id: "contato", label: "Contato" },
  ];

  return (
    <header
      className={`sticky top-0 z-40 transition-all duration-300 ${
        scrolled ? "bg-background/95 backdrop-blur shadow-[0_4px_20px_-12px_hsl(var(--primary)/0.25)]" : "bg-background"
      }`}
    >
      <div className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8">
        <div className="flex items-center justify-between h-18 py-3">
          <button onClick={() => scrollTo("inicio")} className="flex items-center gap-2 text-left">
            <div className="flex items-center justify-center w-10 h-10 rounded-xl bg-primary text-primary-foreground font-display font-bold">
              HP
            </div>
            <div className="leading-tight">
              <p className="font-display font-bold text-foreground text-base">Hugo Pavão</p>
              <p className="text-xs text-muted-foreground">Fisioterapia Domiciliar</p>
            </div>
          </button>

          <nav className="hidden lg:flex items-center gap-8">
            {links.map((l) => (
              <button
                key={l.id}
                onClick={() => scrollTo(l.id)}
                className="text-sm font-medium text-foreground/80 hover:text-primary transition-colors"
              >
                {l.label}
              </button>
            ))}
          </nav>

          <div className="hidden md:flex items-center gap-3">
            <Button
              onClick={whatsapp}
              className="bg-whatsapp hover:bg-whatsapp-hover text-whatsapp-foreground font-semibold"
            >
              <MessageCircle className="w-4 h-4 mr-2" />
              Agendar pelo WhatsApp
            </Button>
          </div>

          <Button
            onClick={() => setOpen(!open)}
            variant="outline"
            size="sm"
            className="md:hidden h-10 w-10 p-0"
            aria-label="Menu"
          >
            {open ? <X className="w-5 h-5" /> : <Menu className="w-5 h-5" />}
          </Button>
        </div>

        {open && (
          <div className="md:hidden absolute left-0 right-0 top-full bg-background border-b border-border shadow-xl">
            <div className="px-4 py-4 space-y-1">
              {links.map((l) => (
                <button
                  key={l.id}
                  onClick={() => scrollTo(l.id)}
                  className="block w-full text-left py-3 px-3 rounded-lg text-foreground hover:bg-secondary"
                >
                  {l.label}
                </button>
              ))}
              <Button
                onClick={whatsapp}
                className="w-full mt-2 bg-whatsapp hover:bg-whatsapp-hover text-whatsapp-foreground"
              >
                <MessageCircle className="w-4 h-4 mr-2" />
                Agendar pelo WhatsApp
              </Button>
            </div>
          </div>
        )}
      </div>
    </header>
  );
};

export default Header;
