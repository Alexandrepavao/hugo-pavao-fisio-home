-- DEMONSTRAÇÃO (somente Dev): contas, campanhas, gasto, leads, agendamentos, vendas e recebimentos SINTÉTICOS, todos marcados com "DEMO" no nome.
-- Gerado a partir da fixture de teste N26. Remova com: node supabase/tools/marketing-demo.mjs remove
create temp table demo_c (ord int, platform text, name text, purpose text, front text, status text, spend numeric, impr int, clk int, leads int, classified boolean);
    insert into demo_c values
      (1, 'meta', 'DEMO Meta | Captação Pacientes — Avaliação gratuita SP Zona Sul · Público frio 25–45 anos · Criativo vídeo depoimento A (teste de oferta e copy)', 'Captar pacientes', 'HP Fisioterapia', 'ACTIVE', 90, 5200, 150, 18, true),
      (2, 'meta', 'DEMO Meta | Captação Parceiros Fisio', 'Captar parceiros', 'HP Fisioterapia', 'ACTIVE', 40, 2600, 70, 6, true),
      (3, 'meta', 'DEMO Meta | Reconhecimento HP Group', 'DEMO Reconhecimento', 'HP Fisioterapia', 'ACTIVE', 60, 14000, 130, 0, true),
      (4, 'meta', 'DEMO Meta | Mentoria Academy — Venda', 'Vender mentoria', 'HP Academy', 'PAUSED', 55, 3100, 80, 8, true),
      (5, 'meta', 'DEMO Meta | Teste criativo 1', 'Captar pacientes', 'HP Fisioterapia', 'ACTIVE', 12, 900, 20, 2, true),
      (6, 'meta', 'DEMO Meta | Teste criativo 2', 'Captar pacientes', 'HP Fisioterapia', 'ACTIVE', 12, 880, 22, 2, true),
      (7, 'meta', 'DEMO Meta | Teste criativo 3', 'Captar pacientes', 'HP Fisioterapia', 'PAUSED', 12, 700, 15, 1, true),
      (8, 'meta', 'DEMO Meta | Teste criativo 4', 'Captar pacientes', 'HP Fisioterapia', 'ACTIVE', 12, 950, 24, 2, true),
      (9, 'meta', 'DEMO Meta | Campanha nova sem classificação', null, null, 'ACTIVE', 18, 1200, 30, 1, false),
      (10, 'google', 'DEMO Google | Pesquisa — fisioterapia domiciliar zona sul e oeste', 'Captar pacientes', 'HP Fisioterapia', 'ENABLED', 70, 2400, 160, 12, true),
      (11, 'google', 'DEMO Google | Pesquisa — pilates', 'Captar pacientes', 'HP Fisioterapia', 'ENABLED', 35, 1300, 70, 5, true),
      (12, 'google', 'DEMO Google | Display remarketing', 'Captar pacientes', 'HP Fisioterapia', 'ENABLED', 20, 9000, 40, 0, true),
      (13, 'google', 'DEMO Google | Marca HP', 'Captar pacientes', 'HP Fisioterapia', 'ENABLED', 15, 600, 60, 3, true),
      (14, 'google', 'DEMO Google | Pesquisa — curso de pós Academy', 'Vender mentoria', 'HP Academy', 'PAUSED', 25, 900, 38, 2, true),
      (15, 'google', 'DEMO Google | Pesquisa — tecnologia para clínicas', 'Vender tecnologia', 'HP Tech', 'ENABLED', 22, 700, 30, 1, true);
    do $$
    declare
      v_org uuid; ua uuid; mgr uuid; pipe uuid; st_new uuid; svc uuid; prod uuid; acc_m uuid; acc_g uuid; camp uuid; fr uuid; pu uuid; pr uuid; p uuid; o uuid; sale uuid; rec uuid; r record;
      v_today date := (now() at time zone 'America/Sao_Paulo')::date; d int; j int; ts timestamptz; slot int := 0; prof uuid; pid uuid[] := '{}'; n_sales int := 0;
    begin
      select id into v_org from public.organizations where slug = 'hp-group'; select id into ua from public.units where org_id = v_org and slug = 'sao-paulo';
      select u.id into mgr from auth.users u where u.email = 'qa.manager@hp-test.dev';
      select id, (select id from public.pipeline_stages s where s.pipeline_id = pl.id order by position limit 1) into pipe, st_new from public.pipelines pl where org_id = v_org and name = 'Pacientes' limit 1;
      insert into public.services (org_id, name, duration_min) values (v_org, 'DEMO Avaliação', 45) returning id into svc;
      insert into public.products (org_id, kind, name, price_cents, active) values (v_org, 'service', 'Produto DEMO', 100000, true) returning id into prod;
      for d in 1..80 loop insert into public.professionals (org_id, display_name) values (v_org, 'Fisio DEMO ' || d) returning id into prof; pid := pid || prof; end loop;
      insert into public.mkt_purposes (org_id, label, default_result, position) values (v_org, 'DEMO Reconhecimento', 'awareness', 90) on conflict do nothing;
      perform private.mkt_seed_defaults(v_org);
      set local role authenticated; perform set_config('request.jwt.claims', json_build_object('sub', mgr, 'role', 'authenticated')::text, true);
      acc_m := public.mkt_manual_account_create('meta', 'DEMO conta Meta', 'BRL', 'America/Sao_Paulo', ua); acc_g := public.mkt_manual_account_create('google', 'DEMO conta Google', 'BRL', 'America/Sao_Paulo', ua);
      reset role; update public.mkt_connections set enabled = true where org_id = v_org and platform in ('meta', 'google');
      for r in select * from demo_c order by ord loop
        set local role authenticated; perform set_config('request.jwt.claims', json_build_object('sub', mgr, 'role', 'authenticated')::text, true);
        camp := public.mkt_manual_campaign_create(case when r.platform = 'meta' then acc_m else acc_g end, r.name);
        if r.classified then
          select id into fr from public.mkt_fronts where org_id = v_org and label = r.front; select id into pu from public.mkt_purposes where org_id = v_org and label = r.purpose;
          perform public.mkt_class_save(camp, jsonb_build_object('front_id', fr, 'purpose_id', pu, 'unit_id', ua));
        end if;
        for d in 1..75 loop perform public.mkt_spend_manual_upsert(camp, v_today - d, round(r.spend * (0.75 + ((d * 7 + r.ord * 3) % 11) / 20.0), 2), 'BRL', round(r.impr * (0.8 + ((d * 5 + r.ord) % 9) / 20.0))::int, round(r.clk * (0.8 + ((d * 3 + r.ord) % 7) / 20.0))::int, 'DEMO', false); end loop;
        reset role; update public.mkt_campaigns set platform_status = r.status where id = camp;
        for j in 1..(r.leads * 2) loop
          d := ((j * 7 + r.ord * 5) % 72) + 1; ts := now() - make_interval(days => d);
          insert into public.people (org_id, unit_id, full_name) values (v_org, ua, 'Lead DEMO ' || r.ord || '-' || j) returning id into p;
          perform private.mkt_touch_upsert(v_org, ua, p, null, ts - interval '2 hours', 'form', 'form:demo', gen_random_uuid(),
            jsonb_build_object('utm_source', case when r.platform = 'meta' then 'facebook' else 'google' end, 'utm_medium', 'cpc', 'utm_campaign', r.name), null, '/lp');
          set local role authenticated; perform set_config('request.jwt.claims', json_build_object('sub', mgr, 'role', 'authenticated')::text, true);
          o := public.crm_create_opportunity(p, pipe, ua, 'Opp DEMO ' || r.ord || '-' || j, null, 0, mgr, 'teste', null); reset role;
          update public.opportunities set created_at = ts where id = o; update public.mkt_attributions set opp_created_at = ts where opportunity_id = o;
          if j % 3 <> 0 then update public.opportunities set first_response_at = ts + interval '25 minutes' where id = o; end if;
          if j % 4 = 1 or j % 6 = 0 then
            slot := slot + 1; insert into public.appointments (org_id, unit_id, professional_id, person_id, service_id, opportunity_id, period, status)
              values (v_org, ua, pid[((slot - 1) % 80) + 1], p, svc, o, tstzrange(ts + interval '2 days', ts + interval '2 days 45 minutes'), case when j % 2 = 1 and ts + interval '2 days' < now() then 'attended' else 'scheduled' end);
          end if;
          if j % 5 = 1 and r.leads >= 6 and n_sales < 26 then
            set local role authenticated; perform set_config('request.jwt.claims', json_build_object('sub', mgr, 'role', 'authenticated')::text, true);
            sale := public.sale_create(p, ua, o, ('[{"product_id":"' || prod || '","qty":' || ((j % 3) + 1) || '}]')::jsonb, 0, 1, current_date, null, 'demo-' || r.ord || '-' || j); perform public.sale_confirm(sale); reset role;
            n_sales := n_sales + 1;
            select id into rec from public.receivables where sale_id = sale limit 1;
            if n_sales % 2 = 0 and rec is not null then insert into public.payments (org_id, unit_id, receivable_id, kind, amount_cents, paid_at, idempotency_key) values (v_org, ua, rec, 'payment', 100000, now(), 'demo-p-' || r.ord || '-' || j); end if;
          end if;
        end loop;
      end loop;
      reset role;
    end $$;

