-- RELEASE — S32: Finanças pessoais — importação/conciliação de extrato, vínculo com retirada da empresa e comprovantes (migration 095). Transação sempre desfeita. Somente Dev/teste.
--  · prévia valida linha a linha, detecta duplicidade e sugere correspondência; só as decisões confirmadas alteram registros; reimportar o mesmo arquivo não duplica
--  · conciliar com lançamento previsto LIQUIDA o lançamento (não cria despesa nova); nada vai para contas/lançamentos da empresa
--  · retirada paga no financeiro empresarial ↔ entrada pessoal: exige os dois acessos, é atômico, idempotente, tem pendência recuperável e não toca o lado empresarial
create or replace function pg_temp.chk(ok boolean, msg text) returns text language sql as $$ select format(E'\n[%s] %s', case when coalesce(ok, false) then 'OK' else 'FALHA' end, msg) $$;
create or replace function pg_temp.err(sql text) returns text language plpgsql as $$ begin execute sql; return null; exception when others then return sqlstate || ': ' || sqlerrm; end $$;
create or replace function pg_temp.as_user(u uuid) returns void language plpgsql as $$ begin perform set_config('request.jwt.claims', json_build_object('sub', u, 'role', 'authenticated')::text, true); end $$;
create or replace function pg_temp.bal(a uuid) returns bigint language sql security definer as $$ select private.pf_balance(a, (now() at time zone 'America/Sao_Paulo')::date) $$;
do $$
declare
  v_org uuid; v_unit uuid; u_own uuid := gen_random_uuid(); u_own2 uuid := gen_random_uuid(); u_fin uuid := gen_random_uuid(); u_mgr uuid := gen_random_uuid(); rep text := '';
  v_cur date := date_trunc('month', (now() at time zone 'America/Sao_Paulo')::date)::date; v_today date := (now() at time zone 'America/Sao_Paulo')::date;
  acc uuid; acc2 uuid; cat_h uuid; cat_i uuid; pv jsonb; imp uuid; ln jsonb; l1 uuid; l2 uuid; l3 uuid; l4 uuid; l5 uuid; l8 uuid; r jsonb; e_int uuid; s_rent uuid; n int; v bigint; pay uuid; pay2 uuid; lk jsonb; rows jsonb; e_inc uuid; bal0 bigint; cnt_pay int;
  d1 date := v_cur; d2 date := least(v_cur + 4, v_today);
