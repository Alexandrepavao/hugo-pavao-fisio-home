-- HP Group Hub — 105 Marketing: rastreamento da captação, toques, atribuição determinística de oportunidades e vendas.
--
-- O QUE MUDA NA CAPTAÇÃO EXISTENTE (sem reescrever as funções públicas de envio):
--   • Gatilhos BEFORE INSERT higienizam utm / referrer / origin_path de form_submissions, quiz_leads, opportunities e page_visits: só chaves conhecidas, tamanho limitado, sem e-mail/token,
--     sem query string nem fragmento (nada de URL completa). Identificadores de clique (fbclid/gclid/wbraid/gbraid) só são mantidos quando o navegador declara consentimento de rastreamento.
--     Parâmetros públicos NÃO são prova de autenticidade: servem para análise, e a campanha só é ligada a uma campanha IMPORTADA de uma conta autorizada.
--   • Gatilhos AFTER registram um TOQUE (mkt_touches) por formulário enviado / quiz iniciado, sem apagar nem sobrescrever a origem histórica da pessoa (mkt_person_origin é só-inserção).
--   • Atribuição por oportunidade (mkt_attributions) calculada UMA vez, no commit da criação da oportunidade: último toque PAGO elegível dentro da janela configurada. Não é recalculada sozinha.
--   • Atribuição por venda (mkt_sale_attributions): cada venda confirmada é ligada uma única vez; cliente novo × recompra × expansão fixados na confirmação.

-- ---------------------------------------------------------------- higienização
create or replace function private.mkt_clean_utm(p jsonb) returns jsonb language plpgsql immutable set search_path = '' as $$
declare k text; v text; res jsonb := '{}'::jsonb;
begin
  if p is null or jsonb_typeof(p) <> 'object' then return '{}'::jsonb; end if;
  foreach k in array array['utm_source','utm_medium','utm_campaign','utm_content','utm_term','utm_id','hp_campaign_id','hp_adset_id','hp_ad_id','ref','fbclid','gclid','wbraid','gbraid'] loop
    v := p ->> k;
    if v is null then continue; end if;
    v := btrim(regexp_replace(v, '[[:cntrl:]<>"''`\\]', '', 'g'));
    if v = '' or v ~ '@' then continue; end if;                                      -- e-mail dentro de parâmetro: descartado
    if k in ('hp_campaign_id','hp_adset_id','hp_ad_id') then
      if v !~ '^[0-9]{5,25}$' then continue; end if;
    elsif k in ('fbclid','gclid','wbraid','gbraid') then
      if coalesce(p ->> 'hp_consent', '') <> 'tracking' or v !~ '^[A-Za-z0-9_.-]{10,200}$' then continue; end if;   -- só com consentimento declarado
    elsif k = 'ref' then
      if v !~* '^[a-z0-9]{4,32}$' then continue; end if;
    else
      v := left(v, 150);
      if length(v) >= 40 and v ~ '^[A-Za-z0-9+/=_-]+$' then continue; end if;       -- parece token/segredo
    end if;
    res := res || jsonb_build_object(k, v);
  end loop;
  return res;
end $$;

-- mantém só endereço + caminho (sem query, fragmento, credenciais); segmentos que parecem token/UUID/e-mail viram ":token"
create or replace function private.mkt_clean_url(p text) returns text language plpgsql immutable set search_path = '' as $$
declare v text; host text; path text; seg text; out_path text := '';
begin
  if p is null or btrim(p) = '' then return null; end if;
  v := regexp_replace(btrim(p), '[?#].*$', '');
  v := regexp_replace(v, '^([A-Za-z][A-Za-z0-9+.-]*://)[^/@]*@', '\1');
  if v ~* '^https?://' then host := lower(substring(v from '^[A-Za-z]+://([^/]+)')); path := coalesce(substring(v from '^[A-Za-z]+://[^/]+(/.*)$'), '/');
  else host := null; path := v; end if;
  if left(path, 1) <> '/' then path := '/' || path; end if;
  foreach seg in array string_to_array(path, '/') loop
    if seg = '' then continue; end if;
    if seg ~* '^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$' or seg ~ '@' or (length(seg) >= 24 and seg ~ '^[A-Za-z0-9_-]+$' and seg ~ '[0-9]') then seg := ':token'; end if;
    out_path := out_path || '/' || left(seg, 60);
  end loop;
  if out_path = '' then out_path := '/'; end if;
  return left(coalesce(host, '') || out_path, 200);
