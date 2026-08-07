import { useEffect } from "react";
import { MessageCircle } from "lucide-react";
import Header from "@/components/Header";
import Footer from "@/components/Footer";
import WhatsAppFloat from "@/components/WhatsAppFloat";
import WorkWithUs from "@/components/WorkWithUs";
import Divider from "@/components/Divider";
import { openProfissional } from "@/lib/contact";

const criterios = [
  "Registro ativo no CREFITO e formação comprovada",
  "Experiência clínica em reabilitação e atendimento domiciliar",
  "Postura humanizada, escuta ativa e comunicação clara com o paciente",
  "Disponibilidade para atender na sua região com agenda organizada",
];

const etapas = [
  { n: "01", t: "Você entra em contato", d: "Envie uma mensagem no WhatsApp de fisioterapeutas contando sua formação, experiência e região de atuação." },
  { n: "02", t: "Conversamos e avaliamos", d: "Analisamos seu perfil técnico e fazemos uma conversa para entender seu jeito de atender." },
  { n: "03", t: "Você passa a representar a HP", d: "Aprovado, você recebe nossos protocolos e passa a atender os pacientes HP da sua região." },
];

const TrabalheConosco = () => {
  useEffect(() => {
    document.title = "Trabalhe Conosco | HP Fisioterapia — Rede Nacional de Home Care";
  }, []);

  return (
    <div className="min-h-screen">
      <Header />
      <main>
        <section className="px-6 sm:px-8 pt-16 pb-20 lg:pt-24">
          <div className="container-hp max-w-3xl text-center">
            <p className="eyebrow">Para fisioterapeutas</p>
            <h1 className="font-display text-4xl sm:text-5xl lg:text-[3.4rem] leading-[1.12] text-navy-900 mt-6">
              Expanda sua atuação<br />com a HP Fisioterapia
            </h1>
            <Divider className="my-8" />
            <p className="text-navy-400">
              Estamos construindo uma rede nacional de fisioterapia domiciliar e
              buscamos profissionais de alta capacidade técnica para representar
              a HP em cada região do Brasil. Ser parceiro HP é integrar uma
              marca única em expansão — com critério de seleção, padrão clínico
              definido e pacientes encaminhados.
            </p>
            <button
              onClick={openProfissional}
              className="inline-flex items-center justify-center gap-3 bg-accent text-accent-foreground text-[13px] uppercase tracking-[0.16em] px-8 py-4 mt-10 hover:opacity-90 transition-opacity"
            >
              <MessageCircle className="w-4 h-4" />
              Quero fazer parte
            </button>
          </div>
        </section>

        <WorkWithUs full />

        <section className="section">
          <div className="container-hp grid lg:grid-cols-2 gap-14 lg:gap-20">
            <div>
              <p className="eyebrow">Critérios de seleção</p>
              <h2 className="font-display text-3xl sm:text-4xl text-navy-900 mt-5">
                Quem pode ser um parceiro HP
              </h2>
              <ul className="mt-8 divide-y divide-border">
                {criterios.map((c) => (
                  <li key={c} className="flex items-center gap-4 py-4">
                    <span className="h-px w-6 bg-border shrink-0" />
                    <span className="h-[5px] w-[5px] rounded-full bg-accent shrink-0" />
                    <span className="text-[15px] text-navy-700">{c}</span>
                  </li>
                ))}
              </ul>
            </div>

            <div>
              <p className="eyebrow">Como é o processo</p>
              <h2 className="font-display text-3xl sm:text-4xl text-navy-900 mt-5">
                Três etapas até o primeiro paciente
              </h2>
              <div className="mt-8 space-y-8">
                {etapas.map((e) => (
                  <div key={e.n} className="border-l border-border pl-6 relative">
                    <span className="absolute -left-[3px] top-2 h-[5px] w-[5px] rounded-full bg-accent" />
                    <p className="font-display text-lg text-navy-900">
                      <span className="text-accent mr-3">{e.n}</span>
                      {e.t}
                    </p>
                    <p className="text-[15px] text-navy-400 mt-2">{e.d}</p>
                  </div>
                ))}
              </div>
            </div>
          </div>
        </section>
      </main>
      <Footer />
      <WhatsAppFloat />
    </div>
  );
};

export default TrabalheConosco;
