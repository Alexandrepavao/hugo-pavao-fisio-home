// Números exibidos como informação de contato (rodapé). Nenhum botão do site abre o WhatsApp direto:
// o contato começa pelo quiz (src/lib/useStartJourney.ts), que captura nome completo, e-mail e WhatsApp,
// e o WhatsApp é aberto no fim com o número configurado no banco (quiz_whatsapp_numbers).
// Desde 27/10/2026 o HP Group usa um único número para pacientes e profissionais.
export const TELEFONE_DISPLAY = "(11) 91363-4424";
export const WHATSAPP_PACIENTES_DISPLAY = TELEFONE_DISPLAY;
export const WHATSAPP_PROFISSIONAIS_DISPLAY = TELEFONE_DISPLAY;

export const INSTAGRAM_HANDLE = "@hpfisiogroup";
export const INSTAGRAM_URL = "https://instagram.com/hpfisiogroup";
