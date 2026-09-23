-- Autoatendimento do paciente (migration 029): lista explícita de campos permitidos, validação no servidor,
-- auditoria. Confirma que full_name/unit_id nunca mudam (não expostos pela função), telefone inválido é
-- rejeitado, troca de telefone nunca deixa dois "principais" ao mesmo tempo, conta sem pessoa vinculada é
-- rejeitada, e que a RLS direta na tabela people continua bloqueando escrita em cadastro de outra pessoa
-- (o RPC nem aceita um "para quem" — só edita private.current_person()).
-- Transação sempre desfeita. Somente dev/teste.
do $$
declare
  v_org uuid; v_ua uuid; u_pat uuid := gen_random_uuid();
  pa uuid; other_pa uuid; rep text := ''; n int; ok boolean;
  before_full_name text; after_full_name text; before_unit uuid; after_unit uuid;
begin
  select id into v_org from public.organizations where slug = 'hp-group';
  select id into v_ua from public.units where org_id = v_org and slug = 'sao-paulo';
  insert into public.people (org_id, unit_id, full_name, preferred_name) values (v_org, v_ua, 'Paciente SelfEdit Original', null) returning id into pa;
  insert into public.people (org_id, unit_id, full_name) values (v_org, v_ua, 'Outra Pessoa SelfEdit') returning id into other_pa;
  insert into auth.users (id, aud, role, email) values (u_pat,'authenticated','authenticated','selfedit.pat@t.local');
  insert into public.user_accounts (user_id, org_id, person_id, display_name) values (u_pat, v_org, pa, 'Paciente SelfEdit');
  insert into public.role_assignments (org_id, user_id, role) values (v_org, u_pat, 'member');

  select full_name, unit_id into before_full_name, before_unit from public.people where id = pa;

  perform set_config('request.jwt.claims', json_build_object('sub', u_pat, 'role','authenticated')::text, true);
  set local role authenticated;
  perform public.my_profile_update('Apelido Teste', '(11) 98888-7777', 'São Paulo', 'sp');
  reset role;

  select full_name into after_full_name from public.people where id = pa;
  select unit_id into after_unit from public.people where id = pa;

  rep := rep || format(E'\n[%s] preferred_name atualizado (%s)', case when (select preferred_name from public.people where id = pa) = 'Apelido Teste' then 'OK' else 'FALHA' end, (select preferred_name from public.people where id = pa));
  rep := rep || format(E'\n[%s] city/state_uf atualizados, UF virou maiúscula mesmo enviada em minúsculo (%s / %s)', case when (select city from public.people where id = pa) = 'São Paulo' and (select state_uf from public.people where id = pa) = 'SP' then 'OK' else 'FALHA' end, (select city from public.people where id = pa), (select state_uf from public.people where id = pa));
  rep := rep || format(E'\n[%s] telefone virou o contato principal (%s)', case when exists (select 1 from public.person_contacts where person_id = pa and type='phone' and is_primary and value = '(11) 98888-7777') then 'OK' else 'FALHA' end, (select value from public.person_contacts where person_id=pa and type='phone' and is_primary));
  rep := rep || format(E'\n[%s] full_name NÃO mudou — campo não exposto pela função (%s = %s)', case when before_full_name = after_full_name then 'OK' else 'FALHA' end, before_full_name, after_full_name);
  rep := rep || format(E'\n[%s] unit_id (vínculo de unidade) NÃO mudou (%s)', case when before_unit = after_unit then 'OK' else 'FALHA' end, after_unit);

  perform set_config('request.jwt.claims', json_build_object('sub', u_pat, 'role','authenticated')::text, true);
  set local role authenticated;
  begin perform public.my_profile_update(null, '123', null, null); ok := true; exception when others then ok := false; end;
  reset role;
  rep := rep || format(E'\n[%s] telefone inválido (poucos dígitos) é rejeitado', case when not ok then 'OK' else 'FALHA' end);

  -- troca de telefone: nunca dois "principais" ao mesmo tempo (o índice único parcial garante isso)
  perform set_config('request.jwt.claims', json_build_object('sub', u_pat, 'role','authenticated')::text, true);
  set local role authenticated;
  perform public.my_profile_update(null, '11977776666', null, null);
  reset role;
  select count(*) into n from public.person_contacts where person_id = pa and type = 'phone' and is_primary;
  rep := rep || format(E'\n[%s] troca de telefone: exatamente 1 principal, nunca dois ao mesmo tempo (%s)', case when n = 1 then 'OK' else 'FALHA' end, n);

  -- conta autenticada sem cadastro de pessoa vinculado é rejeitada com clareza (não escreve em cadastro nenhum)
  declare u_nolink uuid := gen_random_uuid(); ok2 boolean := false; begin
    insert into auth.users (id, aud, role, email) values (u_nolink,'authenticated','authenticated','selfedit.nolink@t.local');
    insert into public.user_accounts (user_id, org_id, display_name) values (u_nolink, v_org, 'Sem Pessoa');
    perform set_config('request.jwt.claims', json_build_object('sub', u_nolink, 'role','authenticated')::text, true);
    set local role authenticated;
    begin perform public.my_profile_update('X', null, null, null); ok2 := true; exception when others then ok2 := false; end;
    reset role;
    rep := rep || format(E'\n[%s] conta sem pessoa vinculada é rejeitada', case when not ok2 then 'OK' else 'FALHA' end);
  end;

  -- tentativa de escrita direta (fora do RPC) em cadastro de OUTRA pessoa continua bloqueada pela RLS de sempre
  perform set_config('request.jwt.claims', json_build_object('sub', u_pat, 'role','authenticated')::text, true);
  set local role authenticated;
  update public.people set full_name = 'HACKEADO' where id = other_pa;
  reset role;
  select full_name into after_full_name from public.people where id = other_pa;
  rep := rep || format(E'\n[%s] UPDATE direto em people de outra pessoa continua bloqueado pela RLS (%s)', case when after_full_name = 'Outra Pessoa SelfEdit' then 'OK' else 'FALHA' end, after_full_name);

  select count(*) into n from public.audit_log where entity_type = 'people' and entity_id = pa::text and new_values ? 'preferred_name';
  rep := rep || format(E'\n[%s] auditoria registrou o novo valor de preferred_name (%s entrada(s))', case when n >= 1 then 'OK' else 'FALHA' end, n);

  raise exception E'RELATORIO_PATIENT_SELF_EDIT (transação desfeita):%', rep;
end $$;