-- zonas e cidades (cerca de 1 em cada 7 fica sem localização)
update public.people p set zone = case z.k when 0 then 'sul' when 1 then 'norte' when 2 then 'leste' when 3 then 'oeste' when 4 then 'centro' else p.zone end,
    city = case when z.k = 5 then 'Campinas' else p.city end, state_uf = case when z.k = 5 then 'SP' else p.state_uf end
  from (select id, abs(hashtext(id::text)) % 8 k from public.people where full_name like 'Lead DEMO %') z where p.id = z.id;
-- perdas com motivo (leads sem venda)
insert into public.loss_reasons (org_id, name) select id, 'DEMO Sem orçamento' from public.organizations where slug = 'hp-group' on conflict do nothing;
insert into public.loss_reasons (org_id, name) select id, 'DEMO Preço' from public.organizations where slug = 'hp-group' on conflict do nothing;
insert into public.loss_reasons (org_id, name) select id, 'DEMO Sem retorno do paciente' from public.organizations where slug = 'hp-group' on conflict do nothing;
update public.opportunities o set status = 'lost', closed_at = o.created_at + interval '6 days',
  lost_reason_id = (select id from public.loss_reasons r where r.org_id = o.org_id and r.name = (array['DEMO Sem orçamento','DEMO Preço','DEMO Sem retorno do paciente'])[1 + abs(hashtext(o.id::text)) % 3])
 where o.person_id in (select id from public.people where full_name like 'Lead DEMO %') and o.created_at < now() - interval '8 days'
   and not exists (select 1 from public.sales s where s.person_id = o.person_id) and abs(hashtext(o.id::text)) % 4 = 0;
