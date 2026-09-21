-- HP Group Hub — 005 HP Pages, formulários públicos, visitas e métricas

create or replace function private.is_reserved_slug(s text) returns boolean
language sql immutable set search_path = '' as $$
  select lower(s) = any (array['admin','login','logout','academy','portal','api','redefinir-senha','primeiro-acesso',
    'trabalhe-conosco','paciente','parceiro','auth','assets','static','favicon.png','robots.txt','sitemap.xml',
    'netlify','supabase','p','preview','hp','hub','sistema'])
$$;

-- Blocos: lista de objetos com type permitido. Nada de HTML/JS livre; o front só renderiza componentes conhecidos.
create or replace function private.validate_blocks(p_blocks jsonb) returns void
language plpgsql immutable set search_path = '' as $$
declare b jsonb;
begin
  if p_blocks is null then return; end if;
  if jsonb_typeof(p_blocks) <> 'array' then raise exception 'conteúdo deve ser uma lista de blocos'; end if;
  if length(p_blocks::text) > 300000 then raise exception 'conteúdo muito grande'; end if;
  if p_blocks::text ~* '(javascript:|vbscript:|data:text/html|<script|<iframe|onerror\s*=|onload\s*=)' then
    raise exception 'conteúdo contém código não permitido';
  end if;
  for b in select * from jsonb_array_elements(p_blocks) loop
    if jsonb_typeof(b) <> 'object' or (b ->> 'type') is null
       or (b ->> 'type') <> all (array['hero','text','image','video','benefits','team','faq','cta','form']) then
      raise exception 'tipo de bloco inválido: %', b ->> 'type';
    end if;
  end loop;
end $$;

create table public.pages (
  id uuid primary key default gen_random_uuid(),
  org_id uuid not null references public.organizations(id) on delete restrict,
  unit_id uuid references public.units(id) on delete restrict,
  owner_user_id uuid references auth.users(id) on delete set null,
  pipeline_id uuid references public.pipelines(id) on delete set null,
  product_id uuid references public.products(id) on delete set null,
  slug text not null check (slug ~ '^[a-z0-9]+(-[a-z0-9]+)*$' and length(slug) <= 60 and not private.is_reserved_slug(slug)),
  title text not null check (length(btrim(title)) > 1),
  description text,
  template text not null default 'blank',
  status text not null default 'draft' check (status in ('draft','published','disabled')),
  publish_at timestamptz,
  unpublish_at timestamptz,
  disabled_mode text not null default 'message' check (disabled_mode in ('message','waitlist','redirect')),
  disabled_message text,
  redirect_url text check (redirect_url is null or redirect_url ~ '^(https://|/)'),
  waitlist_form_id uuid,
  seo jsonb not null default '{}',
  draft_content jsonb not null default '[]',
  published_content jsonb,
  published_title text,
  published_seo jsonb,
  published_at timestamptz,
  created_by uuid references auth.users(id) on delete set null,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  deleted_at timestamptz,
  check (unpublish_at is null or publish_at is null or unpublish_at > publish_at)
);
create unique index pages_slug_uq on public.pages (org_id, slug) where deleted_at is null;
create trigger pages_touch before update on public.pages for each row execute function private.touch_updated_at();

create or replace function private.pages_validate() returns trigger
language plpgsql set search_path = '' as $$
begin
  perform private.validate_blocks(new.draft_content);
  perform private.validate_blocks(new.published_content);
  return new;
end $$;
create trigger pages_validate before insert or update on public.pages for each row execute function private.pages_validate();

alter table public.opportunities add constraint opportunities_page_fk foreign key (page_id) references public.pages(id) on delete set null;

create table public.page_versions (
  id uuid primary key default gen_random_uuid(),
  org_id uuid not null,
  page_id uuid not null references public.pages(id) on delete cascade,
  version_no int not null,
  kind text not null default 'draft' check (kind in ('draft','publish','restore','create')),
  title text not null,
  content jsonb not null,
  seo jsonb,
  note text,
  created_by uuid,
  created_at timestamptz not null default now(),
  unique (page_id, version_no)
);

