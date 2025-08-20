
import { MessageCircle } from "lucide-react";

const WhatsAppFloat = () => {
  const handleWhatsAppClick = () => {
    window.open('https://wa.me/5511959075351?text=Oi,+tudo+bem%3F+Vi+seu+site+e+tenho+interesse+em+saber+mais+sobre+os+atendimentos+de+fisioterapia.+Pode+me+orientar%3F', '_blank');
  };

  return (
    <button
      onClick={handleWhatsAppClick}
      className="whatsapp-float"
      aria-label="Conversar no WhatsApp"
      title="Fale conosco no WhatsApp"
    >
      <MessageCircle className="w-5 h-5 sm:w-6 sm:h-6 text-white" />
    </button>
  );
};

export default WhatsAppFloat;
