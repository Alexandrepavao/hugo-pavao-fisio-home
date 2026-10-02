-- Central de Conversas do CRM: conversa por pessoa/canal, multiatendimento (responsável + colaboradores, entrada, saída, transferência), mensagens (recebida, enviada, nota
-- interna, sistema), mensagens agendadas e ficha do lead por nicho (campos administrativos por tipo de funil).
--
-- HONESTIDADE DE ENVIO: o HP NÃO tem provedor de WhatsApp/e-mail conectado. Portanto:
--  * "enviada" significa que o atendente abriu o WhatsApp (wa.me) com o texto e registrou aqui — não há confirmação de entrega nem de leitura (`delivery = 'whatsapp_opened'`);
--  * "recebida" é o registro manual da resposta do contato (`delivery = 'registered'`);
--  * mensagem agendada NÃO é enviada sozinha: no horário ela vira lembrete (tarefa do CRM para o responsável) e fica "pronta para enviar" na tela.
-- Escrita só por função (security definer, com checagem do chamador); leitura por RLS (papéis do CRM na unidade, igual às oportunidades). Mensagens são imutáveis.

-- ---------------------------------------------------------------- tabelas
create table public.crm_conversations (
  id uuid primary key default gen_random_uuid(),
  org_id uuid not null references public.organizations(id) on delete restrict,
  unit_id uuid not null references public.units(id) on delete restrict,
  person_id uuid not null references public.people(id) on delete cascade,
  opportunity_id uuid references public.opportunities(id) on delete set null,
  channel text not null default 'whatsapp' check (channel in ('whatsapp','phone','email')),
  status text not null default 'open' check (status in ('open','pending','resolved')),
  last_message_at timestamptz,
  last_message_preview text,
  last_message_direction text check (last_message_direction in ('inbound','outbound','note','system')),
  last_inbound_at timestamptz,
  created_by uuid references auth.users(id) on delete set null,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (org_id, person_id, channel)
);
create index crm_conv_unit_last_idx on public.crm_conversations (unit_id, last_message_at desc nulls last);
create index crm_conv_opp_idx on public.crm_conversations (opportunity_id);
create trigger crm_conversations_touch before update on public.crm_conversations for each row execute function private.touch_updated_at();

create table public.crm_conversation_participants (
  conversation_id uuid not null references public.crm_conversations(id) on delete cascade,
  user_id uuid not null references auth.users(id) on delete cascade,
  role text not null default 'collaborator' check (role in ('owner','collaborator')),
  added_by uuid references auth.users(id) on delete set null,
  added_at timestamptz not null default now(),
  primary key (conversation_id, user_id)
);
create unique index crm_conv_one_owner_uq on public.crm_conversation_participants (conversation_id) where role = 'owner';
create index crm_conv_part_user_idx on public.crm_conversation_participants (user_id);

create table public.crm_conversation_reads (
  conversation_id uuid not null references public.crm_conversations(id) on delete cascade,
  user_id uuid not null references auth.users(id) on delete cascade,
  last_read_at timestamptz not null default now(),
  primary key (conversation_id, user_id)
);

create table public.crm_messages (
  id uuid primary key default gen_random_uuid(),
  org_id uuid not null references public.organizations(id) on delete restrict,
  unit_id uuid not null references public.units(id) on delete restrict,
  conversation_id uuid not null references public.crm_conversations(id) on delete cascade,
  direction text not null check (direction in ('inbound','outbound','note','system')),
  body text not null check (length(btrim(body)) > 0 and length(body) <= 4000),
  delivery text not null default 'registered' check (delivery in ('registered','whatsapp_opened')),
  author_user_id uuid references auth.users(id) on delete set null,
  scheduled_message_id uuid,
  created_at timestamptz not null default clock_timestamp()
);
create index crm_messages_conv_idx on public.crm_messages (conversation_id, created_at, id);

