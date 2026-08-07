import {
  Accordion, AccordionContent, AccordionItem, AccordionTrigger,
} from "@/components/ui/accordion";
import Divider from "./Divider";

const faqs = [
  {
    q: "A HP atende convênio?",
    a: "O atendimento é particular. Emitimos recibo para que você possa solicitar reembolso ao seu plano de saúde, conforme as regras da sua operadora.",
  },
  {
    q: "Como funciona o pagamento?",
    a: "O valor é combinado antes do primeiro atendimento, com opções de sessão avulsa ou pacote de sessões. As formas de pagamento aceitas são informadas no contato pelo WhatsApp.",
  },
  {
    q: "Os equipamentos têm custo extra?",
    a: "Não. O fisioterapeuta leva todos os equipamentos necessários para o seu tratamento, já inclusos no valor da sessão.",
  },
  {
    q: "A HP atende em qualquer cidade do Brasil?",
    a: "Atuamos nacionalmente através da rede de fisioterapeutas parceiros e a cobertura cresce continuamente. Envie a sua cidade pelo WhatsApp e confirmamos a disponibilidade de um profissional na sua região.",
  },
  {
    q: "Como vocês selecionam os fisioterapeutas da rede em cada região?",
    a: "Todo profissional passa por análise de formação, registro ativo no CREFITO, experiência clínica comprovada e alinhamento ao protocolo de atendimento humanizado da HP. Só depois disso ele representa a marca na sua região.",
  },
  {
    q: "Preciso ir a um consultório em algum momento?",
    a: "Não. Todo o processo — avaliação, tratamento e reavaliações — acontece na sua casa, no horário combinado.",
  },
];

const FAQ = () => (
  <section id="faq" className="section bg-card border-y border-border">
    <div className="container-hp max-w-3xl">
      <div className="text-center">
        <p className="eyebrow">Perguntas frequentes</p>
        <h2 className="font-display text-3xl sm:text-4xl lg:text-5xl text-navy-900 mt-5">
          Ainda com dúvidas?
        </h2>
        <Divider className="mt-8" />
      </div>

      <Accordion type="single" collapsible className="mt-14">
        {faqs.map((f, i) => (
          <AccordionItem key={i} value={`item-${i}`} className="border-border">
            <AccordionTrigger className="text-left font-display text-lg text-navy-900 hover:no-underline">
              {f.q}
            </AccordionTrigger>
            <AccordionContent className="text-[15px] text-navy-400 leading-relaxed">
              {f.a}
            </AccordionContent>
          </AccordionItem>
        ))}
      </Accordion>
    </div>
  </section>
);

export default FAQ;
