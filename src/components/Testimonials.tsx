import { Star, Quote } from "lucide-react";
import Divider from "./Divider";
import p1 from "@/assets/paciente-1.jpg";
import p2 from "@/assets/paciente-2.jpg";
import p3 from "@/assets/paciente-3.jpg";

const cards = [
  {
    photo: p1,
    name: "Marlene A.",
    info: "São Bernardo do Campo · Pós-operatório de quadril",
    text: "Voltei a andar sozinha pela casa em poucas semanas. O fisioterapeuta chegava sempre no horário, com todos os aparelhos, e explicava cada exercício com muita paciência.",
  },
  {
    photo: p2,
    name: "Ricardo M.",
    info: "São Paulo · Dor lombar crônica",
    text: "Eu já tinha tentado de tudo para a coluna. O plano foi montado para a minha rotina de trabalho em casa e, pela primeira vez, a dor parou de voltar toda semana.",
  },
  {
    photo: p3,
    name: "Juliana P.",
    info: "Santo André · Reabilitação do pai após AVC",
    text: "O acompanhamento com o meu pai foi humano do começo ao fim. Ele recuperou movimento do braço e nós, da família, aprendemos a ajudar no dia a dia.",
  },
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
        {cards.map((c) => (
          <article key={c.name} className="card-hp flex flex-col">
            <div className="flex items-center justify-between">
              <div className="flex items-center gap-1 text-accent">
                {Array.from({ length: 5 }).map((_, i) => (
                  <Star key={i} className="w-3.5 h-3.5 fill-current" />
                ))}
              </div>
              <Quote className="w-6 h-6 text-border" strokeWidth={1.25} />
            </div>

            <p className="text-[15px] text-navy-700 mt-6 flex-1 leading-relaxed">
              “{c.text}”
            </p>

            <div className="mt-8 pt-6 border-t border-border flex items-center gap-4">
              <img
                src={c.photo}
                alt={`Paciente ${c.name}`}
                width={512}
                height={512}
                loading="lazy"
                className="h-12 w-12 rounded-full object-cover"
              />
              <div>
                <p className="text-[14px] text-navy-900">{c.name}</p>
                <p className="text-[13px] text-navy-400">{c.info}</p>
              </div>
            </div>
          </article>
        ))}
      </div>
    </div>
  </section>
);

export default Testimonials;
