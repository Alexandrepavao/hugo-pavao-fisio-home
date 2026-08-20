import { MessageCircle } from "lucide-react";
import Divider from "./Divider";
import { openPaciente } from "@/lib/contact";
import BrazilMap from "./BrazilMap";

const regioes = [
  { nome: "São Paulo (capital)", tag: "Atendimento direto" },
  { nome: "Grande ABC", tag: "Atendimento direto" },
  { nome: "Grande São Paulo", tag: "Rede parceira" },
  { nome: "Campinas e interior de SP", tag: "Rede parceira" },
  { nome: "Rio de Janeiro", tag: "Rede parceira" },
  { nome: "Belo Horizonte", tag: "Rede parceira" },
  { nome: "Curitiba e Porto Alegre", tag: "Rede parceira" },
  { nome: "Demais estados do Brasil", tag: "Rede parceira" },
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
          O HP Fisio Group atende em <strong className="text-navy-900 font-normal">todos os
          26 estados brasileiros e no Distrito Federal</strong>, por meio da sua rede de
          fisioterapeutas parceiros. Cada profissional é selecionado, avaliado e
          alinhado ao padrão clínico do grupo antes de representar a HP na sua
          região. Onde quer que você esteja, temos um profissional qualificado
          perto de você.
        </p>
        <p className="text-navy-400 mt-5">
          São Paulo capital e o Grande ABC são a praça de origem do grupo, onde
          a equipe própria do HP Fisio Group realiza os atendimentos.
        </p>

        <BrazilMap className="mt-10" />

        <button onClick={openPaciente} className="btn-primary mt-10">
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
            <li key={r.nome} className="flex items-center justify-between gap-4 py-4">
              <span className="flex items-center gap-4">
                <span className="h-px w-6 bg-border" />
                <span className="h-[5px] w-[5px] rounded-full bg-accent shrink-0" />
                <span className="text-navy-900">{r.nome}</span>
              </span>
              <span className="text-[11px] uppercase tracking-[0.14em] text-accent whitespace-nowrap">
                {r.tag}
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
