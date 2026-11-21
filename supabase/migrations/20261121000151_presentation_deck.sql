-- HP Group Hub — 151 Apresentação PDF personalizada pós-avaliação ("deck" 16:9) — substitui o e-book simples da 150 (Dev; a 150 só existia nesta branch).
-- Fluxo: avaliação registrada e apresentação publicada → GERAR RASCUNHO (retrato dos dados da avaliação) → o profissional REVISA (escolhe o que entra e a oferta) → APROVAR VERSÃO (imutável) →
-- visualizar → exportar PDF. O PDF é sempre desenhado a partir do retrato aprovado: mudanças futuras na avaliação NÃO alteram a versão emitida (trigger impede qualquer UPDATE/DELETE em versão aprovada).
-- O retrato guarda (a) a apresentação publicada (o que o paciente já pode ver), (b) as medidas realmente registradas, (c) o conjunto de dados que o portal usa (gêmeos prof_*) para a SIMULAÇÃO do aplicativo
-- com os componentes reais, (d) evidências aprovadas escolhidas, (e) a marca. Nada de nota interna. A oferta/valores ficam à parte e só entram se o profissional escolher incluir.
-- "Próximo passo" do paciente só REGISTRA o interesse (interação + tarefa no CRM): nunca vende, cobra nem ativa.
drop function if exists public.presentation_ebook_options(uuid), public.presentation_ebook_generate(uuid, uuid), public.presentation_ebook_get(uuid), public.my_ebook(), private.ebook_snapshot(public.patient_enrollments, public.evaluation_presentations, uuid);
drop table if exists public.presentation_ebooks;

create table public.presentation_decks (
  id uuid primary key default gen_random_uuid(),
  org_id uuid not null references public.organizations(id) on delete restrict,
  enrollment_id uuid not null references public.patient_enrollments(id) on delete cascade,
  person_id uuid not null references public.people(id) on delete restrict,
  presentation_id uuid not null references public.evaluation_presentations(id) on delete cascade,
  presentation_version int not null,
  status text not null default 'draft' check (status in ('draft', 'approved', 'superseded')),
  version int,                                   -- numeração só das versões aprovadas
  snapshot jsonb not null,                       -- retrato dos dados da avaliação
  offer jsonb,                                   -- condições comerciais (produto da organização) — opcionais
  selection jsonb not null,                      -- o que entra no documento
  is_demo boolean not null default false,
  content_hash text,
  created_by uuid references auth.users(id) on delete set null,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  approved_by uuid references auth.users(id) on delete set null,
  approved_at timestamptz,
  unique (enrollment_id, version)
);
create unique index presentation_decks_one_draft on public.presentation_decks (enrollment_id) where status = 'draft';
create index presentation_decks_person_idx on public.presentation_decks (org_id, person_id, status, version desc);
alter table public.presentation_decks enable row level security;
revoke all on public.presentation_decks from public, anon, authenticated;
select private.org_fk_map_refresh();
select private.org_fk_guard_attach();

-- versão aprovada é um RETRATO: nada muda nela (só a passagem aprovada → substituída quando nasce uma versão mais nova); nenhuma versão é apagada
create or replace function private.deck_immutable() returns trigger language plpgsql set search_path = '' as $$
begin
  if tg_op = 'DELETE' then
    if old.status <> 'draft' then raise exception 'versão aprovada não pode ser apagada' using errcode = '42501'; end if;
    return old;
  end if;
  if old.status in ('approved', 'superseded') then
    if old.status = 'approved' and new.status = 'superseded' and (to_jsonb(new) - 'status' - 'updated_at') = (to_jsonb(old) - 'status' - 'updated_at') then return new; end if;
    raise exception 'versão aprovada é imutável: gere um novo rascunho' using errcode = '42501';
  end if;
  return new;
end $$;
create trigger presentation_decks_immutable before update or delete on public.presentation_decks for each row execute function private.deck_immutable();

