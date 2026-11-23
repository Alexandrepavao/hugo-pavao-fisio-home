-- HP Group Hub — 154 Orçamento: ao RECALCULAR depois de mudar o plano, um desconto que passou do novo limite autorizado é reduzido ao máximo (com aviso `discount_adjusted`), sem travar a geração.
-- A escolha manual de desconto (deck_quote_update) continua recusando qualquer valor acima do autorizado.

create or replace function private.deck_quote_offer(e public.patient_enrollments, p_product uuid, p_quote jsonb, p_plan_sessions int) returns jsonb language plpgsql stable security definer set search_path = '' as $$
declare v public.products; q jsonb := coalesce(p_quote, '{}'::jsonb); v_qty int; v_src text; v_sub bigint; v_disc bigint; v_total bigint; v_n int; v_first date; v_valid date; v_methods text[]; v_inst jsonb := '[]'::jsonb;
  v_covered int; v_pkg boolean; i int; v_base bigint; v_rem bigint; v_cap bigint; v_adjusted boolean := false;
begin
  if p_product is null then return null; end if;
  select * into v from public.products where id = p_product and org_id = e.org_id and active;
  if v.id is null then raise exception 'escolha um produto ativo da organização' using errcode = '22023'; end if;
  v_pkg := v.kind::text in ('package', 'plan');
  -- quantidade: manual quando a profissional define; senão pacote = 1 e serviço avulso = sessões do plano inicial (acompanha as mudanças do plano)
  if coalesce(q ->> 'quantity_source', '') = 'manual' and (q ->> 'quantity') is not null then v_qty := (q ->> 'quantity')::int; v_src := 'manual';
  else v_qty := case when v_pkg then 1 else greatest(coalesce(p_plan_sessions, 1), 1) end; v_src := 'auto'; end if;
  if v_qty < 1 or v_qty > 200 then raise exception 'quantidade inválida (1 a 200)' using errcode = '22023'; end if;
  v_sub := v.price_cents * v_qty;
  v_disc := coalesce(nullif(q ->> 'discount_cents', '')::bigint, 0);
  if v_disc < 0 or v_disc > v_sub then raise exception 'desconto inválido' using errcode = '22023'; end if;
  v_cap := floor(v_sub * v.max_discount_pct / 100.0);
  -- recálculo por mudança do plano: o desconto anterior que passou do novo limite é REDUZIDO ao máximo autorizado (e o documento avisa), em vez de travar o fluxo
  if v_disc > v_cap and coalesce((q ->> 'recalc')::boolean, false) then v_disc := v_cap; v_adjusted := true; end if;
  if v_disc > v_cap then raise exception 'desconto acima do autorizado para este produto (máximo % %% do valor)', v.max_discount_pct using errcode = '22023'; end if;
  v_total := v_sub - v_disc;
  v_n := coalesce(nullif(q ->> 'installments_count', '')::int, 1); if v_n < 1 or v_n > 12 then raise exception 'parcelas: de 1 a 12' using errcode = '22023'; end if;
  v_first := nullif(q ->> 'first_due', '')::date; if v_first is not null and v_first < current_date then raise exception 'o primeiro vencimento não pode estar no passado' using errcode = '22023'; end if;
  v_valid := coalesce(nullif(q ->> 'valid_until', '')::date, current_date + 15); if v_valid < current_date then raise exception 'a validade da proposta não pode estar no passado' using errcode = '22023'; end if;
  v_methods := coalesce((select array_agg(distinct x) from jsonb_array_elements_text(coalesce(q -> 'payment_methods', '["pix"]'::jsonb)) x), '{}');
  if exists (select 1 from unnest(v_methods) m where m not in ('pix', 'dinheiro', 'cartao', 'transferencia')) then raise exception 'forma de pagamento inválida' using errcode = '22023'; end if;
  if coalesce(array_length(v_methods, 1), 0) = 0 then raise exception 'escolha ao menos uma forma de pagamento' using errcode = '22023'; end if;
  v_base := v_total / v_n; v_rem := v_total - v_base * v_n;
  for i in 1..v_n loop
    v_inst := v_inst || jsonb_build_array(jsonb_build_object('no', i, 'amount_cents', v_base + case when i = 1 then v_rem else 0 end, 'due_date', case when v_first is null then null else (v_first + ((i - 1) || ' months')::interval)::date end));
  end loop;
  v_covered := case when v_pkg then coalesce(v.sessions_count, 0) * v_qty else v_qty end;
  return jsonb_build_object('product_id', v.id, 'name', v.name, 'kind', v.kind, 'price_cents', v.price_cents, 'sessions_count', v.sessions_count, 'validity_days', v.validity_days,
    'per_session_cents', case when v_covered > 0 then round(v_total::numeric / v_covered)::bigint end, 'consume_on_no_show', v.consume_on_no_show, 'late_cancel_hours', v.late_cancel_hours, 'quoted_at', now(),
    'quantity', v_qty, 'quantity_source', v_src, 'unit_price_cents', v.price_cents, 'subtotal_cents', v_sub, 'discount_cents', v_disc, 'discount_max_pct', v.max_discount_pct, 'total_cents', v_total,
    'installments_count', v_n, 'first_due', v_first, 'installments', v_inst, 'payment_methods', to_jsonb(v_methods), 'valid_until', v_valid,
    'sessions_covered', v_covered, 'plan_sessions', p_plan_sessions, 'plan_mismatch', (p_plan_sessions is not null and v_covered > 0 and v_covered <> p_plan_sessions), 'discount_adjusted', v_adjusted);
