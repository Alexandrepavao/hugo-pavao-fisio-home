-- Remove a simulação de rota (Jan/Hugo) do Dev: atendimentos, locais, pacientes fictícios, profissionais de teste, disponibilidade, preferências e serviço.
do $sim$
declare v_org uuid := '268b67d7-faa3-43c2-bb91-0616c78e10d0';
begin
  delete from public.route_apply_log where professional_id in (select id from public.professionals where display_name like '% (simulação)');
  delete from public.appointments where person_id in (select id from public.people where org_id = v_org and full_name like '% Simulação');
  delete from public.route_places where owner_kind = 'person' and owner_id in (select id from public.people where org_id = v_org and full_name like '% Simulação');
  delete from public.people where org_id = v_org and full_name like '% Simulação';
  delete from public.availability_rules where professional_id in (select id from public.professionals where display_name like '% (simulação)');
  delete from public.professional_units where professional_id in (select id from public.professionals where display_name like '% (simulação)');
  delete from public.professional_route_prefs where professional_id in (select id from public.professionals where display_name like '% (simulação)');
  delete from public.professionals where display_name like '% (simulação)';
  delete from public.services where org_id = v_org and name = 'Fisioterapia domiciliar (simulação)';
end
$sim$;
