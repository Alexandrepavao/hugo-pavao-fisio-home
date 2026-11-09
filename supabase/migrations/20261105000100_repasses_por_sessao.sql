-- HP Group Hub — 100 Portais F5: repasse do fisioterapeuta por SESSÃO ATENDIDA (pacote fechado) com valores definidos pelo admin + extrato e indicadores do fisio.
-- Regras decididas pelo proprietário (05/11): o valor cadastrado pelo admin é o valor FINAL da venda; o repasse por sessão é definido pelo admin por produto (igual para todos os fisios) e congelado em cada
-- lançamento; tudo que foi pago é comissionado (mesmo se o paciente parar: o resíduo vai ao último fisio responsável); cada fisio recebe 100% das sessões que ATENDEU; o lançamento nasce a cada
-- sessão atendida (consumo no livro de sessões) e fica PENDENTE até o admin autorizar. Não substitui a comissão percentual existente (comercial); é um livro à parte.
-- Limites honestos: sessão avulsa/protocolo sem pacote entram por ajuste manual; "marcar pago" registra a decisão do admin (não gera despesa no contas a pagar nem paga o banco).

-- "hoje" no fuso de São Paulo (a clínica opera em Brasília): vigências e prazos usam sempre esta data, nunca a data UTC do servidor
create or replace function private.today_sp() returns date language sql stable set search_path = '' as $$ select (now() at time zone 'America/Sao_Paulo')::date $$;

alter table public.client_packages add column responsible_professional_id uuid references public.professionals(id) on delete set null;

create table public.product_physio_share (
  id uuid primary key default gen_random_uuid(), org_id uuid not null, product_id uuid not null references public.products(id) on delete cascade,
  share_cents int not null check (share_cents >= 0), valid_from date not null default private.today_sp(),
  created_by uuid references auth.users(id) on delete set null, created_at timestamptz not null default clock_timestamp()
);
create index product_physio_share_idx on public.product_physio_share (product_id, valid_from desc, created_at desc);

create table public.physio_payouts (
  id uuid primary key default gen_random_uuid(), org_id uuid not null, unit_id uuid references public.units(id) on delete restrict,
  professional_id uuid references public.professionals(id) on delete restrict,                            -- nulo = resíduo sem fisio atribuído (o admin atribui)
  client_package_id uuid references public.client_packages(id) on delete set null, appointment_id uuid references public.appointments(id) on delete set null,
  sale_id uuid references public.sales(id) on delete set null, product_id uuid references public.products(id) on delete set null,
  kind text not null check (kind in ('session','residual','adjustment','reversal')), amount_cents bigint not null, share_cents_snapshot int,
  status text not null default 'pending' check (status in ('pending','authorized','paid','void')), reason text check (reason is null or length(reason) <= 500),
  ref_payout_id uuid references public.physio_payouts(id) on delete set null,
  authorized_by uuid references auth.users(id) on delete set null, authorized_at timestamptz, paid_by uuid references auth.users(id) on delete set null, paid_at timestamptz,
  created_by uuid references auth.users(id) on delete set null, created_at timestamptz not null default clock_timestamp()
);
create unique index physio_payouts_session_uq on public.physio_payouts (appointment_id) where kind = 'session' and status <> 'void';
create unique index physio_payouts_residual_uq on public.physio_payouts (client_package_id) where kind = 'residual' and status <> 'void';
create index physio_payouts_prof_idx on public.physio_payouts (professional_id, created_at desc);
-- falhas silenciosas do gatilho (o atendimento nunca é bloqueado): ficam registradas para o admin ver e reprocessar
create table public.physio_payout_errors (
  id bigint generated always as identity primary key, org_id uuid, ledger_id bigint, message text not null, at timestamptz not null default now()
);
alter table public.physio_payout_errors enable row level security;
alter table public.product_physio_share enable row level security; alter table public.physio_payouts enable row level security;     -- sem GRANT: tudo por função
create trigger audit_physio_payouts after insert or update on public.physio_payouts for each row execute function private.audit_row('kind','amount_cents','status');
create trigger audit_product_physio_share after insert on public.product_physio_share for each row execute function private.audit_row('product_id','share_cents','valid_from');

-- ---------------------------------------------------------------- regras derivadas
create or replace function private.share_at(p_product uuid, p_date date) returns int language sql stable security definer set search_path = '' as $$
  select s.share_cents from public.product_physio_share s where s.product_id = p_product and s.valid_from <= p_date order by s.valid_from desc, s.created_at desc limit 1
