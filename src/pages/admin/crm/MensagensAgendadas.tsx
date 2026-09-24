import { CalendarClock } from "lucide-react";
import { PageHead } from "@/lib/ui";

/** Mensagens agendadas exige um provedor de envio automático (WhatsApp Business API ou similar) executando
 *  no horário agendado — HP hoje só tem números de WhatsApp para link manual (wa.me, ver Conversas), sem
 *  provedor conectado capaz de enviar sozinho. Bloqueio real, não simulado: nenhuma tela aqui finge agendar. */
const MensagensAgendadas = () => (
  <div>
    <PageHead eyebrow="CRM · Comunicação" title="Mensagens agendadas" />
    <div className="hp-card p-6 text-center max-w-xl mx-auto">
      <CalendarClock className="mx-auto mb-3 text-muted-foreground" size={32} aria-hidden />
      <p className="font-medium mb-2">Pendente: nenhum provedor de envio automático configurado</p>
      <p className="text-sm text-muted-foreground">
        Agendar o envio de uma mensagem exige um serviço rodando no horário marcado que efetivamente a envie
        (uma API de WhatsApp Business ou similar) — hoje a organização não tem esse provedor conectado. Sem
        ele, esta tela não pode gravar uma mensagem "para ser enviada depois" com garantia real de envio, e
        fingir isso seria pior do que não ter a tela. Enquanto isso, use <strong>Conversas</strong> para abrir
        o WhatsApp com uma mensagem pronta agora mesmo.
      </p>
    </div>
  </div>
);

export default MensagensAgendadas;