create or replace function private.deck_default_selection(p_snapshot jsonb, p_offer jsonb) returns jsonb language sql immutable set search_path = '' as $$
  select jsonb_build_object('goals', true, 'start', true, 'path', true, 'evolution', true, 'app', true, 'videos', true, 'continuity', true,
    'evidence', jsonb_array_length(coalesce(p_snapshot #> '{presentation,content,evidence}', '[]'::jsonb)) > 0, 'plan', true, 'commercial', p_offer is not null, 'next', true)
$$;

create or replace function private.deck_offer(e public.patient_enrollments, p_product uuid) returns jsonb language plpgsql stable security definer set search_path = '' as $$
declare v public.products;
begin
  if p_product is null then return null; end if;
  select * into v from public.products where id = p_product and org_id = e.org_id and active;
  if v.id is null then raise exception 'escolha um produto ativo da organização' using errcode = '22023'; end if;
  return jsonb_build_object('product_id', v.id, 'name', v.name, 'kind', v.kind, 'price_cents', v.price_cents, 'sessions_count', v.sessions_count, 'validity_days', v.validity_days,
    'per_session_cents', case when coalesce(v.sessions_count, 0) > 0 then round(v.price_cents::numeric / v.sessions_count)::bigint end, 'consume_on_no_show', v.consume_on_no_show, 'late_cancel_hours', v.late_cancel_hours,
    'quoted_at', now());
end $$;

create or replace function private.deck_snapshot(e public.patient_enrollments, p public.evaluation_presentations) returns jsonb language plpgsql security definer set search_path = '' as $$
declare v_payload jsonb; v_ver int; raw jsonb := '{}'::jsonb; x jsonb; v_name text;
begin
  select payload, version into v_payload, v_ver from public.presentation_versions where presentation_id = p.id and version = p.published_version;
  select coalesce(nullif(btrim(preferred_name), ''), full_name) into v_name from public.people where id = e.person_id;
  -- dados que o PORTAL do paciente usa (gêmeos prof_*: só leitura, exigem vínculo assistencial); cada parte ausente fica ausente — nunca inventada
  begin x := public.presentation_preview_home(e.person_id); raw := raw || jsonb_build_object('home', x); exception when others then null; end;
  begin x := public.prof_patient_evolution(e.person_id); raw := raw || jsonb_build_object('evo', x); exception when others then null; end;
  begin x := public.prof_training(e.person_id); raw := raw || jsonb_build_object('trn', x); exception when others then null; end;
  begin x := public.professional_journey(e.person_id); raw := raw || jsonb_build_object('jny', x); exception when others then null; end;
  begin x := public.presentation_preview_appointments(e.person_id); raw := raw || jsonb_build_object('appts', x); exception when others then null; end;
  begin x := public.prof_journey_plan(e.person_id); raw := raw || jsonb_build_object('plan', x); exception when others then null; end;
  begin x := public.prof_education(e.person_id); raw := raw || jsonb_build_object('edu', x); exception when others then null; end;
  return jsonb_build_object(
    'clinic', private.org_brand_json(e.org_id) - 'org_id' - 'texts' - 'version' - 'legal_name' - 'logo_dark_path' - 'color_ink' - 'email_from_name' - 'support_phone',
    'patient', jsonb_build_object('name', v_name, 'first_name', split_part(v_name, ' ', 1)),
    'professional', (select display_name from public.professionals where id = e.professional_id),
    'evaluation_at', (select lower(period) from public.appointments where id = e.evaluation_appointment_id),
    'enrollment_status', e.status,
    'presentation', jsonb_build_object('version', v_ver, 'content', v_payload),
    'measures', coalesce(raw -> 'evo' -> 'series', '[]'::jsonb),
    'planned_sessions', raw #> '{plan,plan,planned_sessions}',
    'raw', raw,
    'generated_at', now());
end $$;

create or replace function public.deck_options(p_enrollment uuid) returns jsonb language plpgsql stable security definer set search_path = '' as $$
declare e public.patient_enrollments;
begin
  e := private.presentation_can_edit(p_enrollment);
  return coalesce((select jsonb_agg(jsonb_build_object('id', p.id, 'name', p.name, 'kind', p.kind, 'price_cents', p.price_cents, 'sessions_count', p.sessions_count, 'validity_days', p.validity_days) order by p.price_cents, p.name)
                     from public.products p where p.org_id = e.org_id and p.active and p.kind = 'package' and p.price_cents > 0), '[]'::jsonb);
end $$;

create or replace function private.deck_json(d public.presentation_decks) returns jsonb language sql stable set search_path = '' as $$
  select jsonb_build_object('id', d.id, 'status', d.status, 'version', d.version, 'presentation_version', d.presentation_version, 'snapshot', d.snapshot, 'offer', d.offer, 'selection', d.selection, 'is_demo', d.is_demo,
    'content_hash', d.content_hash, 'created_at', d.created_at, 'updated_at', d.updated_at, 'approved_at', d.approved_at)
$$;

-- 1) gerar (ou refazer) o RASCUNHO a partir da apresentação publicada
create or replace function public.deck_draft_generate(p_enrollment uuid, p_product uuid default null) returns jsonb language plpgsql security definer set search_path = '' as $$
declare e public.patient_enrollments; p public.evaluation_presentations; v_snap jsonb; v_offer jsonb; r public.presentation_decks;
begin
  e := private.presentation_can_edit(p_enrollment);
  perform pg_advisory_xact_lock(hashtextextended('deck:' || e.id::text, 0));
  select * into p from public.evaluation_presentations where enrollment_id = e.id;
  if not found or p.published_version = 0 then raise exception 'publique a apresentação antes de gerar a apresentação em PDF' using errcode = '22023'; end if;
  v_snap := private.deck_snapshot(e, p); v_offer := private.deck_offer(e, p_product);
  delete from public.presentation_decks where enrollment_id = e.id and status = 'draft';
  insert into public.presentation_decks (org_id, enrollment_id, person_id, presentation_id, presentation_version, snapshot, offer, selection, is_demo, created_by)
    values (e.org_id, e.id, e.person_id, p.id, p.published_version, v_snap, v_offer, private.deck_default_selection(v_snap, v_offer), (v_snap #>> '{patient,name}') ~* '\(exemplo\)', (select auth.uid())) returning * into r;
  perform private.log_clinical_access(e.person_id, 'professional', 'deck');
  return private.deck_json(r);
end $$;

-- 2) revisar: o profissional escolhe o que entra e a oferta (só rascunho)
create or replace function public.deck_draft_update(p_id uuid, p_selection jsonb, p_product uuid default null, p_clear_product boolean default false) returns jsonb language plpgsql security definer set search_path = '' as $$
declare d public.presentation_decks; e public.patient_enrollments; k text; v_sel jsonb; v_offer jsonb;
begin
  select * into d from public.presentation_decks where id = p_id; if not found then raise exception 'rascunho não encontrado' using errcode = '42501'; end if;
  e := private.presentation_can_edit(d.enrollment_id);
  if d.status <> 'draft' then raise exception 'só o rascunho pode ser alterado' using errcode = '42501'; end if;
  v_sel := d.selection;
  if p_selection is not null then
    for k in select jsonb_object_keys(p_selection) loop
      if not (v_sel ? k) or jsonb_typeof(p_selection -> k) <> 'boolean' then raise exception 'seleção inválida: %', k using errcode = '22023'; end if;
      v_sel := v_sel || jsonb_build_object(k, p_selection -> k);
    end loop;
  end if;
  v_offer := d.offer;
  if p_clear_product then v_offer := null; v_sel := v_sel || jsonb_build_object('commercial', false); elsif p_product is not null then v_offer := private.deck_offer(e, p_product); if p_selection is null or not (p_selection ? 'commercial') then v_sel := v_sel || jsonb_build_object('commercial', true); end if; end if;   -- escolher o produto inclui as condições comerciais (a menos que o profissional diga o contrário)
  if coalesce((v_sel ->> 'commercial')::boolean, false) and v_offer is null then raise exception 'escolha o produto antes de incluir valores e condições comerciais' using errcode = '22023'; end if;
  update public.presentation_decks set selection = v_sel, offer = v_offer, updated_at = now() where id = d.id returning * into d;
  return private.deck_json(d);
end $$;

-- 3) aprovar a versão (imutável)
create or replace function public.deck_approve(p_id uuid) returns jsonb language plpgsql security definer set search_path = '' as $$
declare d public.presentation_decks; e public.patient_enrollments; v_next int;
begin
  select * into d from public.presentation_decks where id = p_id; if not found then raise exception 'rascunho não encontrado' using errcode = '42501'; end if;
  e := private.presentation_can_edit(d.enrollment_id);
  if d.status <> 'draft' then raise exception 'só o rascunho pode ser aprovado' using errcode = '42501'; end if;
  perform pg_advisory_xact_lock(hashtextextended('deck:' || e.id::text, 0));
  select coalesce(max(version), 0) + 1 into v_next from public.presentation_decks where enrollment_id = e.id;
  update public.presentation_decks set status = 'superseded' where enrollment_id = e.id and status = 'approved';
  update public.presentation_decks set status = 'approved', version = v_next, approved_by = (select auth.uid()), approved_at = now(), updated_at = now(),
    content_hash = encode(sha256(convert_to((snapshot - 'generated_at')::text || coalesce(offer::text, '') || selection::text, 'UTF8')), 'hex') where id = d.id returning * into d;
  insert into public.audit_log (org_id, actor_user_id, action, entity_type, entity_id, unit_id) values (e.org_id, (select auth.uid()), 'deck_approved', 'presentation_decks', d.id::text, e.unit_id);
  return private.deck_json(d);
end $$;

-- leitura da equipe: rascunho atual + versões aprovadas
create or replace function public.deck_get(p_enrollment uuid) returns jsonb language plpgsql stable security definer set search_path = '' as $$
declare e public.patient_enrollments;
begin
  e := private.presentation_can_edit(p_enrollment);
  return jsonb_build_object(
    'draft', (select private.deck_json(d) from public.presentation_decks d where d.enrollment_id = e.id and d.status = 'draft'),
    'versions', coalesce((select jsonb_agg(jsonb_build_object('id', d.id, 'version', d.version, 'status', d.status, 'approved_at', d.approved_at, 'content_hash', d.content_hash, 'is_demo', d.is_demo) order by d.version desc)
                            from public.presentation_decks d where d.enrollment_id = e.id and d.status in ('approved', 'superseded')), '[]'::jsonb));
end $$;

create or replace function public.deck_read(p_id uuid) returns jsonb language plpgsql stable security definer set search_path = '' as $$
declare d public.presentation_decks;
begin
  select * into d from public.presentation_decks where id = p_id; if not found then raise exception 'sem permissão' using errcode = '42501'; end if;
  perform private.presentation_can_edit(d.enrollment_id);
  return private.deck_json(d);
end $$;

create or replace function public.deck_export_log(p_id uuid) returns void language plpgsql security definer set search_path = '' as $$
declare d public.presentation_decks; e public.patient_enrollments;
begin
  select * into d from public.presentation_decks where id = p_id; if not found then raise exception 'sem permissão' using errcode = '42501'; end if;
  e := private.presentation_can_edit(d.enrollment_id);
  insert into public.audit_log (org_id, actor_user_id, action, entity_type, entity_id, unit_id) values (e.org_id, (select auth.uid()), 'deck_exported', 'presentation_decks', d.id::text, e.unit_id);
end $$;

-- o PRÓPRIO paciente: última versão APROVADA (nunca rascunho), com o andamento atual do pagamento
create or replace function public.my_deck() returns jsonb language plpgsql stable security definer set search_path = '' as $$
declare v_person uuid := private.current_person(); v_org uuid := private.current_org(); d public.presentation_decks; v_sale uuid;
begin
  if v_person is null or v_org is null then return jsonb_build_object('exists', false); end if;
  select b.* into d from public.presentation_decks b join public.patient_enrollments e on e.id = b.enrollment_id
   where b.org_id = v_org and b.person_id = v_person and b.status = 'approved' and e.status in ('pending', 'active') order by b.version desc limit 1;
  if d.id is null then return jsonb_build_object('exists', false); end if;
  select s.id into v_sale from public.sales s where s.org_id = v_org and s.person_id = v_person and s.status = 'confirmed' order by s.created_at desc limit 1;
  return jsonb_build_object('exists', true, 'deck', private.deck_json(d), 'enrollment_status', (select status from public.patient_enrollments where id = d.enrollment_id),
    'payment', private.enrollment_payment_state(v_org, v_person),
    'installments', coalesce((select jsonb_agg(jsonb_build_object('no', c.installment_no, 'due_date', c.due_date, 'amount_cents', c.amount_cents, 'status', c.status) order by c.installment_no) from public.receivables c where c.sale_id = v_sale and c.org_id = v_org), '[]'::jsonb),
    'responded', coalesce((select jsonb_agg(distinct split_part(t.dedupe_key, ':', 3)) from public.crm_tasks t where t.org_id = v_org and t.person_id = v_person and t.dedupe_key like 'deck-resp:' || d.id::text || ':%'), '[]'::jsonb));
end $$;

-- "Próximo passo": só REGISTRA o interesse (interação + tarefa para a equipe). Nunca cria venda, cobrança, pagamento nem ativa o paciente.
create or replace function public.my_deck_respond(p_deck uuid, p_choice text) returns jsonb language plpgsql security definer set search_path = '' as $$
declare v_person uuid := private.current_person(); v_org uuid := private.current_org(); d public.presentation_decks; v_opp record; v_title text; v_unit uuid; v_new int := 0;
begin
  if p_choice not in ('questions', 'start') then raise exception 'escolha inválida' using errcode = '22023'; end if;
  if v_person is null or v_org is null then raise exception 'sem permissão' using errcode = '42501'; end if;
  select * into d from public.presentation_decks where id = p_deck and org_id = v_org and person_id = v_person and status = 'approved';
  if not found then raise exception 'proposta não encontrada' using errcode = '42501'; end if;
  perform private.rate_limit('deck_resp:' || v_person::text, interval '10 minutes', 10);
  select o.id, o.owner_user_id, o.unit_id into v_opp from public.opportunities o where o.org_id = v_org and o.person_id = v_person and o.status = 'open' order by o.created_at desc limit 1;
  v_unit := coalesce(v_opp.unit_id, (select unit_id from public.patient_enrollments where id = d.enrollment_id));
  v_title := case p_choice when 'questions' then 'Paciente quer esclarecer dúvidas sobre o plano proposto' else 'Paciente quer iniciar o acompanhamento — confirmar contratação' end;
  insert into public.crm_tasks (org_id, unit_id, opportunity_id, person_id, assignee_user_id, kind, title, due_at, dedupe_key)
    values (v_org, v_unit, v_opp.id, v_person, v_opp.owner_user_id, 'follow_up', v_title, now() + interval '1 hour', 'deck-resp:' || d.id::text || ':' || p_choice) on conflict do nothing;
  get diagnostics v_new = row_count;
  if v_new > 0 then insert into public.interactions (org_id, person_id, unit_id, opportunity_id, channel, summary) values (v_org, v_person, v_unit, v_opp.id, 'system', v_title || ' (pela apresentação em PDF, versão ' || d.version || ')'); end if;
  return jsonb_build_object('recorded', true, 'new', v_new > 0, 'choice', p_choice);
end $$;

revoke all on function public.deck_options(uuid), public.deck_draft_generate(uuid, uuid), public.deck_draft_update(uuid, jsonb, uuid, boolean), public.deck_approve(uuid), public.deck_get(uuid), public.deck_read(uuid), public.deck_export_log(uuid),
  public.my_deck(), public.my_deck_respond(uuid, text) from public, anon;
revoke all on function private.deck_snapshot(public.patient_enrollments, public.evaluation_presentations), private.deck_offer(public.patient_enrollments, uuid), private.deck_json(public.presentation_decks), private.deck_default_selection(jsonb, jsonb), private.deck_immutable() from public, anon, authenticated;
grant execute on function public.deck_options(uuid), public.deck_draft_generate(uuid, uuid), public.deck_draft_update(uuid, jsonb, uuid, boolean), public.deck_approve(uuid), public.deck_get(uuid), public.deck_read(uuid), public.deck_export_log(uuid),
  public.my_deck(), public.my_deck_respond(uuid, text) to authenticated;