$$;
-- valor de UMA sessão do produto (preço final ÷ sessões do pacote; sessão avulsa = o preço)
create or replace function private.session_value_cents(p_product uuid) returns bigint language sql stable security definer set search_path = '' as $$
  select floor(p.price_cents::numeric / greatest(coalesce(p.sessions_count, 1), 1))::bigint from public.products p where p.id = p_product
$$;
create or replace function private.payout_admin() returns boolean language sql stable security definer set search_path = '' as $$
  select private.has_org_role(array['manager','ops_admin','finance']::public.app_role[])
$$;
-- sessões do pacote já consumidas (consumo − devolução ligada a atendimento)
create or replace function private.package_consumed(p_pkg uuid) returns int language sql stable security definer set search_path = '' as $$
  select coalesce(sum(case l.reason when 'consume' then 1 when 'refund' then -1 else 0 end) filter (where l.appointment_id is not null), 0)::int from public.session_ledger l where l.client_package_id = p_pkg
$$;

-- Lançamento por sessão atendida (e estorno da sessão devolvida). Nunca bloqueia o atendimento: se algo falhar, vira aviso e a sessão aparece em "sem repasse" para o admin.
create or replace function private.payout_on_ledger() returns trigger language plpgsql security definer set search_path = '' as $$
declare a public.appointments; pk public.client_packages; v_share int; v_pay public.physio_payouts;
begin
  if new.appointment_id is null then return new; end if;
  begin
    select * into a from public.appointments where id = new.appointment_id; select * into pk from public.client_packages where id = new.client_package_id;
    if a.id is null or pk.id is null then return new; end if;
    if new.reason = 'consume' then
      v_share := private.share_at(pk.product_id, private.today_sp());
      if v_share is not null then
        insert into public.physio_payouts (org_id, unit_id, professional_id, client_package_id, appointment_id, sale_id, product_id, kind, amount_cents, share_cents_snapshot)
          values (a.org_id, a.unit_id, a.professional_id, pk.id, a.id, pk.sale_id, pk.product_id, 'session', v_share, v_share) on conflict do nothing;
      end if;
    elsif new.reason = 'refund' then
      select * into v_pay from public.physio_payouts where appointment_id = new.appointment_id and kind = 'session' and status <> 'void' limit 1;
      if v_pay.id is not null then
        if v_pay.status = 'pending' then update public.physio_payouts set status = 'void', reason = 'sessão devolvida ao paciente' where id = v_pay.id;
        else insert into public.physio_payouts (org_id, unit_id, professional_id, client_package_id, appointment_id, sale_id, product_id, kind, amount_cents, share_cents_snapshot, ref_payout_id, reason)
               values (v_pay.org_id, v_pay.unit_id, v_pay.professional_id, v_pay.client_package_id, null, v_pay.sale_id, v_pay.product_id, 'reversal', -v_pay.amount_cents, v_pay.share_cents_snapshot, v_pay.id, 'sessão devolvida ao paciente'); end if;
      end if;
    end if;
  exception when others then insert into public.physio_payout_errors (org_id, ledger_id, message) values (new.org_id, new.id, sqlerrm);
  end;
  return new;
end $$;
create trigger payout_on_ledger after insert on public.session_ledger for each row execute function private.payout_on_ledger();

-- resíduo: sessões PAGAS e não atendidas vão ao fisio responsável pelo pacote (ou ao último que atendeu); sem ninguém, fica sem atribuição para o admin decidir
create or replace function private.payout_residual(p_pkg uuid) returns uuid language plpgsql security definer set search_path = '' as $$
declare pk public.client_packages; v_share int; v_left int; v_prof uuid; v_id uuid; v_net bigint;
begin
  select * into pk from public.client_packages where id = p_pkg; if pk.id is null then return null; end if;
  v_share := private.share_at(pk.product_id, private.today_sp()); if v_share is null then return null; end if;
  select coalesce(sum(case p.kind when 'payment' then p.amount_cents else -p.amount_cents end), 0) into v_net from public.payments p join public.receivables r on r.id = p.receivable_id where r.sale_id = pk.sale_id;
  if v_net <= 0 then return null; end if;                                    -- nada foi pago (ou foi tudo estornado): nada a comissionar
  v_left := pk.total_sessions - private.package_consumed(p_pkg); if v_left <= 0 then return null; end if;
  v_prof := pk.responsible_professional_id;
  if v_prof is null then select a.professional_id into v_prof from public.session_ledger l join public.appointments a on a.id = l.appointment_id where l.client_package_id = p_pkg and l.reason = 'consume' order by l.created_at desc limit 1; end if;
  insert into public.physio_payouts (org_id, unit_id, professional_id, client_package_id, sale_id, product_id, kind, amount_cents, share_cents_snapshot, reason)
    values (pk.org_id, pk.unit_id, v_prof, pk.id, pk.sale_id, pk.product_id, 'residual', v_left::bigint * v_share, v_share, format('%s sessão(ões) pagas e não atendidas', v_left)) on conflict do nothing returning id into v_id;
  return v_id;
