-- Teste HP Pages + formulários públicos. Transação desfeita ao final. Somente dev/teste.
do $$
declare
  v_org uuid; v_ua uuid; v_ub uuid; v_pipe uuid;
  u_mgr uuid := gen_random_uuid(); u_sb uuid := gen_random_uuid();
  pg uuid; fm uuid; r jsonb; n int; ok boolean; rep text := ''; i int;
begin
  select id into v_org from public.organizations where slug = 'hp-group';
  select id into v_ua from public.units where org_id = v_org and slug = 'sao-paulo';
  insert into public.units (org_id, name, slug) values (v_org, 'Unidade B (teste)', 'teste-b') returning id into v_ub;
  select id into v_pipe from public.pipelines where org_id = v_org and kind = 'patients';
  insert into auth.users (id, aud, role, email) values (u_mgr,'authenticated','authenticated','m@t.local'),(u_sb,'authenticated','authenticated','sb@t.local');
  insert into public.user_accounts (user_id, org_id) values (u_mgr, v_org),(u_sb, v_org);
  insert into public.role_assignments (org_id, user_id, role, unit_id) values (v_org, u_mgr, 'manager', null),(v_org, u_sb, 'sales', v_ub);

  perform set_config('request.jwt.claims', json_build_object('sub', u_mgr, 'role','authenticated')::text, true);
  set local role authenticated;
  pg := public.page_create('checkup', 'Check-up Fisioterapêutico', 'checkup',
        '[{"type":"hero","title":"Check-up"},{"type":"form","form_id":"__DEFAULT_FORM__"}]'::jsonb, v_ua, v_pipe);
  select id into fm from public.forms where page_id = pg;
  select count(*) into n from public.page_versions where page_id = pg;
  rep := rep || format(E'\n[%s] página criada com formulário padrão e versão inicial (versões=%s)', case when fm is not null and n = 1 then 'OK' else 'FALHA' end, n);
  select count(*) into n from public.pages where id = pg and draft_content::text like '%' || fm::text || '%';
  rep := rep || format(E'\n[%s] bloco de formulário aponta para o formulário criado', case when n = 1 then 'OK' else 'FALHA' end);

  ok := false; begin perform public.page_create('admin', 'X página', 'blank', '[]', v_ua, v_pipe); exception when others then ok := true; end;
  rep := rep || format(E'\n[%s] slug reservado (/admin) é recusado', case when ok then 'OK' else 'FALHA' end);
  ok := false; begin perform public.page_create('checkup', 'Outra', 'blank', '[]', v_ua, v_pipe); exception when unique_violation then ok := true; end;
  rep := rep || format(E'\n[%s] colisão de slug é recusada', case when ok then 'OK' else 'FALHA' end);
  ok := false; begin perform public.page_save_draft(pg, 'Check-up', null, '[{"type":"text","body":"<script>alert(1)</script>"}]'::jsonb, '{}'); exception when others then ok := true; end;
  rep := rep || format(E'\n[%s] conteúdo com <script> é recusado', case when ok then 'OK' else 'FALHA' end);
  ok := false; begin perform public.page_save_draft(pg, 'Check-up', null, '[{"type":"raw_html","html":"x"}]'::jsonb, '{}'); exception when others then ok := true; end;
  rep := rep || format(E'\n[%s] tipo de bloco desconhecido é recusado', case when ok then 'OK' else 'FALHA' end);
  reset role;

  -- rascunho não é público
  set local role anon;
  r := public.get_public_page('checkup');
  rep := rep || format(E'\n[%s] página em rascunho não é pública (%s)', case when r ->> 'status' = 'not_found' then 'OK' else 'FALHA' end, r ->> 'status');
  reset role;

  -- publica
  perform set_config('request.jwt.claims', json_build_object('sub', u_mgr, 'role','authenticated')::text, true);
  set local role authenticated;
  perform public.page_publish(pg);
  reset role;
  set local role anon;
  r := public.get_public_page('checkup');
  rep := rep || format(E'\n[%s] página publicada é pública com formulário (%s)', case when r ->> 'status' = 'published' and jsonb_array_length(r -> 'page' -> 'forms') = 1 then 'OK' else 'FALHA' end, r ->> 'status');

  -- envio público
  r := public.submit_public_form(fm, '{"name":"Maria Souza","phone":"(11) 98888-7777","email":"maria@x.com"}', '{"utm_campaign":"setembro"}');
  rep := rep || format(E'\n[%s] formulário cria lead (%s)', case when r ->> 'status' = 'created' then 'OK' else 'FALHA' end, r ->> 'status');
  r := public.submit_public_form(fm, '{"name":"Maria Souza","phone":"11988887777","email":"maria@x.com"}');
  rep := rep || format(E'\n[%s] reenvio no mesmo dia é idempotente (%s)', case when r ->> 'status' = 'duplicate' then 'OK' else 'FALHA' end, r ->> 'status');
  r := public.submit_public_form(fm, '{"name":"Zé Ninguém","phone":"11999990000"}', '{}', 'bot');
  rep := rep || format(E'\n[%s] honeypot preenchido não cria nada', case when r ->> 'status' = 'ok' then 'OK' else 'FALHA' end);
  ok := false; begin perform public.submit_public_form(fm, '{"name":"Sem contato"}'); exception when others then ok := true; end;
  rep := rep || format(E'\n[%s] campo obrigatório ausente é recusado', case when ok then 'OK' else 'FALHA' end);
  ok := false; begin perform public.submit_public_form(fm, '{"name":"Fulano","phone":"123"}'); exception when others then ok := true; end;
  rep := rep || format(E'\n[%s] telefone inválido é recusado', case when ok then 'OK' else 'FALHA' end);
  -- contato compartilhado com nome diferente => nova pessoa + revisão (nunca mescla)
  r := public.submit_public_form(fm, '{"name":"João Pereira","phone":"11988887777"}');
  reset role;
  select count(*) into n from public.people where full_name in ('Maria Souza','João Pereira');
  rep := rep || format(E'\n[%s] contato compartilhado com nome diferente cria NOVA pessoa (%s pessoas)', case when n = 2 then 'OK' else 'FALHA' end, n);
  select count(*) into n from public.crm_tasks where kind = 'dedupe_review';
  rep := rep || format(E'\n[%s] gerou tarefa de revisão de duplicidade (%s)', case when n >= 1 then 'OK' else 'FALHA' end, n);
  select count(*) into n from public.opportunities o join public.people p on p.id = o.person_id where p.full_name = 'Maria Souza' and o.source = 'page:checkup' and o.campaign = 'setembro';
  rep := rep || format(E'\n[%s] oportunidade criada com origem e campanha (%s)', case when n = 1 then 'OK' else 'FALHA' end, n);
  select count(*) into n from public.crm_tasks where kind = 'first_contact';
  rep := rep || format(E'\n[%s] tarefa de primeiro contato criada (%s)', case when n >= 1 then 'OK' else 'FALHA' end, n);
  select count(*) into n from public.domain_events where type = 'form.submitted' and status = 'processed';
  rep := rep || format(E'\n[%s] evento form.submitted registrado (%s)', case when n >= 1 then 'OK' else 'FALHA' end, n);

  -- rate limit
  set local role anon;
  ok := false;
  begin
    for i in 1..8 loop perform public.submit_public_form(fm, format('{"name":"Lead %s","phone":"1197777%s"}', i, lpad(i::text, 4, '0'))::jsonb); end loop;
  exception when others then ok := sqlerrm = 'rate_limited'; end;
  rep := rep || format(E'\n[%s] limite de taxa bloqueia rajada de envios', case when ok then 'OK' else 'FALHA' end);
  reset role;

  -- anon não lê tabelas
  set local role anon;
  ok := false; begin perform 1 from public.form_submissions limit 1; exception when others then ok := true; end;
  rep := rep || format(E'\n[%s] anon não lê form_submissions', case when ok then 'OK' else 'FALHA' end);
  ok := false; begin perform 1 from public.pages limit 1; exception when others then ok := true; end;
  rep := rep || format(E'\n[%s] anon não lê pages diretamente', case when ok then 'OK' else 'FALHA' end);
  reset role;

  -- comercial de outra unidade não vê nem edita a página da unidade A
  perform set_config('request.jwt.claims', json_build_object('sub', u_sb, 'role','authenticated')::text, true);
  set local role authenticated;
  select count(*) into n from public.pages; rep := rep || format(E'\n[%s] comercial da unidade B não vê páginas da unidade A (%s)', case when n = 0 then 'OK' else 'FALHA' end, n);
  ok := false; begin perform public.page_publish(pg); exception when others then ok := true; end;
  rep := rep || format(E'\n[%s] comercial da unidade B não publica página da A', case when ok then 'OK' else 'FALHA' end);
  select count(*) into n from public.opportunities; rep := rep || format(E'\n[%s] comercial da unidade B não vê oportunidades da A (%s)', case when n = 0 then 'OK' else 'FALHA' end, n);
  reset role;

  -- desativação: mensagem, redirecionamento e lista de espera
  perform set_config('request.jwt.claims', json_build_object('sub', u_mgr, 'role','authenticated')::text, true);
  set local role authenticated;
  perform public.page_disable(pg, 'message', 'Encerrado.');
  reset role; set local role anon; r := public.get_public_page('checkup');
  rep := rep || format(E'\n[%s] desativada com mensagem (%s)', case when r ->> 'status' = 'closed' then 'OK' else 'FALHA' end, r ->> 'status'); reset role;
  set local role authenticated; perform public.page_disable(pg, 'redirect', null, 'https://exemplo.com/nova'); reset role;
  set local role anon; r := public.get_public_page('checkup');
  rep := rep || format(E'\n[%s] desativada com redirecionamento (%s)', case when r ->> 'status' = 'redirect' then 'OK' else 'FALHA' end, r ->> 'status'); reset role;
  set local role authenticated; perform public.page_disable(pg, 'waitlist'); reset role;
  set local role anon; r := public.get_public_page('checkup');
  rep := rep || format(E'\n[%s] desativada com lista de espera (%s)', case when r ->> 'status' = 'waitlist' then 'OK' else 'FALHA' end, r ->> 'status');
  r := public.submit_public_form((r -> 'page' -> 'forms' -> 0 ->> 'id')::uuid, '{"name":"Ana Espera","phone":"11955554444"}');
  rep := rep || format(E'\n[%s] lista de espera recebe inscrição (%s)', case when r ->> 'status' = 'created' then 'OK' else 'FALHA' end, r ->> 'status');
  ok := false; begin perform public.submit_public_form(fm, '{"name":"Tarde Demais","phone":"11944443333"}'); exception when others then ok := true; end;
  rep := rep || format(E'\n[%s] formulário normal indisponível após desativar', case when ok then 'OK' else 'FALHA' end);
  reset role;

  -- versões e restauração
  perform set_config('request.jwt.claims', json_build_object('sub', u_mgr, 'role','authenticated')::text, true);
  set local role authenticated;
  perform public.page_save_draft(pg, 'Check-up v2', null, '[{"type":"text","body":"nova"}]'::jsonb, '{}');
  perform public.page_restore_version(pg, 1);
  select count(*) into n from public.pages where id = pg and title = 'Check-up Fisioterapêutico' and draft_content::text like '%Check-up%';
  rep := rep || format(E'\n[%s] restauração de versão devolve o conteúdo anterior', case when n = 1 then 'OK' else 'FALHA' end);
  reset role;

  raise exception E'RELATORIO_PAGES (transação desfeita):%', rep;
end $$;