create table public.forms (
  id uuid primary key default gen_random_uuid(),
  org_id uuid not null references public.organizations(id) on delete restrict,
  page_id uuid not null references public.pages(id) on delete cascade,
  unit_id uuid not null references public.units(id) on delete restrict,
  pipeline_id uuid references public.pipelines(id) on delete restrict,
  owner_user_id uuid references auth.users(id) on delete set null,
  product_id uuid references public.products(id) on delete set null,
  name text not null,
  fields jsonb not null,
  success_message text not null default 'Recebemos seus dados. Em breve nossa equipe entrará em contato.',
  active boolean not null default true,
  created_at timestamptz not null default now()
);
alter table public.pages add constraint pages_waitlist_form_fk foreign key (waitlist_form_id) references public.forms(id) on delete set null;

create or replace function private.forms_validate() returns trigger
language plpgsql set search_path = '' as $$
declare f jsonb; keys text[] := '{}';
begin
  if jsonb_typeof(new.fields) <> 'array' or jsonb_array_length(new.fields) > 15 then raise exception 'campos inválidos'; end if;
  for f in select * from jsonb_array_elements(new.fields) loop
    if (f ->> 'key') !~ '^[a-z][a-z0-9_]{0,30}$' or (f ->> 'type') <> all (array['text','email','phone','textarea','select'])
       or coalesce(f ->> 'label', '') = '' then raise exception 'campo inválido: %', f; end if;
    keys := keys || (f ->> 'key');
  end loop;
  if not ('name' = any (keys)) or not ('email' = any (keys) or 'phone' = any (keys)) then
    raise exception 'o formulário precisa do campo name e de email ou phone';
  end if;
  return new;
end $$;
create trigger forms_validate before insert or update on public.forms for each row execute function private.forms_validate();

create table public.form_submissions (
  id uuid primary key default gen_random_uuid(),
  org_id uuid not null,
  form_id uuid not null references public.forms(id) on delete cascade,
  page_id uuid not null references public.pages(id) on delete cascade,
  person_id uuid references public.people(id) on delete set null,
  opportunity_id uuid references public.opportunities(id) on delete set null,
  answers jsonb not null,
  utm jsonb,
  referrer text,
  dedupe_key text not null,
  created_at timestamptz not null default now(),
  unique (form_id, dedupe_key)
);
create index form_submissions_page_idx on public.form_submissions (page_id, created_at desc);

create table public.page_visits (
  id bigint generated always as identity primary key,
  org_id uuid not null,
  page_id uuid not null references public.pages(id) on delete cascade,
  session_id text not null,
  utm jsonb,
  referrer text,
  visited_at timestamptz not null default now()
);
create index page_visits_page_idx on public.page_visits (page_id, visited_at desc);

create table private.rate_limits (
  key text not null, window_start timestamptz not null, hits int not null default 1,
  primary key (key, window_start)
);

create or replace function private.rate_limit(p_key text, p_window interval, p_max int) returns void
language plpgsql security definer set search_path = '' as $$
declare v_start timestamptz := date_bin(p_window, now(), '2000-01-01'::timestamptz); v_hits int;
begin
  insert into private.rate_limits (key, window_start) values (p_key, v_start)
    on conflict (key, window_start) do update set hits = private.rate_limits.hits + 1 returning hits into v_hits;
  if v_hits > p_max then raise exception 'rate_limited' using errcode = 'P0429'; end if;
  if random() < 0.02 then delete from private.rate_limits where window_start < now() - interval '2 days'; end if;
end $$;

create or replace function private.client_ip_hash() returns text
language sql stable set search_path = '' as $$
  select md5(coalesce(split_part(coalesce(nullif(current_setting('request.headers', true), '')::json ->> 'x-forwarded-for', 'unknown'), ',', 1), 'unknown'))
$$;

create or replace function private.page_is_live(p public.pages) returns boolean
language sql stable set search_path = '' as $$
  select p.deleted_at is null and p.status = 'published' and p.published_content is not null
     and (p.publish_at is null or p.publish_at <= now()) and (p.unpublish_at is null or p.unpublish_at > now())
$$;

create or replace function private.can_edit_page_unit(p_unit uuid) returns boolean
language sql stable set search_path = '' as $$
  select private.has_unit_role(array['manager','ops_admin','unit_manager','sales']::public.app_role[], p_unit)