end $$;
create or replace function private.payout_on_package() returns trigger language plpgsql security definer set search_path = '' as $$
begin
  begin if new.status = 'expired' and old.status is distinct from 'expired' then perform private.payout_residual(new.id); end if;
  exception when others then insert into public.physio_payout_errors (org_id, ledger_id, message) values (new.org_id, null, 'resíduo do pacote ' || new.id || ': ' || sqlerrm); end;
  return new;
end $$;
create trigger payout_on_package after update of status on public.client_packages for each row execute function private.payout_on_package();

-- cobertura: o repasse só é liberado até o limite do que o paciente já pagou do pacote (parcelado). Devolve o que está coberto, em ordem de criação.
create or replace function private.payout_covered(p_pkg uuid) returns table (payout_id uuid, covered boolean) language sql stable security definer set search_path = '' as $$
  with pk as (select c.id, c.total_sessions, c.sale_id from public.client_packages c where c.id = p_pkg),
  paid as (select coalesce(sum(case p.kind when 'payment' then p.amount_cents else -p.amount_cents end), 0) net from public.payments p join public.receivables r on r.id = p.receivable_id join pk on r.sale_id = pk.sale_id),
  tot as (select coalesce(nullif(s.total_cents, 0), 1) total from public.sales s join pk on s.id = pk.sale_id),
  exp as (select pk.total_sessions * coalesce((select max(x.share_cents_snapshot) from public.physio_payouts x where x.client_package_id = pk.id and x.status <> 'void'), 0) amount from pk),
  lim as (select floor(exp.amount * least(1, greatest(0, paid.net)::numeric / tot.total))::bigint allowed from exp, paid, tot),
  rows as (select x.id, sum(x.amount_cents) over (order by x.created_at, x.id) running from public.physio_payouts x where x.client_package_id = p_pkg and x.status <> 'void')
  select rows.id, rows.running <= (select allowed from lim) from rows
$$;

-- ---------------------------------------------------------------- admin: preços e repasses
create or replace function public.physio_pricing_list() returns jsonb language plpgsql stable security definer set search_path = '' as $$
begin
  if not private.has_org_role(array['manager','ops_admin','finance']::public.app_role[]) then raise exception 'sem permissão' using errcode = '42501'; end if;
  return coalesce((select jsonb_agg(jsonb_build_object('id', p.id, 'name', p.name, 'kind', p.kind, 'price_cents', p.price_cents, 'sessions_count', p.sessions_count, 'session_value_cents', private.session_value_cents(p.id),
      'share_cents', private.share_at(p.id, private.today_sp()), 'hp_cents', case when private.share_at(p.id, private.today_sp()) is null then null else private.session_value_cents(p.id) - private.share_at(p.id, private.today_sp()) end,
      'valid_from', (select s.valid_from from public.product_physio_share s where s.product_id = p.id and s.valid_from <= private.today_sp() order by s.valid_from desc, s.created_at desc limit 1),
      'history', (select count(*) from public.product_physio_share s where s.product_id = p.id)) order by p.kind, p.name)
    from public.products p where p.org_id = private.current_org() and p.active and p.kind in ('service','package','plan')), '[]'::jsonb);
end $$;
create or replace function public.product_share_set(p_product uuid, p_share_cents int, p_valid_from date default null) returns uuid language plpgsql security definer set search_path = '' as $$
declare v_val bigint; v_id uuid;
begin
  if not private.has_org_role(array['manager','ops_admin']::public.app_role[]) then raise exception 'sem permissão' using errcode = '42501'; end if;
  if not exists (select 1 from public.products where id = p_product and org_id = private.current_org() and kind in ('service','package','plan')) then raise exception 'produto não encontrado'; end if;
  v_val := private.session_value_cents(p_product);
  if p_share_cents is null or p_share_cents < 0 then raise exception 'informe o repasse por sessão (zero ou mais)'; end if;
  if p_share_cents > v_val then raise exception 'o repasse (%) não pode superar o valor da sessão (%)', p_share_cents, v_val; end if;
  if p_valid_from is not null and p_valid_from < private.today_sp() - 31 then raise exception 'a vigência não pode ser tão antiga'; end if;
  insert into public.product_physio_share (org_id, product_id, share_cents, valid_from, created_by) values (private.current_org(), p_product, p_share_cents, coalesce(p_valid_from, private.today_sp()), (select auth.uid())) returning id into v_id;
  return v_id;