create table public.crm_scheduled_messages (
  id uuid primary key default gen_random_uuid(),
  org_id uuid not null references public.organizations(id) on delete restrict,
  unit_id uuid not null references public.units(id) on delete restrict,
  conversation_id uuid not null references public.crm_conversations(id) on delete cascade,
  person_id uuid not null references public.people(id) on delete cascade,
  body text not null check (length(btrim(body)) > 0 and length(body) <= 4000),
  scheduled_for timestamptz not null,
  status text not null default 'scheduled' check (status in ('scheduled','sent','cancelled')),
  assignee_user_id uuid references auth.users(id) on delete set null,
  task_id uuid references public.crm_tasks(id) on delete set null,
  message_id uuid references public.crm_messages(id) on delete set null,
  created_by uuid references auth.users(id) on delete set null,
  created_at timestamptz not null default now(),
  sent_at timestamptz, sent_by uuid references auth.users(id) on delete set null,
  cancelled_at timestamptz, cancelled_by uuid references auth.users(id) on delete set null
);
create index crm_sched_status_idx on public.crm_scheduled_messages (status, scheduled_for);
create index crm_sched_conv_idx on public.crm_scheduled_messages (conversation_id);
create index crm_sched_assignee_idx on public.crm_scheduled_messages (assignee_user_id) where status = 'scheduled';

-- campos administrativos da ficha por nicho (validados por função; nada clínico)
alter table public.opportunities add column profile jsonb not null default '{}'::jsonb check (jsonb_typeof(profile) = 'object');

-- ---------------------------------------------------------------- RLS (leitura) e privilégios
alter table public.crm_conversations enable row level security;
alter table public.crm_conversation_participants enable row level security;
alter table public.crm_conversation_reads enable row level security;
alter table public.crm_messages enable row level security;
alter table public.crm_scheduled_messages enable row level security;
revoke all on public.crm_conversations, public.crm_conversation_participants, public.crm_conversation_reads, public.crm_messages, public.crm_scheduled_messages from anon, authenticated;
grant select on public.crm_conversations, public.crm_conversation_participants, public.crm_conversation_reads, public.crm_messages, public.crm_scheduled_messages to authenticated;

create policy crm_conv_read on public.crm_conversations for select to authenticated
  using (private.in_org(org_id) and private.has_unit_role(array['manager','ops_admin','unit_manager','sales']::public.app_role[], unit_id));
create policy crm_conv_part_read on public.crm_conversation_participants for select to authenticated
  using (exists (select 1 from public.crm_conversations c where c.id = conversation_id));
create policy crm_conv_reads_own on public.crm_conversation_reads for select to authenticated
  using (user_id = (select auth.uid()));
create policy crm_msg_read on public.crm_messages for select to authenticated
  using (private.in_org(org_id) and private.has_unit_role(array['manager','ops_admin','unit_manager','sales']::public.app_role[], unit_id));
create policy crm_sched_read on public.crm_scheduled_messages for select to authenticated
  using (private.in_org(org_id) and private.has_unit_role(array['manager','ops_admin','unit_manager','sales']::public.app_role[], unit_id));

create trigger audit_crm_conversations after insert or update or delete on public.crm_conversations
  for each row execute function private.audit_row('status','opportunity_id','channel');
create trigger audit_crm_scheduled after insert or update or delete on public.crm_scheduled_messages
  for each row execute function private.audit_row('status','scheduled_for','assignee_user_id');

-- ---------------------------------------------------------------- auxiliares internos
create or replace function private.user_label(p_user uuid) returns text
language sql stable security definer set search_path = '' as $$
  select coalesce((select ua.display_name from public.user_accounts ua where ua.user_id = p_user), 'Usuário') $$;

-- o usuário informado tem papel ativo do CRM na unidade (para receber conversa/mensagem agendada)
create or replace function private.user_crm_in_unit(p_user uuid, p_unit uuid) returns boolean
language sql stable security definer set search_path = '' as $$
  select exists (
    select 1 from public.role_assignments ra
    join public.user_accounts ua on ua.user_id = ra.user_id and ua.status = 'active'
    where ra.user_id = p_user and ra.role = any (array['manager','ops_admin','unit_manager','sales']::public.app_role[])
      and (ra.unit_id is null or ra.unit_id = p_unit)
      and ra.revoked_at is null and ra.valid_from <= now() and (ra.valid_until is null or ra.valid_until > now())) $$;

-- pode agir na conversa: participante dela OU gestor (gestor, adm. operacional, gestor de unidade)
create or replace function private.conv_can_act(p_conv uuid) returns boolean
language sql stable security definer set search_path = '' as $$
  select exists (
    select 1 from public.crm_conversations c
    where c.id = p_conv and c.org_id = private.current_org()
      and private.has_unit_role(array['manager','ops_admin','unit_manager','sales']::public.app_role[], c.unit_id)
      and (exists (select 1 from public.crm_conversation_participants cp where cp.conversation_id = c.id and cp.user_id = (select auth.uid()))
           or private.has_unit_role(array['manager','ops_admin','unit_manager']::public.app_role[], c.unit_id))) $$;

