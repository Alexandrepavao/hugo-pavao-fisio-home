-- SIMULAÇÃO PARA TESTE (somente Dev): gestores que também atendem — "Jan" (conta qa.manager@hp-test.dev) e "Hugo" (sem login, aparece no seletor de agenda).
-- Pacientes FICTÍCIOS ("<nome> Simulação"), bairros reais de São Paulo (coordenadas de bairro, nunca de pessoa real). Idempotente: apaga a simulação anterior e recria.
-- Dias: seg 16/11/2026 e ter 17/11/2026. Para remover tudo: supabase/tools/rota-simulacao-limpar.sql
-- Rodar SOMENTE no projeto Dev (fsvtzowcwhvwtluwrhnb), nunca em produção.
do $sim$
declare
  v_org uuid := '268b67d7-faa3-43c2-bb91-0616c78e10d0';
  v_unit uuid := '9ace3ebd-352c-4832-b488-904f6a708e22';
  v_user uuid := (select id from auth.users where email = 'qa.manager@hp-test.dev');
  v_svc uuid; v_jan uuid; v_hugo uuid; v_p uuid; r record;
begin
  if v_user is null then raise exception 'conta qa.manager@hp-test.dev não existe neste banco (este script é só para o Dev)'; end if;

  -- 1) limpeza da simulação anterior (atendimentos, locais, pacientes, profissionais, serviço)
  delete from public.route_apply_log where professional_id in (select id from public.professionals where display_name like '% (simulação)');
  delete from public.appointments where person_id in (select id from public.people where org_id = v_org and full_name like '% Simulação');
  delete from public.route_places where owner_kind = 'person' and owner_id in (select id from public.people where org_id = v_org and full_name like '% Simulação');
  delete from public.people where org_id = v_org and full_name like '% Simulação';
  delete from public.availability_rules where professional_id in (select id from public.professionals where display_name like '% (simulação)');
  delete from public.professional_units where professional_id in (select id from public.professionals where display_name like '% (simulação)');
  delete from public.professional_route_prefs where professional_id in (select id from public.professionals where display_name like '% (simulação)');
  delete from public.professionals where display_name like '% (simulação)';
  delete from public.services where org_id = v_org and name = 'Fisioterapia domiciliar (simulação)';

  -- 2) serviço, profissionais (Jan = conta de gestor de teste; Hugo = sem login) e disponibilidade seg–sex 08:00–19:00
  insert into public.services (org_id, name, duration_min, price_cents, active) values (v_org, 'Fisioterapia domiciliar (simulação)', 50, 0, true) returning id into v_svc;
  insert into public.professionals (org_id, user_id, display_name, active) values (v_org, v_user, 'Jan (simulação)', true) returning id into v_jan;
  insert into public.professionals (org_id, user_id, display_name, active) values (v_org, null, 'Hugo (simulação)', true) returning id into v_hugo;
  insert into public.professional_units (professional_id, unit_id) values (v_jan, v_unit), (v_hugo, v_unit);
  insert into public.availability_rules (org_id, professional_id, unit_id, weekday, start_time, end_time)
    select v_org, p, v_unit, d, time '08:00', time '19:00' from unnest(array[v_jan, v_hugo]) p, generate_series(1, 5) d;

  -- 3) pacientes fictícios + local + atendimentos
  --    (quem, paciente, bairro, lat, lng, precisão, formato, dia, hora, status, fixo)
  for r in select * from (values
    -- JAN · seg 16/11 — dia "bagunçado" (zigue-zague) para a rota sugerida ter o que melhorar
    ('jan', 'Alice',   'Vila Mariana', -23.5890, -46.6350, 'exact', 'home_visit', date '2026-11-16', time '08:00', 'scheduled', false),
    ('jan', 'Bruno',   'Santana',      -23.5030, -46.6250, 'exact', 'home_visit', date '2026-11-16', time '09:30', 'scheduled', false),
    ('jan', 'Carla',   'Moema',        -23.6006, -46.6686, 'exact', 'home_visit', date '2026-11-16', time '11:00', 'scheduled', false),
    ('jan', 'Diego',   'Remoto',       null,     null,     null,    'remote',     date '2026-11-16', time '12:30', 'scheduled', false),
    ('jan', 'Elisa',   'Tatuapé',      -23.5405, -46.5766, 'exact', 'home_visit', date '2026-11-16', time '14:00', 'confirmed', false),
    ('jan', 'Fábio',   'Butantã',      -23.5710, -46.7260, 'cep',   'home_visit', date '2026-11-16', time '15:30', 'scheduled', false),
    ('jan', 'Gisele',  'Santo Amaro',  -23.6540, -46.7110, 'exact', 'home_visit', date '2026-11-16', time '17:00', 'scheduled', true),
    -- JAN · ter 17/11 — trecho apertado (Itaim → Lapa em 10 min), paciente sem local, atendimento na unidade, horários livres para "melhor encaixe"
    ('jan', 'Heitor',  'Itaim Bibi',   -23.5850, -46.6800, 'exact', 'home_visit', date '2026-11-17', time '09:00', 'scheduled', false),
    ('jan', 'Isabela', 'Lapa',         -23.5230, -46.7050, 'exact', 'home_visit', date '2026-11-17', time '10:00', 'scheduled', false),
    ('jan', 'João',    'Sem local',    null,     null,     null,    'home_visit', date '2026-11-17', time '13:00', 'scheduled', false),
    ('jan', 'Karen',   'Na unidade',   null,     null,     null,    'in_clinic',  date '2026-11-17', time '15:00', 'scheduled', false),
    ('jan', 'Lucas',   'Mooca',        -23.5600, -46.5990, 'exact', 'home_visit', date '2026-11-17', time '16:30', 'scheduled', false),
    -- HUGO · seg 16/11
    ('hugo', 'Marta',   'Pinheiros',   -23.5667, -46.6917, 'exact', 'home_visit', date '2026-11-16', time '08:30', 'scheduled', false),
    ('hugo', 'Nelson',  'Tatuapé',     -23.5405, -46.5766, 'exact', 'home_visit', date '2026-11-16', time '10:00', 'scheduled', false),
    ('hugo', 'Olívia',  'Butantã',     -23.5710, -46.7260, 'exact', 'home_visit', date '2026-11-16', time '11:30', 'scheduled', false),
    ('hugo', 'Paulo',   'Mooca',       -23.5600, -46.5990, 'exact', 'home_visit', date '2026-11-16', time '14:00', 'scheduled', false),
    ('hugo', 'Quitéria','Na unidade',  null,     null,     null,    'in_clinic',  date '2026-11-16', time '16:00', 'scheduled', false)
  ) t(quem, nome, bairro, lat, lng, prec, modo, dia, hora, st, fixo) loop
    insert into public.people (org_id, unit_id, full_name, neighborhood, city, state_uf) values (v_org, v_unit, r.nome || ' Simulação', r.bairro, 'São Paulo', 'SP') returning id into v_p;
    if r.lat is not null then
      insert into public.route_places (org_id, owner_kind, owner_id, lat, lng, precision, source)
        values (v_org, 'person', v_p, r.lat, r.lng, r.prec, case when r.prec = 'cep' then 'cep_approx' else 'manual_pin' end);
    end if;
    insert into public.appointments (org_id, unit_id, professional_id, person_id, service_id, period, status, service_mode, visit_lat, visit_lng, visit_precision, route_fixed, patient_confirmed_at, patient_confirmed_via)
      values (v_org, v_unit, case r.quem when 'jan' then v_jan else v_hugo end, v_p, v_svc,
              tstzrange((r.dia + r.hora)::text::timestamp at time zone 'America/Sao_Paulo', (r.dia + r.hora + interval '50 minutes')::text::timestamp at time zone 'America/Sao_Paulo'),
              r.st, r.modo, r.lat, r.lng, r.prec, r.fixo,
              case when r.st = 'confirmed' then now() end, case when r.st = 'confirmed' then 'staff' end);
  end loop;
end
$sim$;
select p.display_name, to_char(lower(a.period) at time zone 'America/Sao_Paulo', 'DD/MM') dia, count(*) atendimentos
  from public.appointments a join public.professionals p on p.id = a.professional_id
 where p.display_name like '% (simulação)' group by 1, 2 order by 1, 2;