end $$;
-- valor final da venda do produto (vale para vendas FUTURAS; o repasse por sessão não pode ficar acima do novo valor da sessão)
create or replace function public.product_price_set(p_product uuid, p_price_cents bigint) returns void language plpgsql security definer set search_path = '' as $$
declare pr public.products; v_new bigint; v_share int;
begin
  if not private.has_org_role(array['manager','ops_admin']::public.app_role[]) then raise exception 'sem permissão' using errcode = '42501'; end if;
  select * into pr from public.products where id = p_product and org_id = private.current_org() and kind in ('service','package','plan'); if pr.id is null then raise exception 'produto não encontrado'; end if;
  if p_price_cents is null or p_price_cents < 0 then raise exception 'valor inválido'; end if;
  v_new := floor(p_price_cents::numeric / greatest(coalesce(pr.sessions_count, 1), 1))::bigint; v_share := private.share_at(p_product, private.today_sp());
  if v_share is not null and v_share > v_new then raise exception 'o novo valor da sessão (%) ficaria abaixo do repasse (%): ajuste o repasse antes', v_new, v_share; end if;
  update public.products set price_cents = p_price_cents where id = p_product;
end $$;
create or replace function public.package_responsible_set(p_package uuid, p_professional uuid) returns void language plpgsql security definer set search_path = '' as $$
begin
  if not private.has_org_role(array['manager','ops_admin']::public.app_role[]) then raise exception 'sem permissão' using errcode = '42501'; end if;
  if p_professional is not null and not exists (select 1 from public.professionals where id = p_professional and org_id = private.current_org() and active) then raise exception 'profissional inválido'; end if;
  update public.client_packages set responsible_professional_id = p_professional where id = p_package and org_id = private.current_org();
  if not found then raise exception 'pacote não encontrado'; end if;
end $$;

-- lançamentos (admin/financeiro): lista com cobertura, fisio, produto e pacote — o nome do paciente aparece só aqui (conferência), nunca no extrato do fisio
create or replace function public.physio_payouts_list(p_status text default null, p_from date default null, p_to date default null, p_professional uuid default null) returns jsonb language plpgsql stable security definer set search_path = '' as $$
begin
  if not private.payout_admin() then raise exception 'sem permissão' using errcode = '42501'; end if;
  return coalesce((select jsonb_agg(jsonb_build_object('id', x.id, 'at', x.created_at, 'kind', x.kind, 'amount_cents', x.amount_cents, 'status', x.status, 'reason', x.reason,
      'professional_id', x.professional_id, 'professional', pr.display_name, 'product', p.name, 'patient', pe.full_name, 'package_id', x.client_package_id,
      'covered', coalesce((select c.covered from private.payout_covered(x.client_package_id) c where c.payout_id = x.id), true)) order by x.created_at desc)
    from (select * from public.physio_payouts y where y.org_id = private.current_org() and (p_status is null or y.status = p_status) and (p_from is null or (y.created_at at time zone 'America/Sao_Paulo')::date >= p_from) and (p_to is null or (y.created_at at time zone 'America/Sao_Paulo')::date <= p_to)
            and (p_professional is null or y.professional_id = p_professional) order by y.created_at desc limit 500) x
    left join public.professionals pr on pr.id = x.professional_id left join public.products p on p.id = x.product_id
    left join public.client_packages cp on cp.id = x.client_package_id left join public.people pe on pe.id = cp.person_id), '[]'::jsonb);
end $$;
create or replace function private.payout_get(p_id uuid) returns public.physio_payouts language plpgsql stable security definer set search_path = '' as $$
declare r public.physio_payouts;
begin
  select * into r from public.physio_payouts where id = p_id and org_id = private.current_org();
  if r.id is null or not private.payout_admin() then raise exception 'sem permissão' using errcode = '42501'; end if;
  return r;
end $$;
create or replace function public.physio_payout_authorize(p_id uuid) returns void language plpgsql security definer set search_path = '' as $$
declare r public.physio_payouts := private.payout_get(p_id); v_cov boolean := true;
begin
  if r.status <> 'pending' then raise exception 'transição inválida: só lançamento pendente é autorizado'; end if;
  if r.professional_id is null then raise exception 'atribua um fisioterapeuta antes de autorizar'; end if;
  if r.client_package_id is not null and r.amount_cents > 0 then select coalesce(c.covered, true) into v_cov from private.payout_covered(r.client_package_id) c where c.payout_id = r.id;
    if not coalesce(v_cov, true) then raise exception 'o paciente ainda não pagou o suficiente deste pacote para liberar este repasse'; end if; end if;
  update public.physio_payouts set status = 'authorized', authorized_by = (select auth.uid()), authorized_at = now() where id = p_id;
