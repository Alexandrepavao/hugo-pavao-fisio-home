import Divider from "./Divider";

const About = () => (
  <section id="sobre" className="section">
    <div className="container-hp grid lg:grid-cols-[0.85fr_1.15fr] gap-14 lg:gap-20 items-center">
      <div>
        <div className="border border-border bg-card p-3">
          <div className="placeholder-box aspect-[4/5] flex-col gap-3">
            <span className="font-display text-2xl normal-case tracking-normal text-navy-700">
              Foto do Hugo Pavão
            </span>
            <span>[inserir foto real do profissional]</span>
          </div>
        </div>
      </div>

      <div>
        <p className="eyebrow">Sobre o fundador</p>
        <h2 className="font-display text-3xl sm:text-4xl lg:text-5xl text-navy-900 mt-5">
          Hugo Pavão
        </h2>
        <p className="text-[13px] uppercase tracking-[0.2em] text-navy-400 mt-4">
          Fisioterapeuta · CREFITO [inserir número]
        </p>

        <Divider className="justify-start my-8 [&::before]:hidden" />

        <p className="text-navy-400">
          Hugo Pavão é o fisioterapeuta fundador da HP Fisioterapia e a
          referência da marca em São Paulo e no Grande ABC, onde atende
          diretamente. Formado em [inserir formação] e com [inserir anos] anos
          de experiência em reabilitação domiciliar, ele construiu a HP a partir
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
            <p className="font-display text-2xl text-navy-900">[inserir]</p>
            <p className="text-[13px] text-navy-400 mt-1">Anos de experiência</p>
          </div>
          <div>
            <p className="font-display text-2xl text-navy-900">[inserir]</p>
            <p className="text-[13px] text-navy-400 mt-1">Formação e pós</p>
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
