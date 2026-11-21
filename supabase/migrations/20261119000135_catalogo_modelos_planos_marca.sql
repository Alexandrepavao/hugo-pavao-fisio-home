-- HP Group Hub — 135 Catálogo de módulos, segmentos/modelos versionados, planos e consumo, marca por organização, domínios e auditoria da plataforma.
-- Tudo escrito/lido por FUNÇÃO (tabelas sem GRANT). A plataforma administra o produto; NUNCA ganha acesso a dados clínicos/comerciais das organizações (só contagens e configuração).
-- Habilitação de módulo vale NO SERVIDOR: (1) o pré-request da API recusa REST/RPC de módulo desabilitado para a organização ativa; (2) políticas RESTRICTIVE nas tabelas do módulo (cobre GraphQL).
-- Desabilitar módulo NÃO apaga dados; a exportação continua incluindo os dados do módulo desabilitado (portabilidade).

-- ---------------------------------------------------------------- 1. organização: estado do ciclo de vida
alter table public.organizations add column if not exists status text not null default 'active' check (status in ('provisioning', 'active', 'suspended', 'archived'));
alter table public.organizations add column if not exists segment_key text;
alter table public.organizations add column if not exists template_version int;
alter table public.organizations add column if not exists provisioned_at timestamptz;
alter table public.organizations add column if not exists provisioning_request_id uuid;

-- ---------------------------------------------------------------- 2. auditoria da plataforma
create table public.platform_audit (
  id bigint generated always as identity primary key, at timestamptz not null default now(), actor_user_id uuid, action text not null,
  org_id uuid references public.organizations(id) on delete set null, entity_type text, entity_id text, details jsonb not null default '{}'
);
create index platform_audit_org_idx on public.platform_audit (org_id, at desc);
alter table public.platform_audit enable row level security; revoke all on public.platform_audit from public, anon, authenticated;
create or replace function private.platform_audit(p_action text, p_org uuid, p_type text, p_id text, p_details jsonb default '{}') returns void language sql security definer set search_path = '' as $$
  insert into public.platform_audit (actor_user_id, action, org_id, entity_type, entity_id, details) values ((select auth.uid()), p_action, p_org, p_type, p_id, coalesce(p_details, '{}'))
$$;
create or replace function private.require_platform_admin() returns void language plpgsql stable security definer set search_path = '' as $$
begin if not private.is_platform_admin() then raise exception 'sem permissão' using errcode = '42501'; end if; end $$;

-- ---------------------------------------------------------------- 3. segmentos, módulos, dependências e objetos protegidos
create table public.platform_segments (key text primary key, name text not null, status text not null check (status in ('available', 'experimental', 'planned')), description text, sort int not null default 100);
insert into public.platform_segments (key, name, status, description, sort) values
  ('fisioterapia', 'Fisioterapia', 'available', 'Clínica de fisioterapia (presencial, remota ou domiciliar): avaliação, plano de cuidado, sessões e pacotes, evolução, exercícios, portal do paciente.', 1),
  ('clinica_medica', 'Clínica médica', 'planned', 'Planejado: prontuário médico, agenda por especialidade, convênios. Não provisionável.', 2),
  ('odontologia', 'Odontologia', 'planned', 'Planejado: odontograma, plano de tratamento por dente. Não provisionável.', 3),
  ('psicologia', 'Psicologia', 'planned', 'Planejado: prontuário psicológico com sigilo reforçado. Não provisionável.', 4),
  ('estetica', 'Estética', 'planned', 'Planejado: protocolos, fotos antes/depois, pacotes. Não provisionável.', 5),
  ('mentoria', 'Mentoria/consultoria', 'planned', 'Planejado: turmas, entregáveis e acompanhamento (parte já existe no Academy). Não provisionável.', 6),
  ('advocacia', 'Advocacia', 'planned', 'Planejado: processos, prazos, honorários. Não provisionável.', 7),
  ('imobiliaria', 'Imobiliária', 'planned', 'Planejado: imóveis, propostas, contratos. Não provisionável.', 8),
  ('condominios', 'Condomínios', 'planned', 'Planejado: unidades, cobranças, assembleias. Não provisionável.', 9);

create table public.platform_modules (
  key text primary key, name text not null, description text, version text not null default '1.0.0',
  status text not null check (status in ('available', 'experimental', 'planned')), core boolean not null default false,
  segments text[] not null default '{}',                        -- vazio = compatível com todos os segmentos disponíveis
  enforcement text not null default 'none' check (enforcement in ('none', 'rls_rpc')),   -- 'rls_rpc' = a habilitação é imposta pelo servidor (API + RLS); 'none' = só papéis/menus (limitação declarada)
  routes text[] not null default '{}', permissions text[] not null default '{}', settings jsonb not null default '{}', usage_metrics text[] not null default '{}', sort int not null default 100
);
create table public.platform_module_deps (module_key text not null references public.platform_modules(key) on delete cascade, requires text not null references public.platform_modules(key) on delete restrict, primary key (module_key, requires), check (module_key <> requires));
create table public.platform_module_objects (
  module_key text not null references public.platform_modules(key) on delete cascade, kind text not null check (kind in ('table', 'table_like', 'rpc', 'rpc_like')), pattern text not null, primary key (module_key, kind, pattern)
);