end $$;
create or replace function public.physio_payout_pay(p_id uuid) returns void language plpgsql security definer set search_path = '' as $$
declare r public.physio_payouts := private.payout_get(p_id);
begin
  if r.status <> 'authorized' then raise exception 'transição inválida: pague apenas o que foi autorizado'; end if;
  update public.physio_payouts set status = 'paid', paid_by = (select auth.uid()), paid_at = now() where id = p_id;
end $$;
create or replace function public.physio_payout_void(p_id uuid, p_reason text) returns void language plpgsql security definer set search_path = '' as $$
declare r public.physio_payouts := private.payout_get(p_id);
begin
  if r.status <> 'pending' then raise exception 'só lançamento pendente pode ser anulado; para corrigir um já autorizado/pago, faça um ajuste'; end if;
  if length(btrim(coalesce(p_reason, ''))) < 3 then raise exception 'informe o motivo'; end if;
  update public.physio_payouts set status = 'void', reason = btrim(p_reason) where id = p_id;
end $$;
create or replace function public.physio_payout_reassign(p_id uuid, p_professional uuid) returns void language plpgsql security definer set search_path = '' as $$
declare r public.physio_payouts := private.payout_get(p_id);
begin
  if r.status <> 'pending' then raise exception 'só lançamento pendente pode mudar de fisioterapeuta'; end if;
  if not exists (select 1 from public.professionals where id = p_professional and org_id = private.current_org() and active) then raise exception 'profissional inválido'; end if;
  update public.physio_payouts set professional_id = p_professional where id = p_id;
end $$;
-- ajuste manual (sessão avulsa, protocolo, correção de lançamento já pago): positivo ou negativo, sempre com motivo; nasce pendente
create or replace function public.physio_payout_adjust(p_professional uuid, p_amount_cents bigint, p_reason text, p_package uuid default null) returns uuid language plpgsql security definer set search_path = '' as $$
declare v_id uuid; v_unit uuid;
begin
  if not private.has_org_role(array['manager','ops_admin']::public.app_role[]) then raise exception 'sem permissão' using errcode = '42501'; end if;
  if p_amount_cents is null or p_amount_cents = 0 then raise exception 'informe o valor do ajuste (positivo ou negativo)'; end if;
  if length(btrim(coalesce(p_reason, ''))) < 3 then raise exception 'informe o motivo do ajuste'; end if;
  select pu.unit_id into v_unit from public.professional_units pu join public.professionals pr on pr.id = pu.professional_id where pr.id = p_professional and pr.org_id = private.current_org() limit 1;
  if v_unit is null then raise exception 'profissional inválido'; end if;
  insert into public.physio_payouts (org_id, unit_id, professional_id, client_package_id, kind, amount_cents, reason, created_by) values (private.current_org(), v_unit, p_professional, p_package, 'adjustment', p_amount_cents, btrim(p_reason), (select auth.uid())) returning id into v_id;
  return v_id;
end $$;
create or replace function public.physio_package_close(p_package uuid) returns uuid language plpgsql security definer set search_path = '' as $$
begin
  if not private.has_org_role(array['manager','ops_admin']::public.app_role[]) then raise exception 'sem permissão' using errcode = '42501'; end if;
  if not exists (select 1 from public.client_packages where id = p_package and org_id = private.current_org()) then raise exception 'pacote não encontrado'; end if;
  return private.payout_residual(p_package);
end $$;
-- pendências do admin: sessões consumidas sem lançamento (produto sem regra de repasse) e pacotes ativos sem fisio responsável
create or replace function public.physio_payouts_missing() returns jsonb language plpgsql stable security definer set search_path = '' as $$
begin
  if not private.payout_admin() then raise exception 'sem permissão' using errcode = '42501'; end if;
  return jsonb_build_object(
    'sessions_without_payout', coalesce((select jsonb_agg(jsonb_build_object('product_id', q.product_id, 'product', q.name, 'sessions', q.n, 'has_share', q.has_share) order by q.name) from (
        select cp.product_id, p.name, count(*) n, private.share_at(cp.product_id, private.today_sp()) is not null has_share
          from public.session_ledger l join public.client_packages cp on cp.id = l.client_package_id join public.products p on p.id = cp.product_id
         where l.org_id = private.current_org() and l.reason = 'consume' and l.appointment_id is not null
           and not exists (select 1 from public.physio_payouts x where x.appointment_id = l.appointment_id and x.kind = 'session')
           and not exists (select 1 from public.session_ledger rf where rf.appointment_id = l.appointment_id and rf.reason = 'refund')       -- sessão devolvida não gera repasse
           and exists (select 1 from public.product_physio_share s where s.product_id = cp.product_id and s.valid_from <= (l.created_at at time zone 'America/Sao_Paulo')::date)
         group by cp.product_id, p.name) q), '[]'::jsonb),
    'packages_without_responsible', (select count(*) from public.client_packages cp where cp.org_id = private.current_org() and cp.status = 'active' and cp.responsible_professional_id is null));
