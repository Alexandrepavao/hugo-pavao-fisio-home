-- HP Group Hub — 127 CORREÇÃO: as zonas das capitais (migration 122) bloqueavam quem grava pessoas pela tela.
-- Problema: os checks `people.zone`, `quiz_leads.zone` e `professional_profiles.service_zones` passaram a chamar private.zone_valid_any / private.zones_all_valid, mas as duas funções foram criadas sem EXECUTE para os
-- usuários logados. O CHECK roda com o papel de quem grava: criar ou editar uma pessoa pelo painel (create_person e as edições em Pessoas/CRM, que não são security definer)
-- falhavam com “permission denied for function zone_valid_any”. Os fluxos públicos (quiz, onboarding) e as zonas de atendimento do fisioterapeuta não eram afetados porque rodam como security definer.
-- Correção: conceder EXECUTE às duas funções de checagem para `authenticated` (como as demais auxiliares de constraint do projeto). Ambas só leem a tabela de referência public.geo_zones (leitura pública) e devolvem true/false;
-- não expõem nem alteram nenhum dado. `anon` continua sem acesso direto (os envios públicos usam funções security definer). Nada mais é alterado.

grant execute on function private.zone_valid_any(text), private.zones_all_valid(text[]) to authenticated;