insert into public.platform_modules (key, name, description, status, core, enforcement, routes, permissions, usage_metrics, sort) values
  ('core', 'Base comum', 'Identidade, convites, permissões, pessoas e empresas, unidades, configurações, marca e notificações.', 'available', true, 'none', '{/admin/configuracoes,/admin/equipe}', '{manager,ops_admin}', '{usuarios}', 1),
  ('crm', 'CRM e captação', 'Funis, oportunidades, tarefas, listas, importação, formulários e páginas de captação.', 'available', false, 'none', '{/admin/crm}', '{sales,manager}', '{}', 2),
  ('agenda', 'Agenda', 'Serviços, disponibilidade, agendamentos, confirmações e lista de espera.', 'available', false, 'none', '{/admin/agenda}', '{physio,manager}', '{}', 3),
  ('financeiro', 'Financeiro operacional', 'Vendas, parcelas, recebimentos, contas a pagar, conciliação e DRE da clínica (não é a cobrança da plataforma).', 'available', false, 'none', '{/admin/financeiro}', '{finance,manager}', '{}', 4),
  ('jornada_paciente', 'Jornada do paciente', 'Avaliação, plano de cuidado, sessões e pacotes, evolução, exercícios e vídeos, reavaliação e alta, portal do paciente.', 'available', false, 'none', '{/paciente,/fisio}', '{physio,member}', '{pacientes_ativos}', 5),
  ('apresentacao_evidencias', 'Apresentação e evidências', 'Apresentação personalizada da avaliação, biblioteca de evidências revisada e prévia real do portal.', 'experimental', false, 'rls_rpc', '{/apresentacao,/admin/evidencias}', '{physio,manager}', '{}', 6),
  ('repasses', 'Repasses', 'Comissões e repasses a profissionais e parceiros, com máquina de estados.', 'available', false, 'none', '{/admin/financeiro/comissoes}', '{finance}', '{}', 7),
  ('rota_domiciliar', 'Rotas domiciliares', 'Ordem e tempo de deslocamento dos atendimentos domiciliares (provedor de rotas gratuito, sem trânsito em tempo real).', 'available', false, 'rls_rpc', '{/admin/meu-dia}', '{physio}', '{rotas}', 8),
  ('marketing', 'Marketing e anúncios', 'Campanhas, funis, atribuição e indicadores de marketing (somente leitura das plataformas).', 'available', false, 'rls_rpc', '{/admin/marketing}', '{manager,sales}', '{}', 9),
  ('academy', 'Academy', 'Cursos, trilhas, alunos e certificados.', 'available', false, 'none', '{/admin/academy,/academy}', '{teacher,manager}', '{}', 10),
  ('parceiros', 'Parceiros e indicações', 'Códigos de indicação, portal do parceiro e repasses por decisão expressa.', 'available', false, 'none', '{/admin/parceiros}', '{partner,manager}', '{}', 11),
  ('financas_pessoais', 'Finanças pessoais', 'Controle financeiro pessoal de cada usuário (dados do usuário, não da empresa).', 'available', false, 'rls_rpc', '{/admin/financas}', '{}', '{}', 12),
  ('contabil', 'Contábil', 'Documentos e períodos para o contador, com exportações.', 'experimental', false, 'rls_rpc', '{/admin/contabil}', '{accountant}', '{armazenamento}', 13),
  ('pesquisas', 'Pesquisas de satisfação', 'Pesquisas, respostas e indicadores com anonimato mínimo.', 'available', false, 'rls_rpc', '{/admin/pesquisas}', '{manager}', '{}', 14),
  ('cartoes_corporativos', 'Contas corporativas', 'Contratos, cartões e membros de empresas clientes.', 'available', false, 'rls_rpc', '{/admin/corporativo}', '{manager}', '{}', 15),
  ('prontuario_medico', 'Prontuário médico', 'Planejado — não disponível.', 'planned', false, 'none', '{}', '{}', '{}', 90),
  ('odontograma', 'Odontograma e plano por dente', 'Planejado — não disponível.', 'planned', false, 'none', '{}', '{}', '{}', 91),
  ('prontuario_psicologia', 'Prontuário psicológico', 'Planejado — não disponível.', 'planned', false, 'none', '{}', '{}', '{}', 92),
  ('processos_juridicos', 'Processos e prazos', 'Planejado — não disponível.', 'planned', false, 'none', '{}', '{}', '{}', 93),
  ('imoveis_contratos', 'Imóveis e contratos', 'Planejado — não disponível.', 'planned', false, 'none', '{}', '{}', '{}', 94),
  ('gestao_condominios', 'Gestão de condomínios', 'Planejado — não disponível.', 'planned', false, 'none', '{}', '{}', '{}', 95);
update public.platform_modules set segments = '{fisioterapia}' where key in ('jornada_paciente', 'apresentacao_evidencias', 'rota_domiciliar', 'repasses');
update public.platform_modules set segments = '{clinica_medica}' where key = 'prontuario_medico'; update public.platform_modules set segments = '{odontologia}' where key = 'odontograma';
update public.platform_modules set segments = '{psicologia}' where key = 'prontuario_psicologia'; update public.platform_modules set segments = '{advocacia}' where key = 'processos_juridicos';
update public.platform_modules set segments = '{imobiliaria}' where key = 'imoveis_contratos'; update public.platform_modules set segments = '{condominios}' where key = 'gestao_condominios';

insert into public.platform_module_deps (module_key, requires) values
  ('crm', 'core'), ('agenda', 'core'), ('financeiro', 'core'), ('jornada_paciente', 'agenda'), ('apresentacao_evidencias', 'jornada_paciente'), ('repasses', 'financeiro'), ('repasses', 'agenda'),
  ('rota_domiciliar', 'agenda'), ('marketing', 'crm'), ('academy', 'core'), ('parceiros', 'crm'), ('contabil', 'financeiro'), ('pesquisas', 'agenda'), ('cartoes_corporativos', 'financeiro'), ('financas_pessoais', 'core');

-- objetos que a habilitação protege no SERVIDOR (tabelas: políticas restritivas; RPCs: recusa no pré-request da API)
insert into public.platform_module_objects (module_key, kind, pattern) values
  ('marketing', 'table_like', 'mkt\_%'), ('marketing', 'rpc_like', 'mkt\_%'),
  ('financas_pessoais', 'table_like', 'pf\_%'), ('financas_pessoais', 'rpc_like', 'pf\_%'),
  ('contabil', 'table_like', 'acc\_%'), ('contabil', 'rpc_like', 'acc\_%'),
  ('pesquisas', 'table_like', 'research\_%'), ('pesquisas', 'rpc_like', 'research\_%'),
  ('cartoes_corporativos', 'table_like', 'corporate\_%'), ('cartoes_corporativos', 'rpc_like', 'corporate\_%'), ('cartoes_corporativos', 'rpc_like', 'card\_%'),
  ('rota_domiciliar', 'table_like', 'route\_%'), ('rota_domiciliar', 'table', 'professional_route_prefs'), ('rota_domiciliar', 'rpc_like', 'route\_%'),
  ('apresentacao_evidencias', 'table', 'evaluation_presentations'), ('apresentacao_evidencias', 'table', 'presentation_evidence'), ('apresentacao_evidencias', 'table', 'presentation_versions'),
  ('apresentacao_evidencias', 'table', 'evidence_references'), ('apresentacao_evidencias', 'rpc_like', 'presentation\_%'), ('apresentacao_evidencias', 'rpc_like', 'evidence\_%'), ('apresentacao_evidencias', 'rpc', 'my_presentation');