end $$;

create or replace function private.mkt_sanitize_origin() returns trigger language plpgsql set search_path = '' as $$
begin
  if tg_table_name in ('form_submissions','quiz_leads','page_visits') then
    new.utm := case when new.utm is null and tg_table_name = 'form_submissions' then null else private.mkt_clean_utm(new.utm) end;
    new.referrer := private.mkt_clean_url(new.referrer);
  elsif tg_table_name = 'opportunities' then
    new.utm := case when new.utm is null then null else private.mkt_clean_utm(new.utm) end;
  end if;
  if tg_table_name = 'quiz_leads' then new.origin_path := private.mkt_clean_url(new.origin_path); end if;
  return new;
end $$;
create trigger mkt_sanitize_form_submissions before insert on public.form_submissions for each row execute function private.mkt_sanitize_origin();
create trigger mkt_sanitize_quiz_leads before insert on public.quiz_leads for each row execute function private.mkt_sanitize_origin();
create trigger mkt_sanitize_opportunities before insert on public.opportunities for each row execute function private.mkt_sanitize_origin();
create trigger mkt_sanitize_page_visits before insert on public.page_visits for each row execute function private.mkt_sanitize_origin();

-- ---------------------------------------------------------------- toques
create table public.mkt_touches (
  id uuid primary key default gen_random_uuid(),
  org_id uuid not null references public.organizations(id) on delete cascade,
  unit_id uuid references public.units(id) on delete set null,
  person_id uuid references public.people(id) on delete set null,
  opportunity_id uuid references public.opportunities(id) on delete set null,
  touched_at timestamptz not null,
  kind text not null check (kind in ('form','quiz')),
  source_ref text not null, record_id uuid not null,                      -- form:<id> | quiz:<jornada>; id do envio/quiz
  utm_source text, utm_medium text, utm_campaign text, utm_content text, utm_term text, utm_id text,
  ext_campaign_id text, ext_adset_id text, ext_ad_id text,                -- ids de campanha/conjunto/anúncio informados na URL (não são prova)
  click_id_kind text check (click_id_kind in ('fbclid','gclid','wbraid','gbraid')), click_id text, click_consent boolean not null default false,
  platform text not null default 'none' check (platform in ('meta','google','other','none')),
  is_paid boolean not null default false, paid_basis text check (paid_basis in ('click_id','campaign_id','medium')),
  campaign_id uuid references public.mkt_campaigns(id) on delete set null,
  campaign_link_basis text check (campaign_link_basis in ('campaign_id','name_exact')),
  entry_path text, referrer_host text,
  created_at timestamptz not null default now(),
  unique (kind, record_id)
);
create index mkt_touches_person on public.mkt_touches (person_id, touched_at desc);
create index mkt_touches_opp on public.mkt_touches (opportunity_id);
create index mkt_touches_org_time on public.mkt_touches (org_id, touched_at);
-- origem histórica da pessoa: só-inserção (o primeiro toque nunca é substituído por formulários posteriores)
create table public.mkt_person_origin (
  person_id uuid primary key references public.people(id) on delete cascade, org_id uuid not null,
  touch_id uuid references public.mkt_touches(id) on delete set null, set_at timestamptz not null default now()
);
alter table public.mkt_touches enable row level security; alter table public.mkt_person_origin enable row level security;
create policy mkt_touches_admin_read on public.mkt_touches for select to authenticated using (org_id = private.current_org() and private.mkt_admin());
create policy mkt_person_origin_admin_read on public.mkt_person_origin for select to authenticated using (org_id = private.current_org() and private.mkt_admin());
revoke all on public.mkt_touches, public.mkt_person_origin from anon;
revoke insert, update, delete, truncate on public.mkt_touches, public.mkt_person_origin from authenticated;

