import { MessageCircle } from "lucide-react";
import { linkPaciente } from "@/lib/contact";

const WhatsAppFloat = () => (
  <a
    href={linkPaciente}
    target="_blank"
    rel="noopener noreferrer"
    className="whatsapp-float"
    aria-label="Agendar avaliação pelo WhatsApp"
    title="Fale com a HP Fisioterapia no WhatsApp"
  >
    <MessageCircle className="w-6 h-6 text-whatsapp-foreground" />
  </a>
);

export default WhatsAppFloat;
