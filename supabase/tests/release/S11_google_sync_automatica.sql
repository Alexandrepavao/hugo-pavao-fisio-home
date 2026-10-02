-- RELEASE v1 — S11: sincronização automática com o Google Calendar (migration 063): gatilho de atendimento + rede de segurança de 5 minutos.
-- Transação sempre desfeita: nada é enviado de verdade (a fila do pg_net é uma tabela; o que entra nela numa transação desfeita nunca sai).
-- O que se prova aqui: criação, remarcação e cancelamento de atendimento de quem TEM conexão Google disparam a sincronização daquele usuário (e só dele);
-- sem conexão, conexão revogada ou sem configuração no Vault não há chamada; a agenda nunca falha; o corpo da chamada não tem dado pessoal; nada é executável pelo navegador.
create or replace function pg_temp.chk(ok boolean, msg text) returns text language sql as $$ select format(E'\n[%s] %s', case when coalesce(ok, false) then 'OK' else 'FALHA' end, msg) $$;
do $$
declare
  v_org uuid; uz uuid; u_a uuid := gen_random_uuid(); u_b uuid := gen_random_uuid(); u_c uuid := gen_random_uuid(); u_pat uuid := gen_random_uuid();
  pr_a uuid; pr_b uuid; pr_c uuid; pe uuid; svc uuid; ap uuid; ap2 uuid; q0 bigint; q1 bigint; n bigint; ok boolean; rep text := ''; jb jsonb;
  t0 timestamptz := now() + interval '3 days';
