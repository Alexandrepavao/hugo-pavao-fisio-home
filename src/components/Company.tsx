import Divider from "./Divider";
import terapia from "@/assets/terapia-manual.jpg";
import reabilitacao from "@/assets/reabilitacao-idoso.jpg";

const numeros = [
  { valor: "Domiciliar", label: "Especialidade da casa" },
  { valor: "9 áreas", label: "Especialidades atendidas" },
  { valor: "Brasil", label: "Cobertura nacional" },
];

const Company = () => (
  <section id="sobre" className="section">
    <div className="container-hp grid lg:grid-cols-[0.9fr_1.1fr] gap-14 lg:gap-20 items-center">
      <div className="relative">
        <img
          src={reabilitacao}
          alt="Fisioterapeuta da HP Fisio Group conduzindo sessão de reabilitação na casa do paciente"
          width={1200}
          height={912}
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
        <p className="eyebrow">A empresa</p>
        <h2 className="font-display text-3xl sm:text-4xl lg:text-5xl text-navy-900 mt-5">
          HP Fisio Group
        </h2>
        <p className="text-[13px] uppercase tracking-[0.2em] text-navy-400 mt-4">
          Rede nacional de fisioterapia domiciliar
        </p>

        <Divider className="justify-start my-8 [&::before]:hidden" />

        <p className="text-navy-400">
          O HP Fisio Group é um grupo de fisioterapia especializado em
          atendimento domiciliar, presente em todo o Brasil por meio de uma rede
          de profissionais selecionados. Nascemos de uma convicção simples: o
          tratamento funciona melhor quando acontece na rotina real do paciente,
          dentro de casa.
        </p>
        <p className="text-navy-400 mt-5">
          Reunimos fisioterapeutas com atuação em ortopedia, neurologia e
          geriatria sob um único padrão clínico — escuta atenta, plano
          individualizado e acompanhamento próximo. Quem contrata o HP Fisio
          Group em qualquer estado recebe o mesmo cuidado e o mesmo critério
          técnico.
        </p>

        <div className="grid sm:grid-cols-3 gap-8 mt-10 pt-8 border-t border-border">
          {numeros.map((n) => (
            <div key={n.valor}>
              <p className="font-display text-2xl text-navy-900">{n.valor}</p>
              <p className="text-[13px] text-navy-400 mt-1">{n.label}</p>
            </div>
          ))}
        </div>
      </div>
    </div>
  </section>
);

export default Company;