create or replace function private.mkt_platform_of(p_utm jsonb) returns text language sql immutable set search_path = '' as $$
  select case
    when p_utm ? 'fbclid' or lower(coalesce(p_utm ->> 'utm_source', '')) in ('facebook','fb','instagram','ig','meta','facebook_ads','fb_ads','meta_ads') then 'meta'
    when p_utm ? 'gclid' or p_utm ? 'wbraid' or p_utm ? 'gbraid' or lower(coalesce(p_utm ->> 'utm_source', '')) in ('google','googleads','google_ads','adwords') then 'google'
    when coalesce(p_utm ->> 'utm_source', '') <> '' then 'other' else 'none' end
$$;

-- liga o toque a uma campanha IMPORTADA (conta autorizada, mesma plataforma): por id; senão por nome exato e único (a base fica registrada)
create or replace function private.mkt_link_touch_campaign(p_touch uuid) returns void language plpgsql security definer set search_path = '' as $$
declare t public.mkt_touches; v_c uuid; v_basis text;
begin
  select * into t from public.mkt_touches where id = p_touch; if t.id is null or t.platform not in ('meta','google') then return; end if;
  if t.ext_campaign_id is not null then
    select c.id into v_c from public.mkt_campaigns c join public.mkt_ad_accounts a on a.id = c.account_id
     where c.org_id = t.org_id and a.platform = t.platform and a.selected and c.external_id = t.ext_campaign_id limit 1;
    if v_c is not null then v_basis := 'campaign_id'; end if;
  end if;
  if v_c is null and coalesce(t.utm_campaign, '') <> '' then
    select min(c.id::text)::uuid into v_c from public.mkt_campaigns c join public.mkt_ad_accounts a on a.id = c.account_id
     where c.org_id = t.org_id and a.platform = t.platform and a.selected and lower(c.name) = lower(t.utm_campaign) having count(*) = 1;
    if v_c is not null then v_basis := 'name_exact'; end if;
  end if;
  if v_c is not null then update public.mkt_touches set campaign_id = v_c, campaign_link_basis = v_basis where id = p_touch; end if;
end $$;

