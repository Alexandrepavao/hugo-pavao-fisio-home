-- O quiz de parceria passou a ter 8 perguntas (migration 081): a etapa gravada chega a 12 e a regra antiga (1..10) recusava a resposta.
-- Amplia para 1..20, com folga para novas perguntas; os indicadores de abandono por etapa agrupam por step_reached e não dependem do limite.
alter table public.quiz_leads drop constraint if exists quiz_leads_step_reached_check;
alter table public.quiz_leads add constraint quiz_leads_step_reached_check check (step_reached >= 1 and step_reached <= 20);
