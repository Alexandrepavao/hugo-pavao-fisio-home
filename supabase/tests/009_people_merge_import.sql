-- Teste de mesclagem e importação de pessoas. Transação desfeita ao final. Somente dev/teste.
do $$
declare
  v_org uuid; v_ua uuid; v_ub uuid; v_pipe uuid; u_mgr uuid := gen_random_uuid(); u_sales uuid := gen_random_uuid(); u_umb uuid := gen_random_uuid();
  a uuid; b uuid; c uuid; d uuid; e1 uuid; e2 uuid; opp uuid; pv jsonb; r jsonb; n int; ok boolean; rep text := ''; tag uuid;
begin
  select id into v_org from public.organizations where slug = 'hp-group';
  select id into v_ua from public.units where org_id = v_org and slug = 'sao-paulo';
  insert into public.units (org_id, name, slug) values (v_org, 'Unidade B (teste)', 'teste-b') returning id into v_ub;
  select id into v_pipe from public.pipelines where org_id = v_org and kind = 'patients';
  insert into auth.users (id, aud, role, email) values (u_mgr,'authenticated','authenticated','m@t.local'),(u_sales,'authenticated','authenticated','s@t.local'),(u_umb,'authenticated','authenticated','u@t.local');
  insert into public.user_accounts (user_id, org_id) values (u_mgr, v_org),(u_sales, v_org),(u_umb, v_org);
  insert into public.role_assignments (org_id, user_id, role, unit_id) values (v_org, u_mgr, 'manager', null),(v_org, u_sales, 'sales', v_ua),(v_org, u_umb, 'unit_manager', v_ub);

  insert into public.people (org_id, unit_id, full_name) values (v_org, v_ua, 'Maria Souza') returning id into a;
  insert into public.people (org_id, unit_id, full_name) values (v_org, v_ua, 'Maria S. Souza') returning id into b;
  insert into public.person_kinds values (a, 'lead', now()), (b, 'lead', now()), (b, 'patient', now());
  insert into public.person_contacts (org_id, person_id, type, value, is_primary) values (v_org, a, 'email', 'maria@x.com', true), (v_org, b, 'email', 'maria@x.com', true), (v_org, b, 'phone', '11988887777', true);
  insert into public.tags (org_id, name) values (v_org, 'vip') returning id into tag;
  insert into public.person_tags values (a, tag), (b, tag);
  insert into public.opportunities (org_id, unit_id, person_id, pipeline_id, stage_id, title) select v_org, v_ua, b, v_pipe, id, 'Opp da B' from public.pipeline_stages where pipeline_id = v_pipe and position = 1 returning id into opp;
  insert into public.interactions (org_id, person_id, unit_id, channel, summary) values (v_org, b, v_ua, 'note', 'nota antiga da B');

  perform set_config('request.jwt.claims', json_build_object('sub', u_mgr, 'role','authenticated')::text, true);
  set local role authenticated;
  pv := public.merge_preview(a, b);
  rep := rep || format(E'\n[%s] prévia lista o que será movido e permite mesclar (%s)', case when (pv ->> 'can_merge')::boolean and (pv -> 'moves') ? 'opportunities.person_id' then 'OK' else 'FALHA' end, pv -> 'moves');
  r := public.merge_people(a, b);
  reset role;
  select count(*) into n from public.people where id = b and merged_into_id = a and archived_at is not null; rep := rep || format(E'\n[%s] cadastro mesclado fica arquivado (não é apagado) e aponta para o mantido', case when n = 1 then 'OK' else 'FALHA' end);
  select count(*) into n from public.opportunities where id = opp and person_id = a; rep := rep || format(E'\n[%s] oportunidade migrou para o cadastro mantido', case when n = 1 then 'OK' else 'FALHA' end);
  select count(*) into n from public.interactions where person_id = a and summary = 'nota antiga da B'; rep := rep || format(E'\n[%s] histórico de relacionamento preservado', case when n = 1 then 'OK' else 'FALHA' end);
  select count(*) into n from public.person_contacts where person_id = a; rep := rep || format(E'\n[%s] contatos combinados sem duplicar o e-mail comum (%s contatos)', case when n = 2 then 'OK' else 'FALHA' end, n);
  select count(*) into n from public.person_kinds where person_id = a; rep := rep || format(E'\n[%s] tipos combinados (lead+paciente) (%s)', case when n = 2 then 'OK' else 'FALHA' end, n);
  select count(*) into n from public.person_tags where person_id = a; rep := rep || format(E'\n[%s] tag repetida não gera erro (%s)', case when n = 1 then 'OK' else 'FALHA' end, n);
  select count(*) into n from public.person_merges where kept_person_id = a and merged_person_id = b and merged_snapshot ->> 'full_name' = 'Maria S. Souza'; rep := rep || format(E'\n[%s] mesclagem registrada com foto do cadastro original', case when n = 1 then 'OK' else 'FALHA' end);

  -- bloqueios e avisos
  insert into public.people (org_id, unit_id, full_name, document_number) values (v_org, v_ua, 'Carlos Lima', '111') returning id into c;
  insert into public.people (org_id, unit_id, full_name, document_number) values (v_org, v_ua, 'Carlos Lima', '222') returning id into d;
  perform set_config('request.jwt.claims', json_build_object('sub', u_mgr, 'role','authenticated')::text, true);
  set local role authenticated;
  pv := public.merge_preview(c, d); rep := rep || format(E'\n[%s] documentos diferentes bloqueiam a mesclagem', case when not (pv ->> 'can_merge')::boolean then 'OK' else 'FALHA' end);
  ok := false; begin perform public.merge_people(c, d); exception when others then ok := true; end; rep := rep || format(E'\n[%s] mesclar bloqueado é recusado no servidor', case when ok then 'OK' else 'FALHA' end);
  reset role;
  insert into public.people (org_id, unit_id, full_name) values (v_org, v_ua, 'Ana Pereira') returning id into e1;
  insert into public.people (org_id, unit_id, full_name) values (v_org, v_ua, 'Zeferino Quintas') returning id into e2;
  perform set_config('request.jwt.claims', json_build_object('sub', u_mgr, 'role','authenticated')::text, true);
  set local role authenticated;
  ok := false; begin perform public.merge_people(e1, e2); exception when others then ok := sqlerrm like 'Confirme os avisos%'; end; rep := rep || format(E'\n[%s] nomes muito diferentes exigem confirmação explícita dos avisos', case when ok then 'OK' else 'FALHA' end);
  r := public.merge_people(e1, e2, true); rep := rep || format(E'\n[%s] com confirmação dos avisos a mesclagem prossegue', case when r ->> 'status' = 'merged' then 'OK' else 'FALHA' end);
  reset role;
  -- contas nos dois cadastros bloqueiam
  insert into public.people (org_id, unit_id, full_name) values (v_org, v_ua, 'Duas Contas Um') returning id into c;
  insert into public.people (org_id, unit_id, full_name) values (v_org, v_ua, 'Duas Contas Um') returning id into d;
  update public.user_accounts set person_id = c where user_id = u_sales; update public.user_accounts set person_id = d where user_id = u_umb;
  perform set_config('request.jwt.claims', json_build_object('sub', u_mgr, 'role','authenticated')::text, true);
  set local role authenticated;
  pv := public.merge_preview(c, d); rep := rep || format(E'\n[%s] dois cadastros com conta de acesso bloqueiam a mesclagem', case when not (pv ->> 'can_merge')::boolean then 'OK' else 'FALHA' end);
  reset role;

  -- permissões
  perform set_config('request.jwt.claims', json_build_object('sub', u_sales, 'role','authenticated')::text, true);
  set local role authenticated;
  ok := false; begin perform public.merge_preview(a, e1); exception when others then ok := sqlstate = '42501'; end; rep := rep || format(E'\n[%s] comercial não mescla cadastros', case when ok then 'OK' else 'FALHA' end);
  reset role;
  perform set_config('request.jwt.claims', json_build_object('sub', u_umb, 'role','authenticated')::text, true);
  set local role authenticated;
  ok := false; begin perform public.merge_preview(a, e1); exception when others then ok := true; end; rep := rep || format(E'\n[%s] gestor de outra unidade não mescla cadastros da unidade A', case when ok then 'OK' else 'FALHA' end);
  reset role;

  -- importação
  perform set_config('request.jwt.claims', json_build_object('sub', u_mgr, 'role','authenticated')::text, true);
  set local role authenticated;
  r := public.import_people_check('[{"name":"Novo Lead Um","email":"novo1@x.com","phone":"11911110000"},{"name":"Outra Pessoa","email":"maria@x.com"},{"name":"Sem Contato Valido","phone":"12"}]');
  rep := rep || format(E'\n[%s] verificação prévia marca duplicidade por contato (linha 2)', case when (r -> 1 ->> 'duplicate')::boolean and not (r -> 0 ->> 'duplicate')::boolean then 'OK' else 'FALHA' end);
  r := public.import_people_commit(v_ua, '[{"name":"Novo Lead Um","email":"novo1@x.com","phone":"11911110000"},{"name":"Outra Pessoa","email":"maria@x.com"},{"name":"Sem Contato Valido","phone":"12"},{"name":"Fulana Forçada","email":"maria@x.com"}]', array[3]);
  rep := rep || format(E'\n[%s] importação: cria a nova, pula a duplicada, reporta erro e cria a forçada (%s)', case when r -> 0 ->> 'status' = 'created' and r -> 1 ->> 'status' = 'duplicate' and r -> 2 ->> 'status' = 'error' and r -> 3 ->> 'status' = 'created' then 'OK' else 'FALHA' end, r);
  r := public.import_people_commit(v_ua, '[{"name":"Novo Lead Um","email":"novo1@x.com","phone":"11911110000"}]');
  rep := rep || format(E'\n[%s] reimportar o mesmo arquivo não duplica cadastros (idempotente)', case when r -> 0 ->> 'status' = 'duplicate' then 'OK' else 'FALHA' end);
  reset role;
  n := coalesce(array_length(private.anon_extra_functions(), 1), 0); rep := rep || format(E'\n[%s] anon continua restrito às 3 RPCs (extras=%s)', case when n = 0 then 'OK' else 'FALHA' end, n);

  raise exception E'RELATORIO_MERGE_IMPORT (transação desfeita):%', rep;
end $$;