begin
  select id into v_org from public.organizations where slug = 'hp-group';
  insert into public.units (org_id, name, slug) values (v_org, 'Unidade Z (teste S11)', 'teste-z-s11') returning id into uz;
  insert into auth.users (id, aud, role, email) values (u_a,'authenticated','authenticated','a@s11.local'),(u_b,'authenticated','authenticated','b@s11.local'),(u_c,'authenticated','authenticated','c@s11.local'),(u_pat,'authenticated','authenticated','p@s11.local');
  insert into public.user_accounts (user_id, org_id, person_id) values (u_a, v_org, null),(u_b, v_org, null),(u_c, v_org, null),(u_pat, v_org, null);
  insert into public.role_assignments (org_id, user_id, role, unit_id) values (v_org, u_a, 'physio', uz),(v_org, u_b, 'physio', uz),(v_org, u_c, 'physio', uz);
  insert into public.professionals (org_id, user_id, display_name) values (v_org, u_a, 'Fisio A S11') returning id into pr_a;
  insert into public.professionals (org_id, user_id, display_name) values (v_org, u_b, 'Fisio B S11') returning id into pr_b;
  insert into public.professionals (org_id, user_id, display_name) values (v_org, u_c, 'Fisio C S11 (sem conexão)') returning id into pr_c;
  insert into public.professional_units values (pr_a, uz),(pr_b, uz),(pr_c, uz);
  insert into public.people (org_id, unit_id, full_name) values (v_org, uz, 'Paciente S11') returning id into pe;
  insert into public.services (org_id, name, duration_min) values (v_org, 'Sessão S11', 50) returning id into svc;
  insert into public.google_calendar_connections (user_id, org_id, refresh_token_enc, status) values (u_a, v_org, 'x.y', 'active'),(u_b, v_org, 'x.y', 'active');

  -- configuração no Vault da transação (valores de mentira; a transação é desfeita)
  delete from vault.secrets where name in ('calendar_sync_url', 'calendar_sync_secret');
  -- ============ 1) sem configuração no Vault: no-op silencioso, e a agenda funciona
  select count(*) into q0 from net.http_request_queue;
  insert into public.appointments (org_id, unit_id, professional_id, person_id, service_id, period, status) values (v_org, uz, pr_a, pe, svc, tstzrange(t0, t0 + interval '50 minutes'), 'scheduled') returning id into ap;
  select count(*) into q1 from net.http_request_queue;
  rep := rep || pg_temp.chk(q1 = q0 and ap is not null, 'sem URL/segredo no Vault: nenhuma chamada sai, e o atendimento é criado normalmente (a agenda não depende do calendário)');
  perform vault.create_secret('https://exemplo.invalid/functions/v1/google-calendar/sync', 'calendar_sync_url'); perform vault.create_secret('segredo-de-teste-s11', 'calendar_sync_secret');

  -- ============ 2) criação, remarcação e cancelamento disparam a sincronização do profissional conectado
  select count(*) into q0 from net.http_request_queue;
  insert into public.appointments (org_id, unit_id, professional_id, person_id, service_id, period, status) values (v_org, uz, pr_a, pe, svc, tstzrange(t0 + interval '2 hours', t0 + interval '2 hours 50 minutes'), 'scheduled') returning id into ap2;
  select count(*) into q1 from net.http_request_queue; rep := rep || pg_temp.chk(q1 = q0 + 1, format('criar atendimento de profissional conectado → 1 chamada de sincronização (obtido %s)', q1 - q0));
  select convert_from(q.body, 'utf8')::jsonb into jb from net.http_request_queue q order by id desc limit 1;
  rep := rep || pg_temp.chk((jb ->> 'user_id')::uuid = u_a and (select count(*) from jsonb_object_keys(jb)) = 1, 'o corpo da chamada tem SÓ o identificador do usuário a sincronizar (nada de paciente, horário, serviço ou nota)');
  select count(*) into n from net.http_request_queue where url = 'https://exemplo.invalid/functions/v1/google-calendar/sync' and headers ->> 'x-cron-secret' = 'segredo-de-teste-s11' and id > (select max(id) - 1 from net.http_request_queue);
  rep := rep || pg_temp.chk(n = 1, 'a chamada vai para a URL do Vault com o segredo servidor-a-servidor no cabeçalho (nunca no corpo)');
  select count(*) into q0 from net.http_request_queue;
  update public.appointments set period = tstzrange(t0 + interval '5 hours', t0 + interval '5 hours 50 minutes') where id = ap2;
  select count(*) into q1 from net.http_request_queue; rep := rep || pg_temp.chk(q1 = q0 + 1, 'remarcar (mudar o horário) → nova sincronização');
  select count(*) into q0 from net.http_request_queue;
  update public.appointments set status = 'cancelled_by_patient' where id = ap2;
  select count(*) into q1 from net.http_request_queue; rep := rep || pg_temp.chk(q1 = q0 + 1, 'cancelar (mudar o status) → nova sincronização (o evento sai do Google)');
  select count(*) into q0 from net.http_request_queue;
  update public.appointments set notes = 'anotação administrativa' where id = ap;
  select count(*) into q1 from net.http_request_queue; rep := rep || pg_temp.chk(q1 = q0, 'mudar só uma anotação NÃO dispara sincronização (o gatilho só olha status, horário e profissional)');

  -- ============ 3) só quem tem conexão ativa
  select count(*) into q0 from net.http_request_queue;
  insert into public.appointments (org_id, unit_id, professional_id, person_id, service_id, period, status) values (v_org, uz, pr_c, pe, svc, tstzrange(t0 + interval '8 hours', t0 + interval '8 hours 50 minutes'), 'scheduled');
  select count(*) into q1 from net.http_request_queue; rep := rep || pg_temp.chk(q1 = q0, 'profissional SEM conexão Google: nenhuma chamada');
  update public.google_calendar_connections set status = 'revoked' where user_id = u_b;
  select count(*) into q0 from net.http_request_queue;
  insert into public.appointments (org_id, unit_id, professional_id, person_id, service_id, period, status) values (v_org, uz, pr_b, pe, svc, tstzrange(t0 + interval '10 hours', t0 + interval '10 hours 50 minutes'), 'scheduled');
  select count(*) into q1 from net.http_request_queue; rep := rep || pg_temp.chk(q1 = q0, 'conexão REVOGADA pelo usuário: nenhuma chamada');
  update public.google_calendar_connections set status = 'error' where user_id = u_b;
  select count(*) into q0 from net.http_request_queue;
  update public.appointments set status = 'confirmed' where id = ap;                                                                   -- atendimento do A; B com erro não entra
  insert into public.appointments (org_id, unit_id, professional_id, person_id, service_id, period, status) values (v_org, uz, pr_b, pe, svc, tstzrange(t0 + interval '12 hours', t0 + interval '12 hours 50 minutes'), 'scheduled');
  select count(*) into q1 from net.http_request_queue; rep := rep || pg_temp.chk(q1 = q0 + 2, format('conexão com erro também tenta de novo (2 chamadas: A e B) (obtido %s)', q1 - q0));

  -- ============ 4) mudar de profissional sincroniza os dois (o antigo perde o evento)
  update public.google_calendar_connections set status = 'active' where user_id = u_b;
  select count(*) into q0 from net.http_request_queue;
  update public.appointments set professional_id = pr_b where id = ap;
  select count(*) into q1 from net.http_request_queue; rep := rep || pg_temp.chk(q1 = q0 + 2, format('trocar o profissional do atendimento → sincroniza o novo (B) e o antigo (A), para o evento sair da agenda de A (obtido %s)', q1 - q0));

  -- ============ 5) rede de segurança (cron de 5 minutos)
  select count(*) into q0 from net.http_request_queue; perform private.google_sync_tick(); select count(*) into q1 from net.http_request_queue;
  select convert_from(q.body, 'utf8')::jsonb into jb from net.http_request_queue q order by id desc limit 1;
  rep := rep || pg_temp.chk(q1 = q0 + 1 and jb = '{}'::jsonb, 'o tick chama a sincronização de TODAS as conexões (corpo vazio) quando há conexão ativa ou com erro');
  update public.google_calendar_connections set status = 'revoked';
  select count(*) into q0 from net.http_request_queue; perform private.google_sync_tick(); select count(*) into q1 from net.http_request_queue;
  rep := rep || pg_temp.chk(q1 = q0, 'sem nenhuma conexão utilizável o tick não chama nada');
  select count(*) into n from cron.job where jobname = 'google-calendar-sync' and schedule = '*/5 * * * *' and active;
  rep := rep || pg_temp.chk(n = 1, 'o job do pg_cron “google-calendar-sync” existe, ativo, a cada 5 minutos');

  -- ============ 6) a agenda nunca falha por causa do calendário
  update public.google_calendar_connections set status = 'active' where user_id = u_a;
  ok := true; begin
    delete from vault.secrets where name = 'calendar_sync_url'; perform vault.create_secret('', 'calendar_sync_url');                      -- URL vazia: a chamada falha por dentro
    insert into public.appointments (org_id, unit_id, professional_id, person_id, service_id, period, status) values (v_org, uz, pr_a, pe, svc, tstzrange(t0 + interval '20 hours', t0 + interval '20 hours 50 minutes'), 'scheduled');
  exception when others then ok := false; end;
  rep := rep || pg_temp.chk(ok, 'mesmo com o Vault em estado estranho, criar atendimento continua funcionando (erros do calendário são engolidos)');

  -- ============ 7) superfície pública
  set local role authenticated; perform set_config('request.jwt.claims', json_build_object('sub', u_a, 'role', 'authenticated')::text, true);
  ok := false; begin perform private.google_sync_call(u_a); exception when others then ok := sqlstate = '42501'; end; rep := rep || pg_temp.chk(ok, 'o navegador (authenticated) NÃO chama a sincronização direto');
  ok := false; begin perform private.google_sync_tick(); exception when others then ok := sqlstate = '42501'; end; rep := rep || pg_temp.chk(ok, 'o navegador NÃO executa o tick');
  ok := false; begin perform count(*) from vault.decrypted_secrets; exception when others then ok := sqlstate = '42501'; end; rep := rep || pg_temp.chk(ok, 'o navegador não lê o Vault (segredo nunca chega ao cliente)');
  reset role; set local role anon;
  ok := false; begin perform private.google_sync_call(u_a); exception when others then ok := sqlstate = '42501'; end; rep := rep || pg_temp.chk(ok, 'anon NÃO chama a sincronização');
  reset role;

  raise exception E'RELATORIO_S11_GOOGLE_SYNC_AUTOMATICA (transação desfeita):%', rep;
end $$;