-- ---------------------------------------------------------------- 4. modelos (templates) por segmento, versionados
create table public.platform_templates (
  segment_key text not null references public.platform_segments(key) on delete restrict, version int not null, status text not null default 'draft' check (status in ('draft', 'published', 'retired')),
  definition jsonb not null, notes text, created_by uuid references auth.users(id) on delete set null, created_at timestamptz not null default now(), published_at timestamptz,
  primary key (segment_key, version)
);
-- modelo de FISIOTERAPIA v1: só configuração inicial APROVADA (nunca dados, pacientes, credenciais ou registros da HP)
insert into public.platform_templates (segment_key, version, status, definition, notes, published_at) values ('fisioterapia', 1, 'published', $tpl${
  "vocabulary": {"client": "paciente", "client_plural": "pacientes", "attendance": "atendimento", "session": "sessão", "evaluation": "avaliação", "professional": "fisioterapeuta"},
  "default_modules": ["core", "crm", "agenda", "financeiro", "jornada_paciente", "apresentacao_evidencias", "repasses"],
  "optional_modules": ["rota_domiciliar", "marketing", "academy", "parceiros", "pesquisas", "contabil", "cartoes_corporativos", "financas_pessoais"],
  "roles": [
    {"role": "manager", "label": "Gestor da clínica"}, {"role": "ops_admin", "label": "Administrativo"}, {"role": "unit_manager", "label": "Gestor de unidade"},
    {"role": "sales", "label": "Comercial"}, {"role": "finance", "label": "Financeiro"}, {"role": "physio", "label": "Fisioterapeuta"}, {"role": "member", "label": "Paciente"}
  ],
  "pipelines": [
    {"name": "Pacientes", "kind": "patients", "stages": ["Novo contato", "Atendimento", "Avaliação agendada", "Compareceu", "Proposta", "Contratou"], "won": "Contratou"}
  ],
  "loss_reasons": ["Sem resposta", "Preço", "Escolheu concorrente", "Sem interesse no momento", "Fora da região de atendimento", "Outro"],
  "finance_categories": [{"name": "Atendimentos", "kind": "income"}, {"name": "Pacotes", "kind": "income"}, {"name": "Salários e repasses", "kind": "expense"}, {"name": "Aluguel e condomínio", "kind": "expense"}, {"name": "Materiais", "kind": "expense"}, {"name": "Marketing", "kind": "expense"}, {"name": "Impostos e taxas", "kind": "expense"}],
  "settings": {"timezone": "America/Sao_Paulo", "locale": "pt-BR", "service_modes": ["in_clinic", "home_visit", "remote"]},
  "checklist": [
    {"key": "admin_invite", "label": "Administrador convidado e primeiro acesso concluído"}, {"key": "units", "label": "Unidades cadastradas"}, {"key": "services", "label": "Serviços e preços cadastrados pela clínica"},
    {"key": "professionals", "label": "Profissionais convidados e disponibilidade configurada"}, {"key": "brand", "label": "Marca revisada (logo e cores)"}, {"key": "integrations", "label": "Integrações conectadas pela própria clínica (e-mail, calendário, pagamentos)"},
    {"key": "import", "label": "Importação de dados (se contratada) revisada"}, {"key": "training", "label": "Treinamento realizado (se contratado)"}
  ]
}$tpl$::jsonb, 'Primeiro modelo operacional. Atualizar um modelo NÃO sobrescreve configurações já personalizadas por clientes existentes: cada organização guarda a versão aplicada.', now());

-- ---------------------------------------------------------------- 5. planos, assinaturas, módulos da organização
create table public.platform_plans (
  key text primary key, name text not null, description text, status text not null default 'draft' check (status in ('draft', 'active', 'retired')), version int not null default 1,
  implementation_fee_cents bigint check (implementation_fee_cents is null or implementation_fee_cents >= 0), monthly_fee_cents bigint check (monthly_fee_cents is null or monthly_fee_cents >= 0),
  included_modules text[] not null default '{}',
  limits jsonb not null default '{}',     -- max_staff_users, max_professionals, max_units, max_active_patients, storage_mb, external (franquias de serviços externos: route_requests_month, ...)
  created_at timestamptz not null default now(), updated_at timestamptz not null default now()
);
-- NENHUM preço ou limite é inventado: os planos nascem em rascunho, sem valores; a plataforma define.
insert into public.platform_plans (key, name, description, status) values
  ('interno', 'Interno (HP)', 'Organização operadora do produto. Sem cobrança.', 'active'),
  ('essencial', 'Essencial', 'Rascunho: valores, módulos incluídos e limites a definir pela plataforma.', 'draft'),
  ('profissional', 'Profissional', 'Rascunho: valores, módulos incluídos e limites a definir pela plataforma.', 'draft'),
  ('rede', 'Rede', 'Rascunho: valores, módulos incluídos e limites a definir pela plataforma.', 'draft');
create table public.org_subscriptions (
  org_id uuid primary key references public.organizations(id) on delete cascade, plan_key text not null references public.platform_plans(key) on delete restrict,
  status text not null default 'trial' check (status in ('trial', 'active', 'suspended', 'cancelled')), started_at timestamptz not null default now(),
  limits_override jsonb not null default '{}', enforcement text not null default 'warn' check (enforcement in ('warn', 'block_new')),    -- warn: só avisa. block_new: bloqueia CRIAR novos usuários/unidades/profissionais acima do limite (nunca histórico/exportação)
  implementation_status text not null default 'pending' check (implementation_status in ('pending', 'in_progress', 'done')), notes text, updated_at timestamptz not null default now()
);
create table public.org_modules (
  org_id uuid not null references public.organizations(id) on delete cascade, module_key text not null references public.platform_modules(key) on delete restrict, enabled boolean not null default true,
  source text not null default 'manual' check (source in ('template', 'manual', 'plan', 'legacy')), config jsonb not null default '{}', changed_at timestamptz not null default now(), changed_by uuid references auth.users(id) on delete set null,
  primary key (org_id, module_key)
);
alter table public.platform_segments enable row level security; alter table public.platform_modules enable row level security; alter table public.platform_module_deps enable row level security;
alter table public.platform_module_objects enable row level security; alter table public.platform_templates enable row level security; alter table public.platform_plans enable row level security;
alter table public.org_subscriptions enable row level security; alter table public.org_modules enable row level security;
revoke all on public.platform_segments, public.platform_modules, public.platform_module_deps, public.platform_module_objects, public.platform_templates, public.platform_plans, public.org_subscriptions, public.org_modules from public, anon, authenticated;

-- a HP continua com TUDO que já usa
insert into public.org_modules (org_id, module_key, enabled, source) select o.id, m.key, true, 'legacy' from public.organizations o cross join public.platform_modules m where o.slug = 'hp-group' and m.status in ('available', 'experimental') and not m.core on conflict do nothing;
insert into public.org_subscriptions (org_id, plan_key, status, implementation_status) select o.id, 'interno', 'active', 'done' from public.organizations o where o.slug = 'hp-group' on conflict do nothing;
update public.organizations set segment_key = 'fisioterapia', template_version = 1, status = 'active', provisioned_at = coalesce(provisioned_at, created_at) where slug = 'hp-group';

