-- HP Group Hub — 150 E-book da apresentação (proposta de acompanhamento), Dev.
-- O fisioterapeuta, DEPOIS de publicar a apresentação, gera um e-book: um instantâneo versionado e imutável que reúne (1) a apresentação liberada ao paciente, (2) a oferta escolhida
-- (nome, valor, nº de sessões, validade — vindos do cadastro de produtos da própria organização; nada fixo no código), (3) como o pagamento ativa o acompanhamento (regra existente:
-- só a 1ª parcela quitada ativa) e (4) o acesso à área do paciente, com a marca da organização. O paciente lê o último e-book na própria área; o valor mostrado é o do dia em que foi gerado.
-- Sem dado clínico além do que o paciente já vê na apresentação (payload publicado); anotação interna e dados de outras pessoas nunca entram. Escrita só por função; sem leitura direta.
create table public.presentation_ebooks (
  id uuid primary key default gen_random_uuid(),
  org_id uuid not null references public.organizations(id) on delete restrict,
  enrollment_id uuid not null references public.patient_enrollments(id) on delete cascade,
  person_id uuid not null references public.people(id) on delete restrict,
  presentation_id uuid not null references public.evaluation_presentations(id) on delete cascade,
  presentation_version int not null,
  version int not null,
  product_id uuid references public.products(id) on delete set null,
  snapshot jsonb not null,
  content_hash text not null,
  created_by uuid references auth.users(id) on delete set null,
  created_at timestamptz not null default now(),
  unique (enrollment_id, version)
);
create index presentation_ebooks_person_idx on public.presentation_ebooks (org_id, person_id, created_at desc);
alter table public.presentation_ebooks enable row level security;
revoke all on public.presentation_ebooks from public, anon, authenticated;
select private.org_fk_map_refresh();
select private.org_fk_guard_attach();

-- opções de oferta (produtos ativos da organização) para o fisioterapeuta escolher
create or replace function public.presentation_ebook_options(p_enrollment uuid) returns jsonb language plpgsql stable security definer set search_path = '' as $$
declare e public.patient_enrollments;
begin
  e := private.presentation_can_edit(p_enrollment);
  return coalesce((select jsonb_agg(jsonb_build_object('id', p.id, 'name', p.name, 'kind', p.kind, 'price_cents', p.price_cents, 'sessions_count', p.sessions_count, 'validity_days', p.validity_days) order by p.price_cents, p.name)
                     from public.products p where p.org_id = e.org_id and p.active and p.kind = 'package' and p.price_cents > 0), '[]'::jsonb);
end $$;

create or replace function private.ebook_snapshot(e public.patient_enrollments, p public.evaluation_presentations, p_product uuid) returns jsonb language plpgsql stable security definer set search_path = '' as $$
declare v_payload jsonb; v_prod public.products; v_ver int;
begin
  select payload, version into v_payload, v_ver from public.presentation_versions where presentation_id = p.id and version = p.published_version;
  select * into v_prod from public.products where id = p_product and org_id = e.org_id and active;
  if v_prod.id is null then raise exception 'escolha um pacote ativo da organização' using errcode = '22023'; end if;
  return jsonb_build_object(
    'clinic', private.org_brand_json(e.org_id) - 'org_id' - 'texts' - 'version' - 'legal_name' - 'logo_dark_path' - 'color_ink' - 'email_from_name',
    'patient', jsonb_build_object('first_name', (select split_part(coalesce(nullif(btrim(preferred_name), ''), full_name), ' ', 1) from public.people where id = e.person_id)),
    'professional', (select display_name from public.professionals where id = e.professional_id),
    'presentation', jsonb_build_object('version', v_ver, 'content', v_payload),
    'offer', jsonb_build_object('product_id', v_prod.id, 'name', v_prod.name, 'price_cents', v_prod.price_cents, 'sessions_count', v_prod.sessions_count, 'validity_days', v_prod.validity_days,
      'per_session_cents', case when coalesce(v_prod.sessions_count, 0) > 0 then round(v_prod.price_cents::numeric / v_prod.sessions_count)::bigint end,
      'consume_on_no_show', v_prod.consume_on_no_show, 'late_cancel_hours', v_prod.late_cancel_hours),
    'payment_rule', jsonb_build_array(
      'A forma e as parcelas são combinadas com a clínica na contratação; o valor acima é o do dia em que este e-book foi gerado.',
      'O acompanhamento fica ATIVO quando a 1ª parcela da contratação estiver quitada. Confirmar a venda sozinho, ou pagar só parte da 1ª parcela, não ativa.',
      'Com o acompanhamento ativo, o pacote de sessões é liberado na sua área do paciente.'),
    'app', jsonb_build_array(
      'Você recebe um convite por e-mail para criar a sua senha (a senha nunca é enviada por e-mail).',
      'Na sua área do paciente você vê o objetivo, o plano, as sessões do pacote, a agenda, a evolução e os exercícios liberados.',
      'Você acompanha aqui o andamento do pagamento: aguardando ou confirmado.'));