end $$;
-- gera os lançamentos das sessões já atendidas A PARTIR da vigência da regra (nunca do passado anterior a ela)
create or replace function public.physio_payouts_backfill(p_product uuid) returns int language plpgsql security definer set search_path = '' as $$
declare n int := 0; r record; v_share int;
begin
  if not private.has_org_role(array['manager','ops_admin']::public.app_role[]) then raise exception 'sem permissão' using errcode = '42501'; end if;
  for r in select l.id, (l.created_at at time zone 'America/Sao_Paulo')::date d, a.id appt, a.professional_id, a.unit_id, cp.id pkg, cp.sale_id, cp.org_id from public.session_ledger l join public.client_packages cp on cp.id = l.client_package_id join public.appointments a on a.id = l.appointment_id
            where cp.product_id = p_product and cp.org_id = private.current_org() and l.reason = 'consume'
              and not exists (select 1 from public.physio_payouts x where x.appointment_id = l.appointment_id and x.kind = 'session')
              and not exists (select 1 from public.session_ledger rf where rf.appointment_id = l.appointment_id and rf.reason = 'refund') order by l.created_at loop
    v_share := private.share_at(p_product, r.d); if v_share is null then continue; end if;
    insert into public.physio_payouts (org_id, unit_id, professional_id, client_package_id, appointment_id, sale_id, product_id, kind, amount_cents, share_cents_snapshot, reason)
      values (r.org_id, r.unit_id, r.professional_id, r.pkg, r.appt, r.sale_id, p_product, 'session', v_share, v_share, 'gerado a partir da vigência da regra') on conflict do nothing;
    if found then n := n + 1; end if;
  end loop;
  return n;
end $$;

-- pacotes em aberto para o admin escolher o fisio responsável (quem recebe o resíduo e aparece no "previsto" dele)
create or replace function public.physio_packages_open(p_only_without boolean default true) returns jsonb language plpgsql stable security definer set search_path = '' as $$
begin
  if not private.payout_admin() then raise exception 'sem permissão' using errcode = '42501'; end if;
  return coalesce((select jsonb_agg(jsonb_build_object('id', cp.id, 'patient', pe.full_name, 'product', p.name, 'total_sessions', cp.total_sessions, 'remaining', private.package_balance(cp.id),
      'consumed', private.package_consumed(cp.id), 'responsible_id', cp.responsible_professional_id, 'responsible', pr.display_name, 'created_at', cp.created_at) order by cp.created_at desc)
    from public.client_packages cp join public.people pe on pe.id = cp.person_id join public.products p on p.id = cp.product_id left join public.professionals pr on pr.id = cp.responsible_professional_id
   where cp.org_id = private.current_org() and cp.status = 'active' and (not p_only_without or cp.responsible_professional_id is null)), '[]'::jsonb);
end $$;

-- ---------------------------------------------------------------- fisio: extrato (SEM nome de paciente) e indicadores
create or replace function public.prof_commission_statement(p_from date default null, p_to date default null) returns jsonb language plpgsql stable security definer set search_path = '' as $$
declare v_prof uuid; v_from date := coalesce(p_from, date_trunc('month', private.today_sp())::date); v_to date := coalesce(p_to, private.today_sp());
begin
  select id into v_prof from public.professionals where user_id = (select auth.uid()) and org_id = private.current_org();
  if v_prof is null then raise exception 'sem permissão' using errcode = '42501'; end if;
  return jsonb_build_object('from', v_from, 'to', v_to,
    'totals', (select jsonb_build_object('pending_cents', coalesce(sum(x.amount_cents) filter (where x.status = 'pending'), 0), 'authorized_cents', coalesce(sum(x.amount_cents) filter (where x.status = 'authorized'), 0),
        'paid_cents', coalesce(sum(x.amount_cents) filter (where x.status = 'paid'), 0), 'net_cents', coalesce(sum(x.amount_cents) filter (where x.status <> 'void'), 0), 'sessions', count(*) filter (where x.kind = 'session' and x.status <> 'void'))
      from public.physio_payouts x where x.professional_id = v_prof and (x.created_at at time zone 'America/Sao_Paulo')::date between v_from and v_to),
    'entries', coalesce((select jsonb_agg(jsonb_build_object('id', x.id, 'at', x.created_at, 'kind', x.kind, 'amount_cents', x.amount_cents, 'status', x.status, 'product', p.name, 'reason', x.reason) order by x.created_at desc)
      from (select * from public.physio_payouts y where y.professional_id = v_prof and (y.created_at at time zone 'America/Sao_Paulo')::date between v_from and v_to order by y.created_at desc limit 200) x left join public.products p on p.id = x.product_id), '[]'::jsonb),
    'upcoming', coalesce((select jsonb_agg(jsonb_build_object('product', p.name, 'remaining_sessions', private.package_balance(cp.id), 'share_cents', private.share_at(cp.product_id, private.today_sp()),
        'expected_cents', private.package_balance(cp.id)::bigint * coalesce(private.share_at(cp.product_id, private.today_sp()), 0)) order by p.name)
      from public.client_packages cp join public.products p on p.id = cp.product_id where cp.org_id = private.current_org() and cp.status = 'active' and cp.responsible_professional_id = v_prof
       and private.package_balance(cp.id) > 0 and private.share_at(cp.product_id, private.today_sp()) is not null), '[]'::jsonb),
    'basis', 'Repasse por sessão atendida, definido pela administração. Previsto = sessões ainda não atendidas dos pacotes em que você é o responsável (informativo, não é lançamento).');