create or replace function private.module_enabled_for(p_org uuid, p_key text) returns boolean language sql stable security definer set search_path = '' as $$
  select exists (select 1 from public.platform_modules m where m.key = p_key and m.core)
      or exists (select 1 from public.org_modules om where om.org_id = p_org and om.module_key = p_key and om.enabled)
$$;
create or replace function private.module_enabled(p_key text) returns boolean language sql stable security definer set search_path = '' as $$
  select private.module_enabled_for((select private.current_org()), p_key)
$$;

-- políticas RESTRITIVAS nas tabelas dos módulos com imposição no servidor (regerável: private.module_guards_apply())
create or replace function private.module_guards_apply() returns int language plpgsql security definer set search_path = '' as $$
declare m record; t record; n int := 0; v_pol text;
begin
  for m in select pm.key from public.platform_modules pm where pm.enforcement = 'rls_rpc' loop
    for t in select distinct c.relname from pg_class c join pg_namespace ns on ns.oid = c.relnamespace join public.platform_module_objects o on o.module_key = m.key
              where ns.nspname = 'public' and c.relkind = 'r' and ((o.kind = 'table' and c.relname = o.pattern) or (o.kind = 'table_like' and c.relname like o.pattern)) loop
      v_pol := 'zz_module_' || m.key;
      if not exists (select 1 from pg_policies p where p.schemaname = 'public' and p.tablename = t.relname and p.policyname = v_pol) then
        execute format('create policy %I on public.%I as restrictive for all to authenticated using ((select private.module_enabled(%L))) with check ((select private.module_enabled(%L)))', v_pol, t.relname, m.key, m.key);
        n := n + 1;
      end if;
    end loop;
  end loop;
  return n;
end $$;
select private.module_guards_apply();

-- ---------------------------------------------------------------- 6. marca, domínios
create table public.org_settings (
  org_id uuid primary key references public.organizations(id) on delete cascade,
  app_name text check (app_name is null or length(btrim(app_name)) between 2 and 60), legal_name text check (legal_name is null or length(legal_name) <= 160),
  logo_path text check (logo_path is null or logo_path ~ '^[0-9a-f-]{36}/[A-Za-z0-9._-]{1,120}$'), logo_dark_path text check (logo_dark_path is null or logo_dark_path ~ '^[0-9a-f-]{36}/[A-Za-z0-9._-]{1,120}$'),
  color_primary text check (color_primary is null or color_primary ~ '^#[0-9a-fA-F]{6}$'), color_accent text check (color_accent is null or color_accent ~ '^#[0-9a-fA-F]{6}$'), color_ink text check (color_ink is null or color_ink ~ '^#[0-9a-fA-F]{6}$'),
  support_email text check (support_email is null or support_email ~* '^[^@\s]+@[^@\s]+\.[^@\s]+$'), support_phone text check (support_phone is null or length(support_phone) <= 30), website_url text check (website_url is null or website_url ~* '^https://[^\s]+$'),
  texts jsonb not null default '{}' check (jsonb_typeof(texts) = 'object' and pg_column_size(texts) < 8000),     -- só TEXTO simples por chave (sem HTML/script)
  email_from_name text check (email_from_name is null or length(btrim(email_from_name)) between 2 and 60),
  timezone text not null default 'America/Sao_Paulo', locale text not null default 'pt-BR', brand_version int not null default 1, updated_at timestamptz not null default now(), updated_by uuid references auth.users(id) on delete set null
);
alter table public.org_settings enable row level security; revoke all on public.org_settings from public, anon, authenticated;
insert into public.org_settings (org_id, app_name, legal_name, support_email) select id, 'HP Fisioterapia', 'HP Group', null from public.organizations where slug = 'hp-group' on conflict do nothing;

create table public.org_domains (
  id uuid primary key default gen_random_uuid(), org_id uuid not null references public.organizations(id) on delete cascade,
  host text not null check (host = lower(host) and host ~ '^([a-z0-9]([a-z0-9-]{0,61}[a-z0-9])?\.)+[a-z]{2,}$|^[a-z0-9-]+\.localhost$'),
  kind text not null check (kind in ('subdomain', 'custom', 'dev')), status text not null default 'pending' check (status in ('pending', 'verified', 'disabled')),
  verification_token text not null default encode(extensions.gen_random_bytes(16), 'hex'), verified_at timestamptz, verified_method text, created_at timestamptz not null default now()
);
create unique index org_domains_host_uq on public.org_domains (host);
alter table public.org_domains enable row level security; revoke all on public.org_domains from public, anon, authenticated;

insert into storage.buckets (id, name, public) values ('org-brand', 'org-brand', true) on conflict (id) do nothing;      -- logos são ativos PÚBLICOS por natureza (aparecem antes do login)
create policy org_brand_write on storage.objects for insert to authenticated with check (bucket_id = 'org-brand' and ((private.has_org_role(array['manager', 'ops_admin']::public.app_role[]) and (storage.foldername(name))[1] = (select private.current_org())::text) or private.is_platform_admin()));
create policy org_brand_update on storage.objects for update to authenticated using (bucket_id = 'org-brand' and ((private.has_org_role(array['manager', 'ops_admin']::public.app_role[]) and (storage.foldername(name))[1] = (select private.current_org())::text) or private.is_platform_admin()))
  with check (bucket_id = 'org-brand' and ((private.has_org_role(array['manager', 'ops_admin']::public.app_role[]) and (storage.foldername(name))[1] = (select private.current_org())::text) or private.is_platform_admin()));
create policy org_brand_delete on storage.objects for delete to authenticated using (bucket_id = 'org-brand' and ((private.has_org_role(array['manager', 'ops_admin']::public.app_role[]) and (storage.foldername(name))[1] = (select private.current_org())::text) or private.is_platform_admin()));

create or replace function private.org_brand_json(p_org uuid) returns jsonb language sql stable security definer set search_path = '' as $$
  select jsonb_build_object('org_id', o.id, 'name', coalesce(s.app_name, o.name), 'legal_name', s.legal_name, 'logo_path', s.logo_path, 'logo_dark_path', s.logo_dark_path,
    'color_primary', s.color_primary, 'color_accent', s.color_accent, 'color_ink', s.color_ink, 'support_email', s.support_email, 'support_phone', s.support_phone, 'website_url', s.website_url,
    'texts', coalesce(s.texts, '{}'), 'email_from_name', s.email_from_name, 'version', coalesce(s.brand_version, 1), 'is_default_brand', (o.slug = 'hp-group'))
  from public.organizations o left join public.org_settings s on s.org_id = o.id where o.id = p_org
