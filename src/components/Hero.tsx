import { MessageCircle, ArrowRight, Star } from "lucide-react";
import { Link } from "react-router-dom";
import { openPaciente } from "@/lib/contact";
import HeroVisual from "./HeroVisual";
import p1 from "@/assets/paciente-1.jpg";
import p2 from "@/assets/paciente-2.jpg";
import p3 from "@/assets/paciente-3.jpg";

const Hero = () => (
  <section id="inicio" className="relative overflow-hidden px-6 sm:px-8 pt-14 pb-20 lg:pt-20 lg:pb-28">
    <div className="hero-glow" aria-hidden="true" />

    <div className="container-hp relative grid lg:grid-cols-[1.02fr_0.98fr] gap-14 lg:gap-20 items-center">
      <div className="animate-fade-in">
        <p className="eyebrow">Home Care · Cobertura Nacional</p>

        <h1 className="font-display text-4xl sm:text-5xl lg:text-[3.7rem] leading-[1.08] text-navy-900 mt-6">
          Fisioterapia que<br />
          <span className="italic text-accent">vai até você.</span>
        </h1>

        <div className="hp-divider justify-start my-8" aria-hidden="true">
          <span className="hp-divider-dot" />
        </div>

        <p className="text-navy-400 max-w-xl">
          Atendimento domiciliar humanizado em todo o Brasil. O HP Fisio Group
          é uma rede de fisioterapeutas parceiros selecionados e capacitados em
          cada região do país, seguindo um único padrão de qualidade — com
          equipamentos inclusos, no conforto da sua casa.
        </p>

        <div className="flex flex-col sm:flex-row sm:items-center gap-5 mt-10">
          <button onClick={openPaciente} className="btn-primary">
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

        <div className="flex items-center gap-5 mt-12 pt-8 border-t border-border">
          <div className="flex -space-x-3">
            {[p1, p2, p3].map((src, i) => (
              <img
                key={i}
                src={src}
                alt=""
                loading="lazy"
                className="h-11 w-11 rounded-full object-cover border-2 border-background"
              />
            ))}
          </div>
          <div>
            <div className="flex items-center gap-1 text-accent">
              {Array.from({ length: 5 }).map((_, i) => (
                <Star key={i} className="w-3.5 h-3.5 fill-current" />
              ))}
            </div>
            <p className="text-[13px] text-navy-400 mt-1">
              Pacientes atendidos em casa com acompanhamento próximo
            </p>
          </div>
        </div>
      </div>

      <div className="animate-fade-in">
        <HeroVisual />

        <p className="text-center text-[12px] uppercase tracking-[0.24em] text-navy-400 mt-12">
          Movimento · Funcionalidade · Qualidade de vida
        </p>
      </div>
    </div>
  </section>
);

export default Hero;
