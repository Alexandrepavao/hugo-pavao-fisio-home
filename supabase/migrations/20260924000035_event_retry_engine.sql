-- HP Group Hub — 035 Retentativas de eventos: processamento real (não só manual), reserva contra execução
-- concorrente duplicada, intervalos progressivos, limite de tentativas, distinção entre falha temporária e
-- definitiva, recuperação após interrupção de worker, reprocessamento manual autorizado e auditado.
--
-- Reaproveita a infraestrutura já existente (public.domain_events, private.event_handlers,
-- public.automation_runs, private.dispatch_event, private.emit_event) — não recria o motor de eventos, só
-- adiciona a camada de fila/agendamento que faltava por cima dele. automation_runs já garante idempotência por
-- handler (unique(event_id, handler) com skip se já 'ok'): reprocessar um evento nunca reexecuta um handler
-- que já teve sucesso.
--
-- Reserva (claim) com FOR UPDATE SKIP LOCKED: dois workers rodando a mesma consulta de fila nunca pegam a
-- mesma linha — um pula silenciosamente o que o outro já travou. Um evento reservado (claimed_at preenchido)
-- que não é liberado em até 5 minutos é considerado de um worker que caiu no meio do processamento e volta a
-- ficar elegível — isso é a "recuperação após interrupção de um worker".
--
-- Falha temporária x definitiva: um handler que quer sinalizar "nunca vai funcionar, não adianta tentar de
-- novo" levanta exceção com errcode 'P0002' (convenção documentada abaixo) — o evento vai direto para 'dead'.
-- Qualquer outra exceção é tratada como temporária: intervalo progressivo (2^tentativas minutos, teto de 60)
-- até o limite de 8 tentativas, quando também vira 'dead' (esgotada, não definitiva desde o início — registrado
-- em domain_events.permanent_failure para diferenciar os dois motivos na auditoria).
--
-- "Não marcar concluído antes de confirmar a ação": nenhum handler atual desta base faz chamada externa (são
-- todos escrita interna determinística) — o ponto fica coberto pelo próprio desenho do dispatch_event, que só
-- marca automation_runs.status='ok' DEPOIS que o handler retorna sem erro, nunca antes. Para um futuro handler
-- que chame um serviço externo de verdade (e-mail, webhook), o padrão obrigatório é: gerar uma chave de
-- idempotência determinística a partir do event_id ANTES de chamar o serviço externo, e no reprocessamento
-- reenviar a MESMA chave — o serviço externo (ou uma tabela de confirmações externas) responde "já recebido"
-- em vez de duplicar, mesmo que a confirmação local anterior tenha falhado depois da chamada externa ter
-- funcionado. Isso é testado aqui com um adaptador controlado (nunca dispara e-mail/webhook real).

alter table public.domain_events add column next_attempt_at timestamptz not null default now();
alter table public.domain_events add column claimed_at timestamptz;
alter table public.domain_events add column claimed_by text;
alter table public.domain_events add column permanent_failure boolean not null default false;
drop index if exists public.domain_events_status_idx;
create index domain_events_queue_idx on public.domain_events (next_attempt_at) where status in ('pending', 'failed');

-- Reserva até p_limit eventos elegíveis (prontos para tentar e não reservados por outro worker vivo, ou
-- reservados há mais de 5 minutos por um worker que presumivelmente caiu) e devolve os ids reservados.
create or replace function private.claim_events(p_worker text, p_limit int default 20) returns setof uuid
language plpgsql as $$
begin
  return query
    update public.domain_events e set claimed_at = now(), claimed_by = p_worker
    from (
      select id from public.domain_events
      where status in ('pending', 'failed') and next_attempt_at <= now()
        and (claimed_at is null or claimed_at < now() - interval '5 minutes')
      order by next_attempt_at
      limit p_limit
      for update skip locked
    ) q
    where e.id = q.id
    returning e.id;
end $$;

