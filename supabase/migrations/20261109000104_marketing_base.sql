-- HP Group Hub — 104 Marketing (base): configuração, conexões de plataformas, contas, campanhas, classificação interna, gastos, execuções de sincronização.
--
-- PRINCÍPIOS (docs/marketing-campanhas.md):
--   • Leitura de plataformas (Meta Ads / Google Ads) SOMENTE. Nada aqui cria, pausa ou altera anúncios. "Acompanhar no Hub" nunca mexe na campanha externa.
--   • Objetivo/status ORIGINAIS da plataforma ficam em colunas próprias; a classificação comercial interna (frente, finalidade, produto, funil, unidade, resultado principal) é outra tabela, com histórico.
--   • Campanha nova nasce "Aguardando classificação" (nada é inferido pelo nome).
--   • Frentes e finalidades são cadastros configuráveis por organização (sem enum específico da HP → white label).
--   • Credenciais: tabela própria SEM política de acesso (só a Edge Function, com a service role, lê/grava), criptografadas pela função antes de gravar.
--   • Sem acesso a dados: nunca "zero" — a cobertura de dias (mkt_day_status) diz o que foi de fato coletado.
--   • Custo/gasto canônico = campanha × dia (mkt_spend_daily). Conjunto/anúncio (mkt_entity_daily) e posicionamento/dispositivo (mkt_breakdown_daily) NUNCA entram na soma do total.

-- ---------------------------------------------------------------- catálogo de resultados suportados (global; o admin escolhe entre eles)
create table public.mkt_event_types (
  key text primary key, label text not null, description text not null, position int not null
);
insert into public.mkt_event_types (key, label, description, position) values
  ('lead', 'Lead', 'Pessoa única que enviou formulário/quiz com origem rastreada.', 1),
  ('qualified_lead', 'Lead qualificado', 'Oportunidade que chegou a uma etapa do funil marcada como “qualificação” em Configurações (Marketing).', 2),
  ('opportunity', 'Oportunidade criada', 'Oportunidade criada no CRM.', 3),
  ('scheduled', 'Agendamento', 'Atendimento marcado para a pessoa depois da oportunidade.', 4),
  ('evaluation_done', 'Avaliação realizada', 'Atendimento realizado de um serviço marcado como “avaliação” em Configurações (Marketing).', 5),
  ('attended', 'Atendimento realizado', 'Qualquer atendimento realizado (compareceu).', 6),
  ('partner_approved', 'Parceiro aprovado', 'Parceiro com cadastro aprovado depois da oportunidade.', 7),
  ('partner_active', 'Parceiro ativo', 'Parceiro aprovado que atende ao critério de atividade configurado (indicações nos últimos N dias).', 8),
  ('enrollment', 'Matrícula', 'Venda confirmada de curso ou mentoria.', 9),
  ('sale', 'Venda', 'Venda confirmada.', 10);
alter table public.mkt_event_types enable row level security;
create policy mkt_event_types_read on public.mkt_event_types for select to authenticated using (true);

-- ---------------------------------------------------------------- configurações por organização
create table public.mkt_settings (
  org_id uuid primary key references public.organizations(id) on delete cascade,
  attribution_window_days int not null default 30 check (attribution_window_days between 1 and 180),   -- janela do último toque pago antes da oportunidade
  reprocess_days int not null default 7 check (reprocess_days between 1 and 30),                         -- janela recente reprocessada a cada sincronização (revisões da plataforma)
  backfill_days int not null default 90 check (backfill_days between 1 and 540),                         -- histórico inicial ao conectar uma conta
  manual_refresh_min_minutes int not null default 15 check (manual_refresh_min_minutes between 5 and 240),
  stale_after_hours int not null default 6 check (stale_after_hours between 1 and 168),
  reporting_currency text not null default 'BRL' check (reporting_currency ~ '^[A-Z]{3}$'),
  paid_mediums text[] not null default array['cpc','ppc','paid','paid_social','paidsocial','paid-social','cpm','display','ads'],
  partner_active_days int check (partner_active_days between 1 and 365),                                  -- null = critério NÃO configurado → "parceiro ativo" indisponível
  evaluation_service_ids uuid[] not null default '{}',                                                    -- serviços que contam como "avaliação" (vazio = indisponível)
  qualified_stage_ids uuid[] not null default '{}',                                                       -- etapas do funil que significam "qualificado" (vazio = indisponível)
  config_version int not null default 1,                                                                  -- sobe a cada mudança de regra; a atribuição já calculada guarda a versão usada
  updated_by uuid references auth.users(id) on delete set null, updated_at timestamptz not null default now()
);
alter table public.mkt_settings enable row level security;

