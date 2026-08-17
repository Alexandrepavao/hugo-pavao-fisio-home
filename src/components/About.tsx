import Divider from "./Divider";
import retrato from "@/assets/hugo-pavao.jpg";
import terapia from "@/assets/terapia-manual.jpg";

const About = () => (
  <section id="sobre" className="section">
    <div className="container-hp grid lg:grid-cols-[0.9fr_1.1fr] gap-14 lg:gap-20 items-center">
      <div className="relative">
        <img
          src={retrato}
          alt="Hugo Pavão, fisioterapeuta fundador da HP Fisioterapia"
          width={1008}
          height={1264}
          loading="lazy"
          className="w-full aspect-[4/5] object-cover"
        />
        <img
          src={terapia}
          alt="Terapia manual em atendimento domiciliar"
          width={1200}
          height={912}
          loading="lazy"
          className="hidden sm:block absolute -bottom-10 -right-6 w-44 aspect-square object-cover border-4 border-background"
        />
      </div>

      <div>
        <p className="eyebrow">Sobre o fundador</p>
        <h2 className="font-display text-3xl sm:text-4xl lg:text-5xl text-navy-900 mt-5">
          Hugo Pavão
        </h2>
        <p className="text-[13px] uppercase tracking-[0.2em] text-navy-400 mt-4">
          Fisioterapeuta · Fundador da rede HP
        </p>

        <Divider className="justify-start my-8 [&::before]:hidden" />

        <p className="text-navy-400">
          Hugo Pavão é o fisioterapeuta fundador da HP Fisioterapia e a
          referência da marca em São Paulo e no Grande ABC, onde atende
          diretamente. Depois de anos dedicados à reabilitação de pacientes
          ortopédicos, neurológicos e geriátricos, ele construiu a HP a partir
          de uma convicção simples: o tratamento funciona melhor quando acontece
          na rotina real do paciente, dentro de casa.
        </p>
        <p className="text-navy-400 mt-5">
          É essa filosofia de atendimento humanizado — escuta atenta, plano
          individualizado e acompanhamento próximo — que define o padrão seguido
          por todos os fisioterapeutas parceiros da rede HP em cada região do
          país. Quem contrata a HP em qualquer estado recebe o mesmo cuidado e o
          mesmo critério clínico.
        </p>

        <div className="grid sm:grid-cols-3 gap-8 mt-10 pt-8 border-t border-border">
          <div>
            <p className="font-display text-2xl text-navy-900">Domiciliar</p>
            <p className="text-[13px] text-navy-400 mt-1">Especialidade da casa</p>
          </div>
          <div>
            <p className="font-display text-2xl text-navy-900">9 áreas</p>
            <p className="text-[13px] text-navy-400 mt-1">Especialidades atendidas</p>
          </div>
          <div>
            <p className="font-display text-2xl text-navy-900">SP · ABC</p>
            <p className="text-[13px] text-navy-400 mt-1">Atendimento direto</p>
          </div>
        </div>
      </div>
    </div>
  </section>
);

export default About;
