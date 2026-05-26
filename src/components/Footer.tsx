import { Instagram, MessageCircle, Mail } from "lucide-react";

const Footer = () => {
  const scrollTo = (id: string) => document.getElementById(id)?.scrollIntoView({ behavior: "smooth" });
  const whatsapp = () => window.open("https://wa.me/5511959075351", "_blank");
  const instagram = () => window.open("https://www.instagram.com/hugopavaofisio/", "_blank");
  const email = () => window.open("mailto:hugopavaoo@gmail.com", "_blank");

  return (
    <footer className="bg-primary text-primary-foreground">
      <div className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8 py-14">
        <div className="grid md:grid-cols-3 gap-10">
          <div>
            <div className="flex items-center gap-2 mb-4">
              <div className="flex items-center justify-center w-10 h-10 rounded-xl bg-accent text-accent-foreground font-display font-bold">
                HP
              </div>
              <div>
                <p className="font-display font-bold">Hugo Pavão</p>
                <p className="text-xs text-white/60">Fisioterapia Domiciliar</p>
              </div>
            </div>
            <p className="text-sm text-white/70 leading-relaxed">
              Cuidado fisioterapêutico humanizado, no conforto da sua casa — Grande ABC e São Paulo.
            </p>
          </div>

          <div>
            <p className="font-display font-semibold mb-4">Navegação</p>
            <ul className="space-y-2 text-sm text-white/70">
              {[
                { id: "servicos", label: "Serviços" },
                { id: "sobre", label: "Sobre" },
                { id: "depoimentos", label: "Depoimentos" },
                { id: "contato", label: "Contato" },
              ].map((l) => (
                <li key={l.id}>
                  <button onClick={() => scrollTo(l.id)} className="hover:text-accent transition-colors">
                    {l.label}
                  </button>
                </li>
              ))}
            </ul>
          </div>

          <div>
            <p className="font-display font-semibold mb-4">Contato</p>
            <ul className="space-y-3 text-sm text-white/70">
              <li>Hugo Pavão — Fisioterapeuta CREFITO</li>
              <li>Atendimento: Grande ABC e SP</li>
            </ul>
            <div className="flex gap-3 mt-5">
              <button onClick={whatsapp} aria-label="WhatsApp" className="w-10 h-10 rounded-xl bg-white/10 hover:bg-accent hover:text-accent-foreground transition-colors flex items-center justify-center">
                <MessageCircle className="w-5 h-5" />
              </button>
              <button onClick={instagram} aria-label="Instagram" className="w-10 h-10 rounded-xl bg-white/10 hover:bg-accent hover:text-accent-foreground transition-colors flex items-center justify-center">
                <Instagram className="w-5 h-5" />
              </button>
              <button onClick={email} aria-label="E-mail" className="w-10 h-10 rounded-xl bg-white/10 hover:bg-accent hover:text-accent-foreground transition-colors flex items-center justify-center">
                <Mail className="w-5 h-5" />
              </button>
            </div>
          </div>
        </div>

        <div className="border-t border-white/10 mt-12 pt-6 text-center text-xs text-white/50">
          © 2025 Hugo Pavão Fisioterapia. Todos os direitos reservados.
        </div>
      </div>
    </footer>
  );
};

export default Footer;