begin
  select id into v_org from public.organizations where slug = 'hp-group'; select id into v_unit from public.units where org_id = v_org order by created_at limit 1;
  update public.organizations set features = features || '{"personal_finance": true}'::jsonb where id = v_org;
  insert into auth.users (id, aud, role, email) values (u_own,'authenticated','authenticated','own@s32.local'),(u_own2,'authenticated','authenticated','own2@s32.local'),(u_fin,'authenticated','authenticated','fin@s32.local'),(u_mgr,'authenticated','authenticated','mgr@s32.local');
  insert into public.user_accounts (user_id, org_id, display_name) values (u_own, v_org, 'Dono S32'),(u_own2, v_org, 'Dono2 S32'),(u_fin, v_org, 'Financeiro S32'),(u_mgr, v_org, 'Gestor S32');
  insert into public.role_assignments (org_id, user_id, role, unit_id) values (v_org, u_own, 'manager', null),(v_org, u_mgr, 'manager', null);
  insert into public.role_assignments (org_id, user_id, role, unit_id) values (v_org, u_fin, 'finance', v_unit);
  insert into public.pf_access (org_id, user_id) values (v_org, u_own),(v_org, u_own2);
  -- retiradas no financeiro empresarial (uma paga, uma ainda aberta)
  insert into public.payables (org_id, unit_id, description, amount_cents, due_date, competence_month, status, paid_at) values (v_org, v_unit, 'Retirada pró-labore S32', 500000, v_cur, v_cur, 'paid', now()) returning id into pay;
  insert into public.payables (org_id, unit_id, description, amount_cents, due_date, competence_month, status) values (v_org, v_unit, 'Retirada em aberto S32', 100000, v_cur, v_cur, 'open') returning id into pay2;
  select count(*) into cnt_pay from public.payables;

  set local role authenticated; perform pg_temp.as_user(u_own); perform public.pf_bootstrap();
  select id into cat_h from public.pf_categories where owner_user_id = u_own and name = 'Moradia' and parent_id is null;
  select id into cat_i from public.pf_categories where owner_user_id = u_own and name = 'Retirada da empresa';
  acc := public.pf_account_save(null, 'Conta S32', 'checking', 0, date '2026-01-01', false);
  acc2 := public.pf_account_save(null, 'Outra S32', 'checking', 0, date '2026-01-01', false);
  r := public.pf_entry_create(jsonb_build_object('kind','expense','description','Internet S32','amount_cents',12990,'category_id',cat_h,'account_id',acc,'due_date',d1)); e_int := (r ->> 'id')::uuid;
  r := public.pf_entry_create(jsonb_build_object('kind','expense','description','Aluguel S32','amount_cents',250000,'category_id',cat_h,'account_id',acc,'nature','fixed','repetition','recurring','recurrence', jsonb_build_object('frequency','monthly','start_date',v_cur,'due_day',1)));
  s_rent := (r ->> 'id')::uuid;

  -- ============ 1) prévia: validação, duplicidade e sugestões — sem alterar nada
  rows := jsonb_build_array(
    jsonb_build_object('date', d2, 'description', 'PIX INTERNET', 'amount_cents', -12990),
    jsonb_build_object('date', d1, 'description', 'ALUGUEL APARTAMENTO', 'amount_cents', -250000),
    jsonb_build_object('date', d2, 'description', 'SUPERMERCADO', 'amount_cents', -8745),
    jsonb_build_object('date', d2, 'description', 'CAFE', 'amount_cents', -1000),
    jsonb_build_object('date', d2, 'description', 'CAFE', 'amount_cents', -1000),
    jsonb_build_object('date', '2026-02-31', 'description', 'DATA RUIM', 'amount_cents', -500),
    jsonb_build_object('date', d2, 'description', 'ZERADO', 'amount_cents', 0),
    jsonb_build_object('date', d2, 'description', 'SALARIO', 'amount_cents', 500000));
  select count(*) into n from public.pf_entries where owner_user_id = u_own;
  pv := public.pf_import_preview(acc, 'extrato-s32.csv', rows); imp := (pv ->> 'import_id')::uuid;
  rep := rep || pg_temp.chk((pv -> 'counts' ->> 'new')::int = 6 and (pv -> 'counts' ->> 'invalid')::int = 2 and (pv -> 'counts' ->> 'duplicate')::int = 0, 'prévia: 6 linhas novas, 2 inválidas (data impossível e valor zero), 0 duplicadas');
  rep := rep || pg_temp.chk((select count(*) from public.pf_entries where owner_user_id = u_own) = n and (select count(*) from public.pf_settlements where owner_user_id = u_own) = 0, 'a prévia NÃO grava lançamentos nem liquidações');
  select (x ->> 'id')::uuid into l1 from jsonb_array_elements(pv -> 'lines') x where (x ->> 'row_no')::int = 1;
  select (x ->> 'id')::uuid into l2 from jsonb_array_elements(pv -> 'lines') x where (x ->> 'row_no')::int = 2;
  select (x ->> 'id')::uuid into l3 from jsonb_array_elements(pv -> 'lines') x where (x ->> 'row_no')::int = 3;
  select (x ->> 'id')::uuid into l4 from jsonb_array_elements(pv -> 'lines') x where (x ->> 'row_no')::int = 4;
  select (x ->> 'id')::uuid into l5 from jsonb_array_elements(pv -> 'lines') x where (x ->> 'row_no')::int = 5;
  select (x ->> 'id')::uuid into l8 from jsonb_array_elements(pv -> 'lines') x where (x ->> 'row_no')::int = 8;
  rep := rep || pg_temp.chk((select x -> 'suggestion' ->> 'entry_id' from jsonb_array_elements(pv -> 'lines') x where (x ->> 'row_no')::int = 1) = e_int::text, 'linha da internet: sugere o lançamento previsto (mesmo valor, vencimento próximo)');
  rep := rep || pg_temp.chk((select x -> 'suggestion' ->> 'type' from jsonb_array_elements(pv -> 'lines') x where (x ->> 'row_no')::int = 2) = 'virtual', 'linha do aluguel: sugere a ocorrência calculada da recorrência');
  rep := rep || pg_temp.chk((select x -> 'suggestion' is null or x ->> 'suggestion' is null from jsonb_array_elements(pv -> 'lines') x where (x ->> 'row_no')::int = 3), 'supermercado: sem correspondência (nada é inventado)');
  rep := rep || pg_temp.chk((select count(distinct id) from jsonb_array_elements(pv -> 'lines') x(id) ) >= 8 and l4 <> l5, 'dois cafés idênticos no mesmo arquivo continuam linhas distintas');

  -- ============ 2) confirmação: só o decidido muda; conciliar não duplica a despesa
  rep := rep || pg_temp.chk(pg_temp.err(format('select public.pf_import_confirm(%L, ''[]''::jsonb)', imp)) like '%nenhuma decisão%', 'confirmar sem decisões é recusado');
  r := public.pf_import_confirm(imp, jsonb_build_array(
        jsonb_build_object('line_id', l1, 'action', 'match'), jsonb_build_object('line_id', l2, 'action', 'match'),
        jsonb_build_object('line_id', l3, 'action', 'create', 'category_id', cat_h, 'description', 'Supermercado S32'),
        jsonb_build_object('line_id', l4, 'action', 'ignore'), jsonb_build_object('line_id', l8, 'action', 'create', 'category_id', cat_i)));
  rep := rep || pg_temp.chk((r ->> 'matched')::int = 2 and (r ->> 'created')::int = 2 and (r ->> 'ignored')::int = 1 and (r ->> 'pending')::int = 1, 'confirmado: 2 conciliados, 2 criados, 1 ignorado, 1 pendente (o 2º café, sem decisão)');
  rep := rep || pg_temp.chk((select status from public.pf_entries where id = e_int) = 'settled' and (select count(*) from public.pf_entries where owner_user_id = u_own and description = 'Internet S32') = 1, 'a internet foi LIQUIDADA e continua um único lançamento (nenhuma despesa duplicada)');
  rep := rep || pg_temp.chk((select count(*) from public.pf_entries where series_id = s_rent and status = 'settled' and amount_cents = 250000) = 1, 'o aluguel previsto virou lançamento liquidado (conciliação da ocorrência calculada)');
  rep := rep || pg_temp.chk((select count(*) from public.pf_entries where owner_user_id = u_own and description = 'Supermercado S32' and status = 'settled') = 1 and pg_temp.bal(acc) = -12990 - 250000 - 8745 + 500000, 'linha sem correspondência virou lançamento só porque foi decidido; saldo = −129,90 − 2.500 − 87,45 + 5.000');
  rep := rep || pg_temp.chk(pg_temp.err(format('select public.pf_import_confirm(%L, jsonb_build_array(jsonb_build_object(''line_id'', %L, ''action'', ''match'')))', imp, l1)) like '%já foi tratada%', 'aplicar de novo a mesma linha é recusado (idempotência)');

  -- ============ 3) reimportar o mesmo arquivo: sem duplicidade
  pv := public.pf_import_preview(acc, 'extrato-s32.csv', rows);
  rep := rep || pg_temp.chk((pv -> 'counts' ->> 'duplicate')::int = 4 and (pv -> 'counts' ->> 'new')::int = 2, 'mesmo arquivo de novo: 4 linhas já importadas viram "duplicada"; só os cafés (ignorado/pendente) seguem novos');
  select (x ->> 'id')::uuid into l1 from jsonb_array_elements(pv -> 'lines') x where (x ->> 'row_no')::int = 1;
  rep := rep || pg_temp.chk(pg_temp.err(format('select public.pf_import_confirm(%L, jsonb_build_array(jsonb_build_object(''line_id'', %L, ''action'', ''create'')))', (pv ->> 'import_id')::uuid, l1)) like '%duplicate%', 'linha duplicada não pode ser aplicada');
  rep := rep || pg_temp.chk(pg_temp.err(format('select public.pf_import_preview(%L, ''x'', %L::jsonb)', acc2, '[{"date":"2020-01-01","description":"x","amount_cents":-1}]')) is null, 'extrato antigo (anterior ao saldo inicial) é aceito na prévia como linha inválida, sem erro geral');
  rep := rep || pg_temp.chk(cnt_pay = (select count(*) from public.payables) and (select count(*) from public.financial_accounts where name like '%S32%') = 0, 'nada foi gravado nas tabelas do financeiro empresarial');

  -- isolamento da importação
  perform pg_temp.as_user(u_own2);
  rep := rep || pg_temp.chk((select count(*) from public.pf_imports) = 0 and (select count(*) from public.pf_import_lines) = 0, 'outro proprietário não enxerga importações alheias');
  rep := rep || pg_temp.chk(pg_temp.err(format('select public.pf_import_preview(%L, ''x'', %L::jsonb)', acc, '[{"date":"2026-01-02","description":"x","amount_cents":-1}]')) like '%escolha a conta pessoal%', 'importar na conta de outra pessoa é recusado');
  perform pg_temp.as_user(u_own);

  -- ============ 4) vínculo com retirada da empresa
  lk := public.pf_business_withdrawals();
  rep := rep || pg_temp.chk(exists (select 1 from jsonb_array_elements(lk -> 'payables') x where x ->> 'description' = 'Retirada pró-labore S32' and (x ->> 'looks_like_withdrawal')::boolean)
                            and not exists (select 1 from jsonb_array_elements(lk -> 'payables') x where x ->> 'description' = 'Retirada em aberto S32'), 'lista só retiradas PAGAS no empresarial (a em aberto não aparece)');
  r := public.pf_link_business_withdrawal(pay, null, null, 's32-link');
  rep := rep || pg_temp.chk((r ->> 'status') = 'pending', 'sem entrada pessoal ainda: fica uma PENDÊNCIA recuperável (nada é perdido)');
  r := public.pf_link_business_withdrawal(pay, null, null, 's32-link');
  rep := rep || pg_temp.chk((r ->> 'duplicate')::boolean and (select count(*) from public.pf_business_links where payable_id = pay) = 1, 'repetir com a mesma chave não duplica o vínculo');
  bal0 := pg_temp.bal(acc);
  r := public.pf_resolve_withdrawal_link((select id from public.pf_business_links where payable_id = pay), null, jsonb_build_object('account_id', acc, 'category_id', cat_i, 'date', v_cur));
  rep := rep || pg_temp.chk((r ->> 'status') = 'linked' and (select amount_cents from public.pf_entries where id = (r ->> 'entry_id')::uuid) = 500000 and (select status from public.pf_entries where id = (r ->> 'entry_id')::uuid) = 'settled'
                            and pg_temp.bal(acc) = bal0 + 500000, 'pendência resolvida: criou a receita pessoal de R$ 5.000,00 já recebida e vinculou (saldo +5.000,00)');
  e_inc := (r ->> 'entry_id')::uuid;
  r := public.pf_link_business_withdrawal(pay, null, jsonb_build_object('account_id', acc, 'date', v_cur), null);
  rep := rep || pg_temp.chk((r ->> 'duplicate')::boolean and (select count(*) from public.pf_entries where description like 'Retirada da empresa: Retirada pró-labore S32%') = 1, 'nova tentativa (retentativa de rede) NÃO duplica a entrada pessoal');
  rep := rep || pg_temp.chk((select status || description || amount_cents::text from public.payables where id = pay) = 'paidRetirada pró-labore S32500000' and (select count(*) from public.payables) = cnt_pay, 'o lado empresarial não foi alterado nem reclassificado (continua pago, mesma descrição e valor)');
  rep := rep || pg_temp.chk(pg_temp.err(format('select public.pf_link_business_withdrawal(%L)', pay2)) like '42501%', 'retirada ainda não paga: não vincula');
  r := public.pf_entry_create(jsonb_build_object('kind','income','description','Outra receita S32','amount_cents',123,'category_id',cat_i,'account_id',acc,'due_date',v_cur));
  rep := rep || pg_temp.chk(pg_temp.err(format('select public.pf_link_business_withdrawal(%L, %L)', pay, (r ->> 'id')::uuid)) is null, 'retirada já vinculada: pedir de novo devolve o vínculo existente');
  -- valor diferente
  reset role; insert into public.payables (org_id, unit_id, description, amount_cents, due_date, competence_month, status, paid_at) values (v_org, v_unit, 'Retirada B S32', 30000, v_cur, v_cur, 'paid', now()) returning id into pay2;
  set local role authenticated; perform pg_temp.as_user(u_own);
  rep := rep || pg_temp.chk(pg_temp.err(format('select public.pf_link_business_withdrawal(%L, %L)', pay2, (r ->> 'id')::uuid)) like '%valores diferem%', 'valores diferentes entre a retirada e a entrada pessoal: recusado com explicação');

  -- ============ 5) permissões nos dois contextos
  perform pg_temp.as_user(u_own2);
  rep := rep || pg_temp.chk(pg_temp.err(format('select public.pf_link_business_withdrawal(%L, null, %L::jsonb)', pay2, jsonb_build_object('account_id', acc2))) like '42501%', 'dono pessoal SEM papel financeiro no empresarial: não vincula retirada');
  perform pg_temp.as_user(u_fin);
  rep := rep || pg_temp.chk(pg_temp.err('select public.pf_business_withdrawals()') like '42501%', 'financeiro da empresa (sem acesso pessoal): não vê nem vincula');
  perform pg_temp.as_user(u_mgr);
  rep := rep || pg_temp.chk((select count(*) from public.pf_business_links) = 0 and (select count(*) from public.pf_entries) = 0 and (select count(*) from public.pf_imports) = 0, 'gestor da empresa não enxerga vínculos, lançamentos nem importações pessoais');
  perform pg_temp.as_user(u_own);
  rep := rep || pg_temp.chk((select count(*) from jsonb_array_elements(public.pf_business_links_list() -> 'links')) = 1, 'o dono vê o histórico dos vínculos');

  -- ============ 6) comprovantes privados
  rep := rep || pg_temp.chk(pg_temp.err(format('select public.pf_entry_set_receipt(%L, %L)', e_inc, u_mgr::text || '/x.pdf')) like '%inválido%', 'comprovante fora da pasta do dono é recusado');
  perform public.pf_entry_set_receipt(e_inc, u_own::text || '/' || e_inc::text || '/recibo.pdf');
  rep := rep || pg_temp.chk((select receipt_path from public.pf_entries where id = e_inc) like u_own::text || '/%', 'comprovante dentro da pasta do dono é aceito');
  rep := rep || pg_temp.chk(pg_temp.err(format('insert into storage.objects (bucket_id, name, owner) values (''pf-private'', %L, %L)', u_own::text || '/arq.pdf', u_own)) is null, 'o dono envia arquivo para a própria pasta do bucket privado');
  rep := rep || pg_temp.chk(pg_temp.err(format('insert into storage.objects (bucket_id, name, owner) values (''pf-private'', %L, %L)', u_mgr::text || '/arq.pdf', u_own)) is not null, 'ninguém grava na pasta de outro usuário');
  perform pg_temp.as_user(u_mgr);
  rep := rep || pg_temp.chk((select count(*) from storage.objects where bucket_id = 'pf-private') = 0, 'gestor não lista arquivos do bucket privado');

  reset role;
  raise exception E'RELATORIO_S32_PF_IMPORTACAO_VINCULO (transação desfeita):%', rep;
end $$;