create or replace function private.conv_add_message(p_conv uuid, p_direction text, p_body text, p_delivery text, p_author uuid, p_sched uuid default null)
returns uuid language plpgsql security definer set search_path = '' as $$
declare c public.crm_conversations; v_id uuid; v_body text := btrim(p_body);
begin
  select * into c from public.crm_conversations where id = p_conv for update;
  insert into public.crm_messages (org_id, unit_id, conversation_id, direction, body, delivery, author_user_id, scheduled_message_id)
  values (c.org_id, c.unit_id, c.id, p_direction, v_body, p_delivery, p_author, p_sched) returning id into v_id;
  update public.crm_conversations set
    last_message_at = clock_timestamp(), last_message_preview = left(v_body, 160), last_message_direction = p_direction,
    last_inbound_at = case when p_direction = 'inbound' then clock_timestamp() else last_inbound_at end,
    status = case when p_direction in ('inbound','outbound') and status = 'resolved' then 'open' else status end
  where id = c.id;
  -- mensagem enviada (e só ela) entra no histórico do lead: atualiza último contato e primeira resposta da oportunidade
  if p_direction = 'outbound' then
    insert into public.interactions (org_id, person_id, unit_id, opportunity_id, channel, summary, created_by)
    values (c.org_id, c.person_id, c.unit_id, c.opportunity_id,
            case c.channel when 'phone' then 'call' when 'email' then 'email' else 'whatsapp' end,
            case when p_delivery = 'whatsapp_opened' then 'WhatsApp aberto com a mensagem (sem confirmação de envio): ' else 'Mensagem registrada na conversa: ' end || left(v_body, 200),
            p_author);
  end if;
  return v_id;
end $$;

create or replace function private.conv_system_message(p_conv uuid, p_body text) returns void
language plpgsql security definer set search_path = '' as $$
declare c public.crm_conversations;
begin
  select * into c from public.crm_conversations where id = p_conv;
  insert into public.crm_messages (org_id, unit_id, conversation_id, direction, body, delivery, author_user_id)
  values (c.org_id, c.unit_id, c.id, 'system', p_body, 'registered', (select auth.uid()));
end $$;

-- ---------------------------------------------------------------- conversa e multiatendimento
create or replace function public.crm_conversation_open(p_person uuid, p_opportunity uuid default null, p_channel text default 'whatsapp')
returns uuid language plpgsql security definer set search_path = '' as $$
declare v_org uuid := private.current_org(); v_me uuid := (select auth.uid()); v_unit uuid; v_opp public.opportunities; v_id uuid; v_new boolean := false;
begin
  if v_org is null or v_me is null then raise exception 'sem acesso' using errcode = '42501'; end if;
  if p_channel not in ('whatsapp','phone','email') then raise exception 'canal inválido'; end if;
  if not private.can_write_person(p_person) then raise exception 'sem acesso a esta pessoa' using errcode = '42501'; end if;
  if p_opportunity is not null then
    select * into v_opp from public.opportunities where id = p_opportunity and person_id = p_person and org_id = v_org;
    if not found then raise exception 'oportunidade não pertence à pessoa'; end if;
    if not private.has_unit_role(array['manager','ops_admin','unit_manager','sales']::public.app_role[], v_opp.unit_id) then raise exception 'sem acesso a esta oportunidade' using errcode = '42501'; end if;
    v_unit := v_opp.unit_id;
  else
    select unit_id into v_unit from public.people where id = p_person;
  end if;
  if v_unit is null then raise exception 'pessoa sem unidade: informe a unidade no cadastro'; end if;
  insert into public.crm_conversations (org_id, unit_id, person_id, opportunity_id, channel, created_by)
  values (v_org, v_unit, p_person, p_opportunity, p_channel, v_me)
  on conflict (org_id, person_id, channel) do nothing returning id into v_id;
  if v_id is null then
    select id into v_id from public.crm_conversations where org_id = v_org and person_id = p_person and channel = p_channel;
    if p_opportunity is not null then update public.crm_conversations set opportunity_id = p_opportunity where id = v_id and opportunity_id is distinct from p_opportunity; end if;
  else
    v_new := true;
  end if;
  if v_new then
    insert into public.crm_conversation_participants (conversation_id, user_id, role, added_by) values (v_id, v_me, 'owner', v_me);
    perform private.conv_system_message(v_id, private.user_label(v_me) || ' abriu a conversa e é a responsável.');
  end if;
  return v_id;