$$;

-- resolução por host (pública, MÍNIMA): só hosts VERIFICADOS de organizações ativas; host desconhecido → não encontrado
create or replace function public.org_brand_for_host(p_host text) returns jsonb language plpgsql stable security definer set search_path = '' as $$
declare h text := lower(btrim(coalesce(p_host, ''))); h2 text; d public.org_domains; o public.organizations;
begin
  h := regexp_replace(h, ':[0-9]+$', '');
  if h = '' or length(h) > 253 then return jsonb_build_object('found', false); end if;
  select * into d from public.org_domains where host = h and status = 'verified';
  if not found then return jsonb_build_object('found', false); end if;
  select * into o from public.organizations where id = d.org_id and status in ('active', 'provisioning');
  if not found then return jsonb_build_object('found', false); end if;
  return jsonb_build_object('found', true, 'brand', private.org_brand_json(o.id) - 'org_id' - 'support_phone');
end $$;

-- contexto da organização ativa para o front (qualquer vínculo): marca, módulos e estado
create or replace function public.org_context() returns jsonb language plpgsql stable security definer set search_path = '' as $$
declare v_org uuid := private.current_org();
begin
  if v_org is null then return jsonb_build_object('org', null); end if;
  return jsonb_build_object('org', (select jsonb_build_object('id', o.id, 'name', o.name, 'slug', o.slug, 'status', o.status, 'segment', o.segment_key, 'template_version', o.template_version) from public.organizations o where o.id = v_org),
    'brand', private.org_brand_json(v_org),
    'modules', coalesce((select jsonb_agg(m.key order by m.sort) from public.platform_modules m where m.status <> 'planned' and private.module_enabled_for(v_org, m.key)), '[]'::jsonb),
    'vocabulary', coalesce((select t.definition -> 'vocabulary' from public.platform_templates t join public.organizations o on o.segment_key = t.segment_key and o.template_version = t.version where o.id = v_org), '{}'::jsonb));
end $$;

create or replace function public.org_settings_save(p_patch jsonb) returns jsonb language plpgsql security definer set search_path = '' as $$
declare v_org uuid := private.current_org(); k text; v_allowed text[] := array['app_name', 'legal_name', 'logo_path', 'logo_dark_path', 'color_primary', 'color_accent', 'color_ink', 'support_email', 'support_phone', 'website_url', 'texts', 'email_from_name'];
begin
  if v_org is null or not private.has_org_role(array['manager', 'ops_admin']::public.app_role[]) then raise exception 'sem permissão' using errcode = '42501'; end if;
  if jsonb_typeof(p_patch) <> 'object' then raise exception 'conteúdo inválido'; end if;
  for k in select jsonb_object_keys(p_patch) loop if not (k = any (v_allowed)) then raise exception 'campo não permitido: %', k; end if; end loop;
  if p_patch ? 'logo_path' and p_patch ->> 'logo_path' is not null and split_part(p_patch ->> 'logo_path', '/', 1) <> v_org::text then raise exception 'o logo precisa estar na pasta da própria organização'; end if;
  if p_patch ? 'logo_dark_path' and p_patch ->> 'logo_dark_path' is not null and split_part(p_patch ->> 'logo_dark_path', '/', 1) <> v_org::text then raise exception 'o logo precisa estar na pasta da própria organização'; end if;
  if p_patch ? 'texts' and exists (select 1 from jsonb_each(p_patch -> 'texts') e where jsonb_typeof(e.value) <> 'string' or e.value::text ~* '<\s*(script|iframe|object|embed)|javascript:|on[a-z]+\s*=') then raise exception 'textos aceitam apenas texto simples'; end if;
  insert into public.org_settings (org_id) values (v_org) on conflict do nothing;
  update public.org_settings s set app_name = case when p_patch ? 'app_name' then nullif(btrim(p_patch ->> 'app_name'), '') else s.app_name end,
      legal_name = case when p_patch ? 'legal_name' then nullif(btrim(p_patch ->> 'legal_name'), '') else s.legal_name end, logo_path = case when p_patch ? 'logo_path' then p_patch ->> 'logo_path' else s.logo_path end,
      logo_dark_path = case when p_patch ? 'logo_dark_path' then p_patch ->> 'logo_dark_path' else s.logo_dark_path end, color_primary = case when p_patch ? 'color_primary' then nullif(p_patch ->> 'color_primary', '') else s.color_primary end,
      color_accent = case when p_patch ? 'color_accent' then nullif(p_patch ->> 'color_accent', '') else s.color_accent end, color_ink = case when p_patch ? 'color_ink' then nullif(p_patch ->> 'color_ink', '') else s.color_ink end,
      support_email = case when p_patch ? 'support_email' then nullif(btrim(p_patch ->> 'support_email'), '') else s.support_email end, support_phone = case when p_patch ? 'support_phone' then nullif(btrim(p_patch ->> 'support_phone'), '') else s.support_phone end,
      website_url = case when p_patch ? 'website_url' then nullif(btrim(p_patch ->> 'website_url'), '') else s.website_url end, texts = case when p_patch ? 'texts' then p_patch -> 'texts' else s.texts end,
      email_from_name = case when p_patch ? 'email_from_name' then nullif(btrim(p_patch ->> 'email_from_name'), '') else s.email_from_name end,
      brand_version = s.brand_version + 1, updated_at = now(), updated_by = (select auth.uid()) where s.org_id = v_org;
  return private.org_brand_json(v_org);
end $$;