end $$;

create or replace function public.presentation_ebook_generate(p_enrollment uuid, p_product uuid) returns jsonb language plpgsql security definer set search_path = '' as $$
declare e public.patient_enrollments; p public.evaluation_presentations; v_snap jsonb; v_hash text; v_last public.presentation_ebooks; r public.presentation_ebooks;
begin
  e := private.presentation_can_edit(p_enrollment);
  perform pg_advisory_xact_lock(hashtextextended('ebook:' || e.id::text, 0));
  select * into p from public.evaluation_presentations where enrollment_id = e.id;
  if not found or p.published_version = 0 then raise exception 'publique a apresentação antes de gerar o e-book' using errcode = '22023'; end if;
  v_snap := private.ebook_snapshot(e, p, p_product);
  v_hash := encode(sha256(convert_to(v_snap::text, 'UTF8')), 'hex');
  select * into v_last from public.presentation_ebooks where enrollment_id = e.id order by version desc limit 1;
  if v_last.id is not null and v_last.content_hash = v_hash then
    return jsonb_build_object('id', v_last.id, 'version', v_last.version, 'created', false, 'created_at', v_last.created_at, 'snapshot', v_last.snapshot);
  end if;
  insert into public.presentation_ebooks (org_id, enrollment_id, person_id, presentation_id, presentation_version, version, product_id, snapshot, content_hash, created_by)
    values (e.org_id, e.id, e.person_id, p.id, p.published_version, coalesce(v_last.version, 0) + 1, p_product, v_snap, v_hash, (select auth.uid())) returning * into r;
  perform private.log_clinical_access(e.person_id, 'professional', 'ebook');
  insert into public.audit_log (org_id, actor_user_id, action, entity_type, entity_id, unit_id) values (e.org_id, (select auth.uid()), 'ebook_generated', 'patient_enrollments', e.id::text, e.unit_id);
  return jsonb_build_object('id', r.id, 'version', r.version, 'created', true, 'created_at', r.created_at, 'snapshot', r.snapshot);
end $$;

-- último e-book da matrícula (equipe com vínculo/gestão)
create or replace function public.presentation_ebook_get(p_enrollment uuid) returns jsonb language plpgsql stable security definer set search_path = '' as $$
declare e public.patient_enrollments; r public.presentation_ebooks;
begin
  e := private.presentation_can_edit(p_enrollment);
  select * into r from public.presentation_ebooks where enrollment_id = e.id order by version desc limit 1;
  if r.id is null then return jsonb_build_object('exists', false); end if;
  return jsonb_build_object('exists', true, 'id', r.id, 'version', r.version, 'created_at', r.created_at, 'snapshot', r.snapshot, 'payment', private.enrollment_payment_state(e.org_id, e.person_id));
end $$;

-- o PRÓPRIO paciente lê o último e-book da sua matrícula, com o andamento atual do pagamento e as parcelas da própria contratação
create or replace function public.my_ebook() returns jsonb language plpgsql stable security definer set search_path = '' as $$
declare v_person uuid := private.current_person(); v_org uuid := private.current_org(); r public.presentation_ebooks; v_sale uuid;
begin
  if v_person is null or v_org is null then return jsonb_build_object('exists', false); end if;
  select b.* into r from public.presentation_ebooks b join public.patient_enrollments e on e.id = b.enrollment_id
   where b.org_id = v_org and b.person_id = v_person and e.status in ('pending', 'active') order by b.version desc limit 1;
  if r.id is null then return jsonb_build_object('exists', false); end if;
  select s.id into v_sale from public.sales s where s.org_id = v_org and s.person_id = v_person and s.status = 'confirmed' order by s.created_at desc limit 1;
  return jsonb_build_object('exists', true, 'version', r.version, 'created_at', r.created_at, 'snapshot', r.snapshot,
    'enrollment_status', (select status from public.patient_enrollments where id = r.enrollment_id), 'payment', private.enrollment_payment_state(v_org, v_person),
    'installments', coalesce((select jsonb_agg(jsonb_build_object('no', c.installment_no, 'due_date', c.due_date, 'amount_cents', c.amount_cents, 'status', c.status) order by c.installment_no)
                                from public.receivables c where c.sale_id = v_sale and c.org_id = v_org), '[]'::jsonb));
end $$;

revoke all on function public.presentation_ebook_options(uuid), public.presentation_ebook_generate(uuid, uuid), public.presentation_ebook_get(uuid), public.my_ebook(), private.ebook_snapshot(public.patient_enrollments, public.evaluation_presentations, uuid) from public, anon;
revoke all on function private.ebook_snapshot(public.patient_enrollments, public.evaluation_presentations, uuid) from authenticated;
grant execute on function public.presentation_ebook_options(uuid), public.presentation_ebook_generate(uuid, uuid), public.presentation_ebook_get(uuid), public.my_ebook() to authenticated;