end $$;

create or replace function public.crm_conversation_post(p_conversation uuid, p_direction text, p_body text, p_whatsapp_opened boolean default false)
returns uuid language plpgsql security definer set search_path = '' as $$
declare v_me uuid := (select auth.uid()); v_id uuid;
begin
  if p_direction not in ('inbound','outbound','note') then raise exception 'tipo de mensagem inválido'; end if;
  if p_body is null or length(btrim(p_body)) = 0 then raise exception 'escreva a mensagem'; end if;
  if length(p_body) > 4000 then raise exception 'mensagem acima de 4000 caracteres'; end if;
  if not private.conv_can_act(p_conversation) then raise exception 'entre na conversa para responder' using errcode = '42501'; end if;
  v_id := private.conv_add_message(p_conversation, p_direction, p_body,
            case when p_direction = 'outbound' and p_whatsapp_opened then 'whatsapp_opened' else 'registered' end, v_me);
  insert into public.crm_conversation_reads (conversation_id, user_id, last_read_at) values (p_conversation, v_me, clock_timestamp())
    on conflict (conversation_id, user_id) do update set last_read_at = excluded.last_read_at;
  return v_id;
end $$;

create or replace function public.crm_conversation_join(p_conversation uuid) returns void
language plpgsql security definer set search_path = '' as $$
declare v_me uuid := (select auth.uid()); c public.crm_conversations; v_role text;
begin
  select * into c from public.crm_conversations where id = p_conversation and org_id = private.current_org();
  if not found or not private.has_unit_role(array['manager','ops_admin','unit_manager','sales']::public.app_role[], c.unit_id) then raise exception 'sem acesso' using errcode = '42501'; end if;
  if exists (select 1 from public.crm_conversation_participants where conversation_id = c.id and user_id = v_me) then return; end if;
  v_role := case when exists (select 1 from public.crm_conversation_participants where conversation_id = c.id and role = 'owner') then 'collaborator' else 'owner' end;
  insert into public.crm_conversation_participants (conversation_id, user_id, role, added_by) values (c.id, v_me, v_role, v_me);
  perform private.conv_system_message(c.id, private.user_label(v_me) || case v_role when 'owner' then ' assumiu a conversa.' else ' entrou na conversa.' end);
end $$;

create or replace function public.crm_conversation_leave(p_conversation uuid) returns void
language plpgsql security definer set search_path = '' as $$
declare v_me uuid := (select auth.uid()); c public.crm_conversations; v_role text; v_next uuid;
begin
  select * into c from public.crm_conversations where id = p_conversation and org_id = private.current_org();
  if not found or not private.has_unit_role(array['manager','ops_admin','unit_manager','sales']::public.app_role[], c.unit_id) then raise exception 'sem acesso' using errcode = '42501'; end if;
  select role into v_role from public.crm_conversation_participants where conversation_id = c.id and user_id = v_me;
  if v_role is null then return; end if;
  delete from public.crm_conversation_participants where conversation_id = c.id and user_id = v_me;
  if v_role = 'owner' then   -- o colaborador mais antigo assume; sem colaborador, a conversa volta para a fila
    select user_id into v_next from public.crm_conversation_participants where conversation_id = c.id order by added_at, user_id limit 1;
    if v_next is not null then update public.crm_conversation_participants set role = 'owner' where conversation_id = c.id and user_id = v_next; end if;
  end if;
  perform private.conv_system_message(c.id, private.user_label(v_me) || ' saiu da conversa.');
end $$;

create or replace function public.crm_conversation_add_participant(p_conversation uuid, p_user uuid) returns void
language plpgsql security definer set search_path = '' as $$
declare v_me uuid := (select auth.uid()); c public.crm_conversations;
begin
  select * into c from public.crm_conversations where id = p_conversation and org_id = private.current_org();
  if not found or not private.conv_can_act(c.id) then raise exception 'sem permissão para adicionar atendentes' using errcode = '42501'; end if;
  if not private.user_crm_in_unit(p_user, c.unit_id) then raise exception 'o usuário não atende o CRM desta unidade'; end if;
  if exists (select 1 from public.crm_conversation_participants where conversation_id = c.id and user_id = p_user) then return; end if;
  insert into public.crm_conversation_participants (conversation_id, user_id, role, added_by)
  values (c.id, p_user, case when exists (select 1 from public.crm_conversation_participants where conversation_id = c.id and role = 'owner') then 'collaborator' else 'owner' end, v_me);
  perform private.conv_system_message(c.id, private.user_label(v_me) || ' adicionou ' || private.user_label(p_user) || ' à conversa.');