create table public.mkt_fronts (
  id uuid primary key default gen_random_uuid(),
  org_id uuid not null references public.organizations(id) on delete cascade,
  label text not null check (length(btrim(label)) between 2 and 60),
  business_line text check (business_line is null or business_line in ('physio','academy')),   -- opcional: liga ao seletor de linhas do Financeiro, quando existir equivalente
  position int not null default 0, active boolean not null default true, created_at timestamptz not null default now(),
  unique (org_id, label), unique (id, org_id)
);
create table public.mkt_purposes (
  id uuid primary key default gen_random_uuid(),
  org_id uuid not null references public.organizations(id) on delete cascade,
  label text not null check (length(btrim(label)) between 2 and 80),
  default_result text references public.mkt_event_types(key),
  position int not null default 0, active boolean not null default true, created_at timestamptz not null default now(),
  unique (org_id, label), unique (id, org_id)
);
alter table public.mkt_fronts enable row level security; alter table public.mkt_purposes enable row level security;

-- ---------------------------------------------------------------- conexões com as plataformas (uma por organização e plataforma)
create table public.mkt_connections (
  id uuid primary key default gen_random_uuid(),
  org_id uuid not null references public.organizations(id) on delete cascade,
  platform text not null check (platform in ('meta','google')),
  enabled boolean not null default false,                     -- o administrador habilita cada plataforma de forma independente
  status text not null default 'disconnected' check (status in ('disconnected','pending','active','error','reauth_required')),
  provider_user_label text, granted_scopes text[] not null default '{}', token_expires_at timestamptz, api_version text,
  connected_by uuid references auth.users(id) on delete set null, connected_at timestamptz, disconnected_at timestamptz,
  last_error text, last_error_at timestamptz, last_sync_at timestamptz, last_ok_at timestamptz,
  created_at timestamptz not null default now(),
  unique (org_id, platform), unique (id, org_id)
);
-- credenciais: SEM política e sem grant → só a service role (Edge Function) acessa. Valores já chegam criptografados (AES-GCM) da função.
create table public.mkt_credentials (
  connection_id uuid primary key references public.mkt_connections(id) on delete cascade,
  org_id uuid not null, token_enc text, refresh_token_enc text, updated_at timestamptz not null default now()
);
create table public.mkt_oauth_states (
  nonce uuid primary key, org_id uuid not null, user_id uuid not null,
  platform text not null check (platform in ('meta','google')),
  code_verifier_enc text,                                    -- PKCE (Google); criptografado
  expires_at timestamptz not null, used_at timestamptz, created_at timestamptz not null default now()
);
alter table public.mkt_connections enable row level security;
alter table public.mkt_credentials enable row level security;
alter table public.mkt_oauth_states enable row level security;
revoke all on public.mkt_credentials, public.mkt_oauth_states from anon, authenticated, public;

-- ---------------------------------------------------------------- contas de anúncios (descobertas pela API ou cadastradas manualmente)
create table public.mkt_ad_accounts (
  id uuid primary key default gen_random_uuid(),
  org_id uuid not null references public.organizations(id) on delete cascade,
  connection_id uuid references public.mkt_connections(id) on delete cascade,     -- nulo = conta manual
  platform text not null check (platform in ('meta','google')),
  origin text not null default 'api' check (origin in ('api','manual')),
  external_id text not null,                                                      -- id na plataforma (conta manual: 'manual:<uuid>')
  name text, currency text check (currency is null or currency ~ '^[A-Z]{3}$'), timezone text, platform_status text,
  login_customer_id text,                                                         -- Google: conta administradora (MCC) usada para acessar a conta cliente
  selected boolean not null default false,                                        -- o administrador escolhe quais contas o Hub acompanha
  selected_by uuid references auth.users(id) on delete set null, selected_at timestamptz,
  unit_id uuid references public.units(id) on delete set null,
  discovered_at timestamptz not null default now(), last_seen_at timestamptz,
  unique (org_id, platform, external_id), unique (id, org_id),
  check ((origin = 'api' and connection_id is not null) or (origin = 'manual' and connection_id is null))
);
-- uma conta real de plataforma só pode ser acompanhada por UMA organização (isolamento white label)
create unique index mkt_ad_accounts_one_org on public.mkt_ad_accounts (platform, external_id) where selected and origin = 'api';
alter table public.mkt_ad_accounts enable row level security;