-- ---------------------------------------------------------------- 7. consumo: definições EXATAS (sem preço, sem cobrança)
-- staff_users: vínculos ATIVOS com ao menos um papel de equipe ativo (manager, ops_admin, unit_manager, sales, finance, physio, teacher, accountant) — "assentos"; paciente/parceiro NÃO contam.
-- professionals: profissionais ativos. units: unidades ativas. active_patients: pessoas distintas com vínculo de paciente ATIVO (patient_enrollments.status = 'active'); mede estado atual, sem dupla contagem.
-- storage_bytes: soma do tamanho dos objetos de Storage atribuíveis à organização (contábil, marca, exportações e documentos jurídicos/representantes pelos caminhos conhecidos); NÃO inclui vídeos hospedados em serviços externos.
-- route_requests_month: consultas de rota (matriz+trajeto) no mês corrente em America/Sao_Paulo (reinicia no dia 1º). Demais serviços externos: ainda sem medição (informado como null).
create or replace function private.org_usage(p_org uuid) returns jsonb language plpgsql stable security definer set search_path = '' as $$
declare v_month date := date_trunc('month', now() at time zone 'America/Sao_Paulo')::date;
begin
  return jsonb_build_object('period_start', v_month, 'timezone', 'America/Sao_Paulo',
    'staff_users', (select count(distinct m.user_id) from public.org_memberships m join public.role_assignments ra on ra.user_id = m.user_id and ra.org_id = m.org_id and ra.revoked_at is null and (ra.valid_until is null or ra.valid_until > now())
                     where m.org_id = p_org and m.status = 'active' and ra.role in ('manager', 'ops_admin', 'unit_manager', 'sales', 'finance', 'physio', 'teacher', 'accountant')),
    'professionals', (select count(*) from public.professionals where org_id = p_org and active),
    'units', (select count(*) from public.units where org_id = p_org and coalesce(active, true)),
    'active_patients', (select count(distinct person_id) from public.patient_enrollments where org_id = p_org and status = 'active'),
    'storage_bytes', (select coalesce(sum((o.metadata ->> 'size')::bigint), 0) from storage.objects o where (o.bucket_id in ('accounting-private', 'org-brand', 'org-exports') and split_part(o.name, '/', 1) = p_org::text)),
    'route_requests_month', (select coalesce(sum(calls), 0) from public.route_usage where org_id = p_org and day >= v_month),
    'external_services', jsonb_build_object('email', null, 'calendar', null, 'payments', null, 'videos', null, 'messages', null));
end $$;
create or replace function private.org_limits(p_org uuid) returns jsonb language sql stable security definer set search_path = '' as $$
  select coalesce(p.limits, '{}') || coalesce(s.limits_override, '{}') from public.org_subscriptions s join public.platform_plans p on p.key = s.plan_key where s.org_id = p_org
$$;
create or replace function private.org_limits_status(p_org uuid) returns jsonb language plpgsql stable security definer set search_path = '' as $$
declare u jsonb := private.org_usage(p_org); l jsonb := coalesce(private.org_limits(p_org), '{}'); r jsonb := '[]'; m record;
begin
  for m in select * from (values ('staff_users', 'max_staff_users'), ('professionals', 'max_professionals'), ('units', 'max_units'), ('active_patients', 'max_active_patients')) x(metric, lim) loop
    r := r || jsonb_build_array(jsonb_build_object('metric', m.metric, 'value', (u ->> m.metric)::numeric, 'limit', nullif(l ->> m.lim, '')::numeric,
      'state', case when nullif(l ->> m.lim, '') is null then 'sem_limite' when (u ->> m.metric)::numeric > (l ->> m.lim)::numeric then 'acima' when (u ->> m.metric)::numeric >= 0.8 * (l ->> m.lim)::numeric then 'perto' else 'ok' end));
  end loop;
  return jsonb_build_object('usage', u, 'limits', r, 'enforcement', (select enforcement from public.org_subscriptions where org_id = p_org), 'note', 'Contagens de uso, não custo financeiro. Excedente não é cobrado automaticamente; limites nunca apagam dados nem bloqueiam histórico/exportação.');
end $$;
create or replace function public.org_usage() returns jsonb language plpgsql stable security definer set search_path = '' as $$
begin
  if private.current_org() is null or not private.has_org_role(array['manager', 'ops_admin']::public.app_role[]) then raise exception 'sem permissão' using errcode = '42501'; end if;
  return private.org_limits_status(private.current_org());
end $$;

-- bloqueio de NOVAS criações acima do limite (só se a assinatura estiver em 'block_new'; nunca por padrão)
create or replace function private.limit_guard() returns trigger language plpgsql security definer set search_path = '' as $$
declare v_org uuid := new.org_id; v_enf text; v_lim numeric; v_val numeric; v_metric text; v_key text;
begin
  select enforcement into v_enf from public.org_subscriptions where org_id = v_org; if v_enf is distinct from 'block_new' then return new; end if;
  v_metric := tg_argv[0]; v_key := tg_argv[1]; v_lim := nullif(private.org_limits(v_org) ->> v_key, '')::numeric; if v_lim is null then return new; end if;
  v_val := (private.org_usage(v_org) ->> v_metric)::numeric;
  if v_val >= v_lim then raise exception 'limite do plano atingido (%): novas criações estão bloqueadas; histórico e exportação continuam disponíveis', v_key using errcode = 'P0011'; end if;
  return new;
end $$;
create trigger limit_units before insert on public.units for each row execute function private.limit_guard('units', 'max_units');
create trigger limit_professionals before insert on public.professionals for each row execute function private.limit_guard('professionals', 'max_professionals');

-- ---------------------------------------------------------------- 8. administração da plataforma (somente administradores da plataforma; sem acesso a dados das organizações)
create or replace function public.platform_whoami() returns jsonb language sql stable security definer set search_path = '' as $$
  select jsonb_build_object('platform_admin', private.is_platform_admin())
$$;

create or replace function public.platform_orgs_list() returns jsonb language plpgsql stable security definer set search_path = '' as $$
begin
  perform private.require_platform_admin();
  return coalesce((select jsonb_agg(jsonb_build_object('id', o.id, 'name', o.name, 'slug', o.slug, 'status', o.status, 'segment', o.segment_key, 'template_version', o.template_version, 'created_at', o.created_at, 'provisioned_at', o.provisioned_at,
      'plan', s.plan_key, 'subscription', s.status, 'implementation', s.implementation_status, 'units', (select count(*) from public.units u where u.org_id = o.id), 'staff_users', (private.org_usage(o.id) ->> 'staff_users')::int,
      'modules', (select count(*) from public.org_modules om where om.org_id = o.id and om.enabled), 'domains', (select coalesce(jsonb_agg(d.host order by d.host) filter (where d.status = 'verified'), '[]') from public.org_domains d where d.org_id = o.id)) order by o.created_at)
    from public.organizations o left join public.org_subscriptions s on s.org_id = o.id), '[]'::jsonb);
end $$;

create or replace function public.platform_catalog() returns jsonb language plpgsql stable security definer set search_path = '' as $$
begin
  perform private.require_platform_admin();
  return jsonb_build_object(
    'segments', (select coalesce(jsonb_agg(to_jsonb(s) order by s.sort), '[]') from public.platform_segments s),
    'modules', (select coalesce(jsonb_agg(to_jsonb(m) || jsonb_build_object('requires', coalesce((select jsonb_agg(d.requires) from public.platform_module_deps d where d.module_key = m.key), '[]')) order by m.sort), '[]') from public.platform_modules m),
    'templates', (select coalesce(jsonb_agg(jsonb_build_object('segment_key', t.segment_key, 'version', t.version, 'status', t.status, 'published_at', t.published_at, 'notes', t.notes, 'default_modules', t.definition -> 'default_modules', 'optional_modules', t.definition -> 'optional_modules', 'vocabulary', t.definition -> 'vocabulary', 'checklist', t.definition -> 'checklist') order by t.segment_key, t.version desc), '[]') from public.platform_templates t),
    'plans', (select coalesce(jsonb_agg(to_jsonb(p) order by p.key), '[]') from public.platform_plans p));
