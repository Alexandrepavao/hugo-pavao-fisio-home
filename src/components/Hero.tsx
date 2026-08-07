import { MessageCircle, ArrowRight } from "lucide-react";
import { Link } from "react-router-dom";
import Divider from "./Divider";
import { openPaciente } from "@/lib/contact";

const Hero = () => (
  <section id="inicio" className="px-6 sm:px-8 pt-16 pb-20 lg:pt-24 lg:pb-28">
    <div className="container-hp grid lg:grid-cols-[1.05fr_0.95fr] gap-14 lg:gap-20 items-center">
      <div className="animate-fade-in">
        <p className="eyebrow">Home Care · Cobertura Nacional</p>

        <h1 className="font-display text-4xl sm:text-5xl lg:text-[3.6rem] leading-[1.1] text-navy-900 mt-6">
          Fisioterapia que<br />vai até você.
        </h1>

        <div className="hp-divider justify-start my-8" aria-hidden="true">
          <span className="hp-divider-dot" />
        </div>

        <p className="text-navy-400 max-w-xl">
          Atendimento domiciliar humanizado em todo o Brasil. A HP Fisioterapia
          é uma rede de fisioterapeutas parceiros selecionados e capacitados em
          cada região do país, seguindo um único padrão de qualidade — com
          equipamentos inclusos, no conforto da sua casa.
        </p>

        <div className="flex flex-col sm:flex-row sm:items-center gap-5 mt-10">
          <button
            onClick={openPaciente}
            className="inline-flex items-center justify-center gap-3 bg-primary text-primary-foreground text-[13px] uppercase tracking-[0.16em] px-8 py-4 hover:bg-navy-900 transition-colors"
          >
            <MessageCircle className="w-4 h-4" />
            Agendar pelo WhatsApp
          </button>

          <Link
            to="/trabalhe-conosco"
            className="inline-flex items-center gap-2 text-[14px] text-accent hover:text-navy-900 transition-colors"
          >
            É fisioterapeuta? Conheça a HP
            <ArrowRight className="w-4 h-4" />
          </Link>
        </div>
      </div>

      <div className="animate-fade-in">
        <div className="relative border border-border bg-card p-3">
          <div className="placeholder-box aspect-[4/5] flex-col gap-3">
            <span className="font-display text-2xl normal-case tracking-normal text-navy-700">
              Foto do atendimento
            </span>
            <span>[inserir foto real de atendimento domiciliar]</span>
          </div>
        </div>
        <Divider className="mt-6" />
        <p className="text-center text-[12px] uppercase tracking-[0.24em] text-navy-400 mt-4">
          Movimento · Funcionalidade · Qualidade de vida
        </p>
      </div>
    </div>
  </section>
);

export default Hero;
