import { Link, useLocation } from "react-router-dom";
import { MessageCircle } from "lucide-react";
import { buildJourneyHref, type Journey } from "@/lib/quiz";
import { utmFromLocation } from "@/features/pages/PageRenderer";

/** Botão flutuante de conversa: não abre o WhatsApp direto — leva ao quiz da jornada (captura nome completo, e-mail e WhatsApp)
 *  e só então oferece continuar pelo WhatsApp. Paciente por padrão; a página de fisioterapeutas passa journey="parceria". */
const WhatsAppFloat = ({ journey = "atendimento" }: { journey?: Journey }) => {
  const { pathname } = useLocation();
  const label = journey === "atendimento" ? "Agendar avaliação: falar com a HP Fisioterapia" : "Quero fazer parte: falar com a HP Fisioterapia";
  return (
    <Link to={buildJourneyHref(journey, { from: pathname, utm: utmFromLocation() })} className="whatsapp-float" aria-label={label} title={label}>
      <MessageCircle className="w-6 h-6 text-whatsapp-foreground" />
    </Link>
  );
};

export default WhatsAppFloat;