-- ---------------------------------------------------------------- entidades importadas (objetivo/status ORIGINAIS da plataforma)
create table public.mkt_campaigns (
  id uuid primary key default gen_random_uuid(),
  org_id uuid not null references public.organizations(id) on delete cascade,
  account_id uuid not null references public.mkt_ad_accounts(id) on delete cascade,
  external_id text not null, origin text not null default 'api' check (origin in ('api','manual')),
  name text not null, platform_objective text, platform_status text, platform_created_at timestamptz, platform_updated_at timestamptz,
  first_seen_at timestamptz not null default now(), last_seen_at timestamptz,
  unique (account_id, external_id), unique (id, org_id)
);
create table public.mkt_adsets (
  id uuid primary key default gen_random_uuid(),
  org_id uuid not null references public.organizations(id) on delete cascade,
  account_id uuid not null references public.mkt_ad_accounts(id) on delete cascade,
  campaign_id uuid not null references public.mkt_campaigns(id) on delete cascade,
  external_id text not null, name text not null, platform_status text, last_seen_at timestamptz,
  unique (account_id, external_id)
);
create table public.mkt_ads (
  id uuid primary key default gen_random_uuid(),
  org_id uuid not null references public.organizations(id) on delete cascade,
  account_id uuid not null references public.mkt_ad_accounts(id) on delete cascade,
  campaign_id uuid not null references public.mkt_campaigns(id) on delete cascade,
  adset_id uuid references public.mkt_adsets(id) on delete cascade,
  external_id text not null, name text not null, platform_status text, creative_ref text, creative_name text, last_seen_at timestamptz,
  unique (account_id, external_id)
);
create index mkt_campaigns_account on public.mkt_campaigns (account_id);
create index mkt_adsets_campaign on public.mkt_adsets (campaign_id);
create index mkt_ads_campaign on public.mkt_ads (campaign_id);
alter table public.mkt_campaigns enable row level security; alter table public.mkt_adsets enable row level security; alter table public.mkt_ads enable row level security;

-- ---------------------------------------------------------------- classificação comercial INTERNA (nunca altera a campanha externa)
create table public.mkt_campaign_class (
  campaign_id uuid primary key references public.mkt_campaigns(id) on delete cascade,
  org_id uuid not null,
  state text not null default 'pending' check (state in ('pending','classified')),       -- pendente = "Aguardando classificação"
  include_in_hub boolean not null default true,                                         -- acompanhar no dashboard do Hub (não pausa nada na plataforma)
  include_in_reports boolean not null default true,                                     -- incluir nos relatórios operacionais
  front_id uuid references public.mkt_fronts(id) on delete set null,
  purpose_id uuid references public.mkt_purposes(id) on delete set null,
  product_id uuid references public.products(id) on delete set null,
  pipeline_id uuid references public.pipelines(id) on delete set null,
  unit_id uuid references public.units(id) on delete set null,
  primary_result text references public.mkt_event_types(key),
  updated_by uuid references auth.users(id) on delete set null, updated_at timestamptz not null default now(),
  check (state = 'pending' or (front_id is not null and purpose_id is not null))
);
create table public.mkt_campaign_class_history (
  id bigserial primary key, org_id uuid not null, campaign_id uuid not null references public.mkt_campaigns(id) on delete cascade,
  changed_at timestamptz not null default now(), changed_by uuid references auth.users(id) on delete set null,
  before jsonb, after jsonb not null, effect text not null
);
alter table public.mkt_campaign_class enable row level security; alter table public.mkt_campaign_class_history enable row level security;

create or replace function private.mkt_campaign_class_default() returns trigger language plpgsql security definer set search_path = '' as $$
begin
  insert into public.mkt_campaign_class (campaign_id, org_id) values (new.id, new.org_id) on conflict do nothing;   -- nasce "Aguardando classificação"
  return new;
end $$;
create trigger mkt_campaign_class_default after insert on public.mkt_campaigns for each row execute function private.mkt_campaign_class_default();

