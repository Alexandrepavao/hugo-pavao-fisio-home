import { MessageCircle, Instagram, MapPin } from "lucide-react";
import { Link } from "react-router-dom";
import Logo from "./Logo";
import Divider from "./Divider";
import {
  linkPaciente,
  linkProfissional,
  WHATSAPP_PACIENTES_DISPLAY,
  WHATSAPP_PROFISSIONAIS_DISPLAY,
} from "@/lib/contact";

const menu = [
  { label: "Sobre", href: "/#sobre" },
  { label: "Especialidades", href: "/#especialidades" },
  { label: "Como Funciona", href: "/#como-funciona" },
  { label: "Área de Atendimento", href: "/#cobertura" },
  { label: "Depoimentos", href: "/#depoimentos" },
  { label: "Perguntas Frequentes", href: "/#faq" },
];

const Footer = () => (
  <footer className="bg-card border-t border-border">
    <div className="container-hp px-6 sm:px-8 py-16 grid lg:grid-cols-[1.2fr_1fr_1fr] gap-12">
      <div>
        <Logo className="h-16" />
        <p className="text-[15px] text-navy-400 mt-6 max-w-sm">
          Fisioterapia domiciliar humanizada em todo o Brasil, através de uma
          rede de fisioterapeutas parceiros selecionados em cada região.
        </p>
        <p className="flex items-start gap-2 text-[14px] text-navy-400 mt-6">
          <MapPin className="w-4 h-4 mt-1 text-accent shrink-0" strokeWidth={1.5} />
          Atuação nacional · Base em São Paulo (capital) e Grande ABC
        </p>
        <a
          href="https://instagram.com"
          target="_blank"
          rel="noopener noreferrer"
          className="inline-flex items-center gap-2 text-[14px] text-navy-400 hover:text-accent transition-colors mt-4"
        >
          <Instagram className="w-4 h-4" strokeWidth={1.5} />
          Instagram @hpfisioterapia
        </a>
      </div>

      <div>
        <p className="text-[12px] uppercase tracking-[0.22em] text-navy-900">Contato</p>
        <Divider className="justify-start my-5 [&::before]:hidden" />

        <a
          href={linkPaciente}
          target="_blank"
          rel="noopener noreferrer"
          className="block group"
        >
          <span className="text-[12px] uppercase tracking-[0.16em] text-accent">
            Pacientes / Agendamentos
          </span>
          <span className="flex items-center gap-2 text-navy-900 group-hover:text-accent transition-colors mt-1">
            <MessageCircle className="w-4 h-4" strokeWidth={1.5} />
            {WHATSAPP_PACIENTES_DISPLAY}
          </span>
        </a>

        <a
          href={linkProfissional}
          target="_blank"
          rel="noopener noreferrer"
          className="block group mt-6"
        >
          <span className="text-[12px] uppercase tracking-[0.16em] text-accent">
            Fisioterapeutas / Trabalhe Conosco
          </span>
          <span className="flex items-center gap-2 text-navy-900 group-hover:text-accent transition-colors mt-1">
            <MessageCircle className="w-4 h-4" strokeWidth={1.5} />
            {WHATSAPP_PROFISSIONAIS_DISPLAY}
          </span>
        </a>
      </div>

      <div>
        <p className="text-[12px] uppercase tracking-[0.22em] text-navy-900">Navegação</p>
        <Divider className="justify-start my-5 [&::before]:hidden" />
        <ul className="space-y-3">
          {menu.map((m) => (
            <li key={m.href}>
              <a href={m.href} className="text-[15px] text-navy-400 hover:text-accent transition-colors">
                {m.label}
              </a>
            </li>
          ))}
          <li>
            <Link to="/trabalhe-conosco" className="text-[15px] text-accent hover:text-navy-900 transition-colors">
              Trabalhe Conosco
            </Link>
          </li>
        </ul>
      </div>
    </div>

    <div className="border-t border-border">
      <div className="container-hp px-6 sm:px-8 py-6 flex flex-col sm:flex-row items-center justify-between gap-3 text-[13px] text-navy-400">
        <p>© {new Date().getFullYear()} HP Fisioterapia · Todos os direitos reservados</p>
        <p className="uppercase tracking-[0.2em] text-[11px]">
          Movimento · Funcionalidade · Qualidade de vida
        </p>
      </div>
    </div>
  </footer>
);

export default Footer;
