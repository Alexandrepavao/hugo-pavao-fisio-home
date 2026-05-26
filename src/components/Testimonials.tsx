import { Star, Quote } from "lucide-react";

const Testimonials = () => {
  const items = [
    {
      name: "Maria S.",
      city: "Santo André",
      text: "O Hugo me ajudou a recuperar após minha cirurgia de joelho, super atencioso e profissional. Em poucos meses consegui andar normalmente novamente.",
      treatment: "Reabilitação Pós-Cirúrgica",
    },
    {
      name: "João P.",
      city: "São Paulo",
      text: "Atendimento em casa fez toda a diferença no meu tratamento. Recomendo muito! Além de conveniente, o Hugo é muito competente.",
      treatment: "Fisioterapia Domiciliar",
    },
    {
      name: "Ana L.",
      city: "São Bernardo",
      text: "Excelente profissional! Me ajudou muito com as dores nas costas. Agora posso trabalhar sem desconforto graças ao tratamento.",
      treatment: "Dores Crônicas",
    },
  ];

  return (
    <section id="depoimentos" className="section-padding-lg">
      <div className="max-w-7xl mx-auto">
        <div className="text-center mb-14 max-w-2xl mx-auto">
          <p className="text-accent font-semibold text-sm uppercase tracking-wider mb-3">Depoimentos</p>
          <h2 className="font-display font-bold text-3xl sm:text-4xl lg:text-5xl text-primary mb-4">
            O que dizem meus pacientes
          </h2>
          <p className="text-lg text-muted-foreground">
            Histórias reais de quem confiou no atendimento humanizado.
          </p>
        </div>

        <div className="grid md:grid-cols-3 gap-6">
          {items.map((t, i) => (
            <article key={i} className="card-pro relative">
              <Quote className="absolute top-5 right-5 w-10 h-10 text-accent/15" />
              <div className="flex gap-1 mb-4">
                {Array.from({ length: 5 }).map((_, j) => (
                  <Star key={j} className="w-4 h-4 fill-accent text-accent" />
                ))}
              </div>
              <p className="text-foreground/85 leading-relaxed mb-6">"{t.text}"</p>
              <div className="flex items-center gap-3 pt-4 border-t border-border">
                <div className="w-11 h-11 rounded-full bg-primary text-primary-foreground flex items-center justify-center font-display font-bold">
                  {t.name.charAt(0)}
                </div>
                <div>
                  <p className="font-semibold text-primary">{t.name}</p>
                  <p className="text-xs text-muted-foreground">
                    {t.city} · {t.treatment}
                  </p>
                </div>
              </div>
            </article>
          ))}
        </div>
      </div>
    </section>
  );
};

export default Testimonials;