-- ---------------------------------------------------------------- gastos e métricas (canônico: campanha × dia)
create table public.mkt_spend_daily (
  id bigserial primary key,
  org_id uuid not null references public.organizations(id) on delete cascade,
  account_id uuid not null references public.mkt_ad_accounts(id) on delete cascade,
  campaign_id uuid not null references public.mkt_campaigns(id) on delete cascade,
  day date not null,                                              -- dia na timezone da CONTA de anúncios
  source text not null check (source in ('api','manual')),
  currency text not null check (currency ~ '^[A-Z]{3}$'), tz text not null,
  spend numeric(18,4) not null check (spend >= 0),
  impressions bigint check (impressions is null or impressions >= 0),
  link_clicks bigint check (link_clicks is null or link_clicks >= 0),     -- cliques CANÔNICOS: Meta = inline_link_clicks (cliques no link); Google = metrics.clicks
  clicks_all bigint check (clicks_all is null or clicks_all >= 0),        -- Meta: todos os cliques; Google: igual a metrics.clicks
  reported_results numeric(18,4),                                         -- resultado reportado PELA PLATAFORMA (não é conversão confirmada no Hub)
  reported_actions jsonb,                                                 -- detalhe por tipo de ação/conversão, como a plataforma reportou
  metric_defs jsonb,                                                      -- definição das métricas na coleta (campos, janela de atribuição, nível)
  api_version text, run_id uuid, collected_at timestamptz not null default now(),
  resolution text not null default 'active' check (resolution in ('active','superseded_by_api','superseded_by_manual')),
  manual_priority boolean not null default false,                         -- lançamento manual que o admin escolheu manter sobre a API
  note text, created_by uuid references auth.users(id) on delete set null,
  unique (org_id, account_id, campaign_id, day, source)
);
create index mkt_spend_day on public.mkt_spend_daily (org_id, day) where resolution = 'active';
create index mkt_spend_campaign on public.mkt_spend_daily (campaign_id, day);
-- detalhamento por conjunto/anúncio (comparar criativos). NUNCA somar com a campanha.
create table public.mkt_entity_daily (
  id bigserial primary key,
  org_id uuid not null references public.organizations(id) on delete cascade,
  account_id uuid not null references public.mkt_ad_accounts(id) on delete cascade,
  level text not null check (level in ('adset','ad')),
  campaign_id uuid not null references public.mkt_campaigns(id) on delete cascade,
  adset_id uuid references public.mkt_adsets(id) on delete cascade, ad_id uuid references public.mkt_ads(id) on delete cascade,
  day date not null, currency text not null check (currency ~ '^[A-Z]{3}$'),
  spend numeric(18,4) not null check (spend >= 0), impressions bigint, link_clicks bigint, reported_results numeric(18,4),
  run_id uuid, collected_at timestamptz not null default now(),
  check ((level = 'adset' and adset_id is not null and ad_id is null) or (level = 'ad' and ad_id is not null))
);
create unique index mkt_entity_daily_uq on public.mkt_entity_daily (account_id, level, coalesce(adset_id, ad_id), day);
-- detalhamento por posicionamento / dispositivo / plataforma de publicação (Facebook × Instagram). Separado dos totais canônicos.
create table public.mkt_breakdown_daily (
  id bigserial primary key,
  org_id uuid not null references public.organizations(id) on delete cascade,
  account_id uuid not null references public.mkt_ad_accounts(id) on delete cascade,
  campaign_id uuid not null references public.mkt_campaigns(id) on delete cascade,
  day date not null, kind text not null check (kind in ('publisher_platform','platform_position','device')),
  value text not null, currency text not null check (currency ~ '^[A-Z]{3}$'),
  spend numeric(18,4) not null check (spend >= 0), impressions bigint, link_clicks bigint,
  run_id uuid, collected_at timestamptz not null default now(),
  unique (account_id, campaign_id, day, kind, value)
);
alter table public.mkt_spend_daily enable row level security; alter table public.mkt_entity_daily enable row level security; alter table public.mkt_breakdown_daily enable row level security;