create or replace function private.mkt_touch_upsert(p_org uuid, p_unit uuid, p_person uuid, p_opp uuid, p_at timestamptz, p_kind text, p_ref text, p_record uuid, p_utm jsonb, p_referrer text, p_path text) returns uuid
language plpgsql security definer set search_path = '' as $$
declare u jsonb := coalesce(p_utm, '{}'::jsonb); v_platform text := private.mkt_platform_of(u); v_id uuid; v_paid boolean := false; v_basis text; v_ck text; v_mediums text[];
begin
  select paid_mediums into v_mediums from public.mkt_settings where org_id = p_org;
  v_mediums := coalesce(v_mediums, array['cpc','ppc','paid','paid_social','paidsocial','paid-social','cpm','display','ads']);
  v_ck := case when u ? 'fbclid' then 'fbclid' when u ? 'gclid' then 'gclid' when u ? 'wbraid' then 'wbraid' when u ? 'gbraid' then 'gbraid' end;
  if v_platform in ('meta','google') then
    if v_ck is not null then v_paid := true; v_basis := 'click_id';
    elsif u ->> 'hp_campaign_id' is not null then v_paid := true; v_basis := 'campaign_id';
    elsif lower(coalesce(u ->> 'utm_medium', '')) = any (v_mediums) then v_paid := true; v_basis := 'medium'; end if;
  end if;
  insert into public.mkt_touches (org_id, unit_id, person_id, opportunity_id, touched_at, kind, source_ref, record_id, utm_source, utm_medium, utm_campaign, utm_content, utm_term, utm_id,
      ext_campaign_id, ext_adset_id, ext_ad_id, click_id_kind, click_id, click_consent, platform, is_paid, paid_basis, entry_path, referrer_host)
    values (p_org, p_unit, p_person, p_opp, p_at, p_kind, p_ref, p_record, u ->> 'utm_source', u ->> 'utm_medium', u ->> 'utm_campaign', u ->> 'utm_content', u ->> 'utm_term', u ->> 'utm_id',
      coalesce(u ->> 'hp_campaign_id', case when u ->> 'utm_id' ~ '^[0-9]{5,25}$' then u ->> 'utm_id' end), u ->> 'hp_adset_id', u ->> 'hp_ad_id', v_ck, case when v_ck is not null then u ->> v_ck end, v_ck is not null,
      v_platform, v_paid, v_basis, left(p_path, 200), nullif(split_part(coalesce(p_referrer, ''), '/', 1), ''))
    on conflict (kind, record_id) do update set person_id = coalesce(excluded.person_id, public.mkt_touches.person_id), opportunity_id = coalesce(excluded.opportunity_id, public.mkt_touches.opportunity_id)
    returning id into v_id;
  if p_person is not null then insert into public.mkt_person_origin (person_id, org_id, touch_id) values (p_person, p_org, v_id) on conflict do nothing; end if;
  perform private.mkt_link_touch_campaign(v_id);
  return v_id;
end $$;

create or replace function private.mkt_touch_form() returns trigger language plpgsql security definer set search_path = '' as $$
declare f public.forms;
begin
  select * into f from public.forms where id = new.form_id;
  perform private.mkt_touch_upsert(new.org_id, f.unit_id, new.person_id, new.opportunity_id, new.created_at, 'form', 'form:' || new.form_id::text, new.id, new.utm, new.referrer,
    (select '/' || pg.slug from public.pages pg where pg.id = new.page_id));
  return new;
end $$;
create trigger mkt_touch_form after insert on public.form_submissions for each row execute function private.mkt_touch_form();

create or replace function private.mkt_touch_quiz() returns trigger language plpgsql security definer set search_path = '' as $$
begin
  perform private.mkt_touch_upsert(new.org_id, new.unit_id, new.person_id, new.opportunity_id, new.started_at, 'quiz', 'quiz:' || new.journey, new.id, new.utm, new.referrer, new.origin_path);
  return new;
end $$;
create trigger mkt_touch_quiz after insert or update of person_id, opportunity_id on public.quiz_leads for each row execute function private.mkt_touch_quiz();

-- ---------------------------------------------------------------- atribuição por oportunidade
create table public.mkt_attributions (
  opportunity_id uuid primary key references public.opportunities(id) on delete cascade,
  org_id uuid not null, unit_id uuid, person_id uuid not null,
  model text not null default 'last_paid_touch', window_days int not null, config_version int not null,
  opp_created_at timestamptz not null,
  outcome text not null check (outcome in ('attributed','organic','no_touch')),    -- atribuída a toque pago | só toques não pagos | nenhum toque registrado
  touch_id uuid references public.mkt_touches(id) on delete set null,
  first_touch_id uuid references public.mkt_touches(id) on delete set null,
  computed_at timestamptz not null default now(), computed_by text not null default 'on_create' check (computed_by in ('on_create','recompute','backfill'))
);
create index mkt_attr_org_time on public.mkt_attributions (org_id, opp_created_at);
create index mkt_attr_touch on public.mkt_attributions (touch_id);
create table public.mkt_attribution_log (
  id bigserial primary key, org_id uuid not null, run_by uuid references auth.users(id) on delete set null, at timestamptz not null default now(),
  kind text not null check (kind in ('recompute','backfill','relink')), window_from date, window_to date, changed int not null default 0, config_version int, note text
);
alter table public.mkt_attributions enable row level security; alter table public.mkt_attribution_log enable row level security;
create policy mkt_attr_admin_read on public.mkt_attributions for select to authenticated using (org_id = private.current_org() and private.mkt_admin());
create policy mkt_attr_log_admin_read on public.mkt_attribution_log for select to authenticated using (org_id = private.current_org() and private.mkt_admin());
revoke all on public.mkt_attributions, public.mkt_attribution_log from anon;
revoke insert, update, delete, truncate on public.mkt_attributions, public.mkt_attribution_log from authenticated;