end $$;

-- transferência: o novo responsável assume; o anterior sai (ou fica como colaborador com p_keep). A oportunidade e as mensagens agendadas pendentes acompanham.
create or replace function public.crm_conversation_transfer(p_conversation uuid, p_to uuid, p_keep boolean default false) returns void
language plpgsql security definer set search_path = '' as $$
declare v_me uuid := (select auth.uid()); c public.crm_conversations; v_from uuid;
begin
  select * into c from public.crm_conversations where id = p_conversation and org_id = private.current_org();
  if not found or not private.has_unit_role(array['manager','ops_admin','unit_manager','sales']::public.app_role[], c.unit_id) then raise exception 'sem acesso' using errcode = '42501'; end if;
  select user_id into v_from from public.crm_conversation_participants where conversation_id = c.id and role = 'owner';
  if not (v_from = v_me or private.has_unit_role(array['manager','ops_admin','unit_manager']::public.app_role[], c.unit_id)) then
    raise exception 'só o responsável ou um gestor transfere a conversa' using errcode = '42501'; end if;
  if not private.user_crm_in_unit(p_to, c.unit_id) then raise exception 'o usuário não atende o CRM desta unidade'; end if;
  if v_from = p_to then return; end if;
  if v_from is not null then
    if p_keep then update public.crm_conversation_participants set role = 'collaborator' where conversation_id = c.id and user_id = v_from;
    else delete from public.crm_conversation_participants where conversation_id = c.id and user_id = v_from; end if;
  end if;
  insert into public.crm_conversation_participants (conversation_id, user_id, role, added_by) values (c.id, p_to, 'owner', v_me)
    on conflict (conversation_id, user_id) do update set role = 'owner';
  if c.opportunity_id is not null then update public.opportunities set owner_user_id = p_to where id = c.opportunity_id and status = 'open'; end if;
  update public.crm_scheduled_messages set assignee_user_id = p_to where conversation_id = c.id and status = 'scheduled' and assignee_user_id is not distinct from v_from;
  update public.crm_tasks t set assignee_user_id = p_to from public.crm_scheduled_messages s
    where s.task_id = t.id and s.conversation_id = c.id and s.status = 'scheduled' and t.done_at is null;
  perform private.conv_system_message(c.id, private.user_label(v_me) || ' transferiu a conversa' || coalesce(' de ' || private.user_label(v_from), '') || ' para ' || private.user_label(p_to) || '.');
end $$;

create or replace function public.crm_conversation_set_status(p_conversation uuid, p_status text) returns void
language plpgsql security definer set search_path = '' as $$
begin
  if p_status not in ('open','pending','resolved') then raise exception 'estado inválido'; end if;
  if not private.conv_can_act(p_conversation) then raise exception 'entre na conversa para alterar o estado' using errcode = '42501'; end if;
  update public.crm_conversations set status = p_status where id = p_conversation and status <> p_status;
  perform private.conv_system_message(p_conversation, private.user_label((select auth.uid())) || ' marcou a conversa como ' || case p_status when 'open' then 'aberta' when 'pending' then 'aguardando retorno' else 'resolvida' end || '.');
end $$;

create or replace function public.crm_conversation_mark_read(p_conversation uuid) returns void
language plpgsql security definer set search_path = '' as $$
declare c public.crm_conversations;
begin
  select * into c from public.crm_conversations where id = p_conversation and org_id = private.current_org();
  if not found or not private.has_unit_role(array['manager','ops_admin','unit_manager','sales']::public.app_role[], c.unit_id) then return; end if;
  insert into public.crm_conversation_reads (conversation_id, user_id, last_read_at) values (c.id, (select auth.uid()), clock_timestamp())
    on conflict (conversation_id, user_id) do update set last_read_at = excluded.last_read_at;
end $$;

