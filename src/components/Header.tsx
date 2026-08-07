import { useEffect, useState } from "react";
import { Menu, X } from "lucide-react";
import { Link, useLocation, useNavigate } from "react-router-dom";
import Logo from "./Logo";
import { openPaciente } from "@/lib/contact";

const links = [
  { label: "Sobre", href: "#sobre" },
  { label: "Especialidades", href: "#especialidades" },
  { label: "Como Funciona", href: "#como-funciona" },
  { label: "Área de Atendimento", href: "#cobertura" },
  { label: "Depoimentos", href: "#depoimentos" },
];

const Header = () => {
  const [open, setOpen] = useState(false);
  const [scrolled, setScrolled] = useState(false);
  const location = useLocation();
  const navigate = useNavigate();

  useEffect(() => {
    const onScroll = () => setScrolled(window.scrollY > 12);
    window.addEventListener("scroll", onScroll);
    return () => window.removeEventListener("scroll", onScroll);
  }, []);

  const goTo = (href: string) => {
    setOpen(false);
    if (location.pathname !== "/") {
      navigate("/" + href);
      return;
    }
    document.querySelector(href)?.scrollIntoView({ behavior: "smooth" });
  };

  return (
    <header
      className={`sticky top-0 z-40 border-b transition-colors duration-300 ${
        scrolled ? "bg-background/95 backdrop-blur border-border" : "bg-background border-transparent"
      }`}
    >
      <div className="container-hp flex items-center justify-between gap-6 px-6 sm:px-8 py-4">
        <Logo className="h-11 sm:h-14" />

        <nav className="hidden lg:flex items-center gap-8">
          {links.map((l) => (
            <button
              key={l.href}
              onClick={() => goTo(l.href)}
              className="text-[14px] text-navy-400 hover:text-navy-900 transition-colors"
            >
              {l.label}
            </button>
          ))}
          <Link
            to="/trabalhe-conosco"
            className="text-[14px] text-accent hover:text-navy-900 transition-colors"
          >
            Trabalhe Conosco
          </Link>
        </nav>

        <div className="flex items-center gap-3">
          <button
            onClick={openPaciente}
            className="hidden sm:inline-flex bg-primary text-primary-foreground text-[13px] uppercase tracking-[0.14em] px-6 py-3 hover:bg-navy-900 transition-colors"
          >
            Agendar Avaliação
          </button>
          <button
            className="lg:hidden text-navy-900 p-2"
            onClick={() => setOpen(!open)}
            aria-label={open ? "Fechar menu" : "Abrir menu"}
          >
            {open ? <X className="w-6 h-6" /> : <Menu className="w-6 h-6" />}
          </button>
        </div>
      </div>

      {open && (
        <div className="lg:hidden border-t border-border bg-background px-6 py-6 flex flex-col gap-5">
          {links.map((l) => (
            <button
              key={l.href}
              onClick={() => goTo(l.href)}
              className="text-left text-navy-700"
            >
              {l.label}
            </button>
          ))}
          <Link
            to="/trabalhe-conosco"
            onClick={() => setOpen(false)}
            className="text-accent"
          >
            Trabalhe Conosco
          </Link>
          <button
            onClick={openPaciente}
            className="bg-primary text-primary-foreground text-[13px] uppercase tracking-[0.14em] px-6 py-3"
          >
            Agendar Avaliação
          </button>
        </div>
      )}
    </header>
  );
};

export default Header;
