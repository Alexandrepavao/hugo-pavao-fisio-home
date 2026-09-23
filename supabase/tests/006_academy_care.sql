-- Teste Academy e acompanhamento de pacientes. Transação desfeita ao final. Somente dev/teste.
do $$
declare
  v_org uuid; v_ua uuid; v_pipe uuid;
  u_mgr uuid := gen_random_uuid(); u_fin uuid := gen_random_uuid(); u_sales uuid := gen_random_uuid(); u_tea uuid := gen_random_uuid();
  u_st1 uuid := gen_random_uuid(); u_st2 uuid := gen_random_uuid(); u_phy uuid := gen_random_uuid(); u_phy2 uuid := gen_random_uuid(); u_pat uuid := gen_random_uuid(); u_pat2 uuid := gen_random_uuid();
  ps1 uuid; ps2 uuid; ppat uuid; ppat2 uuid; prod uuid; prod_full uuid; course uuid; course_full uuid; l1 uuid; l2 uuid; l_draft uuid; quiz uuid; q1 uuid; q2 uuid; acct uuid;
  sa uuid; sb uuid; ra uuid; rb1 uuid; rb2 uuid; pay uuid; post uuid; ent uuid; content uuid; asg uuid; obj uuid; cid uuid; relid uuid;
  n int; ok boolean; rep text := ''; res jsonb;
