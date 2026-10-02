-- patient_reassessments.decided_at passa a usar clock_timestamp(): duas decisões na MESMA transação empatavam em now() e “a última decisão” (usada pela regra de renovação, migration 068)
-- dependia de um desempate por uuid aleatório. Só muda o padrão de novas linhas; nada existente é alterado.
alter table public.patient_reassessments alter column decided_at set default clock_timestamp();