-- caixa de entrada: SECURITY INVOKER (RLS decide o que aparece). scope: mine | queue | all
create or replace function public.crm_conversations_inbox(p_scope text default 'mine', p_status text default null, p_search text default null, p_limit int default 100)
returns jsonb language plpgsql stable security invoker set search_path = '' as $$
declare v_me uuid := (select auth.uid()); v_res jsonb; v_q text := nullif(btrim(p_search), '');
begin
  if p_scope not in ('mine','queue','all') then raise exception 'escopo inválido'; end if;
  select coalesce(jsonb_agg(x.j order by x.sortkey desc), '[]'::jsonb) into v_res from (
    select coalesce(c.last_message_at, c.created_at) as sortkey, jsonb_build_object(
      'id', c.id, 'person_id', c.person_id, 'full_name', p.full_name, 'opportunity_id', c.opportunity_id, 'opportunity_title', o.title,
      'niche', pl.kind, 'stage', st.name, 'status', c.status, 'channel', c.channel, 'unit_id', c.unit_id,
      'last_message_at', c.last_message_at, 'last_message_preview', c.last_message_preview, 'last_message_direction', c.last_message_direction,
      'unread', (c.last_inbound_at is not null and (r.last_read_at is null or r.last_read_at < c.last_inbound_at)),
      'phone', (select pc.normalized from public.person_contacts pc where pc.person_id = c.person_id and pc.type = 'phone' order by pc.is_primary desc, pc.created_at limit 1),
      'participants', coalesce((select jsonb_agg(jsonb_build_object('user_id', cp.user_id, 'name', private.user_label(cp.user_id), 'role', cp.role) order by cp.role desc, cp.added_at) from public.crm_conversation_participants cp where cp.conversation_id = c.id), '[]'::jsonb),
      'scheduled_pending', (select count(*) from public.crm_scheduled_messages s where s.conversation_id = c.id and s.status = 'scheduled')
    ) as j
    from public.crm_conversations c
    join public.people p on p.id = c.person_id
    left join public.opportunities o on o.id = c.opportunity_id
    left join public.pipelines pl on pl.id = o.pipeline_id
    left join public.pipeline_stages st on st.id = o.stage_id
    left join public.crm_conversation_reads r on r.conversation_id = c.id and r.user_id = v_me
    where (p_status is null or c.status = p_status)
      and (v_q is null or p.full_name ilike '%' || v_q || '%' or c.last_message_preview ilike '%' || v_q || '%')
      and case p_scope
            when 'mine' then exists (select 1 from public.crm_conversation_participants cp where cp.conversation_id = c.id and cp.user_id = v_me)
            when 'queue' then not exists (select 1 from public.crm_conversation_participants cp where cp.conversation_id = c.id) and c.status <> 'resolved'
            else true end
    order by coalesce(c.last_message_at, c.created_at) desc
    limit greatest(1, least(coalesce(p_limit, 100), 300))
  ) x;
  return v_res;
end $$;

create or replace function public.crm_conversations_unread() returns int
language sql stable security invoker set search_path = '' as $$
  select count(*)::int from public.crm_conversations c
  join public.crm_conversation_participants cp on cp.conversation_id = c.id and cp.user_id = (select auth.uid())
  left join public.crm_conversation_reads r on r.conversation_id = c.id and r.user_id = cp.user_id
  where c.status <> 'resolved' and c.last_inbound_at is not null and (r.last_read_at is null or r.last_read_at < c.last_inbound_at) $$;

-- ---------------------------------------------------------------- mensagens agendadas (lembrete + registro; não há envio automático)
create or replace function public.crm_schedule_message(p_conversation uuid, p_body text, p_when timestamptz, p_assignee uuid default null)
returns uuid language plpgsql security definer set search_path = '' as $$
declare v_me uuid := (select auth.uid()); c public.crm_conversations; v_id uuid := gen_random_uuid(); v_task uuid; v_to uuid; v_name text;
begin
  if p_body is null or length(btrim(p_body)) = 0 then raise exception 'escreva a mensagem'; end if;
  if length(p_body) > 4000 then raise exception 'mensagem acima de 4000 caracteres'; end if;
  if p_when is null or p_when <= now() then raise exception 'escolha um horário futuro'; end if;
  if not private.conv_can_act(p_conversation) then raise exception 'entre na conversa para agendar mensagens' using errcode = '42501'; end if;
  select * into c from public.crm_conversations where id = p_conversation;
  v_to := coalesce(p_assignee, v_me);
  if not private.user_crm_in_unit(v_to, c.unit_id) then raise exception 'o responsável pelo envio não atende o CRM desta unidade'; end if;
  select full_name into v_name from public.people where id = c.person_id;
  insert into public.crm_tasks (org_id, unit_id, opportunity_id, person_id, assignee_user_id, kind, title, due_at, dedupe_key, created_by)
  values (c.org_id, c.unit_id, c.opportunity_id, c.person_id, v_to, 'reminder', 'Enviar mensagem agendada para ' || v_name, p_when, 'sched:' || v_id, v_me) returning id into v_task;
  insert into public.crm_scheduled_messages (id, org_id, unit_id, conversation_id, person_id, body, scheduled_for, assignee_user_id, task_id, created_by)
  values (v_id, c.org_id, c.unit_id, c.id, c.person_id, btrim(p_body), p_when, v_to, v_task, v_me);
  perform private.conv_system_message(c.id, private.user_label(v_me) || ' agendou uma mensagem para ' || to_char(p_when at time zone 'America/Sao_Paulo', 'DD/MM/YYYY "às" HH24:MI') || ' (lembrete para ' || private.user_label(v_to) || '; o envio é manual).');
  return v_id;