begin
  select id into v_org from public.organizations where slug = 'hp-group';
  select id into v_ua from public.units where org_id = v_org and slug = 'sao-paulo';
  insert into auth.users (id, aud, role, email) select x, 'authenticated', 'authenticated', x::text || '@t.local' from unnest(array[u_mgr,u_fin,u_sales,u_tea,u_st1,u_st2,u_phy,u_phy2,u_pat,u_pat2]) x;
  insert into public.people (org_id, unit_id, full_name) values (v_org, v_ua, 'Aluno Um') returning id into ps1;
  insert into public.people (org_id, unit_id, full_name) values (v_org, v_ua, 'Aluno Dois') returning id into ps2;
  insert into public.people (org_id, unit_id, full_name) values (v_org, v_ua, 'Paciente Um') returning id into ppat;
  insert into public.people (org_id, unit_id, full_name) values (v_org, v_ua, 'Paciente Dois') returning id into ppat2;
  insert into public.user_accounts (user_id, org_id, person_id) values (u_mgr, v_org, null),(u_fin, v_org, null),(u_sales, v_org, null),(u_tea, v_org, null),(u_st1, v_org, ps1),(u_st2, v_org, ps2),(u_phy, v_org, null),(u_phy2, v_org, null),(u_pat, v_org, ppat),(u_pat2, v_org, ppat2);
  insert into public.role_assignments (org_id, user_id, role, unit_id) values (v_org, u_mgr, 'manager', null),(v_org, u_fin, 'finance', v_ua),(v_org, u_sales, 'sales', v_ua),(v_org, u_tea, 'teacher', null),
    (v_org, u_st1, 'member', null),(v_org, u_st2, 'member', null),(v_org, u_phy, 'physio', v_ua),(v_org, u_phy2, 'physio', v_ua),(v_org, u_pat, 'member', null),(v_org, u_pat2, 'member', null);
  insert into public.financial_accounts (org_id, name) values (v_org, 'Conta ac') returning id into acct;
  insert into public.products (org_id, kind, name, price_cents, validity_days) values (v_org, 'course', 'Curso (teste)', 100000, 365) returning id into prod;
  insert into public.products (org_id, kind, name, price_cents, access_rule) values (v_org, 'mentoring', 'Mentoria pagto integral (teste)', 200000, 'on_full_payment') returning id into prod_full;

  -- conteúdo (professor)
  perform set_config('request.jwt.claims', json_build_object('sub', u_tea, 'role','authenticated')::text, true);
  set local role authenticated;
  insert into public.courses (org_id, kind, title, slug, product_id, status, created_by) values (v_org, 'course', 'Curso de teste', 'curso-teste', prod, 'published', u_tea) returning id into course;
  insert into public.courses (org_id, kind, title, slug, product_id, status, created_by) values (v_org, 'mentoring', 'Mentoria de teste', 'mentoria-teste', prod_full, 'published', u_tea) returning id into course_full;
  insert into public.lessons (org_id, course_id, title, position, kind, published) values (v_org, course, 'Aula 1', 1, 'text', true) returning id into l1;
  insert into public.lessons (org_id, course_id, title, position, kind, published) values (v_org, course, 'Aula 2', 2, 'text', true) returning id into l2;
  insert into public.lessons (org_id, course_id, title, position, kind, published) values (v_org, course, 'Rascunho', 3, 'text', false) returning id into l_draft;
  insert into public.quizzes (org_id, course_id, title, pass_score) values (v_org, course, 'Prova final', 70) returning id into quiz;
  insert into public.quiz_questions (org_id, quiz_id, position, prompt, options, correct_index) values (v_org, quiz, 1, 'P1', '["a","b"]', 1) returning id into q1;
  insert into public.quiz_questions (org_id, quiz_id, position, prompt, options, correct_index) values (v_org, quiz, 2, 'P2', '["a","b","c"]', 2) returning id into q2;
  reset role;
  insert into storage.objects (bucket_id, name, owner_id) values ('academy-private', course::text || '/aula1.mp4', null) returning id into obj;

  -- sem acesso: aluno não vê nada
  perform set_config('request.jwt.claims', json_build_object('sub', u_st1, 'role','authenticated')::text, true);
  set local role authenticated;
  select count(*) into n from public.lessons; rep := rep || format(E'\n[%s] aluno sem acesso não vê aulas (%s)', case when n = 0 then 'OK' else 'FALHA' end, n);
  select count(*) into n from public.courses; rep := rep || format(E'\n[%s] aluno sem acesso não vê cursos (%s)', case when n = 0 then 'OK' else 'FALHA' end, n);
  select count(*) into n from storage.objects where bucket_id = 'academy-private'; rep := rep || format(E'\n[%s] aluno sem acesso não enxerga arquivo privado (%s)', case when n = 0 then 'OK' else 'FALHA' end, n);
  ok := false; begin perform public.lesson_complete(l1); exception when others then ok := sqlstate = '42501'; end; rep := rep || format(E'\n[%s] aluno sem acesso não conclui aula', case when ok then 'OK' else 'FALHA' end);
  ok := false; begin perform public.entitlement_grant_manual(ps1, course, null, 'x'); exception when others then ok := sqlstate = '42501'; end; rep := rep || format(E'\n[%s] aluno não concede acesso a si mesmo', case when ok then 'OK' else 'FALHA' end);
  reset role;

  -- compra (acesso por pagamento confirmado)
  perform set_config('request.jwt.claims', json_build_object('sub', u_sales, 'role','authenticated')::text, true);
  set local role authenticated;
  sa := public.sale_create(ps1, v_ua, null, jsonb_build_array(jsonb_build_object('product_id', prod)), 0, 1);
  perform public.sale_confirm(sa);
  reset role;
  select id into ra from public.receivables where sale_id = sa;
  perform set_config('request.jwt.claims', json_build_object('sub', u_st1, 'role','authenticated')::text, true);
  set local role authenticated;
  select count(*) into n from public.lessons; rep := rep || format(E'\n[%s] retorno ao checkout/venda sem pagamento NÃO libera acesso (%s)', case when n = 0 then 'OK' else 'FALHA' end, n);
  reset role;
  perform set_config('request.jwt.claims', json_build_object('sub', u_fin, 'role','authenticated')::text, true);
  set local role authenticated;
  pay := public.payment_record(ra, 100000, now(), 'pix', acct, 'ac-1');
  reset role;
  perform set_config('request.jwt.claims', json_build_object('sub', u_st1, 'role','authenticated')::text, true);
  set local role authenticated;
  select count(*) into n from public.lessons; rep := rep || format(E'\n[%s] pagamento confirmado libera as aulas publicadas (%s de 2; rascunho oculto)', case when n = 2 then 'OK' else 'FALHA' end, n);
  select count(*) into n from storage.objects where bucket_id = 'academy-private'; rep := rep || format(E'\n[%s] aluno com acesso enxerga o arquivo do curso (%s)', case when n = 1 then 'OK' else 'FALHA' end, n);
  select count(*) into n from public.quiz_questions; rep := rep || format(E'\n[%s] aluno não lê o gabarito diretamente (%s)', case when n = 0 then 'OK' else 'FALHA' end, n);
  res := public.quiz_for_student(quiz);
  rep := rep || format(E'\n[%s] prova entregue ao aluno sem o campo correct_index', case when res::text not like '%correct%' and jsonb_array_length(res -> 'questions') = 2 then 'OK' else 'FALHA' end);
  ok := false; begin perform public.issue_certificate(course); exception when others then ok := sqlerrm like 'progresso insuficiente%'; end; rep := rep || format(E'\n[%s] certificado exige conclusão das aulas', case when ok then 'OK' else 'FALHA' end);
  perform public.lesson_complete(l1); perform public.lesson_complete(l1); perform public.lesson_complete(l2);
  select done into n from public.course_progress(course); rep := rep || format(E'\n[%s] progresso conta aulas concluídas uma vez (%s)', case when n = 2 then 'OK' else 'FALHA' end, n);
  ok := false; begin perform public.issue_certificate(course); exception when others then ok := sqlerrm like '%avaliações pendentes%'; end; rep := rep || format(E'\n[%s] certificado exige aprovação na avaliação', case when ok then 'OK' else 'FALHA' end);
  res := public.quiz_submit(quiz, jsonb_build_object(q1::text, 0, q2::text, 2));
  rep := rep || format(E'\n[%s] nota calculada no servidor (50%% reprova): %s', case when (res ->> 'score')::int = 50 and not (res ->> 'passed')::boolean then 'OK' else 'FALHA' end, res);
  res := public.quiz_submit(quiz, jsonb_build_object(q1::text, 1, q2::text, 2));
  rep := rep || format(E'\n[%s] aprovação com 100%%', case when (res ->> 'passed')::boolean then 'OK' else 'FALHA' end);
  cid := public.issue_certificate(course);
  rep := rep || format(E'\n[%s] certificado emitido uma única vez', case when cid = public.issue_certificate(course) then 'OK' else 'FALHA' end);
  -- comunidade
  post := public.community_post(course, 'Olá turma!');
  reset role;
  perform set_config('request.jwt.claims', json_build_object('sub', u_st2, 'role','authenticated')::text, true);
  set local role authenticated;
  ok := false; begin perform public.community_post(course, 'intruso'); exception when others then ok := sqlstate = '42501'; end; rep := rep || format(E'\n[%s] quem não tem acesso não publica na comunidade', case when ok then 'OK' else 'FALHA' end);
  select count(*) into n from public.community_posts; rep := rep || format(E'\n[%s] quem não tem acesso não lê a comunidade (%s)', case when n = 0 then 'OK' else 'FALHA' end, n);
  reset role;
  perform set_config('request.jwt.claims', json_build_object('sub', u_tea, 'role','authenticated')::text, true);
  set local role authenticated;
  perform public.community_moderate(post, true, 'teste');
  reset role;
  perform set_config('request.jwt.claims', json_build_object('sub', u_st1, 'role','authenticated')::text, true);
  set local role authenticated;
  select count(*) into n from public.community_posts; rep := rep || format(E'\n[%s] comentário moderado some para alunos (%s)', case when n = 0 then 'OK' else 'FALHA' end, n);
  ok := false; begin perform public.community_moderate(post, false); exception when others then ok := sqlstate = '42501'; end; rep := rep || format(E'\n[%s] aluno não modera', case when ok then 'OK' else 'FALHA' end);
  reset role;

  -- estorno revoga acesso imediatamente
  perform set_config('request.jwt.claims', json_build_object('sub', u_fin, 'role','authenticated')::text, true);
  set local role authenticated;
  perform public.payment_refund(pay, 100000, 'devolução total', 'ac-r1');
  reset role;
  perform set_config('request.jwt.claims', json_build_object('sub', u_st1, 'role','authenticated')::text, true);
  set local role authenticated;
  select count(*) into n from public.lessons; rep := rep || format(E'\n[%s] estorno total revoga o acesso na hora (aulas visíveis=%s)', case when n = 0 then 'OK' else 'FALHA' end, n);
  select count(*) into n from storage.objects where bucket_id = 'academy-private'; rep := rep || format(E'\n[%s] estorno também bloqueia o arquivo privado (%s)', case when n = 0 then 'OK' else 'FALHA' end, n);
  ok := false; begin perform public.lesson_complete(l2); exception when others then ok := sqlstate = '42501'; end; rep := rep || format(E'\n[%s] servidor recusa ação após revogação', case when ok then 'OK' else 'FALHA' end);
  reset role;

  -- regra: liberar só com pagamento integral
  perform set_config('request.jwt.claims', json_build_object('sub', u_sales, 'role','authenticated')::text, true);
  set local role authenticated;
  sb := public.sale_create(ps2, v_ua, null, jsonb_build_array(jsonb_build_object('product_id', prod_full)), 0, 2);
  perform public.sale_confirm(sb);
  reset role;
  select id into rb1 from public.receivables where sale_id = sb and installment_no = 1; select id into rb2 from public.receivables where sale_id = sb and installment_no = 2;
  perform set_config('request.jwt.claims', json_build_object('sub', u_fin, 'role','authenticated')::text, true);
  set local role authenticated;
  perform public.payment_record(rb1, 100000, now(), 'pix', acct, 'ac-2');
  reset role;
  select count(*) into n from public.entitlements where person_id = ps2 and revoked_at is null; rep := rep || format(E'\n[%s] regra "pagamento integral": 1ª parcela ainda não libera (%s)', case when n = 0 then 'OK' else 'FALHA' end, n);
  perform set_config('request.jwt.claims', json_build_object('sub', u_fin, 'role','authenticated')::text, true);
  set local role authenticated;
  perform public.payment_record(rb2, 100000, now(), 'pix', acct, 'ac-3');
  reset role;
  select count(*) into n from public.entitlements where person_id = ps2 and revoked_at is null; rep := rep || format(E'\n[%s] regra "pagamento integral": quitação libera (%s)', case when n = 1 then 'OK' else 'FALHA' end, n);

  -- liberação manual e validade
  perform set_config('request.jwt.claims', json_build_object('sub', u_mgr, 'role','authenticated')::text, true);
  set local role authenticated;
  ok := false; begin perform public.entitlement_grant_manual(ps1, course, null, ''); exception when others then ok := true; end; rep := rep || format(E'\n[%s] liberação manual exige motivo', case when ok then 'OK' else 'FALHA' end);
  ent := public.entitlement_grant_manual(ps1, course, null, 'cortesia autorizada');
  reset role;
  perform set_config('request.jwt.claims', json_build_object('sub', u_st1, 'role','authenticated')::text, true);
  set local role authenticated;
  select count(*) into n from public.lessons; rep := rep || format(E'\n[%s] liberação manual vale imediatamente (%s)', case when n = 2 then 'OK' else 'FALHA' end, n);
  reset role;
  update public.entitlements set valid_from = now() - interval '2 days', valid_until = now() - interval '1 day' where id = ent;
  perform set_config('request.jwt.claims', json_build_object('sub', u_st1, 'role','authenticated')::text, true);
  set local role authenticated;
  select count(*) into n from public.lessons; rep := rep || format(E'\n[%s] acesso vencido não libera (%s)', case when n = 0 then 'OK' else 'FALHA' end, n);
  reset role;

  -- ACOMPANHAMENTO DE PACIENTES
  perform set_config('request.jwt.claims', json_build_object('sub', u_phy, 'role','authenticated')::text, true);
  set local role authenticated;
  insert into public.care_contents (org_id, unit_id, title, kind, body, created_by) values (v_org, v_ua, 'Alongamento lombar', 'exercise_video', 'Orientação', u_phy) returning id into content;
  ok := false; begin perform public.care_assign(ppat, content, 'program'); exception when others then ok := sqlstate = '42501'; end;
  rep := rep || format(E'\n[%s] fisioterapeuta sem vínculo não libera conteúdo ao paciente', case when ok then 'OK' else 'FALHA' end);
  reset role;
  perform set_config('request.jwt.claims', json_build_object('sub', u_mgr, 'role','authenticated')::text, true);
  set local role authenticated;
  relid := public.care_link(ppat, u_phy, v_ua);
  reset role;
  insert into storage.objects (bucket_id, name, owner_id) values ('care-private', content::text || '/video.mp4', null);
  perform set_config('request.jwt.claims', json_build_object('sub', u_phy, 'role','authenticated')::text, true);
  set local role authenticated;
  asg := public.care_assign(ppat, content, 'program');
  rep := rep || format(E'\n[%s] com vínculo, o fisioterapeuta libera o conteúdo', case when asg is not null then 'OK' else 'FALHA' end);
  reset role;
  perform set_config('request.jwt.claims', json_build_object('sub', u_pat, 'role','authenticated')::text, true);
  set local role authenticated;
  select count(*) into n from public.care_assignments; rep := rep || format(E'\n[%s] paciente vê o que foi liberado (%s)', case when n = 1 then 'OK' else 'FALHA' end, n);
  select count(*) into n from public.care_contents; rep := rep || format(E'\n[%s] paciente vê apenas o conteúdo liberado (%s)', case when n = 1 then 'OK' else 'FALHA' end, n);
  select count(*) into n from storage.objects where bucket_id = 'care-private'; rep := rep || format(E'\n[%s] paciente acessa o vídeo liberado (%s)', case when n = 1 then 'OK' else 'FALHA' end, n);
  perform public.care_log_activity(asg, 3::smallint, null, 'senti dor leve', true);
  perform public.care_send_message('Tenho uma dúvida sobre o exercício');
  reset role;
  select count(*) into n from public.crm_tasks where person_id = ppat and kind = 'follow_up' and assignee_user_id = u_phy; rep := rep || format(E'\n[%s] sinalização e dúvida do paciente geram tarefas para o profissional (%s)', case when n >= 2 then 'OK' else 'FALHA' end, n);
  perform set_config('request.jwt.claims', json_build_object('sub', u_pat2, 'role','authenticated')::text, true);
  set local role authenticated;
  select count(*) into n from public.care_assignments; select count(*) + n into n from public.care_messages; select count(*) + n into n from public.care_activity; select count(*) + n into n from storage.objects where bucket_id = 'care-private';
  rep := rep || format(E'\n[%s] outro paciente não vê nada de acompanhamento alheio (%s)', case when n = 0 then 'OK' else 'FALHA' end, n);
  reset role;
  perform set_config('request.jwt.claims', json_build_object('sub', u_mgr, 'role','authenticated')::text, true);
  set local role authenticated;
  select count(*) into n from public.care_messages; select count(*) + n into n from public.care_activity; select count(*) + n into n from public.care_assignments;
  rep := rep || format(E'\n[%s] gestor NÃO tem acesso clínico individual (%s)', case when n = 0 then 'OK' else 'FALHA' end, n);
  reset role;
  perform set_config('request.jwt.claims', json_build_object('sub', u_phy2, 'role','authenticated')::text, true);
  set local role authenticated;
  select count(*) into n from public.care_messages; select count(*) + n into n from public.care_activity; select count(*) + n into n from public.care_assignments;
  rep := rep || format(E'\n[%s] outro fisioterapeuta sem vínculo não lê dados do paciente (%s)', case when n = 0 then 'OK' else 'FALHA' end, n);
  ok := false; begin perform public.care_reply(ppat, 'oi'); exception when others then ok := sqlstate = '42501'; end; rep := rep || format(E'\n[%s] fisioterapeuta sem vínculo não responde ao paciente', case when ok then 'OK' else 'FALHA' end);
  reset role;
  perform set_config('request.jwt.claims', json_build_object('sub', u_phy, 'role','authenticated')::text, true);
  set local role authenticated;
  select count(*) into n from public.care_messages; rep := rep || format(E'\n[%s] profissional vinculado lê o canal de dúvidas (%s)', case when n = 1 then 'OK' else 'FALHA' end, n);
  perform public.care_reply(ppat, 'Vamos ajustar o exercício.');
  reset role;
  -- revogação do vínculo derruba o acesso sensível
  perform set_config('request.jwt.claims', json_build_object('sub', u_mgr, 'role','authenticated')::text, true);
  set local role authenticated;
  perform public.care_unlink(relid);
  reset role;
  perform set_config('request.jwt.claims', json_build_object('sub', u_phy, 'role','authenticated')::text, true);
  set local role authenticated;
  select count(*) into n from public.care_messages; select count(*) + n into n from public.care_activity;
  rep := rep || format(E'\n[%s] revogar vínculo remove o acesso do profissional (%s)', case when n = 0 then 'OK' else 'FALHA' end, n);
  reset role;
  perform set_config('request.jwt.claims', json_build_object('sub', u_pat, 'role','authenticated')::text, true);
  set local role authenticated;
  select count(*) into n from public.care_assignments; select count(*) + n into n from storage.objects where bucket_id = 'care-private';
  rep := rep || format(E'\n[%s] revogar vínculo também retira o conteúdo liberado ao paciente (%s)', case when n = 0 then 'OK' else 'FALHA' end, n);
  reset role;

  raise exception E'RELATORIO_ACADEMY_CARE (transação desfeita):%', rep;
end $$;
