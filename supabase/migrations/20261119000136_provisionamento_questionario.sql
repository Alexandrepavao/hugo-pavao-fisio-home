-- HP Group Hub — 136 Questionário "Criar aplicativo" e motor de provisionamento (white label).
--  · o rascunho é salvo; a confirmação VALIDA TUDO NO SERVIDOR (lista fechada de chaves; nada de SQL/HTML/código aceito como configuração);
--  · idempotente por chave: repetir a solicitação reutiliza a organização e nunca duplica unidades, módulos, papéis, configurações ou convites;
--  · usa a fila de eventos JÁ existente (retentativa com recuo); cada etapa é retomável e registra tempo/erro; chamadas externas (e-mail) ficam FORA da transação SQL (Edge Function) e não desfazem o que já foi criado;
--  · aplica só o MODELO versionado do segmento (configuração inicial aprovada): nunca copia dados, pacientes, credenciais ou registros da HP.

-- ---------------------------------------------------------------- 1. configuração da plataforma
create table public.platform_settings (key text primary key, value jsonb not null, updated_at timestamptz not null default now());
alter table public.platform_settings enable row level security; revoke all on public.platform_settings from public, anon, authenticated;
insert into public.platform_settings (key, value) values
  ('base_domain', 'null'::jsonb),                       -- ex.: "app.exemplo.com.br" quando houver domínio de subdomínios; nulo no Dev
  ('reserved_subdomains', '["www","app","api","admin","plataforma","platform","login","auth","mail","status","docs","hp","hp-group","suporte","support"]'::jsonb);
update public.platform_modules set status = 'experimental', description = description || ' Atenção: a configuração inicial do módulo (frentes, finalidades, funis) ainda é a da HP e precisa de revisão para novos clientes.' where key = 'marketing';

-- ---------------------------------------------------------------- 2. solicitações e etapas
create table public.provisioning_requests (
  id uuid primary key default gen_random_uuid(), idempotency_key text not null unique check (length(idempotency_key) between 8 and 80),
  status text not null default 'draft' check (status in ('draft', 'queued', 'preparing', 'verifying', 'available', 'available_with_pending', 'failed_recoverable', 'failed')),
  org_id uuid references public.organizations(id) on delete set null, answers jsonb not null default '{}' check (jsonb_typeof(answers) = 'object' and pg_column_size(answers) < 60000),
  created_by uuid references auth.users(id) on delete set null, created_at timestamptz not null default now(), submitted_at timestamptz, started_at timestamptz, finished_at timestamptz,
  attempts int not null default 0, last_attempt_at timestamptz, last_error text check (last_error is null or length(last_error) <= 400), pending jsonb not null default '[]', admin_invite jsonb not null default '{"state":"not_sent"}'
);
create unique index organizations_prov_req_uq on public.organizations (provisioning_request_id) where provisioning_request_id is not null;
create table public.provisioning_steps (
  request_id uuid not null references public.provisioning_requests(id) on delete cascade, step text not null, position int not null,
  status text not null default 'pending' check (status in ('pending', 'running', 'done', 'failed', 'skipped')), attempts int not null default 0,
  started_at timestamptz, finished_at timestamptz, error text check (error is null or length(error) <= 400), result jsonb not null default '{}', primary key (request_id, step)
);
alter table public.provisioning_requests enable row level security; alter table public.provisioning_steps enable row level security;
revoke all on public.provisioning_requests, public.provisioning_steps from public, anon, authenticated;

-- ---------------------------------------------------------------- 3. validação (servidor) — lista fechada de chaves, tipos e limites
create or replace function private.prov_text_ok(p text, p_min int, p_max int) returns boolean language sql immutable set search_path = '' as $$
  select p is not null and length(btrim(p)) between p_min and p_max and p !~ '[<>]' and p !~ '[[:cntrl:]]'
$$;
create or replace function private.prov_unknown_keys(p jsonb, p_allowed text[]) returns text language sql immutable set search_path = '' as $$
  select string_agg(k, ', ') from jsonb_object_keys(case when jsonb_typeof(p) = 'object' then p else '{}'::jsonb end) k where not (k = any (p_allowed))
$$;

create or replace function private.provisioning_validate(a jsonb, p_request uuid default null) returns jsonb
language plpgsql stable security definer set search_path = '' as $$
declare e jsonb := '[]'; w jsonb := '[]'; u text; x jsonb; v_seg public.platform_segments; v_tpl public.platform_templates; v_sel text[]; v_final text[]; v_mod public.platform_modules; v_miss text[]; v_sub text; v_base text; v_plan public.platform_plans;
        v_roles text[]; v_users int := 0;
  procedure_dummy boolean;