$$;

-- ---------------------------------------------------------------- funções do editor (SECURITY DEFINER com checagem explícita)
create or replace function private.load_editable_page(p_id uuid) returns public.pages
language plpgsql stable security definer set search_path = '' as $$
declare p public.pages;
begin
  select * into p from public.pages where id = p_id and deleted_at is null;
  if not found or p.org_id is distinct from private.current_org() or not private.can_edit_page_unit(p.unit_id) then
    raise exception 'sem permissão ou página inexistente' using errcode = '42501';
  end if;
  return p;
end $$;

create or replace function private.add_version(p public.pages, p_kind text, p_note text) returns int
language plpgsql security definer set search_path = '' as $$
declare v int;
begin
  select coalesce(max(version_no), 0) + 1 into v from public.page_versions where page_id = p.id;
  insert into public.page_versions (org_id, page_id, version_no, kind, title, content, seo, note, created_by)
    values (p.org_id, p.id, v, p_kind, p.title, p.draft_content, p.seo, p_note, (select auth.uid()));
  return v;
end $$;

create or replace function public.page_create(p_slug text, p_title text, p_template text, p_content jsonb,
  p_unit_id uuid, p_pipeline_id uuid, p_owner uuid default null) returns uuid
language plpgsql security definer set search_path = '' as $$
declare v_org uuid := private.current_org(); v_id uuid; v_form uuid; v_content jsonb; p public.pages;
begin
  if v_org is null or p_unit_id is null or not private.can_edit_page_unit(p_unit_id) then raise exception 'sem permissão' using errcode = '42501'; end if;
  if not exists (select 1 from public.units where id = p_unit_id and org_id = v_org) then raise exception 'unidade inválida'; end if;
  insert into public.pages (org_id, unit_id, owner_user_id, pipeline_id, slug, title, template, draft_content, created_by)
    values (v_org, p_unit_id, coalesce(p_owner, (select auth.uid())), p_pipeline_id, lower(btrim(p_slug)), btrim(p_title), coalesce(p_template, 'blank'), '[]', (select auth.uid()))
    returning id into v_id;
  insert into public.forms (org_id, page_id, unit_id, pipeline_id, owner_user_id, name, fields)
    values (v_org, v_id, p_unit_id, p_pipeline_id, p_owner, 'Contato',
      '[{"key":"name","label":"Nome completo","type":"text","required":true},{"key":"phone","label":"WhatsApp","type":"phone","required":true},{"key":"email","label":"E-mail","type":"email","required":false},{"key":"message","label":"Mensagem","type":"textarea","required":false}]'::jsonb)
    returning id into v_form;
  v_content := replace(coalesce(p_content, '[]'::jsonb)::text, '"__DEFAULT_FORM__"', to_json(v_form::text)::text)::jsonb;
  update public.pages set draft_content = v_content where id = v_id returning * into p;
  perform private.add_version(p, 'create', 'Criação');
  return v_id;
end $$;

create or replace function public.page_save_draft(p_id uuid, p_title text, p_description text, p_content jsonb, p_seo jsonb, p_note text default null) returns int
language plpgsql security definer set search_path = '' as $$
declare p public.pages;
begin
  p := private.load_editable_page(p_id);
  update public.pages set title = btrim(p_title), description = p_description, draft_content = p_content, seo = coalesce(p_seo, '{}')
    where id = p_id returning * into p;
  return private.add_version(p, 'draft', p_note);
end $$;

create or replace function public.page_restore_version(p_id uuid, p_version_no int) returns int
language plpgsql security definer set search_path = '' as $$
declare p public.pages; v public.page_versions;
begin
  p := private.load_editable_page(p_id);
  select * into v from public.page_versions where page_id = p_id and version_no = p_version_no;
  if not found then raise exception 'versão inexistente'; end if;
  update public.pages set title = v.title, draft_content = v.content, seo = coalesce(v.seo, '{}') where id = p_id returning * into p;
  return private.add_version(p, 'restore', 'Restaurada da versão ' || p_version_no);
end $$;