create or replace function private.mkt_attribute_opportunity(p_opp uuid, p_by text default 'on_create', p_replace boolean default false) returns void language plpgsql security definer set search_path = '' as $$
declare o public.opportunities; st public.mkt_settings; t_id uuid; v_first uuid; v_any boolean; v_outcome text;
begin
  select * into o from public.opportunities where id = p_opp; if o.id is null then return; end if;
  if not p_replace and exists (select 1 from public.mkt_attributions where opportunity_id = p_opp) then return; end if;      -- calculada uma vez; só muda por ação explícita
  perform private.mkt_seed_defaults(o.org_id);
  select * into st from public.mkt_settings where org_id = o.org_id;
  select x.id into t_id from public.mkt_touches x
   where x.org_id = o.org_id and (x.opportunity_id = o.id or x.person_id = o.person_id) and x.is_paid
     and x.touched_at <= o.created_at and x.touched_at >= o.created_at - make_interval(days => st.attribution_window_days)
   order by x.touched_at desc, x.created_at desc, x.id desc limit 1;                                                             -- último toque pago elegível; desempate: registrado por último, depois id
  select exists (select 1 from public.mkt_touches x where x.org_id = o.org_id and (x.opportunity_id = o.id or x.person_id = o.person_id) and x.touched_at <= o.created_at) into v_any;
  select touch_id into v_first from public.mkt_person_origin where person_id = o.person_id;
  v_outcome := case when t_id is not null then 'attributed' when v_any then 'organic' else 'no_touch' end;
  insert into public.mkt_attributions (opportunity_id, org_id, unit_id, person_id, model, window_days, config_version, opp_created_at, outcome, touch_id, first_touch_id, computed_by)
    values (o.id, o.org_id, o.unit_id, o.person_id, 'last_paid_touch', st.attribution_window_days, st.config_version, o.created_at, v_outcome, t_id, v_first, p_by)
    on conflict (opportunity_id) do update set unit_id = excluded.unit_id, window_days = excluded.window_days, config_version = excluded.config_version, outcome = excluded.outcome,
      touch_id = excluded.touch_id, first_touch_id = excluded.first_touch_id, computed_at = now(), computed_by = excluded.computed_by;
end $$;
create or replace function private.mkt_attribute_opp_trg() returns trigger language plpgsql security definer set search_path = '' as $$
begin perform private.mkt_attribute_opportunity(new.id); return null; end $$;
-- no COMMIT: os toques do envio (mesma transação) já existem quando a atribuição é calculada
create constraint trigger mkt_attribute_opp after insert on public.opportunities deferrable initially deferred for each row execute function private.mkt_attribute_opp_trg();

-- ---------------------------------------------------------------- atribuição por venda (cada venda confirmada é ligada UMA vez)
create table public.mkt_sale_attributions (
  sale_id uuid primary key references public.sales(id) on delete cascade,
  org_id uuid not null, unit_id uuid, person_id uuid not null,
  opportunity_id uuid references public.opportunities(id) on delete set null,
  link_basis text not null check (link_basis in ('sale_opportunity','person_latest_opportunity','none')),
  outcome text not null check (outcome in ('attributed','organic','no_touch','no_opportunity')),
  touch_id uuid references public.mkt_touches(id) on delete set null,
  customer_type text not null check (customer_type in ('new','repeat','expansion')),
  sold_at timestamptz not null, computed_at timestamptz not null default now()
);
create index mkt_sale_attr_org_time on public.mkt_sale_attributions (org_id, sold_at);
alter table public.mkt_sale_attributions enable row level security;
create policy mkt_sale_attr_admin_read on public.mkt_sale_attributions for select to authenticated using (org_id = private.current_org() and private.mkt_admin());
revoke all on public.mkt_sale_attributions from anon; revoke insert, update, delete, truncate on public.mkt_sale_attributions from authenticated;