-- ---------------------------------------------------------------- execuções de sincronização e cobertura de dias
create table public.mkt_sync_runs (
  id uuid primary key default gen_random_uuid(),
  org_id uuid not null references public.organizations(id) on delete cascade,
  connection_id uuid references public.mkt_connections(id) on delete cascade,
  account_id uuid references public.mkt_ad_accounts(id) on delete cascade,
  kind text not null check (kind in ('scheduled','manual','backfill','reprocess','discovery')),
  window_from date, window_to date,
  status text not null default 'running' check (status in ('running','ok','partial','error','skipped')),
  started_at timestamptz not null default now(), heartbeat_at timestamptz not null default now(), finished_at timestamptz,
  rows_written int not null default 0, pages int not null default 0, retries int not null default 0,
  error_code text, error_message text, api_version text, requested_by uuid references auth.users(id) on delete set null
);
-- concorrência: no máximo UMA execução ativa por conta (e uma de descoberta por conexão)
create unique index mkt_sync_one_running_account on public.mkt_sync_runs (account_id) where status = 'running' and account_id is not null;
create unique index mkt_sync_one_running_discovery on public.mkt_sync_runs (connection_id) where status = 'running' and account_id is null;
create index mkt_sync_runs_org on public.mkt_sync_runs (org_id, started_at desc);
create table public.mkt_day_status (
  account_id uuid not null references public.mkt_ad_accounts(id) on delete cascade, day date not null,
  org_id uuid not null, status text not null check (status in ('ok','failed')), run_id uuid, collected_at timestamptz not null default now(),
  primary key (account_id, day)
);
alter table public.mkt_sync_runs enable row level security; alter table public.mkt_day_status enable row level security;

-- ---------------------------------------------------------------- RLS: leitura direta só para administradores da organização; os painéis passam por funções (escopo de unidade)
create or replace function private.mkt_admin() returns boolean language sql stable security definer set search_path = '' as $$
  select private.has_org_role(array['manager','ops_admin']::public.app_role[])
$$;
create or replace function private.mkt_reader() returns boolean language sql stable security definer set search_path = '' as $$
  select private.has_any_role(array['manager','ops_admin','unit_manager','sales']::public.app_role[])
$$;
do $$ declare t text; begin
  foreach t in array array['mkt_settings','mkt_fronts','mkt_purposes','mkt_connections','mkt_ad_accounts','mkt_campaigns','mkt_adsets','mkt_ads','mkt_campaign_class','mkt_campaign_class_history',
                           'mkt_spend_daily','mkt_entity_daily','mkt_breakdown_daily','mkt_sync_runs','mkt_day_status'] loop
    execute format('create policy %I on public.%I for select to authenticated using (org_id = private.current_org() and private.mkt_admin())', t || '_admin_read', t);
  end loop;
end $$;
-- nenhuma política de escrita: toda escrita é por função (security definer) ou pela service role
revoke all on public.mkt_settings, public.mkt_fronts, public.mkt_purposes, public.mkt_connections, public.mkt_ad_accounts, public.mkt_campaigns, public.mkt_adsets, public.mkt_ads,
  public.mkt_campaign_class, public.mkt_campaign_class_history, public.mkt_spend_daily, public.mkt_entity_daily, public.mkt_breakdown_daily, public.mkt_sync_runs, public.mkt_day_status,
  public.mkt_event_types from anon;
revoke insert, update, delete, truncate on public.mkt_settings, public.mkt_fronts, public.mkt_purposes, public.mkt_connections, public.mkt_ad_accounts, public.mkt_campaigns, public.mkt_adsets, public.mkt_ads,
  public.mkt_campaign_class, public.mkt_campaign_class_history, public.mkt_spend_daily, public.mkt_entity_daily, public.mkt_breakdown_daily, public.mkt_sync_runs, public.mkt_day_status,
  public.mkt_event_types from authenticated;

-- ---------------------------------------------------------------- padrões iniciais (editáveis; nada é aplicado a campanhas)
create or replace function private.mkt_seed_defaults(p_org uuid) returns void language plpgsql security definer set search_path = '' as $$
begin
  insert into public.mkt_settings (org_id) values (p_org) on conflict do nothing;
  if not exists (select 1 from public.mkt_fronts where org_id = p_org) then
    insert into public.mkt_fronts (org_id, label, business_line, position) values (p_org, 'HP Fisioterapia', 'physio', 1), (p_org, 'HP Academy', 'academy', 2), (p_org, 'HP Tech', null, 3);
  end if;
  if not exists (select 1 from public.mkt_purposes where org_id = p_org) then
    insert into public.mkt_purposes (org_id, label, default_result, position) values
      (p_org, 'Captar pacientes', 'evaluation_done', 1), (p_org, 'Captar parceiros', 'partner_approved', 2), (p_org, 'Vender mentoria', 'sale', 3),
      (p_org, 'Vender tecnologia', 'sale', 4), (p_org, 'Assinatura', 'sale', 5);
  end if;
  insert into public.mkt_connections (org_id, platform) values (p_org, 'meta'), (p_org, 'google') on conflict do nothing;
end $$;
revoke all on function private.mkt_seed_defaults(uuid) from public, anon, authenticated;
select private.mkt_seed_defaults(id) from public.organizations;