end $$;

-- habilitar/desabilitar módulo com validação de dependências, segmento e estado; nada é apagado
create or replace function public.platform_module_set(p_org uuid, p_module text, p_enabled boolean, p_reason text default null) returns jsonb language plpgsql security definer set search_path = '' as $$
declare m public.platform_modules; o public.organizations; v_missing text[]; v_dependants text[];
begin
  perform private.require_platform_admin();
  select * into o from public.organizations where id = p_org; if not found then raise exception 'organização não encontrada'; end if;
  select * into m from public.platform_modules where key = p_module; if not found then raise exception 'módulo desconhecido'; end if;
  if m.core then raise exception 'a base comum está sempre habilitada'; end if;
  if p_enabled then
    if m.status = 'planned' then raise exception 'módulo planejado: ainda não está disponível'; end if;
    if coalesce(array_length(m.segments, 1), 0) > 0 and (o.segment_key is null or not (o.segment_key = any (m.segments))) then raise exception 'módulo incompatível com o segmento da organização'; end if;
    select array_agg(d.requires order by d.requires) into v_missing from public.platform_module_deps d where d.module_key = p_module and not private.module_enabled_for(p_org, d.requires);
    if v_missing is not null then raise exception 'habilite antes: %', array_to_string(v_missing, ', ') using errcode = 'P0012'; end if;
  else
    select array_agg(d.module_key order by d.module_key) into v_dependants from public.platform_module_deps d where d.requires = p_module and private.module_enabled_for(p_org, d.module_key) and not (select core from public.platform_modules where key = d.module_key);
    if v_dependants is not null then raise exception 'desabilite antes os módulos que dependem deste: %', array_to_string(v_dependants, ', ') using errcode = 'P0012'; end if;
  end if;
  insert into public.org_modules (org_id, module_key, enabled, source, changed_by) values (p_org, p_module, p_enabled, 'manual', (select auth.uid()))
    on conflict (org_id, module_key) do update set enabled = excluded.enabled, source = 'manual', changed_at = now(), changed_by = excluded.changed_by;
  perform private.platform_audit(case when p_enabled then 'module.enable' else 'module.disable' end, p_org, 'module', p_module, jsonb_build_object('reason', p_reason, 'data_preserved', true));
  return jsonb_build_object('module', p_module, 'enabled', p_enabled, 'data_preserved', true);
end $$;

create or replace function public.platform_plan_save(p_key text, p_patch jsonb) returns jsonb language plpgsql security definer set search_path = '' as $$
declare k text; v_allowed text[] := array['name', 'description', 'status', 'implementation_fee_cents', 'monthly_fee_cents', 'included_modules', 'limits'];
begin
  perform private.require_platform_admin();
  if p_key !~ '^[a-z][a-z0-9_]{1,40}$' then raise exception 'chave inválida'; end if;
  for k in select jsonb_object_keys(p_patch) loop if not (k = any (v_allowed)) then raise exception 'campo não permitido: %', k; end if; end loop;
  if p_patch ? 'limits' and exists (select 1 from jsonb_each(p_patch -> 'limits') e where e.key not in ('max_staff_users', 'max_professionals', 'max_units', 'max_active_patients', 'storage_mb', 'external') ) then raise exception 'limite desconhecido'; end if;
  if p_patch ? 'included_modules' and exists (select 1 from jsonb_array_elements_text(p_patch -> 'included_modules') x where not exists (select 1 from public.platform_modules m where m.key = x)) then raise exception 'módulo incluído desconhecido'; end if;
  insert into public.platform_plans (key, name) values (p_key, coalesce(p_patch ->> 'name', p_key)) on conflict (key) do nothing;
  update public.platform_plans p set name = coalesce(p_patch ->> 'name', p.name), description = case when p_patch ? 'description' then p_patch ->> 'description' else p.description end, status = coalesce(p_patch ->> 'status', p.status),
      implementation_fee_cents = case when p_patch ? 'implementation_fee_cents' then nullif(p_patch ->> 'implementation_fee_cents', '')::bigint else p.implementation_fee_cents end,
      monthly_fee_cents = case when p_patch ? 'monthly_fee_cents' then nullif(p_patch ->> 'monthly_fee_cents', '')::bigint else p.monthly_fee_cents end,
      included_modules = case when p_patch ? 'included_modules' then array(select jsonb_array_elements_text(p_patch -> 'included_modules')) else p.included_modules end,
      limits = case when p_patch ? 'limits' then p_patch -> 'limits' else p.limits end, version = p.version + 1, updated_at = now() where p.key = p_key;
  perform private.platform_audit('plan.save', null, 'plan', p_key, p_patch);
  return (select to_jsonb(p) from public.platform_plans p where p.key = p_key);
end $$;

create or replace function public.platform_org_usage(p_org uuid) returns jsonb language plpgsql stable security definer set search_path = '' as $$
begin perform private.require_platform_admin(); return private.org_limits_status(p_org); end $$;
create or replace function public.platform_audit_list(p_org uuid default null, p_limit int default 100) returns jsonb language plpgsql stable security definer set search_path = '' as $$
begin
  perform private.require_platform_admin();
  return coalesce((select jsonb_agg(to_jsonb(a) order by a.at desc) from (select * from public.platform_audit where p_org is null or org_id = p_org order by at desc limit least(greatest(p_limit, 1), 500)) a), '[]'::jsonb);
end $$;

-- domínios: associação ÚNICA; ativação exige verificação de posse (dev/localhost: verificação manual do administrador da plataforma; DNS público: ainda não implementada)
create or replace function public.platform_domain_add(p_org uuid, p_host text, p_kind text) returns jsonb language plpgsql security definer set search_path = '' as $$
declare h text := lower(btrim(p_host)); d public.org_domains;
begin
  perform private.require_platform_admin();
  if p_kind not in ('subdomain', 'custom', 'dev') then raise exception 'tipo inválido'; end if;
  if p_kind = 'dev' and h !~ '^[a-z0-9-]+\.localhost$' then raise exception 'host de desenvolvimento precisa terminar em .localhost'; end if;
  insert into public.org_domains (org_id, host, kind) values (p_org, h, p_kind) returning * into d;
  perform private.platform_audit('domain.add', p_org, 'domain', h, jsonb_build_object('kind', p_kind));
  return jsonb_build_object('id', d.id, 'host', d.host, 'status', d.status, 'verification', jsonb_build_object('type', 'TXT', 'name', '_hp-verify.' || d.host, 'value', d.verification_token));