begin
  if jsonb_typeof(a) <> 'object' then return jsonb_build_object('ok', false, 'errors', jsonb_build_array(jsonb_build_object('path', '', 'message', 'respostas inválidas'))); end if;
  u := private.prov_unknown_keys(a, array['company', 'operation', 'team', 'customers', 'modules', 'brand', 'integrations', 'plan', 'other_segments_interest']);
  if u is not null then e := e || jsonb_build_array(jsonb_build_object('path', '', 'message', 'campos não permitidos: ' || u)); end if;

  -- A — empresa
  x := a -> 'company';
  if jsonb_typeof(x) is distinct from 'object' then e := e || jsonb_build_array(jsonb_build_object('path', 'company', 'message', 'informe os dados da empresa'));
  else
    u := private.prov_unknown_keys(x, array['name', 'segment', 'responsible', 'city', 'state', 'units']); if u is not null then e := e || jsonb_build_array(jsonb_build_object('path', 'company', 'message', 'campos não permitidos: ' || u)); end if;
    if not private.prov_text_ok(x ->> 'name', 2, 80) then e := e || jsonb_build_array(jsonb_build_object('path', 'company.name', 'message', 'nome da empresa: 2 a 80 caracteres, sem < ou >')); end if;
    select * into v_seg from public.platform_segments where key = x ->> 'segment';
    if not found then e := e || jsonb_build_array(jsonb_build_object('path', 'company.segment', 'message', 'segmento desconhecido'));
    elsif v_seg.status <> 'available' then e := e || jsonb_build_array(jsonb_build_object('path', 'company.segment', 'message', 'o segmento "' || v_seg.name || '" ainda não está disponível para provisionamento (planejado): registre o interesse')); end if;
    if jsonb_typeof(x -> 'responsible') is distinct from 'object' or not private.prov_text_ok(x -> 'responsible' ->> 'name', 2, 80) or coalesce(x -> 'responsible' ->> 'email', '') !~* '^[^@\s<>]+@[^@\s<>]+\.[^@\s<>]+$' then
      e := e || jsonb_build_array(jsonb_build_object('path', 'company.responsible', 'message', 'responsável: nome e e-mail válidos'));
    end if;
    if not private.prov_text_ok(x ->> 'city', 2, 80) then e := e || jsonb_build_array(jsonb_build_object('path', 'company.city', 'message', 'cidade: 2 a 80 caracteres')); end if;
    if jsonb_typeof(x -> 'units') is distinct from 'array' or jsonb_array_length(x -> 'units') not between 1 and 20 then e := e || jsonb_build_array(jsonb_build_object('path', 'company.units', 'message', 'informe de 1 a 20 unidades'));
    elsif exists (select 1 from jsonb_array_elements(x -> 'units') un where jsonb_typeof(un) <> 'object' or not private.prov_text_ok(un ->> 'name', 2, 80) or (un ? 'city' and not private.prov_text_ok(un ->> 'city', 2, 80)) or private.prov_unknown_keys(un, array['name', 'city', 'state']) is not null) then
      e := e || jsonb_build_array(jsonb_build_object('path', 'company.units', 'message', 'cada unidade precisa de nome (2 a 80 caracteres)'));
    end if;
  end if;

  -- B — operação
  x := a -> 'operation';
  if jsonb_typeof(x) is distinct from 'object' then e := e || jsonb_build_array(jsonb_build_object('path', 'operation', 'message', 'informe a operação'));
  else
    u := private.prov_unknown_keys(x, array['services', 'modes', 'flow', 'sales_models']); if u is not null then e := e || jsonb_build_array(jsonb_build_object('path', 'operation', 'message', 'campos não permitidos: ' || u)); end if;
    if jsonb_typeof(x -> 'modes') is distinct from 'array' or jsonb_array_length(x -> 'modes') = 0 or exists (select 1 from jsonb_array_elements_text(x -> 'modes') m where m not in ('in_clinic', 'home_visit', 'remote')) then e := e || jsonb_build_array(jsonb_build_object('path', 'operation.modes', 'message', 'escolha presencial, domiciliar e/ou remoto')); end if;
    if jsonb_typeof(x -> 'services') is distinct from 'array' or jsonb_array_length(x -> 'services') not between 1 and 30 or exists (select 1 from jsonb_array_elements(x -> 'services') s where jsonb_typeof(s) <> 'string' or not private.prov_text_ok(s #>> '{}', 2, 80)) then e := e || jsonb_build_array(jsonb_build_object('path', 'operation.services', 'message', 'informe de 1 a 30 serviços (nomes de 2 a 80 caracteres)')); end if;
    if jsonb_typeof(x -> 'sales_models') is distinct from 'array' or jsonb_array_length(x -> 'sales_models') = 0 or exists (select 1 from jsonb_array_elements_text(x -> 'sales_models') m where m not in ('single', 'package', 'subscription')) then e := e || jsonb_build_array(jsonb_build_object('path', 'operation.sales_models', 'message', 'escolha venda avulsa, pacotes e/ou assinatura')); end if;
    if x ? 'flow' and not (private.prov_text_ok(x ->> 'flow', 0, 600)) then e := e || jsonb_build_array(jsonb_build_object('path', 'operation.flow', 'message', 'fluxo de atendimento: até 600 caracteres, sem < ou >')); end if;
  end if;

  -- C — equipe
  x := a -> 'team';
  if jsonb_typeof(x) is distinct from 'object' then e := e || jsonb_build_array(jsonb_build_object('path', 'team', 'message', 'informe a equipe'));
  else
    u := private.prov_unknown_keys(x, array['users_count', 'roles', 'units_scope', 'access_needs']); if u is not null then e := e || jsonb_build_array(jsonb_build_object('path', 'team', 'message', 'campos não permitidos: ' || u)); end if;
    if coalesce(x ->> 'users_count', '') !~ '^[0-9]{1,3}$' or (x ->> 'users_count')::int not between 1 and 500 then e := e || jsonb_build_array(jsonb_build_object('path', 'team.users_count', 'message', 'quantidade de usuários: 1 a 500'));
    else v_users := (x ->> 'users_count')::int; end if;
    select array_agg(r ->> 'role') into v_roles from jsonb_array_elements(coalesce((select definition -> 'roles' from public.platform_templates where segment_key = a #>> '{company,segment}' and status = 'published' order by version desc limit 1), '[]'::jsonb)) r;
    if jsonb_typeof(x -> 'roles') is distinct from 'array' or exists (select 1 from jsonb_array_elements(x -> 'roles') r where jsonb_typeof(r) <> 'object' or not ((r ->> 'role') = any (coalesce(v_roles, '{}'))) or coalesce(r ->> 'count', '') !~ '^[0-9]{1,3}$' or private.prov_unknown_keys(r, array['role', 'count']) is not null) then
      e := e || jsonb_build_array(jsonb_build_object('path', 'team.roles', 'message', 'funções inválidas para o segmento'));
    end if;
    if x ? 'access_needs' and not private.prov_text_ok(x ->> 'access_needs', 0, 600) then e := e || jsonb_build_array(jsonb_build_object('path', 'team.access_needs', 'message', 'necessidades de acesso: até 600 caracteres, sem < ou >')); end if;
  end if;

  -- D — relacionamento com clientes
  x := a -> 'customers';
  if jsonb_typeof(x) is distinct from 'object' then e := e || jsonb_build_array(jsonb_build_object('path', 'customers', 'message', 'informe o relacionamento com clientes'));
  else
    u := private.prov_unknown_keys(x, array['crm', 'capture', 'forms', 'proposals', 'portal', 'import']); if u is not null then e := e || jsonb_build_array(jsonb_build_object('path', 'customers', 'message', 'campos não permitidos: ' || u)); end if;
    if exists (select 1 from jsonb_each(x - 'import') kv where jsonb_typeof(kv.value) <> 'boolean') then e := e || jsonb_build_array(jsonb_build_object('path', 'customers', 'message', 'CRM, captação, formulários, propostas e portal: sim ou não')); end if;
    if x ? 'import' and (jsonb_typeof(x -> 'import') <> 'object' or jsonb_typeof(x -> 'import' -> 'needed') is distinct from 'boolean' or private.prov_unknown_keys(x -> 'import', array['needed', 'source', 'volume']) is not null or (x -> 'import' ? 'source' and not private.prov_text_ok(x -> 'import' ->> 'source', 0, 200))) then
      e := e || jsonb_build_array(jsonb_build_object('path', 'customers.import', 'message', 'importação: informe se é necessária e a origem'));
    end if;
  end if;

  -- E — módulos (selecionados + padrão do modelo; dependências, segmento e estado)
  select * into v_tpl from public.platform_templates where segment_key = a #>> '{company,segment}' and status = 'published' order by version desc limit 1;
  if jsonb_typeof(a -> 'modules') is distinct from 'array' then e := e || jsonb_build_array(jsonb_build_object('path', 'modules', 'message', 'selecione os módulos'));
  else
    select array_agg(distinct m) into v_sel from jsonb_array_elements_text(a -> 'modules') m;
    v_final := array(select distinct k from unnest(coalesce(v_sel, '{}') || coalesce(array(select jsonb_array_elements_text(v_tpl.definition -> 'default_modules')), '{}')) k);
    for v_mod in select * from public.platform_modules pm where pm.key = any (v_final) loop
      if v_mod.status = 'planned' then e := e || jsonb_build_array(jsonb_build_object('path', 'modules', 'message', 'o módulo "' || v_mod.name || '" é planejado e não pode ser habilitado'));
      elsif coalesce(array_length(v_mod.segments, 1), 0) > 0 and not ((a #>> '{company,segment}') = any (v_mod.segments)) then e := e || jsonb_build_array(jsonb_build_object('path', 'modules', 'message', 'o módulo "' || v_mod.name || '" não é compatível com este segmento'));
      end if;
      if v_mod.status = 'experimental' then w := w || jsonb_build_array(jsonb_build_object('path', 'modules', 'message', 'o módulo "' || v_mod.name || '" é experimental')); end if;
      select array_agg(d.requires) into v_miss from public.platform_module_deps d where d.module_key = v_mod.key and not (d.requires = any (v_final)) and not exists (select 1 from public.platform_modules c where c.key = d.requires and c.core);
      if v_miss is not null then e := e || jsonb_build_array(jsonb_build_object('path', 'modules', 'message', 'o módulo "' || v_mod.name || '" depende de: ' || array_to_string(v_miss, ', '))); end if;
    end loop;
    if exists (select 1 from unnest(coalesce(v_sel, '{}')) k where not exists (select 1 from public.platform_modules pm where pm.key = k)) then e := e || jsonb_build_array(jsonb_build_object('path', 'modules', 'message', 'módulo desconhecido na seleção')); end if;
  end if;

  -- F — marca e endereço
  x := a -> 'brand';
  if jsonb_typeof(x) is distinct from 'object' then e := e || jsonb_build_array(jsonb_build_object('path', 'brand', 'message', 'informe a marca'));
  else
    u := private.prov_unknown_keys(x, array['app_name', 'logo_path', 'color_primary', 'color_accent', 'subdomain', 'custom_domain_interest', 'custom_domain']); if u is not null then e := e || jsonb_build_array(jsonb_build_object('path', 'brand', 'message', 'campos não permitidos: ' || u)); end if;
    if not private.prov_text_ok(x ->> 'app_name', 2, 60) then e := e || jsonb_build_array(jsonb_build_object('path', 'brand.app_name', 'message', 'nome do aplicativo: 2 a 60 caracteres')); end if;
    if (x ? 'color_primary' and coalesce(x ->> 'color_primary', '') !~ '^#[0-9a-fA-F]{6}$') or (x ? 'color_accent' and coalesce(x ->> 'color_accent', '') !~ '^#[0-9a-fA-F]{6}$') then e := e || jsonb_build_array(jsonb_build_object('path', 'brand', 'message', 'cores no formato #RRGGBB')); end if;
    v_sub := lower(coalesce(x ->> 'subdomain', ''));
    if v_sub !~ '^[a-z0-9][a-z0-9-]{2,30}$' or v_sub like '%--%' then e := e || jsonb_build_array(jsonb_build_object('path', 'brand.subdomain', 'message', 'subdomínio: 3 a 31 letras minúsculas, números ou hífen'));
    elsif exists (select 1 from jsonb_array_elements_text((select value from public.platform_settings where key = 'reserved_subdomains')) r where r = v_sub) then e := e || jsonb_build_array(jsonb_build_object('path', 'brand.subdomain', 'message', 'este subdomínio é reservado'));
    elsif exists (select 1 from public.organizations o where o.slug = v_sub and o.provisioning_request_id is distinct from p_request) or exists (select 1 from public.org_domains d where d.host in (v_sub || '.localhost') and d.org_id is distinct from (select org_id from public.provisioning_requests where id = p_request)) then
      e := e || jsonb_build_array(jsonb_build_object('path', 'brand.subdomain', 'message', 'este subdomínio já está em uso'));
    end if;
    if x ? 'custom_domain' and coalesce(x ->> 'custom_domain', '') !~ '^([a-z0-9]([a-z0-9-]{0,61}[a-z0-9])?\.)+[a-z]{2,}$' then e := e || jsonb_build_array(jsonb_build_object('path', 'brand.custom_domain', 'message', 'domínio próprio inválido')); end if;
  end if;

  -- G — integrações (interesse: NÃO significa conectado)
  if jsonb_typeof(a -> 'integrations') is distinct from 'array' or exists (select 1 from jsonb_array_elements_text(a -> 'integrations') i where i not in ('email', 'calendar', 'payments', 'videos', 'maps', 'messages')) then e := e || jsonb_build_array(jsonb_build_object('path', 'integrations', 'message', 'integrações inválidas'));
  else w := w || jsonb_build_array(jsonb_build_object('path', 'integrations', 'message', 'integrações selecionadas não ficam conectadas: a clínica cadastra as credenciais depois, por canal seguro')); end if;

  -- H — plano e implantação
  x := a -> 'plan';
  if jsonb_typeof(x) is distinct from 'object' then e := e || jsonb_build_array(jsonb_build_object('path', 'plan', 'message', 'informe o plano'));
  else
    u := private.prov_unknown_keys(x, array['plan_key', 'implementation', 'import_assisted', 'training']); if u is not null then e := e || jsonb_build_array(jsonb_build_object('path', 'plan', 'message', 'campos não permitidos: ' || u)); end if;
    select * into v_plan from public.platform_plans where key = x ->> 'plan_key';
    if not found or v_plan.status = 'retired' then e := e || jsonb_build_array(jsonb_build_object('path', 'plan.plan_key', 'message', 'plano desconhecido ou encerrado'));
    elsif v_plan.status = 'draft' then w := w || jsonb_build_array(jsonb_build_object('path', 'plan.plan_key', 'message', 'plano em rascunho: valores e limites ainda não definidos (nenhuma cobrança é gerada)')); end if;
    if coalesce(x ->> 'implementation', '') not in ('standard', 'assisted') then e := e || jsonb_build_array(jsonb_build_object('path', 'plan.implementation', 'message', 'implantação: padrão ou assistida')); end if;
  end if;

  if a ? 'other_segments_interest' and (jsonb_typeof(a -> 'other_segments_interest') <> 'array' or exists (select 1 from jsonb_array_elements_text(a -> 'other_segments_interest') s where not exists (select 1 from public.platform_segments ps where ps.key = s))) then e := e || jsonb_build_array(jsonb_build_object('path', 'other_segments_interest', 'message', 'segmento de interesse desconhecido')); end if;
  return jsonb_build_object('ok', jsonb_array_length(e) = 0, 'errors', e, 'warnings', w, 'modules_final', to_jsonb(coalesce(v_final, '{}')), 'template_version', v_tpl.version);
end $$;

-- ---------------------------------------------------------------- 4. aplicação do modelo versionado (configuração inicial aprovada)
create or replace function private.template_apply(p_org uuid, p_segment text, p_version int) returns jsonb
language plpgsql security definer set search_path = '' as $$
declare t public.platform_templates; pl jsonb; s text; i int; v_pipe uuid; n_pipe int := 0; n_cat int := 0;
begin
  select * into t from public.platform_templates where segment_key = p_segment and version = p_version and status = 'published';
  if not found then raise exception 'modelo não publicado: % v%', p_segment, p_version; end if;
  for pl in select * from jsonb_array_elements(t.definition -> 'pipelines') loop
    insert into public.pipelines (org_id, name, kind) values (p_org, pl ->> 'name', pl ->> 'kind') on conflict (org_id, name) do nothing returning id into v_pipe;
    if v_pipe is not null then
      i := 0;
      for s in select jsonb_array_elements_text(pl -> 'stages') loop
        i := i + 1;
        insert into public.pipeline_stages (org_id, pipeline_id, name, position, kind) values (p_org, v_pipe, s, i, case when s = pl ->> 'won' then 'won' else 'open' end);
      end loop;
      insert into public.pipeline_stages (org_id, pipeline_id, name, position, kind) values (p_org, v_pipe, 'Perdido', i + 1, 'lost');
      n_pipe := n_pipe + 1;
    end if;
    v_pipe := null;
  end loop;
  insert into public.loss_reasons (org_id, name) select p_org, r from jsonb_array_elements_text(t.definition -> 'loss_reasons') r on conflict do nothing;
  insert into public.finance_categories (org_id, name, kind) select p_org, c ->> 'name', c ->> 'kind' from jsonb_array_elements(t.definition -> 'finance_categories') c
    where not exists (select 1 from public.finance_categories f where f.org_id = p_org and f.name = c ->> 'name');
  get diagnostics n_cat = row_count;
  insert into public.adm_settings (org_id) values (p_org) on conflict do nothing;
  update public.organizations set segment_key = p_segment, template_version = p_version where id = p_org;
  return jsonb_build_object('pipelines', n_pipe, 'finance_categories', n_cat, 'template', p_segment || ' v' || p_version);
end $$;

-- ---------------------------------------------------------------- 5. pendências (o que o sistema NÃO faz sozinho) e estado final
create or replace function private.prov_pending(p_req uuid) returns jsonb language plpgsql stable security definer set search_path = '' as $$
declare r public.provisioning_requests; a jsonb; p jsonb := '[]'; i text;
begin
  select * into r from public.provisioning_requests where id = p_req; a := r.answers;
  if r.admin_invite ->> 'state' <> 'accepted' then p := p || jsonb_build_array(jsonb_build_object('key', 'admin_invite', 'label', case r.admin_invite ->> 'state' when 'sent' then 'Convite enviado: aguardando o primeiro acesso do administrador' when 'failed' then 'Convite não enviado (falha externa): reenviar' else 'Convite ao administrador ainda não enviado' end, 'external', true)); end if;
  for i in select jsonb_array_elements_text(coalesce(a -> 'integrations', '[]')) loop p := p || jsonb_build_array(jsonb_build_object('key', 'integration_' || i, 'label', 'Conectar ' || case i when 'email' then 'e-mail próprio' when 'calendar' then 'calendário' when 'payments' then 'pagamentos' when 'videos' then 'vídeos' when 'maps' then 'mapas' else 'mensagens' end || ' (pela própria clínica)', 'external', true)); end loop;
  if (a #>> '{customers,import,needed}') = 'true' then p := p || jsonb_build_array(jsonb_build_object('key', 'import', 'label', 'Importação de dados a combinar e revisar', 'external', true)); end if;
  if (a #>> '{plan,training}') = 'true' then p := p || jsonb_build_array(jsonb_build_object('key', 'training', 'label', 'Treinamento a agendar', 'external', true)); end if;
  if coalesce(a #>> '{brand,custom_domain}', '') <> '' then p := p || jsonb_build_array(jsonb_build_object('key', 'custom_domain', 'label', 'Domínio próprio: verificação de posse pendente (DNS)', 'external', true)); end if;
  p := p || jsonb_build_array(jsonb_build_object('key', 'services', 'label', 'Cadastrar serviços e preços (a plataforma não inventa valores)', 'external', false));
  return p;
end $$;

-- ---------------------------------------------------------------- 6. etapas (cada uma idempotente)
create or replace function private.prov_step(p_req uuid, p_step text) returns jsonb language plpgsql security definer set search_path = '' as $$
declare r public.provisioning_requests; a jsonb; v_org uuid; u jsonb; n int := 0; v_sub text; v_final text[]; k text; v_tpl public.platform_templates; v_base text; v_email text; res jsonb := '{}'; v_checks text[] := '{}';
begin
  select * into r from public.provisioning_requests where id = p_req; a := r.answers; v_org := r.org_id; v_sub := lower(a #>> '{brand,subdomain}');
  select * into v_tpl from public.platform_templates where segment_key = a #>> '{company,segment}' and status = 'published' order by version desc limit 1;
  if p_step = 'template' then
    res := private.template_apply(v_org, v_tpl.segment_key, v_tpl.version);
  elsif p_step = 'units' then
    for u in select * from jsonb_array_elements(a #> '{company,units}') loop
      insert into public.units (org_id, name, slug, city, state) values (v_org, u ->> 'name', private.prov_slug(u ->> 'name', v_org), coalesce(u ->> 'city', a #>> '{company,city}'), nullif(u ->> 'state', ''))
        on conflict do nothing;
    end loop;
    select count(*) into n from public.units where org_id = v_org; res := jsonb_build_object('units', n);
  elsif p_step = 'modules' then
    v_final := array(select jsonb_array_elements_text(private.provisioning_validate(a, p_req) -> 'modules_final'));
    foreach k in array v_final loop
      insert into public.org_modules (org_id, module_key, enabled, source) select v_org, k, true, 'template' where exists (select 1 from public.platform_modules where key = k and not core) on conflict (org_id, module_key) do nothing; n := n + 1;
    end loop;
    res := jsonb_build_object('modules', v_final);
  elsif p_step = 'brand' then
    insert into public.org_settings (org_id, app_name, legal_name, color_primary, color_accent, support_email, timezone, locale)
      values (v_org, a #>> '{brand,app_name}', a #>> '{company,name}', nullif(a #>> '{brand,color_primary}', ''), nullif(a #>> '{brand,color_accent}', ''), a #>> '{company,responsible,email}',
              coalesce(v_tpl.definition #>> '{settings,timezone}', 'America/Sao_Paulo'), coalesce(v_tpl.definition #>> '{settings,locale}', 'pt-BR'))
      on conflict (org_id) do nothing;
    if coalesce(a #>> '{brand,logo_path}', '') <> '' and split_part(a #>> '{brand,logo_path}', '/', 1) = v_org::text then update public.org_settings set logo_path = a #>> '{brand,logo_path}' where org_id = v_org and logo_path is null; end if;
    insert into public.org_subscriptions (org_id, plan_key, status, implementation_status) values (v_org, a #>> '{plan,plan_key}', 'trial', case when a #>> '{plan,implementation}' = 'assisted' then 'in_progress' else 'pending' end) on conflict (org_id) do nothing;
  elsif p_step = 'admin' then
    v_email := lower(btrim(a #>> '{company,responsible,email}'));
    if exists (select 1 from auth.users where lower(email) = v_email and email_confirmed_at is not null) then
      if not exists (select 1 from public.invitations where org_id = v_org and email = v_email::extensions.citext and role = 'manager' and accepted_at is null and revoked_at is null) then
        insert into public.invitations (org_id, email, role, invited_by, expires_at) values (v_org, v_email, 'manager', r.created_by, now() + interval '30 days');
      end if;
      res := jsonb_build_object('mode', 'existing_user');
    else
      insert into private.manager_bootstrap_emails (org_id, email) values (v_org, v_email::extensions.citext) on conflict do nothing;     -- o gestor nasce quando o e-mail for confirmado (Auth)
      res := jsonb_build_object('mode', 'new_user');
    end if;
  elsif p_step = 'domain' then
    v_base := nullif(trim(both '"' from (select value::text from public.platform_settings where key = 'base_domain')), 'null');
    if v_base is null then
      insert into public.org_domains (org_id, host, kind, status, verified_at, verified_method) values (v_org, v_sub || '.localhost', 'dev', 'verified', now(), 'provisioning_dev') on conflict (host) do nothing; res := jsonb_build_object('host', v_sub || '.localhost', 'kind', 'dev');
    else
      insert into public.org_domains (org_id, host, kind, status) values (v_org, v_sub || '.' || v_base, 'subdomain', 'pending') on conflict (host) do nothing; res := jsonb_build_object('host', v_sub || '.' || v_base, 'kind', 'subdomain', 'status', 'pending');
    end if;
    if coalesce(a #>> '{brand,custom_domain}', '') <> '' then insert into public.org_domains (org_id, host, kind, status) values (v_org, lower(a #>> '{brand,custom_domain}'), 'custom', 'pending') on conflict (host) do nothing; end if;
  elsif p_step = 'verify' then
    if not exists (select 1 from public.organizations where id = v_org and segment_key is not null and template_version is not null) then v_checks := v_checks || 'modelo não aplicado'; end if;
    if (select count(*) from public.units where org_id = v_org) < 1 then v_checks := v_checks || 'nenhuma unidade'; end if;
    if not exists (select 1 from public.org_settings where org_id = v_org) then v_checks := v_checks || 'marca ausente'; end if;
    if not exists (select 1 from public.org_subscriptions where org_id = v_org) then v_checks := v_checks || 'assinatura ausente'; end if;
    if not exists (select 1 from public.org_domains where org_id = v_org and kind <> 'custom') then v_checks := v_checks || 'endereço de acesso ausente'; end if;
    if not exists (select 1 from public.pipelines where org_id = v_org and kind = 'patients') then v_checks := v_checks || 'funil de pacientes ausente'; end if;
    if exists (select 1 from public.org_modules om join public.platform_module_deps d on d.module_key = om.module_key where om.org_id = v_org and om.enabled and not private.module_enabled_for(v_org, d.requires)) then v_checks := v_checks || 'dependência de módulo não satisfeita'; end if;
    if not (exists (select 1 from private.manager_bootstrap_emails b where b.org_id = v_org) or exists (select 1 from public.invitations i where i.org_id = v_org and i.role = 'manager') or exists (select 1 from public.role_assignments ra where ra.org_id = v_org and ra.role = 'manager' and ra.revoked_at is null)) then v_checks := v_checks || 'administrador não preparado'; end if;
    if array_length(v_checks, 1) is not null then raise exception 'verificação falhou: %', array_to_string(v_checks, '; '); end if;
    res := jsonb_build_object('checks', 8, 'ok', true);
  else raise exception 'etapa desconhecida: %', p_step; end if;
  return res;
end $$;

create or replace function private.prov_slug(p_name text, p_org uuid) returns text language plpgsql stable security definer set search_path = '' as $$
declare b text := trim(both '-' from regexp_replace(lower(translate(p_name, 'áàâãäéèêëíìîïóòôõöúùûüçñ', 'aaaaaeeeeiiiiooooouuuucn')), '[^a-z0-9]+', '-', 'g')); c text; i int := 1;
begin
  if b = '' then b := 'unidade'; end if; c := b;
  while exists (select 1 from public.units where org_id = p_org and slug = c) loop i := i + 1; c := b || '-' || i; end loop;
  return c;
end $$;

-- ---------------------------------------------------------------- 7. motor: etapas em ordem, retomável, com tempo e erro por etapa
create or replace function private.prov_run(p_req uuid) returns text language plpgsql security definer set search_path = '' as $$
declare r public.provisioning_requests; st record; v_steps text[] := array['template', 'units', 'modules', 'brand', 'admin', 'domain', 'verify']; s text; i int := 0; v_res jsonb; v_t0 timestamptz; v_failed boolean := false; v_pend jsonb;
begin
  select * into r from public.provisioning_requests where id = p_req for update;
  if r.status in ('available', 'available_with_pending') then return r.status; end if;                                   -- idempotente: já concluída
  if r.org_id is null then raise exception 'solicitação sem organização (confirme a criação primeiro)'; end if;
  if r.attempts >= 6 then update public.provisioning_requests set status = 'failed' where id = p_req; return 'failed'; end if;
  update public.provisioning_requests set status = 'preparing', started_at = coalesce(started_at, now()), attempts = attempts + 1, last_attempt_at = now(), last_error = null where id = p_req;
  foreach s in array v_steps loop
    i := i + 1;
    insert into public.provisioning_steps (request_id, step, position) values (p_req, s, i) on conflict do nothing;
    select * into st from public.provisioning_steps where request_id = p_req and step = s;
    if st.status = 'done' then continue; end if;
    if s = 'verify' then update public.provisioning_requests set status = 'verifying' where id = p_req; end if;
    v_t0 := clock_timestamp();
    update public.provisioning_steps set status = 'running', attempts = attempts + 1, started_at = v_t0, error = null where request_id = p_req and step = s;
    begin
      v_res := private.prov_step(p_req, s);
      update public.provisioning_steps set status = 'done', finished_at = clock_timestamp(), result = coalesce(v_res, '{}') where request_id = p_req and step = s;
    exception when others then
      update public.provisioning_steps set status = 'failed', finished_at = clock_timestamp(), error = left(sqlerrm, 400) where request_id = p_req and step = s;
      update public.provisioning_requests set status = 'failed_recoverable', last_error = left(s || ': ' || sqlerrm, 400) where id = p_req;
      v_failed := true; exit;
    end;
  end loop;
  if v_failed then return 'failed_recoverable'; end if;
  v_pend := private.prov_pending(p_req);
  update public.provisioning_requests set pending = v_pend, finished_at = now(), status = case when jsonb_array_length(v_pend) = 0 then 'available' else 'available_with_pending' end where id = p_req;
  update public.organizations set status = 'active', provisioned_at = now() where id = r.org_id;
  perform private.platform_audit('provisioning.done', r.org_id, 'provisioning', p_req::text, jsonb_build_object('pending', jsonb_array_length(v_pend)));
  return (select status from public.provisioning_requests where id = p_req);
end $$;

create or replace function private.h_provisioning_requested(p_event uuid) returns void language plpgsql security definer set search_path = '' as $$
declare e public.domain_events; v_res text;
begin
  select * into e from public.domain_events where id = p_event;
  v_res := private.prov_run((e.payload ->> 'request_id')::uuid);
  -- NÃO levanta erro quando uma etapa falha: o motor de eventos desfaria também o registro do progresso/erro. A retentativa vem do job prov_retry_tick (recuo exponencial) ou do botão do painel.
end $$;

create or replace function private.prov_retry_tick() returns int language plpgsql security definer set search_path = '' as $$
declare r record; n int := 0;
begin
  for r in select id from public.provisioning_requests where status = 'failed_recoverable' and attempts < 6 and last_attempt_at <= now() - make_interval(mins => power(2, attempts)::int) order by last_attempt_at limit 5 loop
    update public.provisioning_steps set status = 'pending' where request_id = r.id and status = 'failed';
    perform private.prov_run(r.id); n := n + 1;
  end loop;
  return n;
end $$;
select cron.schedule('provisioning-retry', '* * * * *', $cron$select private.prov_retry_tick()$cron$);
insert into private.event_handlers values ('provisioning.requested', 'h_provisioning_requested') on conflict do nothing;

-- ---------------------------------------------------------------- 8. API da plataforma (somente administradores da plataforma)
create or replace function public.provisioning_draft_save(p_key text, p_answers jsonb) returns jsonb language plpgsql security definer set search_path = '' as $$
declare r public.provisioning_requests;
begin
  perform private.require_platform_admin();
  if jsonb_typeof(p_answers) <> 'object' or pg_column_size(p_answers) > 60000 then raise exception 'respostas inválidas'; end if;
  if private.prov_unknown_keys(p_answers, array['company', 'operation', 'team', 'customers', 'modules', 'brand', 'integrations', 'plan', 'other_segments_interest']) is not null then raise exception 'campos não permitidos no rascunho'; end if;
  insert into public.provisioning_requests (idempotency_key, answers, created_by) values (p_key, p_answers, (select auth.uid()))
    on conflict (idempotency_key) do update set answers = case when public.provisioning_requests.status = 'draft' then excluded.answers else public.provisioning_requests.answers end returning * into r;
  return jsonb_build_object('id', r.id, 'status', r.status, 'saved', r.status = 'draft');
end $$;

create or replace function public.provisioning_validate(p_key text) returns jsonb language plpgsql stable security definer set search_path = '' as $$
declare r public.provisioning_requests;
begin
  perform private.require_platform_admin();
  select * into r from public.provisioning_requests where idempotency_key = p_key; if not found then raise exception 'rascunho não encontrado'; end if;
  return private.provisioning_validate(r.answers, r.id);
end $$;

create or replace function public.provisioning_submit(p_key text) returns jsonb language plpgsql security definer set search_path = '' as $$
declare r public.provisioning_requests; v jsonb; v_org uuid; v_slug text;
begin
  perform private.require_platform_admin();
  select * into r from public.provisioning_requests where idempotency_key = p_key for update; if not found then raise exception 'rascunho não encontrado'; end if;
  if r.status <> 'draft' then return jsonb_build_object('id', r.id, 'status', r.status, 'org_id', r.org_id, 'reused', true); end if;                     -- repetir NÃO recria nada
  v := private.provisioning_validate(r.answers, r.id);
  if not (v ->> 'ok')::boolean then raise exception 'respostas inválidas: %', (select string_agg(x ->> 'message', '; ') from jsonb_array_elements(v -> 'errors') x) using errcode = 'P0013'; end if;
  v_slug := lower(r.answers #>> '{brand,subdomain}');
  insert into public.organizations (name, slug, status, segment_key, provisioning_request_id) values (r.answers #>> '{company,name}', v_slug, 'provisioning', r.answers #>> '{company,segment}', r.id)
    on conflict (provisioning_request_id) where provisioning_request_id is not null do update set name = excluded.name returning id into v_org;
  update public.provisioning_requests set status = 'queued', org_id = v_org, submitted_at = now() where id = r.id;
  perform private.platform_audit('provisioning.submit', v_org, 'provisioning', r.id::text, jsonb_build_object('segment', r.answers #>> '{company,segment}'));
  perform private.emit_event(v_org, 'provisioning.requested', 'provisioning', r.id, jsonb_build_object('request_id', r.id), 'provisioning:' || r.id);
  return jsonb_build_object('id', r.id, 'status', (select status from public.provisioning_requests where id = r.id), 'org_id', v_org, 'reused', false);
exception when unique_violation then raise exception 'subdomínio ou organização já existente' using errcode = 'P0013';
end $$;

create or replace function public.provisioning_retry(p_id uuid) returns jsonb language plpgsql security definer set search_path = '' as $$
declare r public.provisioning_requests; v_res text;
begin
  perform private.require_platform_admin();
  select * into r from public.provisioning_requests where id = p_id; if not found then raise exception 'solicitação não encontrada'; end if;
  if r.status not in ('failed_recoverable', 'failed', 'queued') then raise exception 'esta solicitação não precisa de nova tentativa (%)', r.status; end if;
  update public.provisioning_requests set attempts = least(attempts, 5) where id = p_id and status = 'failed';
  update public.provisioning_steps set status = 'pending' where request_id = p_id and status = 'failed';
  update public.provisioning_requests set status = 'queued' where id = p_id;
  v_res := private.prov_run(p_id);
  perform private.platform_audit('provisioning.retry', r.org_id, 'provisioning', p_id::text, jsonb_build_object('result', v_res));
  return public.provisioning_get(p_id);
end $$;

create or replace function public.provisioning_get(p_id uuid) returns jsonb language plpgsql stable security definer set search_path = '' as $$
declare r public.provisioning_requests;
begin
  perform private.require_platform_admin();
  select * into r from public.provisioning_requests where id = p_id; if not found then raise exception 'solicitação não encontrada'; end if;
  return jsonb_build_object('id', r.id, 'status', r.status, 'org_id', r.org_id, 'attempts', r.attempts, 'last_error', r.last_error, 'created_at', r.created_at, 'submitted_at', r.submitted_at, 'started_at', r.started_at, 'finished_at', r.finished_at,
    'internal_ms', (select coalesce(round(sum(extract(epoch from (finished_at - started_at)) * 1000)), 0) from public.provisioning_steps where request_id = p_id and finished_at is not null),
    'steps', coalesce((select jsonb_agg(jsonb_build_object('step', s.step, 'status', s.status, 'attempts', s.attempts, 'error', s.error, 'ms', case when s.finished_at is not null then round(extract(epoch from (s.finished_at - s.started_at)) * 1000) end) order by s.position) from public.provisioning_steps s where s.request_id = p_id), '[]'),
    'pending', case when r.status in ('available', 'available_with_pending') then private.prov_pending(p_id) else r.pending end, 'admin_invite', r.admin_invite, 'answers_summary', jsonb_build_object('company', r.answers #>> '{company,name}', 'segment', r.answers #>> '{company,segment}', 'subdomain', r.answers #>> '{brand,subdomain}'));
end $$;

create or replace function public.provisioning_list() returns jsonb language plpgsql stable security definer set search_path = '' as $$
begin
  perform private.require_platform_admin();
  return coalesce((select jsonb_agg(jsonb_build_object('id', r.id, 'key', r.idempotency_key, 'status', r.status, 'org_id', r.org_id, 'company', r.answers #>> '{company,name}', 'segment', r.answers #>> '{company,segment}', 'created_at', r.created_at, 'finished_at', r.finished_at, 'attempts', r.attempts) order by r.created_at desc)
                     from (select * from public.provisioning_requests order by created_at desc limit 200) r), '[]'::jsonb);
end $$;

create or replace function public.provisioning_draft_get(p_key text) returns jsonb language plpgsql stable security definer set search_path = '' as $$
declare r public.provisioning_requests;
begin
  perform private.require_platform_admin();
  select * into r from public.provisioning_requests where idempotency_key = p_key; if not found then return jsonb_build_object('found', false); end if;
  return jsonb_build_object('found', true, 'id', r.id, 'status', r.status, 'answers', r.answers);
end $$;

-- ---------------------------------------------------------------- 9. convite do administrador (execução externa FORA da transação: Edge Function com service_role)
create or replace function public.provisioning_invite_prepare(p_id uuid) returns jsonb language plpgsql security definer set search_path = '' as $$
declare r public.provisioning_requests; v_email text; v_brand text;
begin
  select * into r from public.provisioning_requests where id = p_id; if not found then raise exception 'solicitação não encontrada'; end if;
  if r.status not in ('available', 'available_with_pending') then return jsonb_build_object('status', 'not_ready'); end if;
  if r.admin_invite ->> 'state' = 'accepted' then return jsonb_build_object('status', 'already_accepted'); end if;
  v_email := lower(btrim(r.answers #>> '{company,responsible,email}')); v_brand := coalesce(r.answers #>> '{brand,app_name}', r.answers #>> '{company,name}');
  return jsonb_build_object('status', 'ready', 'email', v_email, 'brand', v_brand, 'org_id', r.org_id, 'existing_user', exists (select 1 from auth.users where lower(email) = v_email and email_confirmed_at is not null),
    'subdomain', r.answers #>> '{brand,subdomain}');
end $$;
create or replace function public.provisioning_invite_result(p_id uuid, p_state text, p_error text default null) returns void language plpgsql security definer set search_path = '' as $$
begin
  if p_state not in ('sent', 'failed', 'accepted', 'notified') then raise exception 'estado inválido'; end if;
  update public.provisioning_requests set admin_invite = jsonb_build_object('state', p_state, 'at', now(), 'error', left(p_error, 80)), pending = private.prov_pending(id) where id = p_id;
  update public.provisioning_requests set pending = private.prov_pending(id) where id = p_id;
end $$;

-- ---------------------------------------------------------------- 10. quem JÁ tem conta recebe o vínculo pelo aceite autenticado (sem duplicar conta, sem tocar na senha)
create or replace function public.my_pending_invitations() returns jsonb language plpgsql stable security definer set search_path = '' as $$
declare v_uid uuid := (select auth.uid()); v_email text;
begin
  if v_uid is null then raise exception 'sem permissão' using errcode = '42501'; end if;
  select lower(email) into v_email from auth.users where id = v_uid and email_confirmed_at is not null;
  return coalesce((select jsonb_agg(jsonb_build_object('id', i.id, 'org_name', coalesce(s.app_name, o.name), 'role', i.role, 'expires_at', i.expires_at) order by i.created_at)
                     from public.invitations i join public.organizations o on o.id = i.org_id left join public.org_settings s on s.org_id = i.org_id
                    where v_email is not null and lower(i.email::text) = v_email and i.accepted_at is null and i.revoked_at is null and i.expires_at > now()
                      and not exists (select 1 from public.org_memberships m where m.user_id = v_uid and m.org_id = i.org_id and m.status = 'active')), '[]'::jsonb);
end $$;
create or replace function public.invitation_accept(p_id uuid) returns jsonb language plpgsql security definer set search_path = '' as $$
declare v_uid uuid := (select auth.uid()); v_email text; i public.invitations;
begin
  if v_uid is null then raise exception 'sem permissão' using errcode = '42501'; end if;
  select lower(email) into v_email from auth.users where id = v_uid and email_confirmed_at is not null;
  select * into i from public.invitations where id = p_id for update;
  if not found or v_email is null or lower(i.email::text) <> v_email or i.accepted_at is not null or i.revoked_at is not null or i.expires_at <= now() then raise exception 'convite inválido ou expirado' using errcode = '42501'; end if;
  insert into public.org_memberships (user_id, org_id, person_id, status, is_default) values (v_uid, i.org_id, i.person_id, 'active', not exists (select 1 from public.org_memberships x where x.user_id = v_uid and x.is_default))
    on conflict (user_id, org_id) do update set status = 'active', person_id = coalesce(public.org_memberships.person_id, excluded.person_id);
  insert into public.user_accounts (user_id, org_id, person_id) values (v_uid, i.org_id, i.person_id) on conflict (user_id) do nothing;         -- 1º vínculo continua espelhado; os demais ficam só em org_memberships
  insert into public.role_assignments (org_id, user_id, role, unit_id, granted_by) values (i.org_id, v_uid, i.role, i.unit_id, i.invited_by) on conflict do nothing;
  update public.invitations set accepted_at = now() where id = p_id;
  update public.provisioning_requests set admin_invite = jsonb_build_object('state', 'accepted', 'at', now()), pending = private.prov_pending(id) where org_id = i.org_id and i.role = 'manager';
  return jsonb_build_object('org_id', i.org_id, 'role', i.role);
end $$;

revoke all on function private.prov_text_ok(text, int, int), private.prov_unknown_keys(jsonb, text[]), private.provisioning_validate(jsonb, uuid), private.template_apply(uuid, text, int), private.prov_pending(uuid), private.prov_step(uuid, text),
  private.prov_slug(text, uuid), private.prov_run(uuid), private.h_provisioning_requested(uuid), private.prov_retry_tick() from public, anon, authenticated;
revoke all on function public.provisioning_draft_save(text, jsonb), public.provisioning_validate(text), public.provisioning_submit(text), public.provisioning_retry(uuid), public.provisioning_get(uuid), public.provisioning_list(),
  public.provisioning_draft_get(text), public.provisioning_invite_prepare(uuid), public.provisioning_invite_result(uuid, text, text), public.my_pending_invitations(), public.invitation_accept(uuid) from public, anon, authenticated;
grant execute on function public.provisioning_draft_save(text, jsonb), public.provisioning_validate(text), public.provisioning_submit(text), public.provisioning_retry(uuid), public.provisioning_get(uuid), public.provisioning_list(),
  public.provisioning_draft_get(text), public.my_pending_invitations(), public.invitation_accept(uuid) to authenticated;
grant execute on function public.provisioning_invite_prepare(uuid), public.provisioning_invite_result(uuid, text, text) to service_role;