end $$;

create or replace function private.sched_can_manage(s public.crm_scheduled_messages) returns boolean
language sql stable security definer set search_path = '' as $$
  select s.org_id = private.current_org() and private.has_unit_role(array['manager','ops_admin','unit_manager','sales']::public.app_role[], s.unit_id)
     and (s.created_by = (select auth.uid()) or s.assignee_user_id = (select auth.uid()) or private.conv_can_act(s.conversation_id)) $$;

create or replace function public.crm_scheduled_cancel(p_id uuid) returns void
language plpgsql security definer set search_path = '' as $$
declare s public.crm_scheduled_messages;
begin
  select * into s from public.crm_scheduled_messages where id = p_id for update;
  if not found or not private.sched_can_manage(s) then raise exception 'sem permissão' using errcode = '42501'; end if;
  if s.status <> 'scheduled' then raise exception 'esta mensagem já foi %', case s.status when 'sent' then 'enviada' else 'cancelada' end; end if;
  update public.crm_scheduled_messages set status = 'cancelled', cancelled_at = now(), cancelled_by = (select auth.uid()), task_id = null where id = s.id;
  delete from public.crm_tasks where id = s.task_id and done_at is null;
  perform private.conv_system_message(s.conversation_id, private.user_label((select auth.uid())) || ' cancelou uma mensagem agendada para ' || to_char(s.scheduled_for at time zone 'America/Sao_Paulo', 'DD/MM/YYYY "às" HH24:MI') || '.');
end $$;

create or replace function public.crm_scheduled_reschedule(p_id uuid, p_when timestamptz) returns void
language plpgsql security definer set search_path = '' as $$
declare s public.crm_scheduled_messages;
begin
  select * into s from public.crm_scheduled_messages where id = p_id for update;
  if not found or not private.sched_can_manage(s) then raise exception 'sem permissão' using errcode = '42501'; end if;
  if s.status <> 'scheduled' then raise exception 'só mensagens agendadas podem ser remarcadas'; end if;
  if p_when is null or p_when <= now() then raise exception 'escolha um horário futuro'; end if;
  update public.crm_scheduled_messages set scheduled_for = p_when where id = s.id;
  update public.crm_tasks set due_at = p_when where id = s.task_id and done_at is null;
  perform private.conv_system_message(s.conversation_id, private.user_label((select auth.uid())) || ' remarcou uma mensagem agendada para ' || to_char(p_when at time zone 'America/Sao_Paulo', 'DD/MM/YYYY "às" HH24:MI') || '.');
end $$;

-- registra o envio (feito pelo atendente ao abrir o WhatsApp): vira mensagem enviada com `whatsapp_opened`, conclui a tarefa e entra no histórico do lead
create or replace function public.crm_scheduled_mark_sent(p_id uuid) returns uuid
language plpgsql security definer set search_path = '' as $$
declare s public.crm_scheduled_messages; v_msg uuid; v_me uuid := (select auth.uid());
begin
  select * into s from public.crm_scheduled_messages where id = p_id for update;
  if not found or not private.sched_can_manage(s) then raise exception 'sem permissão' using errcode = '42501'; end if;
  if s.status <> 'scheduled' then raise exception 'esta mensagem já foi %', case s.status when 'sent' then 'enviada' else 'cancelada' end; end if;
  v_msg := private.conv_add_message(s.conversation_id, 'outbound', s.body, 'whatsapp_opened', v_me, s.id);
  update public.crm_scheduled_messages set status = 'sent', sent_at = now(), sent_by = v_me, message_id = v_msg where id = s.id;
  update public.crm_tasks set done_at = now() where id = s.task_id and done_at is null;
  return v_msg;
