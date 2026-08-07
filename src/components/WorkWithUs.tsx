import { ArrowRight, MessageCircle, Compass, Users, ShieldCheck, CalendarClock } from "lucide-react";
import { Link } from "react-router-dom";
import Divider from "./Divider";
import { openProfissional } from "@/lib/contact";

const benefits = [
  { icon: CalendarClock, title: "Flexibilidade de agenda", text: "Você define os horários e a região em que quer atender." },
  { icon: Users, title: "Novos pacientes", text: "Encaminhamos demanda qualificada da sua cidade diretamente para você." },
  { icon: ShieldCheck, title: "Suporte da marca", text: "Protocolos, materiais e respaldo de uma marca já reconhecida em home care." },
  { icon: Compass, title: "Presença nacional", text: "Faça parte de uma rede em expansão por todo o Brasil, não de um cadastro genérico." },
];

const WorkWithUs = ({ full = false }: { full?: boolean }) => (
  <section id="trabalhe-conosco" className="section bg-navy-900">
    <div className="container-hp">
      <div className="max-w-3xl">
        <p className="eyebrow">Trabalhe conosco · Fisioterapeutas</p>
        <h2 className="font-display text-3xl sm:text-4xl lg:text-5xl text-background mt-5">
          Leve a HP Fisioterapia para a sua região
        </h2>
        <Divider className="justify-start my-8 [&::before]:hidden [&::after]:bg-accent/40" />
        <p className="text-background/70">
          A HP está construindo uma rede nacional de fisioterapia domiciliar e
          procura profissionais de alta capacidade técnica para representar a
          marca localmente. Não é um cadastro genérico de freelancer: cada
          parceiro passa por um processo de seleção e assume o padrão clínico e
          humano que define a HP em todo o país.
        </p>
      </div>

      <div className="grid sm:grid-cols-2 lg:grid-cols-4 gap-px bg-background/10 mt-14 border border-background/10">
        {benefits.map((b) => (
          <div key={b.title} className="bg-navy-900 p-8">
            <b.icon className="w-6 h-6 text-accent" strokeWidth={1.25} />
            <h3 className="font-display text-lg text-background mt-5">{b.title}</h3>
            <p className="text-[14px] text-background/60 mt-2">{b.text}</p>
          </div>
        ))}
      </div>

      <div className="flex flex-col sm:flex-row sm:items-center gap-6 mt-14">
        <button
          onClick={openProfissional}
          className="inline-flex items-center justify-center gap-3 bg-accent text-accent-foreground text-[13px] uppercase tracking-[0.16em] px-8 py-4 hover:opacity-90 transition-opacity"
        >
          <MessageCircle className="w-4 h-4" />
          Quero fazer parte
        </button>
        {!full && (
          <Link
            to="/trabalhe-conosco"
            className="inline-flex items-center gap-2 text-[14px] text-background/70 hover:text-background transition-colors"
          >
            Ver todos os detalhes da parceria
            <ArrowRight className="w-4 h-4" />
          </Link>
        )}
      </div>
    </div>
  </section>
);

export default WorkWithUs;