create or replace function public.page_publish(p_id uuid, p_publish_at timestamptz default null, p_unpublish_at timestamptz default null) returns void
language plpgsql security definer set search_path = '' as $$
declare p public.pages;
begin
  p := private.load_editable_page(p_id);
  if p.pipeline_id is null then raise exception 'defina o funil de destino antes de publicar'; end if;
  if jsonb_array_length(p.draft_content) = 0 then raise exception 'a página está vazia'; end if;
  update public.pages set status = 'published', published_content = draft_content, published_title = title, published_seo = seo,
      published_at = now(), publish_at = p_publish_at, unpublish_at = p_unpublish_at
    where id = p_id returning * into p;
  perform private.add_version(p, 'publish', 'Publicação');
end $$;

create or replace function public.page_disable(p_id uuid, p_mode text, p_message text default null, p_redirect_url text default null) returns void
language plpgsql security definer set search_path = '' as $$
declare p public.pages; v_form uuid;
begin
  p := private.load_editable_page(p_id);
  if p_mode not in ('message','waitlist','redirect') then raise exception 'modo inválido'; end if;
  if p_mode = 'redirect' and (p_redirect_url is null or p_redirect_url !~ '^(https://|/)') then raise exception 'informe um endereço de redirecionamento válido'; end if;
  v_form := p.waitlist_form_id;
  if p_mode = 'waitlist' and v_form is null then
    insert into public.forms (org_id, page_id, unit_id, pipeline_id, owner_user_id, name, fields, success_message)
      values (p.org_id, p.id, p.unit_id, p.pipeline_id, p.owner_user_id, 'Lista de espera',
        '[{"key":"name","label":"Nome completo","type":"text","required":true},{"key":"phone","label":"WhatsApp","type":"phone","required":true},{"key":"email","label":"E-mail","type":"email","required":false}]'::jsonb,
        'Você entrou na lista de espera. Avisaremos assim que houver novidades.')
      returning id into v_form;
  end if;
  update public.pages set status = 'disabled', disabled_mode = p_mode, disabled_message = p_message, redirect_url = p_redirect_url, waitlist_form_id = v_form
   where id = p_id;
end $$;

create or replace function public.page_duplicate(p_id uuid, p_new_slug text) returns uuid
language plpgsql security definer set search_path = '' as $$
declare p public.pages;
begin
  p := private.load_editable_page(p_id);
  return public.page_create(p_new_slug, p.title || ' (cópia)', p.template, p.draft_content, p.unit_id, p.pipeline_id, p.owner_user_id);
end $$;

create or replace function public.page_set_slug(p_id uuid, p_slug text) returns void
language plpgsql security definer set search_path = '' as $$
begin
  perform private.load_editable_page(p_id);
  update public.pages set slug = lower(btrim(p_slug)) where id = p_id;
end $$;

create or replace function public.page_archive(p_id uuid) returns void
language plpgsql security definer set search_path = '' as $$
begin
  perform private.load_editable_page(p_id);
  update public.pages set deleted_at = now(), status = 'disabled' where id = p_id;
end $$;

-- ---------------------------------------------------------------- funções públicas (anon)
create or replace function public.get_public_page(p_slug text) returns jsonb
language plpgsql stable security definer set search_path = '' as $$
declare p public.pages; v_forms jsonb; v_closed boolean;
begin
  select * into p from public.pages where slug = lower(p_slug) and deleted_at is null
    and org_id = (select id from public.organizations where slug = 'hp-group');
  if not found or p.status = 'draft' then return jsonb_build_object('status', 'not_found'); end if;
  if private.page_is_live(p) then
    select coalesce(jsonb_agg(jsonb_build_object('id', f.id, 'name', f.name, 'fields', f.fields, 'success_message', f.success_message)), '[]')
      into v_forms from public.forms f where f.page_id = p.id and f.active and f.id is distinct from p.waitlist_form_id;
    return jsonb_build_object('status', 'published', 'page', jsonb_build_object(
      'id', p.id, 'title', p.published_title, 'description', p.description, 'seo', p.published_seo,
      'content', p.published_content, 'forms', v_forms));
  end if;
  if p.status = 'published' and (p.publish_at is not null and p.publish_at > now()) then return jsonb_build_object('status', 'not_found'); end if;
  -- desativada ou encerrada por agendamento
  if p.disabled_mode = 'redirect' then return jsonb_build_object('status', 'redirect', 'redirect_url', p.redirect_url); end if;
  if p.disabled_mode = 'waitlist' and p.waitlist_form_id is not null then
    select jsonb_build_object('id', f.id, 'name', f.name, 'fields', f.fields, 'success_message', f.success_message) into v_forms from public.forms f where f.id = p.waitlist_form_id;
    return jsonb_build_object('status', 'waitlist', 'page', jsonb_build_object('title', p.published_title, 'forms', jsonb_build_array(v_forms)));
  end if;
  return jsonb_build_object('status', 'closed', 'message', coalesce(p.disabled_message, 'Esta página não está mais disponível.'), 'title', p.published_title);