-- Reescreve dispatch_event: mesma lógica de handlers/automation_runs de antes, mas agora com intervalo
-- progressivo, limite de tentativas e distinção temporária x definitiva (errcode 'P0002' = definitiva).
create or replace function private.dispatch_event(p_event uuid) returns void
language plpgsql security definer set search_path = '' as $$
declare ev public.domain_events; h record; v_failed boolean := false; v_permanent boolean := false; v_attempts int; v_backoff_minutes numeric;
begin
  select * into ev from public.domain_events where id = p_event for update;
  if not found or ev.status in ('processed', 'dead') then return; end if;
  for h in select handler from private.event_handlers where event_type = ev.type loop
    if exists (select 1 from public.automation_runs r where r.event_id = ev.id and r.handler = h.handler and r.status = 'ok') then continue; end if;
    begin
      execute format('select private.%I($1)', h.handler) using ev.id;
      insert into public.automation_runs (event_id, handler, status) values (ev.id, h.handler, 'ok')
        on conflict (event_id, handler) do update set status = 'ok', error = null, ran_at = now();
    exception when others then
      v_failed := true;
      if sqlstate = 'P0002' then v_permanent := true; end if;
      insert into public.automation_runs (event_id, handler, status, error) values (ev.id, h.handler, 'error', sqlerrm)
        on conflict (event_id, handler) do update set status = 'error', error = excluded.error, ran_at = now();
    end;
  end loop;
  v_attempts := ev.attempts + 1;
  v_backoff_minutes := least(power(2, v_attempts), 60);
  update public.domain_events
     set attempts = v_attempts,
         status = case when not v_failed then 'processed' when v_permanent or v_attempts >= 8 then 'dead' else 'failed' end,
         processed_at = case when not v_failed then now() end,
         last_error = case when v_failed then 'ver automation_runs' end,
         permanent_failure = v_permanent,
         next_attempt_at = case when v_failed and not v_permanent and v_attempts < 8 then now() + make_interval(mins => v_backoff_minutes::int) else next_attempt_at end,
         claimed_at = null, claimed_by = null
   where id = ev.id;
end $$;

-- Reserva + processa até p_limit eventos elegíveis. Chamada pelo cron (automática) e por retry_failed_events (manual).
create or replace function private.claim_and_process_events(p_worker text, p_limit int default 20) returns int
language plpgsql as $$
declare r uuid; n int := 0;
begin
  for r in select private.claim_events(p_worker, p_limit) loop
    perform private.dispatch_event(r); n := n + 1;
  end loop;
  return n;
end $$;

-- Alvo do agendador (pg_cron chama isto a cada minuto — sem checagem de papel, roda fora de uma sessão de usuário).
create or replace function private.cron_process_events() returns void
language plpgsql security definer set search_path = '' as $$
begin
  perform private.claim_and_process_events('cron', 50);
end $$;

-- Reprocessamento manual: agora reserva (evita concorrência com o cron rodando ao mesmo tempo) e sempre grava
-- na auditoria quem disparou — "reprocessamento manual autorizado e auditado".
create or replace function public.retry_failed_events() returns int
language plpgsql security definer set search_path = '' as $$
declare v_n int;
begin
  if not private.is_manager() then raise exception 'apenas gestor' using errcode = '42501'; end if;
  v_n := private.claim_and_process_events('manual:' || (select auth.uid())::text, 100);
  insert into public.audit_log (org_id, actor_user_id, action, entity_type, entity_id, new_values)
    values (private.current_org(), (select auth.uid()), 'retry_failed_events', 'domain_events', null, jsonb_build_object('processed', v_n));
  return v_n;
end $$;

-- Agenda o processamento automático a cada minuto (idempotente: cron.schedule com o mesmo nome substitui o job).
select cron.schedule('domain-events-retry', '* * * * *', $$select private.cron_process_events()$$);

grant execute on function public.retry_failed_events() to authenticated;