exception when unique_violation then raise exception 'este host já está associado a uma organização';
end $$;
create or replace function public.platform_domain_verify(p_domain uuid, p_method text) returns jsonb language plpgsql security definer set search_path = '' as $$
declare d public.org_domains;
begin
  perform private.require_platform_admin();
  select * into d from public.org_domains where id = p_domain for update; if not found then raise exception 'domínio não encontrado'; end if;
  if p_method <> 'manual_dev' or d.kind <> 'dev' then raise exception 'verificação por DNS público ainda não implementada: apenas hosts .localhost podem ser verificados manualmente no Dev'; end if;
  update public.org_domains set status = 'verified', verified_at = now(), verified_method = p_method where id = p_domain;
  perform private.platform_audit('domain.verify', d.org_id, 'domain', d.host, jsonb_build_object('method', p_method));
  return jsonb_build_object('host', d.host, 'status', 'verified');
end $$;

-- ---------------------------------------------------------------- 9. pré-request: agora também recusa REST/RPC de módulo desabilitado (organização ativa)
create or replace function public.hp_pre_request() returns void language plpgsql security definer set search_path = '' as $$
declare h text; ho text; v_claims jsonb; v_real uuid; s public.view_as_sessions; v_id uuid; v_path text; v_name text; v_mod text; v_org uuid;
begin
  begin h := nullif(btrim(current_setting('request.headers', true)::json ->> 'x-view-as'), ''); exception when others then h := null; end;
  if h is not null then
    begin
      v_claims := coalesce(nullif(current_setting('request.jwt.claims', true), '')::jsonb, '{}'::jsonb);
      v_real := nullif(v_claims ->> 'sub', '')::uuid; v_id := h::uuid;
      select * into s from public.view_as_sessions where id = v_id;
    exception when others then raise exception 'ver como inválido' using errcode = '42501'; end;
    if v_real is null or s.id is null or s.viewer_user_id <> v_real or s.ended_at is not null or s.expires_at <= now() or v_claims ? 'view_as_by' then
      raise exception 'ver como inválido ou expirado' using errcode = '42501';
    end if;
    if not exists (select 1 from public.role_assignments ra join public.org_memberships m on m.user_id = ra.user_id and m.org_id = ra.org_id and m.status = 'active'
                    where ra.user_id = v_real and ra.role = 'manager' and ra.revoked_at is null and ra.valid_from <= now() and (ra.valid_until is null or ra.valid_until > now())) then
      raise exception 'ver como inválido ou expirado' using errcode = '42501';
    end if;
    if private.view_as_target_kind(s.target_user_id) is distinct from s.target_kind then raise exception 'ver como inválido ou expirado' using errcode = '42501'; end if;
    v_claims := (v_claims - 'email' - 'phone') || jsonb_build_object('sub', s.target_user_id::text, 'view_as_by', v_real::text);
    perform set_config('request.jwt.claims', v_claims::text, true);
    perform set_config('request.jwt.claim.sub', s.target_user_id::text, true);
    perform set_config('app.view_as_session', s.id::text, true);
    perform set_config('transaction_read_only', 'on', true);
  end if;

  begin ho := nullif(btrim(current_setting('request.headers', true)::json ->> 'x-org'), ''); exception when others then ho := null; end;
  if ho is not null and (select auth.uid()) is not null then
    begin
      if not exists (select 1 from public.org_memberships m where m.user_id = (select auth.uid()) and m.org_id = ho::uuid and m.status = 'active') then
        raise exception 'organização inválida para este usuário' using errcode = '42501';
      end if;
    exception when invalid_text_representation then raise exception 'organização inválida' using errcode = '42501'; end;
    perform set_config('app.active_org', ho, true);
  end if;

  -- módulo desabilitado: recusa REST e RPC dos objetos do módulo (só para usuários autenticados com organização ativa; chamadas de serviço e endpoints públicos seguem as próprias regras)
  if (select auth.uid()) is not null then
    v_org := private.current_org();
    if v_org is not null then
      begin v_path := current_setting('request.path', true); exception when others then v_path := null; end;
      if v_path is not null and v_path <> '' then
        v_name := regexp_replace(v_path, '^/(rpc/)?', '');
        v_name := split_part(v_name, '?', 1);
        select o.module_key into v_mod from public.platform_module_objects o
         where ((v_path like '/rpc/%' and ((o.kind = 'rpc' and o.pattern = v_name) or (o.kind = 'rpc_like' and v_name like o.pattern)))
             or (v_path not like '/rpc/%' and ((o.kind = 'table' and o.pattern = v_name) or (o.kind = 'table_like' and v_name like o.pattern)))) limit 1;
        if v_mod is not null and not private.module_enabled_for(v_org, v_mod) then
          raise exception 'módulo desabilitado para esta organização (%)', v_mod using errcode = '42501';
        end if;
      end if;
    end if;
  end if;
end $$;

revoke all on function private.platform_audit(text, uuid, text, text, jsonb), private.require_platform_admin(), private.module_enabled_for(uuid, text), private.module_enabled(text), private.module_guards_apply(),
  private.org_brand_json(uuid), private.org_usage(uuid), private.org_limits(uuid), private.org_limits_status(uuid), private.limit_guard() from public, anon, authenticated;
revoke all on function public.platform_whoami(), public.platform_orgs_list(), public.platform_catalog(), public.platform_module_set(uuid, text, boolean, text), public.platform_plan_save(text, jsonb), public.platform_org_usage(uuid),
  public.platform_audit_list(uuid, int), public.platform_domain_add(uuid, text, text), public.platform_domain_verify(uuid, text), public.org_context(), public.org_settings_save(jsonb), public.org_usage(), public.org_brand_for_host(text) from public, anon;
grant execute on function public.platform_whoami(), public.platform_orgs_list(), public.platform_catalog(), public.platform_module_set(uuid, text, boolean, text), public.platform_plan_save(text, jsonb), public.platform_org_usage(uuid),
  public.platform_audit_list(uuid, int), public.platform_domain_add(uuid, text, text), public.platform_domain_verify(uuid, text), public.org_context(), public.org_settings_save(jsonb), public.org_usage() to authenticated;
grant execute on function public.org_brand_for_host(text) to anon, authenticated;

-- funções usadas DENTRO de políticas RLS são avaliadas com o papel do usuário: precisam de EXECUTE (como já ocorre com current_org/has_*_role)
grant execute on function private.module_enabled(text), private.module_enabled_for(uuid, text), private.is_platform_admin() to authenticated;