create or replace function private.mkt_attribute_sale(p_sale uuid, p_replace boolean default false) returns void language plpgsql security definer set search_path = '' as $$
declare s public.sales; v_opp uuid; v_basis text := 'none'; a public.mkt_attributions; v_outcome text; v_type text; v_at timestamptz;
begin
  select * into s from public.sales where id = p_sale; if s.id is null or s.status <> 'confirmed' then return; end if;
  if not p_replace and exists (select 1 from public.mkt_sale_attributions where sale_id = p_sale) then return; end if;
  v_at := coalesce(s.sold_at, now());
  if s.opportunity_id is not null then v_opp := s.opportunity_id; v_basis := 'sale_opportunity';
  else select o.id into v_opp from public.opportunities o where o.person_id = s.person_id and o.org_id = s.org_id and o.created_at <= v_at order by o.created_at desc, o.id desc limit 1;
       if v_opp is not null then v_basis := 'person_latest_opportunity'; end if; end if;
  if v_opp is not null then
    perform private.mkt_attribute_opportunity(v_opp); select * into a from public.mkt_attributions where opportunity_id = v_opp;
    v_outcome := coalesce(a.outcome, 'no_touch');
  else v_outcome := 'no_opportunity'; end if;
  -- cliente novo = sem venda confirmada anterior; expansão = algum produto desta venda ainda não comprado; senão recompra
  if not exists (select 1 from public.sales x where x.person_id = s.person_id and x.org_id = s.org_id and x.id <> s.id and x.status = 'confirmed' and coalesce(x.sold_at, x.created_at) < v_at) then v_type := 'new';
  elsif exists (select 1 from public.sale_items si where si.sale_id = s.id and not exists (select 1 from public.sale_items pi join public.sales ps on ps.id = pi.sale_id
                 where ps.person_id = s.person_id and ps.id <> s.id and ps.status = 'confirmed' and coalesce(ps.sold_at, ps.created_at) < v_at and pi.product_id = si.product_id)) then v_type := 'expansion';
  else v_type := 'repeat'; end if;
  insert into public.mkt_sale_attributions (sale_id, org_id, unit_id, person_id, opportunity_id, link_basis, outcome, touch_id, customer_type, sold_at)
    values (s.id, s.org_id, s.unit_id, s.person_id, v_opp, v_basis, v_outcome, a.touch_id, v_type, v_at)
    on conflict (sale_id) do update set opportunity_id = excluded.opportunity_id, link_basis = excluded.link_basis, outcome = excluded.outcome, touch_id = excluded.touch_id,
      customer_type = excluded.customer_type, sold_at = excluded.sold_at, computed_at = now();
end $$;
create or replace function private.mkt_attribute_sale_trg() returns trigger language plpgsql security definer set search_path = '' as $$
begin if new.status = 'confirmed' then perform private.mkt_attribute_sale(new.id); end if; return null; end $$;
create trigger mkt_attribute_sale after insert or update of status on public.sales for each row execute function private.mkt_attribute_sale_trg();

revoke all on function private.mkt_clean_utm(jsonb), private.mkt_clean_url(text), private.mkt_platform_of(jsonb), private.mkt_link_touch_campaign(uuid),
  private.mkt_touch_upsert(uuid, uuid, uuid, uuid, timestamptz, text, text, uuid, jsonb, text, text), private.mkt_attribute_opportunity(uuid, text, boolean), private.mkt_attribute_sale(uuid, boolean) from public, anon, authenticated;