end $$;

create or replace function public.track_page_visit(p_page_id uuid, p_session text, p_utm jsonb default '{}', p_referrer text default null) returns void
language plpgsql security definer set search_path = '' as $$
declare p public.pages;
begin
  if p_session is null or length(p_session) not between 8 and 64 then return; end if;
  select * into p from public.pages where id = p_page_id;
  if not found or not private.page_is_live(p) then return; end if;
  perform private.rate_limit('visit:' || private.client_ip_hash(), interval '10 minutes', 60);
  if exists (select 1 from public.page_visits where page_id = p_page_id and session_id = p_session and visited_at > now() - interval '30 minutes') then return; end if;
  insert into public.page_visits (org_id, page_id, session_id, utm, referrer)
    values (p.org_id, p_page_id, p_session, left(coalesce(p_utm, '{}')::text, 1000)::jsonb, left(p_referrer, 500));
end $$;

create or replace function public.submit_public_form(p_form_id uuid, p_answers jsonb, p_utm jsonb default '{}', p_honeypot text default null, p_referrer text default null) returns jsonb
language plpgsql security definer set search_path = '' as $$
declare
  f public.forms; pg public.pages; fld jsonb; k text; v text; ans jsonb := '{}';
  v_name text; v_email text; v_phone text; v_key text; v_person uuid; v_sim numeric; v_shared boolean := false;
  v_opp uuid; v_owner uuid; v_sub uuid; v_stage uuid; v_new_opp boolean := false; v_utm jsonb; v_review boolean := false;
