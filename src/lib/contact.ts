export const WHATSAPP_PACIENTES = "5511959075351";
export const WHATSAPP_PROFISSIONAIS = "5511913634424";

export const WHATSAPP_PACIENTES_DISPLAY = "(11) 95907-5351";
export const WHATSAPP_PROFISSIONAIS_DISPLAY = "(11) 91363-4424";

const MSG_PACIENTE =
  "Olá! Gostaria de agendar uma avaliação de fisioterapia domiciliar.";
const MSG_PROFISSIONAL =
  "Olá! Sou fisioterapeuta e tenho interesse em fazer parte da equipe HP Fisioterapia.";

export const linkPaciente = `https://wa.me/${WHATSAPP_PACIENTES}?text=${encodeURIComponent(
  MSG_PACIENTE
)}`;

export const linkProfissional = `https://wa.me/${WHATSAPP_PROFISSIONAIS}?text=${encodeURIComponent(
  MSG_PROFISSIONAL
)}`;

export const openPaciente = () => window.open(linkPaciente, "_blank");
export const openProfissional = () => window.open(linkProfissional, "_blank");