end $$;

create or replace function public.prof_kpis(p_from date default null, p_to date default null) returns jsonb language plpgsql stable security definer set search_path = '' as $$
declare v_uid uuid := (select auth.uid()); v_org uuid := private.current_org(); v_prof uuid; v_from date := coalesce(p_from, private.today_sp() - 29); v_to date := coalesce(p_to, private.today_sp()); v_tz text := 'America/Sao_Paulo';
  v_ag jsonb; v_cart jsonb; v_cont jsonb; v_res jsonb; v_qual jsonb; v_rev bigint; v_occ jsonb; v_booked numeric; v_avail numeric;
begin
  select id into v_prof from public.professionals where user_id = v_uid and org_id = v_org and active; if v_prof is null then raise exception 'sem permissão' using errcode = '42501'; end if;
  select jsonb_build_object('scheduled', count(*) filter (where status in ('scheduled','confirmed')), 'attended', count(*) filter (where status = 'attended'), 'no_show', count(*) filter (where status = 'no_show'),
      'cancelled', count(*) filter (where status in ('cancelled_by_patient','cancelled_by_clinic')),
      'attendance_rate', case when count(*) filter (where status in ('attended','no_show')) = 0 then null else round(100.0 * count(*) filter (where status = 'attended') / count(*) filter (where status in ('attended','no_show')), 1) end)
    into v_ag from public.appointments where professional_id = v_prof and org_id = v_org and (lower(period) at time zone v_tz)::date between v_from and v_to;
  -- ocupação: minutos marcados ÷ minutos de disponibilidade cadastrada no período (nulo se não há disponibilidade)
  select coalesce(sum(extract(epoch from upper(period) - lower(period)) / 60), 0) into v_booked from public.appointments where professional_id = v_prof and org_id = v_org and status in ('scheduled','confirmed','attended') and (lower(period) at time zone v_tz)::date between v_from and v_to;
  select coalesce(sum(extract(epoch from (r.end_time - r.start_time)) / 60 * (select count(*) from generate_series(v_from, v_to, interval '1 day') g(d) where extract(dow from g.d)::int = r.weekday and (r.valid_from is null or g.d::date >= r.valid_from) and (r.valid_until is null or g.d::date <= r.valid_until))), 0) into v_avail
    from public.availability_rules r where r.professional_id = v_prof;
  v_occ := case when v_avail > 0 then jsonb_build_object('booked_min', v_booked, 'available_min', v_avail, 'pct', round(100 * v_booked / v_avail, 1)) else null end;
  with mine as (select r.person_id from public.care_relationships r where r.professional_user_id = v_uid and r.org_id = v_org and r.revoked_at is null and r.valid_from <= now() and (r.valid_until is null or r.valid_until > now()))
  select jsonb_build_object('active', (select count(*) from mine), 'new_in_period', (select count(*) from public.care_relationships r where r.professional_user_id = v_uid and r.org_id = v_org and (r.created_at at time zone 'America/Sao_Paulo')::date between v_from and v_to),
      'plans_active', (select count(*) from public.patient_plans pl join mine on mine.person_id = pl.person_id where pl.status = 'active'),
      'near_end', (select count(*) from public.patient_plans pl join mine on mine.person_id = pl.person_id where pl.status = 'active' and (select count(*) from public.appointments a where a.person_id = pl.person_id and a.status = 'attended' and lower(a.period)::date >= pl.started_on) >= greatest(1, ceil(pl.planned_sessions * 0.8))),
      'with_specialty', (select count(*) from public.patient_plans pl join mine on mine.person_id = pl.person_id where pl.status = 'active' and pl.specialty is not null)) into v_cart;
  select jsonb_build_object('decisions', count(*), 'continuity', count(*) filter (where decision in ('continuidade','manutencao')), 'discharged', count(*) filter (where decision = 'alta'),
      'continuity_rate', case when count(*) = 0 then null else round(100.0 * count(*) filter (where decision in ('continuidade','manutencao')) / count(*), 1) end)
    into v_cont from public.patient_reassessments where decided_by = v_uid and org_id = v_org and (decided_at at time zone 'America/Sao_Paulo')::date between v_from and v_to;
  -- resultado clínico DESCRITIVO: variação média de dor (primeira → última) dos meus pacientes com 2+ registros no período; sem ranking, sem interpretação
  with pts as (select m.person_id, (array_agg(m.value order by m.measured_at))[1] f, (array_agg(m.value order by m.measured_at desc))[1] l, count(*) n
      from public.patient_measurements m join public.care_relationships r on r.person_id = m.person_id and r.professional_user_id = v_uid and r.revoked_at is null
     where m.org_id = v_org and m.instrument_key = 'nprs' and (m.measured_at at time zone 'America/Sao_Paulo')::date between v_from and v_to group by m.person_id having count(*) >= 2)
  select jsonb_build_object('patients_with_pain_series', count(*), 'avg_pain_change', case when count(*) = 0 then null else round(avg(l - f), 1) end) into v_res from pts;
  select jsonb_build_object('answers', count(*), 'avg_score', case when count(*) = 0 then null else round(avg(sr.score), 1) end,
      'nps', case when count(*) = 0 then null else round(100.0 * (count(*) filter (where sr.score >= 9) - count(*) filter (where sr.score <= 6)) / count(*), 0) end)
    into v_qual from public.survey_responses sr join public.appointments a on a.id = sr.appointment_id where a.professional_id = v_prof and sr.org_id = v_org and (sr.created_at at time zone 'America/Sao_Paulo')::date between v_from and v_to;
  select coalesce(sum(private.session_value_cents(cp.product_id)), 0) into v_rev from public.physio_payouts x join public.client_packages cp on cp.id = x.client_package_id
   where x.professional_id = v_prof and x.kind = 'session' and x.status <> 'void' and (x.created_at at time zone 'America/Sao_Paulo')::date between v_from and v_to;
  return jsonb_build_object('from', v_from, 'to', v_to, 'agenda', v_ag, 'occupancy', v_occ, 'portfolio', v_cart, 'continuity', v_cont, 'outcome', v_res, 'quality', v_qual, 'revenue_generated_cents', v_rev,
    'adherence', null, 'adherence_note', 'Indisponível até haver treinos prescritos e registrados.');