begin
  if p_honeypot is not null and btrim(p_honeypot) <> '' then return jsonb_build_object('status', 'ok'); end if;
  select * into f from public.forms where id = p_form_id and active;
  if not found then raise exception 'formulário indisponível'; end if;
  select * into pg from public.pages where id = f.page_id;
  if not (private.page_is_live(pg) or (pg.deleted_at is null and pg.status = 'disabled' and pg.disabled_mode = 'waitlist' and pg.waitlist_form_id = f.id)) then
    raise exception 'formulário indisponível';
  end if;
  perform private.rate_limit('form:' || f.id || ':' || private.client_ip_hash(), interval '10 minutes', 5);
  perform private.rate_limit('formg:' || f.id, interval '1 hour', 300);

  if jsonb_typeof(coalesce(p_answers, '{}')) <> 'object' then raise exception 'dados inválidos'; end if;
  for fld in select * from jsonb_array_elements(f.fields) loop
    k := fld ->> 'key'; v := nullif(btrim(coalesce(p_answers ->> k, '')), '');
    if v is null then
      if coalesce((fld ->> 'required')::boolean, false) then raise exception 'Preencha o campo: %', fld ->> 'label'; end if;
      continue;
    end if;
    if length(v) > 2000 then raise exception 'Texto muito longo em: %', fld ->> 'label'; end if;
    if fld ->> 'type' = 'email' and v !~* '^[^@\s]+@[^@\s]+\.[^@\s]+$' then raise exception 'E-mail inválido'; end if;
    if fld ->> 'type' = 'phone' and length(regexp_replace(v, '\D', '', 'g')) not between 10 and 13 then raise exception 'Telefone inválido'; end if;
    ans := ans || jsonb_build_object(k, v);
  end loop;
  v_name := ans ->> 'name'; v_email := lower(ans ->> 'email'); v_phone := private.norm_phone(ans ->> 'phone');
  if v_email is null and v_phone is null then raise exception 'Informe e-mail ou telefone'; end if;
  v_utm := left(coalesce(p_utm, '{}')::text, 1500)::jsonb;

  v_key := encode(sha256(convert_to(f.id::text || '|' || coalesce(v_email, v_phone) || '|' || current_date::text, 'UTF8')), 'hex');
  if exists (select 1 from public.form_submissions where form_id = f.id and dedupe_key = v_key) then
    return jsonb_build_object('status', 'duplicate', 'message', f.success_message);
  end if;

  -- pessoa: reutiliza só com contato igual E nome semelhante; caso contrário cria nova e pede revisão (nunca mescla sozinho)
  select p.id, extensions.similarity(lower(p.full_name), lower(v_name)) into v_person, v_sim
    from public.people p join public.person_contacts c on c.person_id = p.id
   where p.org_id = f.org_id and p.merged_into_id is null
     and ((c.type = 'email' and c.normalized = v_email) or (c.type in ('phone','whatsapp') and c.normalized = v_phone))
   order by extensions.similarity(lower(p.full_name), lower(v_name)) desc limit 1;
  if v_person is not null and v_sim < 0.5 then v_person := null; v_shared := true; v_review := true; end if;
  if v_person is null then
    insert into public.people (org_id, unit_id, full_name) values (f.org_id, f.unit_id, v_name) returning id into v_person;
    insert into public.person_kinds (person_id, kind) values (v_person, 'lead');
    if v_email is not null then insert into public.person_contacts (org_id, person_id, type, value, is_primary, is_shared) values (f.org_id, v_person, 'email', v_email, true, v_shared); end if;
    if v_phone is not null then insert into public.person_contacts (org_id, person_id, type, value, is_primary, is_shared) values (f.org_id, v_person, 'phone', ans ->> 'phone', true, v_shared); end if;
    if not v_review and exists (select 1 from public.people p where p.org_id = f.org_id and p.id <> v_person and p.merged_into_id is null
        and extensions.similarity(lower(p.full_name), lower(v_name)) >= 0.7) then v_review := true; end if;
  else
    insert into public.person_kinds (person_id, kind) values (v_person, 'lead') on conflict do nothing;
  end if;

  -- oportunidade: reaproveita uma aberta da mesma página/funil; senão cria
  select id into v_opp from public.opportunities where person_id = v_person and pipeline_id = f.pipeline_id and page_id = pg.id and status = 'open' limit 1;
  if v_opp is null then
    select id into v_stage from public.pipeline_stages where pipeline_id = f.pipeline_id and kind = 'open' order by position limit 1;
    if v_stage is null then raise exception 'funil da página sem etapas'; end if;
    v_owner := coalesce(f.owner_user_id, pg.owner_user_id, private.pick_owner(f.org_id, f.unit_id));
    insert into public.opportunities (org_id, unit_id, person_id, pipeline_id, stage_id, owner_user_id, product_id, title, source, campaign, utm, page_id)
      values (f.org_id, f.unit_id, v_person, f.pipeline_id, v_stage, v_owner, coalesce(f.product_id, pg.product_id),
              pg.title || ' — ' || f.name, 'page:' || pg.slug, v_utm ->> 'utm_campaign', v_utm, pg.id)
      returning id into v_opp;
    v_new_opp := true;
    insert into public.crm_tasks (org_id, unit_id, opportunity_id, person_id, assignee_user_id, kind, title, due_at, dedupe_key)
      values (f.org_id, f.unit_id, v_opp, v_person, v_owner, 'first_contact', 'Primeiro contato com o lead', now() + interval '15 minutes', 'first_contact:' || v_opp)
      on conflict do nothing;
  end if;
  insert into public.interactions (org_id, person_id, unit_id, opportunity_id, channel, summary)
    values (f.org_id, v_person, f.unit_id, v_opp, 'system', 'Formulário "' || f.name || '" enviado pela página /' || pg.slug);
  if v_review then
    insert into public.crm_tasks (org_id, unit_id, opportunity_id, person_id, assignee_user_id, kind, title, dedupe_key)
      values (f.org_id, f.unit_id, v_opp, v_person, v_owner, 'dedupe_review', 'Revisar possível duplicidade / contato compartilhado', 'dedupe:' || v_person)
      on conflict do nothing;
  end if;
  insert into public.form_submissions (org_id, form_id, page_id, person_id, opportunity_id, answers, utm, referrer, dedupe_key)
    values (f.org_id, f.id, pg.id, v_person, v_opp, ans, v_utm, left(p_referrer, 500), v_key) returning id into v_sub;
  perform private.emit_event(f.org_id, 'form.submitted', 'form_submission', v_sub, jsonb_build_object('opportunity_id', v_opp, 'person_id', v_person), 'form_submission:' || v_sub);
  return jsonb_build_object('status', 'created', 'message', f.success_message);
