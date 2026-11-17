-- NOVO — N18: jornada paciente PENDENTE → ATIVO por PAGAMENTO confirmado (migration 131). Transação sempre desfeita. Somente Dev/teste.
--  · chaves estáveis de etapa; "Avaliação agendada" (tipo Paciente) cria UM vínculo pendente, idempotente; outros tipos não
--  · "Venda feita" / venda confirmada NÃO ativa: sem pacote, sem saldo, sem tipo "paciente"
--  · ativa com a PRIMEIRA PARCELA quitada (não exige quitação integral); pagamento parcial abaixo da parcela não ativa; avaliação avulsa paga não ativa
--  · duplicado/fora de ordem/reavaliação: nada duplica (pacote, vínculo); reconciliação idempotente
--  · estorno: sinaliza para análise, não apaga; regularizado limpa o sinal
--  · perda: encerra só o pendente sem outra oportunidade/pagamento; paciente ativo e conflito financeiro preservados; revoga acesso e convites
--  · permissões e isolamento
create or replace function pg_temp.chk(ok boolean, msg text) returns text language sql as $$ select format(E'\n[%s] %s', case when coalesce(ok, false) then 'OK' else 'FALHA' end, msg) $$;
create or replace function pg_temp.err(sql text) returns text language plpgsql as $$ begin execute sql; return null; exception when others then return sqlstate || ': ' || sqlerrm; end $$;
create or replace function pg_temp.as_user(u uuid) returns void language plpgsql as $$
begin perform set_config('request.jwt.claims', json_build_object('sub', u, 'role', 'authenticated')::text, true); perform set_config('request.jwt.claim.sub', u::text, true); end $$;
do $$
declare
  rep text := ''; v_lr uuid; v_org uuid; ua uuid; v_pat uuid; v_part uuid; k text; n int; j jsonb; st text;
  u_phy uuid := gen_random_uuid(); u_fin uuid := gen_random_uuid(); u_sales uuid := gen_random_uuid(); u_mgr uuid := gen_random_uuid(); u_p1 uuid := gen_random_uuid(); u_p2 uuid := gen_random_uuid(); u_other uuid := gen_random_uuid();
  pe_phy uuid; p1 uuid; p2 uuid; p3 uuid; p4 uuid; p5 uuid; p6 uuid; p7 uuid; v_other_org uuid; v_other_unit uuid; v_other_person uuid;
  prof uuid; svc uuid; prod_pkg uuid; prod_plan uuid; prod_svc uuid; acct uuid; st_sched uuid; st_att uuid; st_lost uuid; st_new uuid; st_won uuid; st_part uuid;
  o1 uuid; o2 uuid; o3 uuid; o3b uuid; o4 uuid; o5 uuid; o6 uuid; o7 uuid; o_part uuid; a1 uuid; e1 uuid; e1b uuid; s1 uuid; s2 uuid; s3 uuid; s4 uuid; s5 uuid; s6 uuid; r11 uuid; r12 uuid; r21 uuid; r31 uuid; r41 uuid; r51 uuid; r61 uuid; pay uuid; pay2 uuid;