end $$;

-- ---------------------------------------------------------------- ficha do lead por nicho
-- chave → null (texto livre, até 200 caracteres) ou lista de valores aceitos. Só campos administrativos: nada clínico.
create or replace function private.lead_profile_spec(p_kind text) returns jsonb
language sql immutable set search_path = '' as $$
  select case p_kind
    when 'patients' then '{"contact_reason":null,"preferred_period":["manha","tarde","noite","indiferente"],"payment_pref":["particular","convenio","a_definir"],"referred_by":null}'::jsonb
    when 'education' then '{"course_interest":null,"professional_profile":["fisioterapeuta","estudante","outro_profissional_saude","outro"],"council_registry":null,"format_pref":["online","presencial","indiferente"]}'::jsonb
    when 'partners' then '{"partnership_type":null,"organization":null,"city_uf":null,"council_registry":null}'::jsonb
    when 'companies' then '{"company_name":null,"contact_role":null,"employees_range":["ate_10","11_50","51_200","acima_200"],"program_interest":null}'::jsonb
    else '{}'::jsonb end $$;

create or replace function public.crm_lead_profile_save(p_opportunity uuid, p_profile jsonb) returns jsonb
language plpgsql security definer set search_path = '' as $$
declare o public.opportunities; v_kind text; v_spec jsonb; k text; v jsonb; v_clean jsonb := '{}'::jsonb; v_txt text;
begin
  select * into o from public.opportunities where id = p_opportunity and org_id = private.current_org();
  if not found or not private.has_unit_role(array['manager','ops_admin','unit_manager','sales']::public.app_role[], o.unit_id) then raise exception 'sem acesso' using errcode = '42501'; end if;
  if p_profile is null or jsonb_typeof(p_profile) <> 'object' then raise exception 'perfil inválido'; end if;
  select kind into v_kind from public.pipelines where id = o.pipeline_id;
  v_spec := private.lead_profile_spec(v_kind);
  for k, v in select key, value from jsonb_each(p_profile) loop
    if not v_spec ? k then raise exception 'o campo "%" não pertence ao nicho "%"', k, v_kind; end if;
    if jsonb_typeof(v) = 'null' then continue; end if;
    if jsonb_typeof(v) <> 'string' then raise exception 'o campo "%" deve ser texto', k; end if;
    v_txt := btrim(v #>> '{}');
    if v_txt = '' then continue; end if;
    if length(v_txt) > 200 then raise exception 'o campo "%" passa de 200 caracteres', k; end if;
    if jsonb_typeof(v_spec -> k) = 'array' and not (v_spec -> k) ? v_txt then raise exception 'valor inválido para "%"', k; end if;
    v_clean := v_clean || jsonb_build_object(k, v_txt);
  end loop;
  update public.opportunities set profile = v_clean where id = o.id;
  return v_clean;
end $$;

-- ---------------------------------------------------------------- permissões de execução (repetidas: GRANT zera ao redefinir)
do $$
declare f text;
begin
  foreach f in array array[
    'public.crm_conversation_open(uuid, uuid, text)', 'public.crm_conversation_post(uuid, text, text, boolean)', 'public.crm_conversation_join(uuid)',
    'public.crm_conversation_leave(uuid)', 'public.crm_conversation_add_participant(uuid, uuid)', 'public.crm_conversation_transfer(uuid, uuid, boolean)',
    'public.crm_conversation_set_status(uuid, text)', 'public.crm_conversation_mark_read(uuid)', 'public.crm_conversations_inbox(text, text, text, int)',
    'public.crm_conversations_unread()', 'public.crm_schedule_message(uuid, text, timestamptz, uuid)', 'public.crm_scheduled_cancel(uuid)',
    'public.crm_scheduled_reschedule(uuid, timestamptz)', 'public.crm_scheduled_mark_sent(uuid)', 'public.crm_lead_profile_save(uuid, jsonb)'] loop
    execute format('revoke all on function %s from public, anon', f);
    execute format('grant execute on function %s to authenticated', f);
  end loop;
end $$;
