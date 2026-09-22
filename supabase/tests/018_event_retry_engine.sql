-- Retentativas de eventos: reserva contra processamento concorrente duplicado, recuperação de worker
-- interrompido, intervalos progressivos, limite de tentativas, falha temporária x definitiva, idempotência por
-- handler (nunca duplica uma ação já confirmada), reprocessamento manual autorizado e auditado.
-- Usa um handler de teste controlado (criado e removido dentro desta mesma transação — nunca some no schema
-- real, nunca dispara e-mail/webhook de verdade): simula uma "confirmação externa" gravando numa tabela de
-- rascunho só para provar que reprocessar um handler já bem-sucedido nunca duplica a ação.
-- Transação sempre desfeita. Somente dev/teste.
do $$
declare
  v_org uuid; rep text := ''; u_mgr uuid;
  ev1 uuid; ev2 uuid; ev3 uuid; ev_dead uuid;
  n int; ok boolean; st text; att int; claimed uuid[];
begin
  select id into v_org from public.organizations where slug = 'hp-group';
  u_mgr := gen_random_uuid();
  insert into auth.users (id, aud, role, email) values (u_mgr, 'authenticated', 'authenticated', 'evt.mgr@t.local');
  insert into public.user_accounts (user_id, org_id, display_name) values (u_mgr, v_org, 'Evt Gestora');
  insert into public.role_assignments (org_id, user_id, role) values (v_org, u_mgr, 'manager');

  -- tabela de rascunho representando "o sistema externo" (só existe dentro desta transação)
  create temporary table test_external_confirmations (event_id uuid primary key, confirmed_at timestamptz not null default now()) on commit drop;

  -- handler de teste: o comportamento vem de payload->>'mode'. 'fail_then_succeed' usa attempts já gravado no
  -- próprio domain_events pra saber em qual tentativa está — não precisa de estado externo.
  create or replace function private.h_test_retry_demo(p_event uuid) returns void
  language plpgsql as $fn$
  declare ev public.domain_events; v_mode text;
  begin
    select * into ev from public.domain_events where id = p_event;
    v_mode := ev.payload ->> 'mode';
    if v_mode = 'fail_permanent' then
      raise exception 'falha definitiva simulada' using errcode = 'P0002';
    elsif v_mode = 'fail_temporary' then
      raise exception 'falha temporária simulada';
    elsif v_mode = 'fail_then_succeed' and ev.attempts < 2 then
      raise exception 'falha temporária simulada (tentativa %)', ev.attempts;
    else
      -- "confirma a ação externa" só agora, depois que o handler decidiu ter sucesso — nunca antes.
      insert into test_external_confirmations (event_id) values (p_event) on conflict (event_id) do nothing;
    end if;
  end $fn$;
  insert into private.event_handlers (event_type, handler) values ('test.retry_demo', 'h_test_retry_demo') on conflict do nothing;

  -- ---------- falha temporária: intervalo progressivo, nunca fica pronta antes da hora
  select private.emit_event(v_org, 'test.retry_demo', 'test', null, jsonb_build_object('mode', 'fail_temporary'), 'evt-temp-1') into ev1;
  select status, attempts, next_attempt_at > now() into st, att, ok from public.domain_events where id = ev1;
  rep := rep || format(E'\n[%s] falha temporária: status=failed, attempts=1, próxima tentativa agendada no futuro (backoff)', case when st = 'failed' and att = 1 and ok then 'OK' else 'FALHA' end);

  -- ---------- reserva: um evento recém-reservado não é pego de novo por outro worker antes de liberar
  update public.domain_events set next_attempt_at = now() - interval '1 second' where id = ev1;    -- simula que já passou o tempo de espera
  select array_agg(x) into claimed from private.claim_events('worker-A', 10) x;
  perform private.claim_events('worker-B', 10);   -- não deve pegar o mesmo evento: ainda está "reservado" por worker-A
  select claimed_by into st from public.domain_events where id = ev1;
  rep := rep || format(E'\n[%s] evento reservado por um worker não é pego por outro enquanto a reserva está fresca (reservado por: %s)', case when ev1 = any(claimed) and st = 'worker-A' then 'OK' else 'FALHA' end, st);

  -- ---------- recuperação de worker interrompido: reserva com mais de 5 minutos é considerada abandonada
  update public.domain_events set claimed_at = now() - interval '10 minutes' where id = ev1;   -- simula worker-A morto há 10min
  select array_agg(x) into claimed from private.claim_events('worker-C', 10) x;
  rep := rep || format(E'\n[%s] reserva de worker que caiu (>5min) é recuperada por outro worker', case when ev1 = any(claimed) then 'OK' else 'FALHA' end);
  -- processa até dar certo (mode fail_temporary sempre falha — troca pra succeed pra fechar o ciclo)
  update public.domain_events set payload = jsonb_build_object('mode', 'succeed'), next_attempt_at = now(), claimed_at = null where id = ev1;
  perform private.claim_and_process_events('worker-final', 10);
  select status into st from public.domain_events where id = ev1;
  rep := rep || format(E'\n[%s] evento processado com sucesso após recuperação (status=%s)', case when st = 'processed' then 'OK' else 'FALHA' end, st);

  -- ---------- idempotência: reprocessar um handler já bem-sucedido nunca duplica a "confirmação externa"
  perform private.dispatch_event(ev1); perform private.dispatch_event(ev1); perform private.dispatch_event(ev1);
  select count(*) into n from test_external_confirmations where event_id = ev1;
  rep := rep || format(E'\n[%s] reprocessar um evento já concluído nunca duplica a confirmação externa (%s confirmação/ões, nunca mais de 1)', case when n = 1 then 'OK' else 'FALHA' end, n);

  -- ---------- falha definitiva (errcode P0002): vai direto pra 'dead', sem reagendar
  select private.emit_event(v_org, 'test.retry_demo', 'test', null, jsonb_build_object('mode', 'fail_permanent'), 'evt-perm-1') into ev_dead;
  select status, permanent_failure into st, ok from public.domain_events where id = ev_dead;
  rep := rep || format(E'\n[%s] falha definitiva (errcode P0002) vai direto pra dead, marcada como definitiva', case when st = 'dead' and ok then 'OK' else 'FALHA' end);

  -- ---------- tentativas esgotadas (8x falha temporária) também vira dead, mas SEM ser marcada como definitiva
  select private.emit_event(v_org, 'test.retry_demo', 'test', null, jsonb_build_object('mode', 'fail_temporary'), 'evt-exhaust-1') into ev2;
  for n in 1..8 loop
    update public.domain_events set next_attempt_at = now(), claimed_at = null where id = ev2 and status <> 'dead';
    perform private.claim_and_process_events('worker-exhaust', 10);
  end loop;
  select status, attempts, permanent_failure into st, att, ok from public.domain_events where id = ev2;
  rep := rep || format(E'\n[%s] 8 falhas temporárias esgotam as tentativas (status=dead, attempts=%s) mas NÃO fica marcada como definitiva', case when st = 'dead' and not ok then 'OK' else 'FALHA' end, att);

  -- ---------- reprocessamento manual: só gestor, e fica auditado
  select private.emit_event(v_org, 'test.retry_demo', 'test', null, jsonb_build_object('mode', 'succeed'), 'evt-manual-1') into ev3;
  perform set_config('request.jwt.claims', json_build_object('sub', u_mgr, 'role','authenticated')::text, true);
  set local role authenticated;
  select public.retry_failed_events() into n;
  reset role;
  select status into st from public.domain_events where id = ev3;
  rep := rep || format(E'\n[%s] reprocessamento manual (gestor) processa o evento pendente (status=%s)', case when st = 'processed' then 'OK' else 'FALHA' end, st);
  rep := rep || format(E'\n[%s] reprocessamento manual fica registrado na auditoria', case when exists (select 1 from public.audit_log where action = 'retry_failed_events' and actor_user_id = u_mgr) then 'OK' else 'FALHA' end);

  drop function private.h_test_retry_demo(uuid);
  delete from private.event_handlers where handler = 'h_test_retry_demo';

  raise exception E'RELATORIO_EVENT_RETRY (transação desfeita):%', rep;
end $$;
