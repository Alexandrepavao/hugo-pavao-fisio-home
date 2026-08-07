import Divider from "./Divider";

const steps = [
  {
    n: "01",
    title: "Você fala com a gente pelo WhatsApp",
    text: "Conte o que está sentindo, para quem é o atendimento e em qual cidade você está. O contato é direto, sem formulário e sem espera.",
  },
  {
    n: "02",
    title: "Fazemos uma avaliação personalizada",
    text: "Entendemos o histórico, os objetivos e as condições do ambiente para montar um plano de tratamento sob medida para o seu caso.",
  },
  {
    n: "03",
    title: "O fisioterapeuta vai até a sua casa",
    text: "Um profissional da rede HP da sua região realiza o atendimento no horário combinado, com todos os equipamentos necessários inclusos.",
  },
];

const HowItWorks = () => (
  <section id="como-funciona" className="section">
    <div className="container-hp">
      <div className="text-center max-w-2xl mx-auto">
        <p className="eyebrow">Como funciona</p>
        <h2 className="font-display text-3xl sm:text-4xl lg:text-5xl text-navy-900 mt-5">
          Três passos até o primeiro atendimento
        </h2>
        <Divider className="mt-8" />
      </div>

      <div className="grid md:grid-cols-3 gap-12 lg:gap-16 mt-16">
        {steps.map((s) => (
          <div key={s.n}>
            <p className="font-display text-4xl text-accent">{s.n}</p>
            <div className="h-px w-full bg-border my-6 relative">
              <span className="absolute left-0 -top-[3px] h-[7px] w-[7px] rounded-full bg-accent" />
            </div>
            <h3 className="font-display text-xl text-navy-900">{s.title}</h3>
            <p className="text-[15px] text-navy-400 mt-3">{s.text}</p>
          </div>
        ))}
      </div>
    </div>
  </section>
);

export default HowItWorks;