end $$;

revoke all on function public.physio_pricing_list(), public.product_share_set(uuid, int, date), public.product_price_set(uuid, bigint), public.package_responsible_set(uuid, uuid),
  public.physio_payouts_list(text, date, date, uuid), public.physio_payout_authorize(uuid), public.physio_payout_pay(uuid), public.physio_payout_void(uuid, text), public.physio_payout_reassign(uuid, uuid),
  public.physio_payout_adjust(uuid, bigint, text, uuid), public.physio_package_close(uuid), public.physio_payouts_missing(), public.physio_payouts_backfill(uuid), public.physio_packages_open(boolean),
  public.prof_commission_statement(date, date), public.prof_kpis(date, date) from public, anon;
grant execute on function public.physio_pricing_list(), public.product_share_set(uuid, int, date), public.product_price_set(uuid, bigint), public.package_responsible_set(uuid, uuid),
  public.physio_payouts_list(text, date, date, uuid), public.physio_payout_authorize(uuid), public.physio_payout_pay(uuid), public.physio_payout_void(uuid, text), public.physio_payout_reassign(uuid, uuid),
  public.physio_payout_adjust(uuid, bigint, text, uuid), public.physio_package_close(uuid), public.physio_payouts_missing(), public.physio_payouts_backfill(uuid), public.physio_packages_open(boolean),
  public.prof_commission_statement(date, date), public.prof_kpis(date, date) to authenticated;
revoke all on function private.today_sp(), private.share_at(uuid, date), private.session_value_cents(uuid), private.payout_admin(), private.package_consumed(uuid), private.payout_on_ledger(), private.payout_residual(uuid),
  private.payout_on_package(), private.payout_covered(uuid), private.payout_get(uuid) from public, anon, authenticated;