end $$;

-- métricas por página (invoker: RLS decide o que aparece). Filtro por data de criação do lead/visita.
create or replace function public.page_metrics(p_from timestamptz, p_to timestamptz) returns table (
  page_id uuid, slug text, title text, visits bigint, leads bigint)
language sql stable security invoker set search_path = '' as $$
  select p.id, p.slug, p.title,
    (select count(distinct v.session_id) from public.page_visits v where v.page_id = p.id and v.visited_at >= p_from and v.visited_at < p_to),
    (select count(*) from public.form_submissions s where s.page_id = p.id and s.created_at >= p_from and s.created_at < p_to)
  from public.pages p where p.deleted_at is null
$$;

-- ---------------------------------------------------------------- RLS e grants
alter table public.pages enable row level security;
alter table public.page_versions enable row level security;
alter table public.forms enable row level security;
alter table public.form_submissions enable row level security;
alter table public.page_visits enable row level security;

grant select on public.pages, public.page_versions, public.form_submissions, public.page_visits to authenticated;
grant select, insert, update on public.forms to authenticated;
-- edição direta de metadados; conteúdo/status/slug só pelas funções acima
grant update (unit_id, owner_user_id, pipeline_id, product_id, seo, publish_at, unpublish_at, disabled_message) on public.pages to authenticated;

create policy pages_read on public.pages for select to authenticated using (private.in_org(org_id) and private.can_edit_page_unit(unit_id));
create policy pages_update on public.pages for update to authenticated using (private.in_org(org_id) and private.can_edit_page_unit(unit_id)) with check (private.in_org(org_id) and private.can_edit_page_unit(unit_id));
create policy versions_read on public.page_versions for select to authenticated using (exists (select 1 from public.pages p where p.id = page_id));
create policy forms_read on public.forms for select to authenticated using (private.in_org(org_id) and private.can_edit_page_unit(unit_id));
create policy forms_insert on public.forms for insert to authenticated with check (private.in_org(org_id) and private.can_edit_page_unit(unit_id) and exists (select 1 from public.pages p where p.id = page_id));
create policy forms_update on public.forms for update to authenticated using (private.in_org(org_id) and private.can_edit_page_unit(unit_id)) with check (private.in_org(org_id) and private.can_edit_page_unit(unit_id));
create policy subs_read on public.form_submissions for select to authenticated using (exists (select 1 from public.pages p where p.id = page_id));
create policy visits_read on public.page_visits for select to authenticated using (exists (select 1 from public.pages p where p.id = page_id));

create trigger audit_pages after insert or update or delete on public.pages
  for each row execute function private.audit_row('slug','status','publish_at','unpublish_at','deleted_at');

grant execute on function public.page_create(text, text, text, jsonb, uuid, uuid, uuid) to authenticated;
grant execute on function public.page_save_draft(uuid, text, text, jsonb, jsonb, text) to authenticated;
grant execute on function public.page_restore_version(uuid, int) to authenticated;
grant execute on function public.page_publish(uuid, timestamptz, timestamptz) to authenticated;
grant execute on function public.page_disable(uuid, text, text, text) to authenticated;
grant execute on function public.page_duplicate(uuid, text) to authenticated;
grant execute on function public.page_set_slug(uuid, text) to authenticated;
grant execute on function public.page_archive(uuid) to authenticated;
grant execute on function public.page_metrics(timestamptz, timestamptz) to authenticated;
grant execute on function public.get_public_page(text) to anon, authenticated;
grant execute on function public.track_page_visit(uuid, text, jsonb, text) to anon, authenticated;
grant execute on function public.submit_public_form(uuid, jsonb, jsonb, text, text) to anon, authenticated;