begin
  select id into v_org from public.organizations where slug = 'hp-group';
  insert into public.units (org_id, name, slug) values (v_org, 'Unidade N18', 'n18-a') returning id into ua;
  select id into v_lr from public.loss_reasons where org_id = v_org limit 1;
  select id into v_pat from public.pipelines where org_id = v_org and kind = 'patients' limit 1;
  select id into v_part from public.pipelines where org_id = v_org and kind = 'partners' limit 1;
  select id into st_new from public.pipeline_stages where pipeline_id = v_pat and key = 'new_contact';
  select id into st_sched from public.pipeline_stages where pipeline_id = v_pat and key = 'evaluation_scheduled';
  select id into st_att from public.pipeline_stages where pipeline_id = v_pat and key = 'attended';
  select id into st_won from public.pipeline_stages where pipeline_id = v_pat and key = 'hired';
  select id into st_lost from public.pipeline_stages where pipeline_id = v_pat and kind = 'lost' order by position limit 1;
  select id into st_part from public.pipeline_stages where pipeline_id = v_part and position = 2;
  -- ---------------- 1. chaves estáveis
  rep := rep || pg_temp.chk((select count(*) from public.pipeline_stages where pipeline_id = v_pat and key is not null) = 6, 'as 6 etapas do funil de pacientes têm chave estável (não dependem do nome exibido)');
  rep := rep || pg_temp.chk(st_sched is not null and st_won is not null and st_lost is not null and st_part is not null, 'etapas encontradas pela chave');

  insert into auth.users (id, aud, role, email) select x, 'authenticated', 'authenticated', x::text || '@n18.local' from unnest(array[u_phy, u_fin, u_sales, u_mgr, u_p1, u_p2, u_other]) x;
  insert into public.people (org_id, unit_id, full_name) select v_org, ua, x from unnest(array['Fisio N18', 'Paciente N18 Um', 'Paciente N18 Dois', 'Paciente N18 Tres', 'Paciente N18 Quatro', 'Paciente N18 Cinco', 'Paciente N18 Seis', 'Paciente N18 Sete']) x;
  select id into pe_phy from public.people where org_id = v_org and full_name = 'Fisio N18' order by created_at desc limit 1;
  select id into p1 from public.people where org_id = v_org and full_name = 'Paciente N18 Um' order by created_at desc limit 1;
  select id into p2 from public.people where org_id = v_org and full_name = 'Paciente N18 Dois' order by created_at desc limit 1;
  select id into p3 from public.people where org_id = v_org and full_name = 'Paciente N18 Tres' order by created_at desc limit 1;
  select id into p4 from public.people where org_id = v_org and full_name = 'Paciente N18 Quatro' order by created_at desc limit 1;
  select id into p5 from public.people where org_id = v_org and full_name = 'Paciente N18 Cinco' order by created_at desc limit 1;
  select id into p6 from public.people where org_id = v_org and full_name = 'Paciente N18 Seis' order by created_at desc limit 1;
  select id into p7 from public.people where org_id = v_org and full_name = 'Paciente N18 Sete' order by created_at desc limit 1;
  insert into public.user_accounts (user_id, org_id, person_id, display_name) values (u_phy, v_org, pe_phy, 'Fisio'), (u_fin, v_org, null, 'Fin'), (u_sales, v_org, null, 'Com'), (u_mgr, v_org, null, 'Gestor'), (u_p1, v_org, p1, 'P1'), (u_p2, v_org, p2, 'P2');
  insert into public.role_assignments (org_id, user_id, role, unit_id) values (v_org, u_phy, 'physio', ua), (v_org, u_fin, 'finance', ua), (v_org, u_sales, 'sales', ua), (v_org, u_mgr, 'manager', null), (v_org, u_p1, 'member', null), (v_org, u_p2, 'member', null);
  insert into public.services (org_id, name, duration_min, price_cents) values (v_org, 'Avaliação N18', 50, 20000) returning id into svc;
  insert into public.professionals (org_id, user_id, person_id, display_name) values (v_org, u_phy, pe_phy, 'Fisio N18') returning id into prof;
  insert into public.professional_units (professional_id, unit_id) values (prof, ua);
  insert into public.availability_rules (org_id, professional_id, unit_id, weekday, start_time, end_time) select v_org, prof, ua, w, time '00:00', time '23:30' from generate_series(0, 6) w;
  insert into public.products (org_id, kind, name, price_cents, sessions_count, service_id, validity_days) values (v_org, 'package', 'Acompanhamento N18', 90000, 10, svc, 180) returning id into prod_pkg;
  insert into public.products (org_id, kind, name, price_cents, recurrence) values (v_org, 'plan', 'Plano N18', 30000, 'monthly') returning id into prod_plan;
  insert into public.products (org_id, kind, name, price_cents, service_id) values (v_org, 'service', 'Avaliação avulsa N18', 20000, svc) returning id into prod_svc;
  insert into public.financial_accounts (org_id, name) values (v_org, 'Conta N18') returning id into acct;
  insert into public.organizations (name, slug) values ('Org N18 Outra', 'n18-outra') returning id into v_other_org;
  insert into public.units (org_id, name, slug) values (v_other_org, 'Unidade Outra N18', 'n18-b') returning id into v_other_unit;
  insert into public.people (org_id, unit_id, full_name) values (v_other_org, v_other_unit, 'Paciente Outra Org N18') returning id into v_other_person;

  -- ---------------- 2. entrada: Avaliação agendada (tipo Paciente) → vínculo PENDENTE, idempotente
  insert into public.opportunities (org_id, unit_id, person_id, pipeline_id, stage_id, title) values (v_org, ua, p1, v_pat, st_new, 'Opp N18 p1') returning id into o1;
  rep := rep || pg_temp.chk(not exists (select 1 from public.patient_enrollments where person_id = p1), 'lead em "Novo contato" não cria vínculo');
  insert into public.appointments (org_id, unit_id, professional_id, person_id, service_id, period, opportunity_id)
    values (v_org, ua, prof, p1, svc, tstzrange(now() + interval '3 days', now() + interval '3 days 50 minutes'), o1) returning id into a1;
  update public.opportunities set stage_id = st_sched where id = o1;
  select id into e1 from public.patient_enrollments where person_id = p1;
  rep := rep || pg_temp.chk(e1 is not null and (select status from public.patient_enrollments where id = e1) = 'pending', 'oportunidade em "Avaliação agendada" cria o vínculo PENDENTE');
  rep := rep || pg_temp.chk((select opportunity_id from public.patient_enrollments where id = e1) = o1 and (select professional_id from public.patient_enrollments where id = e1) = prof
    and (select evaluation_appointment_id from public.patient_enrollments where id = e1) = a1 and (select org_id from public.patient_enrollments where id = e1) = v_org, 'vincula pessoa, oportunidade, organização, avaliação (agendamento existente) e profissional');
  rep := rep || pg_temp.chk(exists (select 1 from public.care_relationships where person_id = p1 and professional_user_id = u_phy and revoked_at is null and enrollment_id = e1), 'a fisioterapeuta responsável recebe o vínculo assistencial do pendente');
  update public.opportunities set stage_id = st_att where id = o1; update public.opportunities set stage_id = st_sched where id = o1;
  perform private.enrollment_ensure(o1); perform private.enrollment_ensure(o1);
  rep := rep || pg_temp.chk((select count(*) from public.patient_enrollments where person_id = p1) = 1 and (select count(*) from public.care_relationships where person_id = p1 and revoked_at is null) = 1, 'repetir/voltar a etapa não duplica vínculo nem acesso (idempotente)');
  insert into public.opportunities (org_id, unit_id, person_id, pipeline_id, stage_id, title) values (v_org, ua, p2, v_part, st_part, 'Opp N18 parceiro') returning id into o2;
  rep := rep || pg_temp.chk(not exists (select 1 from public.patient_enrollments where person_id = p2), 'lead de outro tipo (parceiro) não cria vínculo de paciente');
  rep := rep || pg_temp.chk(pg_temp.err(format('insert into public.patient_enrollments (org_id, person_id) values (%L, %L)', v_org, p1)) like '23505%', 'não existem duas aberturas por pessoa (índice único)');

  -- ---------------- 3. paciente ativo legado: estado preservado
  insert into public.client_packages (org_id, unit_id, person_id, product_id, total_sessions, status) values (v_org, ua, p3, prod_pkg, 10, 'active');
  insert into public.opportunities (org_id, unit_id, person_id, pipeline_id, stage_id, title) values (v_org, ua, p3, v_pat, st_new, 'Opp N18 p3') returning id into o3;
  update public.opportunities set stage_id = st_sched where id = o3;
  rep := rep || pg_temp.chk(not exists (select 1 from public.patient_enrollments where person_id = p3 and status = 'pending'), 'paciente que já tem pacote ativo não vira "pendente" (estado preservado)');

  -- ---------------- 4. "Venda feita" NÃO ativa
  set local role authenticated; perform pg_temp.as_user(u_sales);
  s1 := public.sale_create(p1, ua, o1, jsonb_build_array(jsonb_build_object('product_id', prod_pkg)), 0, 3, current_date, 'venda N18');
  perform public.sale_confirm(s1);
  reset role;
  select id into st_won from public.pipeline_stages where pipeline_id = v_pat and key = 'hired';
  rep := rep || pg_temp.chk((select stage_id from public.opportunities where id = o1) = st_won, 'a venda confirmada leva a oportunidade para "Contratou" (CRM)');
  rep := rep || pg_temp.chk((select status from public.patient_enrollments where id = e1) = 'pending', 'MAS "Venda feita" não ativa: o vínculo continua PENDENTE');
  rep := rep || pg_temp.chk(not exists (select 1 from public.client_packages where sale_id = s1) and not exists (select 1 from public.person_kinds where person_id = p1 and kind = 'patient'), 'sem pacote, sem saldo e sem tipo "paciente" antes do pagamento');
  rep := rep || pg_temp.chk((select count(*) from public.receivables where sale_id = s1) = 3, 'o financeiro gera as 3 parcelas normalmente (a contratação existe)');
  set local role authenticated; perform pg_temp.as_user(u_p1);
  j := public.my_enrollment();
  rep := rep || pg_temp.chk(j ->> 'status' = 'pending' and j ->> 'payment' = 'awaiting', 'o paciente vê "pendente" e "pagamento aguardado" (sem valores)');
  reset role;

  -- ---------------- 5. pagamento parcial abaixo da parcela NÃO ativa; primeira parcela confirmada ATIVA (sem exigir quitação integral)
  select id into r11 from public.receivables where sale_id = s1 and installment_no = 1; select id into r12 from public.receivables where sale_id = s1 and installment_no = 2;
  set local role authenticated; perform pg_temp.as_user(u_fin);
  perform public.payment_record(r11, 10000, now(), 'pix', acct, 'n18-p1-a');
  reset role;
  rep := rep || pg_temp.chk((select status from public.patient_enrollments where id = e1) = 'pending' and not exists (select 1 from public.client_packages where sale_id = s1), 'pagamento parcial AVULSO abaixo da primeira parcela não ativa por acidente');
  set local role authenticated; perform pg_temp.as_user(u_fin);
  pay := public.payment_record(r11, (select amount_cents - 10000 from public.receivables where id = r11), now(), 'pix', acct, 'n18-p1-b');
  reset role;
  select id into e1b from public.patient_enrollments where person_id = p1 and status in ('pending', 'active');
  rep := rep || pg_temp.chk(e1b = e1 and (select status from public.patient_enrollments where id = e1) = 'active', 'primeira parcela quitada ATIVA o MESMO vínculo (pendente → ativo, mesmo id)');
  rep := rep || pg_temp.chk((select activation_sale_id from public.patient_enrollments where id = e1) = s1 and (select activation_receivable_id from public.patient_enrollments where id = e1) = r11 and (select activation_payment_id from public.patient_enrollments where id = e1) is not null, 'guarda venda, parcela e recebimento que ativaram');
  rep := rep || pg_temp.chk(exists (select 1 from public.person_kinds where person_id = p1 and kind = 'patient'), 'só agora a pessoa ganha o tipo "paciente"');
  rep := rep || pg_temp.chk((select count(*) from public.client_packages where sale_id = s1) = 1 and (select coalesce(sum(delta), 0) from public.session_ledger l join public.client_packages c on c.id = l.client_package_id where c.sale_id = s1) = 10, 'pacote e saldo (10 sessões) liberados conforme a contratação, UMA vez');
  rep := rep || pg_temp.chk(not exists (select 1 from public.appointments where person_id = p1 and status = 'attended'), 'ativar não marca nenhuma sessão como realizada');
  rep := rep || pg_temp.chk((select status from public.receivables where id = r12) = 'open', 'as demais parcelas continuam em aberto (não exige quitação integral)');
  rep := rep || pg_temp.chk((select count(*) from public.patient_enrollments where person_id = p1) = 1 and (select count(*) from public.people where id = p1) = 1, 'continua UMA pessoa e UM vínculo (nada copiado entre tabelas)');
  set local role authenticated; perform pg_temp.as_user(u_p1); j := public.my_enrollment(); reset role;
  rep := rep || pg_temp.chk(j ->> 'status' = 'active' and j ->> 'payment' = 'confirmed', 'o portal passa a mostrar ativo / pagamento confirmado');

  -- ---------------- 6. duplicado, fora de ordem, reconciliação: nada duplica
  perform private.enrollment_evaluate(s1); perform private.enrollment_evaluate(s1);
  set local role authenticated; perform pg_temp.as_user(u_fin);
  rep := rep || pg_temp.chk(public.payment_record(r11, (select amount_cents - 10000 from public.receivables where id = r11), now(), 'pix', acct, 'n18-p1-b') = pay, 'reenvio do mesmo recebimento (mesma chave) é idempotente: devolve o mesmo registro');
  j := public.enrollment_reconcile(s1);
  reset role;
  rep := rep || pg_temp.chk((select count(*) from public.client_packages where sale_id = s1) = 1 and (select count(*) from public.patient_enrollments where person_id = p1) = 1 and (select count(*) from public.payments where receivable_id = r11 and kind = 'payment') = 2, 'reavaliar duas vezes e reconciliar não duplica pacote, vínculo nem recebimento (2 recebimentos reais da parcela, sem repetição)');
  set local role authenticated; perform pg_temp.as_user(u_p1);
  rep := rep || pg_temp.chk(pg_temp.err('select public.enrollment_reconcile(null)') like '42501%', 'paciente não reconcilia financeiro');
  reset role;

  -- ---------------- 7. estorno: sinaliza para análise, não apaga; regularizado limpa
  set local role authenticated; perform pg_temp.as_user(u_fin);
  pay2 := public.payment_refund((select id from public.payments where receivable_id = r11 and kind = 'payment' order by paid_at limit 1), 10000, 'estorno N18', 'n18-ref-1');
  reset role;
  rep := rep || pg_temp.chk((select status from public.patient_enrollments where id = e1) = 'active' and (select review_flag from public.patient_enrollments where id = e1) = 'refund', 'estorno da parcela: vínculo continua ATIVO e fica sinalizado para análise administrativa');
  rep := rep || pg_temp.chk(exists (select 1 from public.client_packages where sale_id = s1) and exists (select 1 from public.person_kinds where person_id = p1 and kind = 'patient') and exists (select 1 from public.user_accounts where person_id = p1), 'estorno não apaga pacote, tipo, conta nem histórico');
  set local role authenticated; perform pg_temp.as_user(u_fin);
  perform public.payment_record(r11, 10000, now(), 'pix', acct, 'n18-p1-c');
  reset role;
  rep := rep || pg_temp.chk((select review_flag from public.patient_enrollments where id = e1) is null, 'pagamento regularizado limpa o sinal de estorno');

  -- ---------------- 8. avaliação AVULSA paga não ativa acompanhamento
  insert into public.opportunities (org_id, unit_id, person_id, pipeline_id, stage_id, title) values (v_org, ua, p4, v_pat, st_new, 'Opp N18 p4') returning id into o4;
  update public.opportunities set stage_id = st_sched where id = o4;
  set local role authenticated; perform pg_temp.as_user(u_sales);
  s4 := public.sale_create(p4, ua, o4, jsonb_build_array(jsonb_build_object('product_id', prod_svc)), 0, 1, current_date, 'avulsa');
  perform public.sale_confirm(s4);
  reset role;
  select id into r41 from public.receivables where sale_id = s4 and installment_no = 1;
  set local role authenticated; perform pg_temp.as_user(u_fin); perform public.payment_record(r41, (select amount_cents from public.receivables where id = r41), now(), 'pix', acct, 'n18-p4'); reset role;
  rep := rep || pg_temp.chk((select status from public.patient_enrollments where person_id = p4) = 'pending' and not exists (select 1 from public.client_packages where person_id = p4), 'avaliação AVULSA paga NÃO ativa nem cria pacote de acompanhamento');

  -- ---------------- 9. contratação à vista (1 parcela) e plano mensal
  insert into public.opportunities (org_id, unit_id, person_id, pipeline_id, stage_id, title) values (v_org, ua, p5, v_pat, st_new, 'Opp N18 p5') returning id into o5;
  update public.opportunities set stage_id = st_sched where id = o5;
  set local role authenticated; perform pg_temp.as_user(u_sales);
  s5 := public.sale_create(p5, ua, o5, jsonb_build_array(jsonb_build_object('product_id', prod_plan)), 0, 1, current_date, 'plano');
  perform public.sale_confirm(s5); reset role;
  select id into r51 from public.receivables where sale_id = s5 and installment_no = 1;
  set local role authenticated; perform pg_temp.as_user(u_fin); perform public.payment_record(r51, (select amount_cents from public.receivables where id = r51), now(), 'pix', acct, 'n18-p5'); reset role;
  rep := rep || pg_temp.chk((select status from public.patient_enrollments where person_id = p5) = 'active', 'plano pago à vista ativa o vínculo');

  -- ---------------- 10. perda de oportunidade
  -- (a) pendente sem outra oportunidade e sem pagamento: encerra, revoga acesso e convites
  insert into public.opportunities (org_id, unit_id, person_id, pipeline_id, stage_id, title) values (v_org, ua, p6, v_pat, st_new, 'Opp N18 p6') returning id into o6;
  insert into public.appointments (org_id, unit_id, professional_id, person_id, service_id, period, opportunity_id) values (v_org, ua, prof, p6, svc, tstzrange(now() + interval '4 days', now() + interval '4 days 50 minutes'), o6);
  update public.opportunities set stage_id = st_sched where id = o6;
  insert into public.invitations (org_id, email, role, person_id) values (v_org, 'p6@n18.local', 'member', p6);
  rep := rep || pg_temp.chk((select status from public.patient_enrollments where person_id = p6) = 'pending' and exists (select 1 from public.care_relationships where person_id = p6 and revoked_at is null), 'p6: pendente com acesso da fisioterapeuta');
  update public.opportunities set stage_id = st_lost, status = 'lost', lost_reason_id = v_lr where id = o6;
  rep := rep || pg_temp.chk((select status from public.patient_enrollments where person_id = p6) = 'ended' and (select end_reason from public.patient_enrollments where person_id = p6) = 'opportunity_lost', 'perdida sem contratação paga: encerra o vínculo PENDENTE');
  rep := rep || pg_temp.chk(not exists (select 1 from public.care_relationships where person_id = p6 and revoked_at is null) and not exists (select 1 from public.invitations where person_id = p6 and accepted_at is null and revoked_at is null), 'revoga o acesso clínico do vínculo encerrado e o convite antigo não reativa');
  rep := rep || pg_temp.chk(exists (select 1 from public.people where id = p6) and exists (select 1 from public.opportunities where id = o6), 'a pessoa e o histórico do CRM permanecem');
  -- (b) paciente ATIVO: perder uma oportunidade não o encerra
  insert into public.opportunities (org_id, unit_id, person_id, pipeline_id, stage_id, title) values (v_org, ua, p1, v_pat, st_new, 'Opp N18 p1 renovação') returning id into o7;
  update public.opportunities set stage_id = st_lost, status = 'lost', lost_reason_id = v_lr where id = o7;
  rep := rep || pg_temp.chk((select status from public.patient_enrollments where person_id = p1) = 'active', 'perder outra oportunidade NÃO encerra paciente ativo');
  -- (c) pendente com OUTRA oportunidade válida: continua
  insert into public.opportunities (org_id, unit_id, person_id, pipeline_id, stage_id, title) values (v_org, ua, p4, v_pat, st_att, 'Opp N18 p4 outra') returning id into o_part;
  update public.opportunities set stage_id = st_lost, status = 'lost', lost_reason_id = v_lr where id = o4;
  rep := rep || pg_temp.chk((select status from public.patient_enrollments where person_id = p4) = 'pending' and (select opportunity_id from public.patient_enrollments where person_id = p4) = o_part, 'havendo outra oportunidade válida o vínculo pendente continua (passa a ela)');
  -- (d) pendente com recebimento confirmado: sinaliza o conflito, não encerra
  insert into public.opportunities (org_id, unit_id, person_id, pipeline_id, stage_id, title) values (v_org, ua, p7, v_pat, st_new, 'Opp N18 p7') returning id into o3b;
  update public.opportunities set stage_id = st_sched where id = o3b;
  set local role authenticated; perform pg_temp.as_user(u_sales);
  s6 := public.sale_create(p7, ua, o3b, jsonb_build_array(jsonb_build_object('product_id', prod_pkg)), 0, 3, current_date, 'conflito'); perform public.sale_confirm(s6); reset role;
  select id into r61 from public.receivables where sale_id = s6 and installment_no = 1;
  set local role authenticated; perform pg_temp.as_user(u_fin); perform public.payment_record(r61, 5000, now(), 'pix', acct, 'n18-p7'); reset role;
  update public.opportunities set stage_id = st_lost, status = 'lost', lost_reason_id = v_lr where id = o3b;
  rep := rep || pg_temp.chk((select status from public.patient_enrollments where person_id = p7) = 'pending' and (select review_flag from public.patient_enrollments where person_id = p7) = 'payment_conflict', 'perdida COM recebimento confirmado: sinaliza o conflito antes de encerrar (não encerra)');

  -- ---------------- 11. permissões e isolamento
  set local role authenticated; perform pg_temp.as_user(u_phy);
  rep := rep || pg_temp.chk(pg_temp.err('select count(*) from public.patient_enrollments') like '42501%', 'ninguém lê/escreve a tabela do vínculo direto (só funções)');
  rep := rep || pg_temp.chk(pg_temp.err(format('select public.enrollment_for_person(%L)', p1)) is null and (public.enrollment_for_person(p1) ->> 'status') = 'active', 'a fisioterapeuta com vínculo vê o estado do paciente');
  rep := rep || pg_temp.chk(pg_temp.err(format('select public.enrollment_for_person(%L)', p6)) like '42501%' or (public.enrollment_for_person(p6) ->> 'status') = 'ended', 'após encerrar, o vínculo antigo não dá mais acesso clínico (estado apenas)');
  perform pg_temp.as_user(u_p2);
  j := public.my_enrollment();
  rep := rep || pg_temp.chk(j ->> 'status' = 'none', 'outro paciente não vê o vínculo alheio (my_enrollment é da própria pessoa)');
  rep := rep || pg_temp.chk(pg_temp.err(format('select public.enrollment_for_person(%L)', p1)) like '42501%', 'paciente sem relação não consulta o vínculo de outro');
  perform pg_temp.as_user(u_other);
  rep := rep || pg_temp.chk(pg_temp.err(format('select public.enrollment_for_person(%L)', v_other_person)) is not null, 'usuário sem conta/organização não consulta vínculos');
  perform pg_temp.as_user(u_mgr);
  rep := rep || pg_temp.chk((public.enrollment_for_person(p1) ->> 'status') = 'active' and (public.enrollment_for_person(p7) ->> 'review_flag') = 'payment_conflict', 'gestão vê estado e sinais de análise');
  rep := rep || pg_temp.chk(pg_temp.err('select public.enrollment_reconcile(null)') is null, 'gestão pode reconciliar');
  reset role;
  rep := rep || pg_temp.chk(not exists (select 1 from public.patient_enrollments where org_id = v_other_org), 'nada vaza para outra organização');
  raise exception 'RELATORIO_N18%', rep;
end $$;