end $$;

create or replace function public.deck_draft_generate(p_enrollment uuid, p_product uuid default null) returns jsonb language plpgsql security definer set search_path = '' as $$
declare e public.patient_enrollments; p public.evaluation_presentations; v_snap jsonb; v_offer jsonb; v_prev jsonb; r public.presentation_decks;
begin
  e := private.presentation_can_edit(p_enrollment);
  perform pg_advisory_xact_lock(hashtextextended('deck:' || e.id::text, 0));
  select * into p from public.evaluation_presentations where enrollment_id = e.id;
  if not found or p.published_version = 0 then raise exception 'publique a apresentação antes de gerar a apresentação em PDF' using errcode = '22023'; end if;
  select offer into v_prev from public.presentation_decks where enrollment_id = e.id and status = 'draft';
  v_snap := private.deck_snapshot(e, p);
  -- mesmo produto: reaproveita parâmetros do orçamento (desconto, parcelas, formas, validade) e RECALCULA com o plano atual; produto novo: padrão
  v_offer := private.deck_quote_offer(e, p_product, case when v_prev ->> 'product_id' = p_product::text then v_prev || '{"recalc": true}'::jsonb else null end, nullif(v_snap ->> 'planned_sessions', '')::int);
  delete from public.presentation_decks where enrollment_id = e.id and status = 'draft';
  insert into public.presentation_decks (org_id, enrollment_id, person_id, presentation_id, presentation_version, snapshot, offer, selection, is_demo, created_by)
    values (e.org_id, e.id, e.person_id, p.id, p.published_version, v_snap, v_offer, private.deck_default_selection(v_snap, v_offer), (v_snap #>> '{patient,name}') ~* '\(exemplo\)', (select auth.uid())) returning * into r;
  perform private.log_clinical_access(e.person_id, 'professional', 'deck');
  return private.deck_json(r);
end $$;

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
  if p_clear_product then v_offer := null; v_sel := v_sel || jsonb_build_object('commercial', false);
  elsif p_product is not null then
    v_offer := private.deck_quote_offer(e, p_product, case when d.offer ->> 'product_id' = p_product::text then d.offer || '{"recalc": true}'::jsonb else null end, nullif(d.snapshot ->> 'planned_sessions', '')::int);
    if p_selection is null or not (p_selection ? 'commercial') then v_sel := v_sel || jsonb_build_object('commercial', true); end if;
  end if;
  if coalesce((v_sel ->> 'commercial')::boolean, false) and v_offer is null then raise exception 'escolha o produto antes de incluir valores e condições comerciais' using errcode = '22023'; end if;
  update public.presentation_decks set selection = v_sel, offer = v_offer, updated_at = now() where id = d.id returning * into d;
  return private.deck_json(d);
end $$;
