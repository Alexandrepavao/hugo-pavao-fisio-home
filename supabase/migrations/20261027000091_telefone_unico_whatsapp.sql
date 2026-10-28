-- Telefone único do HP Group: (11) 91363-4424. O botão final do quiz abre o WhatsApp neste número, tanto na jornada de atendimento quanto na de parceria.
-- Só troca o número PADRÃO da organização (unidade nula); números por unidade, se houver, continuam como o gestor configurou. Idempotente.
update public.quiz_whatsapp_numbers set phone = '5511913634424'
 where unit_id is null and journey in ('atendimento', 'parceria') and phone <> '5511913634424';
