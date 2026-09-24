import { Send } from "lucide-react";
import { PageHead } from "@/lib/ui";

/** Disparo em massa tem o mesmo bloqueio real de Mensagens agendadas: precisa de um provedor de envio
 *  automático (não existe hoje). Abrir 1 a 1 pelo WhatsApp Web (Conversas) continua funcionando normalmente —
 *  o que não existe é o envio automático em lote sem intervenção manual por contato. */
const Disparo = () => (
  <div>
    <PageHead eyebrow="CRM · Comunicação" title="Disparo de mensagens" />
    <div className="hp-card p-6 text-center max-w-xl mx-auto">
      <Send className="mx-auto mb-3 text-muted-foreground" size={32} aria-hidden />
      <p className="font-medium mb-2">Pendente: nenhum provedor de envio automático configurado</p>
      <p className="text-sm text-muted-foreground">
        Disparo em massa também depende de um provedor de WhatsApp Business (ou similar) que envie
        automaticamente para uma lista de contatos — sem ele, não há como enviar "para todos" de uma vez com
        confiabilidade real. Nenhuma mensagem é enviada de verdade nesta tela até essa integração existir.
        Para contatos individuais, use <strong>Conversas</strong> (abre o WhatsApp Web com a mensagem pronta,
        um contato por vez).
      </p>
    </div>
  </div>
);

export default Disparo;
