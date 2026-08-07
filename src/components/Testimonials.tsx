import Divider from "./Divider";

const cards = [
  { name: "[nome do paciente]", info: "[cidade] · [tratamento realizado]" },
  { name: "[nome do paciente]", info: "[cidade] · [tratamento realizado]" },
  { name: "[nome do paciente]", info: "[cidade] · [tratamento realizado]" },
];

const Testimonials = () => (
  <section id="depoimentos" className="section">
    <div className="container-hp">
      <div className="text-center max-w-2xl mx-auto">
        <p className="eyebrow">Depoimentos</p>
        <h2 className="font-display text-3xl sm:text-4xl lg:text-5xl text-navy-900 mt-5">
          Quem já foi atendido pela HP
        </h2>
        <Divider className="mt-8" />
      </div>

      <div className="grid md:grid-cols-3 gap-8 mt-16">
        {cards.map((c, i) => (
          <article key={i} className="card-hp flex flex-col">
            <Divider className="justify-start [&::before]:hidden" />
            <p className="font-display text-lg text-navy-700 mt-6 flex-1">
              “[depoimento real do paciente aqui]”
            </p>
            <div className="mt-8 pt-6 border-t border-border">
              <p className="text-[13px] uppercase tracking-[0.16em] text-accent">{c.name}</p>
              <p className="text-[13px] text-navy-400 mt-1">{c.info}</p>
            </div>
          </article>
        ))}
      </div>

      <p className="text-center text-[13px] text-navy-400 mt-10">
        Espaço reservado para avaliações verdadeiras de pacientes — substituir
        pelos depoimentos reais.
      </p>
    </div>
  </section>
);

export default Testimonials;
