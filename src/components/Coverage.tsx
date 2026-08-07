import { MessageCircle } from "lucide-react";
import Divider from "./Divider";
import { openPaciente } from "@/lib/contact";

const regioes = [
  "São Paulo (capital)",
  "Grande ABC",
  "[inserir estado/capital confirmado]",
  "[inserir estado/capital confirmado]",
  "[inserir estado/capital confirmado]",
  "[inserir estado/capital confirmado]",
];

const Coverage = () => (
  <section id="cobertura" className="section bg-card border-y border-border">
    <div className="container-hp grid lg:grid-cols-2 gap-14 lg:gap-20 items-center">
      <div>
        <p className="eyebrow">Área de atendimento</p>
        <h2 className="font-display text-3xl sm:text-4xl lg:text-5xl text-navy-900 mt-5">
          Cobertura nacional,<br />cuidado local
        </h2>
        <Divider className="justify-start my-8 [&::before]:hidden" />
        <p className="text-navy-400">
          A HP Fisioterapia atende em todo o Brasil por meio da sua rede de
          fisioterapeutas parceiros. Cada profissional é selecionado, avaliado e
          alinhado ao padrão clínico da marca antes de representar a HP na sua
          região. Onde quer que você esteja, temos um profissional qualificado
          perto de você.
        </p>
        <p className="text-navy-400 mt-5">
          São Paulo capital e o Grande ABC são a nossa praça de origem, onde o
          próprio Hugo Pavão realiza os atendimentos.
        </p>

        <button
          onClick={openPaciente}
          className="inline-flex items-center gap-3 bg-primary text-primary-foreground text-[13px] uppercase tracking-[0.16em] px-8 py-4 mt-10 hover:bg-navy-900 transition-colors"
        >
          <MessageCircle className="w-4 h-4" />
          Consultar disponibilidade na minha cidade
        </button>
      </div>

      <div className="border border-border bg-background p-8 sm:p-10">
        <p className="text-[12px] uppercase tracking-[0.24em] text-navy-400">
          Regiões atendidas
        </p>
        <ul className="mt-6 divide-y divide-border">
          {regioes.map((r) => (
            <li key={r} className="flex items-center gap-4 py-4">
              <span className="h-px w-6 bg-border" />
              <span className="h-[5px] w-[5px] rounded-full bg-accent shrink-0" />
              <span
                className={
                  r.startsWith("[")
                    ? "text-[14px] uppercase tracking-[0.14em] text-accent"
                    : "text-navy-900"
                }
              >
                {r}
              </span>
            </li>
          ))}
        </ul>
        <p className="text-[13px] text-navy-400 mt-6">
          Não encontrou a sua cidade? Fale com a gente — a rede está em expansão
          contínua por todo o país.
        </p>
      </div>
    </div>
  </section>
);

export default Coverage;
