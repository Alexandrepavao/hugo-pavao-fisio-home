// NOVO — N25: dashboard compacto do Marketing — layout (cartões ~110–125 px, sem cortes/overflow), métricas por objetivo, seleção de métrica, comparação, filtros ativos,
// estados (sem dados, sem conta, falha de sincronização), 390 px em duas colunas, tema escuro e permissões.
// DADOS SINTÉTICOS APENAS DE FIXTURE (prefixo "N25", gasto lançado manualmente): nunca aparecem como resultado real; tudo é removido no fim. Nada aqui prova a comunicação com Meta/Google.
import { expect, test, type Page } from "@playwright/test";
import { join } from "node:path";
import { collectErrors, devSql, loginAs, QA, spDate } from "../release/helpers-release";

test.use({ timezoneId: "America/Sao_Paulo", locale: "pt-BR", viewport: { width: Number(process.env.MKT_W ?? 1440), height: Number(process.env.MKT_H ?? 900) } });
const shot = async (p: Page, name: string) => {
  if (!process.env.MKT_SHOTS) return;
  const tag = process.env.MKT_TAG ? `-${process.env.MKT_TAG}` : ""; const themes = (process.env.MKT_THEMES ?? "light").split(",");
  for (const t of themes) {
    await p.evaluate((th) => { try { localStorage.setItem("hp-theme", th); } catch { /* sem storage */ } document.documentElement.dataset.theme = th; }, t); await p.waitForTimeout(700);
    await p.screenshot({ path: join(process.env.MKT_SHOTS, `${name}${tag}-${t}.png`), fullPage: true });
  }
  await p.evaluate(() => { try { localStorage.setItem("hp-theme", "light"); } catch { /* sem storage */ } document.documentElement.dataset.theme = "light"; });
};
const noOverflow = (p: Page) => p.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth + 1);
const ready = async (p: Page) => { await expect(p.getByTestId("mkt-overview")).toBeVisible({ timeout: 40_000 }); await expect(p.getByTestId("mkt-kpis")).toBeVisible(); await p.waitForLoadState("networkidle"); await p.waitForTimeout(800); };

test.describe.serial("@novos Marketing: dashboard compacto (cartões e gráficos)", () => {
  test.setTimeout(420_000);
  const TAG = "N25";
  const S: Record<string, string> = {}; let acc = "";
  const clean = async () => {
    await devSql(`set local session_replication_role = replica;
      delete from public.mkt_touches where person_id in (select id from public.people where full_name like 'Lead ${TAG} %') or utm_campaign like '${TAG} %';
      delete from public.payments where receivable_id in (select id from public.receivables where sale_id in (select id from public.sales where person_id in (select id from public.people where full_name like 'Lead ${TAG} %')));
      delete from public.receivables where sale_id in (select id from public.sales where person_id in (select id from public.people where full_name like 'Lead ${TAG} %'));
      delete from public.contracts where person_id in (select id from public.people where full_name like 'Lead ${TAG} %');
      delete from public.client_packages where person_id in (select id from public.people where full_name like 'Lead ${TAG} %');
      delete from public.sale_items where sale_id in (select id from public.sales where person_id in (select id from public.people where full_name like 'Lead ${TAG} %'));
      delete from public.sales where person_id in (select id from public.people where full_name like 'Lead ${TAG} %');
      delete from public.appointments where person_id in (select id from public.people where full_name like 'Lead ${TAG} %');
      delete from public.interactions where person_id in (select id from public.people where full_name like 'Lead ${TAG} %');
      delete from public.crm_tasks where person_id in (select id from public.people where full_name like 'Lead ${TAG} %');
      delete from public.opportunities where person_id in (select id from public.people where full_name like 'Lead ${TAG} %');
      delete from public.person_contacts where person_id in (select id from public.people where full_name like 'Lead ${TAG} %');
      delete from public.person_kinds where person_id in (select id from public.people where full_name like 'Lead ${TAG} %');
      delete from public.people where full_name like 'Lead ${TAG} %';
      delete from public.mkt_spend_daily where account_id in (select id from public.mkt_ad_accounts where name like '${TAG} conta %');
      delete from public.mkt_entity_daily where account_id in (select id from public.mkt_ad_accounts where name like '${TAG} conta %');
      delete from public.mkt_breakdown_daily where account_id in (select id from public.mkt_ad_accounts where name like '${TAG} conta %');
      delete from public.mkt_day_status where account_id in (select id from public.mkt_ad_accounts where name like '${TAG} conta %');
      delete from public.mkt_campaign_class_history where campaign_id in (select id from public.mkt_campaigns where name like '${TAG} %');
      delete from public.mkt_campaign_class where campaign_id in (select id from public.mkt_campaigns where name like '${TAG} %');
      delete from public.mkt_campaigns where name like '${TAG} %';
      delete from public.mkt_ad_accounts where name like '${TAG} conta %';
      delete from public.mkt_attributions where opportunity_id not in (select id from public.opportunities);
      delete from public.mkt_sale_attributions where sale_id not in (select id from public.sales);
      delete from public.mkt_person_origin where person_id not in (select id from public.people);
      delete from public.mkt_purposes where label like '${TAG} %';
      delete from public.products where name = 'Produto ${TAG}';
      delete from public.services where name = '${TAG} Avaliação';
      delete from public.professionals where display_name like 'Fisio ${TAG} %';
      delete from public.units where slug = 'n25-sem-contas';`).catch(() => null);
  };
  test.beforeAll(async () => { if (process.env.SUPABASE_ACCESS_TOKEN) await clean(); });
  test.afterAll(async () => { if (process.env.SUPABASE_ACCESS_TOKEN) await clean(); });

  test("fixtures sintéticas identificadas (N25): 2 contas, 15 campanhas (nomes longos), 21 dias de gasto, 60 leads com contato, agendamento, comparecimento e vendas; unidade sem contas; dias com falha", async () => {
    await devSql(`
    create temp table n25_c (ord int, platform text, name text, purpose text, front text, status text, spend numeric, impr int, clk int, leads int, classified boolean);
    insert into n25_c values
      (1, 'meta', '${TAG} Meta | Captação Pacientes — Avaliação gratuita SP Zona Sul · Público frio 25–45 anos · Criativo vídeo depoimento A (teste de oferta e copy)', 'Captar pacientes', 'HP Fisioterapia', 'ACTIVE', 90, 5200, 150, 18, true),
      (2, 'meta', '${TAG} Meta | Captação Parceiros Fisio', 'Captar parceiros', 'HP Fisioterapia', 'ACTIVE', 40, 2600, 70, 6, true),
      (3, 'meta', '${TAG} Meta | Reconhecimento HP Group', '${TAG} Reconhecimento', 'HP Fisioterapia', 'ACTIVE', 60, 14000, 130, 0, true),
      (4, 'meta', '${TAG} Meta | Mentoria Academy — Venda', 'Vender mentoria', 'HP Academy', 'PAUSED', 55, 3100, 80, 8, true),
      (5, 'meta', '${TAG} Meta | Teste criativo 1', 'Captar pacientes', 'HP Fisioterapia', 'ACTIVE', 12, 900, 20, 2, true),
      (6, 'meta', '${TAG} Meta | Teste criativo 2', 'Captar pacientes', 'HP Fisioterapia', 'ACTIVE', 12, 880, 22, 2, true),
      (7, 'meta', '${TAG} Meta | Teste criativo 3', 'Captar pacientes', 'HP Fisioterapia', 'PAUSED', 12, 700, 15, 1, true),
      (8, 'meta', '${TAG} Meta | Teste criativo 4', 'Captar pacientes', 'HP Fisioterapia', 'ACTIVE', 12, 950, 24, 2, true),
      (9, 'meta', '${TAG} Meta | Campanha nova sem classificação', null, null, 'ACTIVE', 18, 1200, 30, 1, false),
      (10, 'google', '${TAG} Google | Pesquisa — fisioterapia domiciliar zona sul e oeste', 'Captar pacientes', 'HP Fisioterapia', 'ENABLED', 70, 2400, 160, 12, true),
      (11, 'google', '${TAG} Google | Pesquisa — pilates', 'Captar pacientes', 'HP Fisioterapia', 'ENABLED', 35, 1300, 70, 5, true),
      (12, 'google', '${TAG} Google | Display remarketing', 'Captar pacientes', 'HP Fisioterapia', 'ENABLED', 20, 9000, 40, 0, true),
      (13, 'google', '${TAG} Google | Marca HP', 'Captar pacientes', 'HP Fisioterapia', 'ENABLED', 15, 600, 60, 3, true),
      (14, 'google', '${TAG} Google | Pesquisa — curso de pós Academy', 'Vender mentoria', 'HP Academy', 'PAUSED', 25, 900, 38, 2, true),
      (15, 'google', '${TAG} Google | Pesquisa — tecnologia para clínicas', 'Vender tecnologia', 'HP Tech', 'ENABLED', 22, 700, 30, 1, true);
    do $$
    declare
      v_org uuid; ua uuid; mgr uuid; pipe uuid; st_new uuid; svc uuid; prod uuid; acc_m uuid; acc_g uuid; camp uuid; fr uuid; pu uuid; pr uuid; p uuid; o uuid; sale uuid; rec uuid; r record;
      v_today date := (now() at time zone 'America/Sao_Paulo')::date; d int; j int; ts timestamptz; slot int := 0; prof uuid; pid uuid[] := '{}'; n_sales int := 0;
    begin
      select id into v_org from public.organizations where slug = 'hp-group'; select id into ua from public.units where org_id = v_org and slug = 'sao-paulo';
      select u.id into mgr from auth.users u where u.email = '${QA.manager}';
      select id, (select id from public.pipeline_stages s where s.pipeline_id = pl.id order by position limit 1) into pipe, st_new from public.pipelines pl where org_id = v_org and name = 'Pacientes' limit 1;
      insert into public.services (org_id, name, duration_min) values (v_org, '${TAG} Avaliação', 45) returning id into svc;
      insert into public.products (org_id, kind, name, price_cents, active) values (v_org, 'service', 'Produto ${TAG}', 100000, true) returning id into prod;
      for d in 1..40 loop insert into public.professionals (org_id, display_name) values (v_org, 'Fisio ${TAG} ' || d) returning id into prof; pid := pid || prof; end loop;
      insert into public.mkt_purposes (org_id, label, default_result, position) values (v_org, '${TAG} Reconhecimento', 'awareness', 90) on conflict do nothing;
      insert into public.units (org_id, name, slug) values (v_org, '${TAG} Unidade sem contas', 'n25-sem-contas') on conflict do nothing;
      perform private.mkt_seed_defaults(v_org);
      set local role authenticated; perform set_config('request.jwt.claims', json_build_object('sub', mgr, 'role', 'authenticated')::text, true);
      acc_m := public.mkt_manual_account_create('meta', '${TAG} conta Meta', 'BRL', 'America/Sao_Paulo', ua); acc_g := public.mkt_manual_account_create('google', '${TAG} conta Google', 'BRL', 'America/Sao_Paulo', ua);
      reset role; update public.mkt_connections set enabled = true where org_id = v_org and platform in ('meta', 'google');
      for r in select * from n25_c order by ord loop
        set local role authenticated; perform set_config('request.jwt.claims', json_build_object('sub', mgr, 'role', 'authenticated')::text, true);
        camp := public.mkt_manual_campaign_create(case when r.platform = 'meta' then acc_m else acc_g end, r.name);
        if r.classified then
          select id into fr from public.mkt_fronts where org_id = v_org and label = r.front; select id into pu from public.mkt_purposes where org_id = v_org and label = r.purpose;
          perform public.mkt_class_save(camp, jsonb_build_object('front_id', fr, 'purpose_id', pu, 'unit_id', ua));
        end if;
        for d in 1..21 loop perform public.mkt_spend_manual_upsert(camp, v_today - d, round(r.spend * (0.75 + ((d * 7 + r.ord * 3) % 11) / 20.0), 2), 'BRL', round(r.impr * (0.8 + ((d * 5 + r.ord) % 9) / 20.0))::int, round(r.clk * (0.8 + ((d * 3 + r.ord) % 7) / 20.0))::int, '${TAG}', false); end loop;
        reset role; update public.mkt_campaigns set platform_status = r.status where id = camp;
        for j in 1..r.leads loop
          d := ((j * 3 + r.ord * 2) % 20) + 1; ts := now() - make_interval(days => d);
          insert into public.people (org_id, unit_id, full_name) values (v_org, ua, 'Lead ${TAG} ' || r.ord || '-' || j) returning id into p;
          perform private.mkt_touch_upsert(v_org, ua, p, null, ts - interval '2 hours', 'form', 'form:n25', gen_random_uuid(),
            jsonb_build_object('utm_source', case when r.platform = 'meta' then 'facebook' else 'google' end, 'utm_medium', 'cpc', 'utm_campaign', r.name), null, '/lp');
          set local role authenticated; perform set_config('request.jwt.claims', json_build_object('sub', mgr, 'role', 'authenticated')::text, true);
          o := public.crm_create_opportunity(p, pipe, ua, 'Opp ${TAG} ' || r.ord || '-' || j, null, 0, mgr, 'teste', null); reset role;
          update public.opportunities set created_at = ts where id = o; update public.mkt_attributions set opp_created_at = ts where opportunity_id = o;
          if j % 3 <> 0 then update public.opportunities set first_response_at = ts + interval '25 minutes' where id = o; end if;
          if j % 4 = 1 or j % 6 = 0 then
            slot := slot + 1; insert into public.appointments (org_id, unit_id, professional_id, person_id, service_id, opportunity_id, period, status)
              values (v_org, ua, pid[((slot - 1) % 40) + 1], p, svc, o, tstzrange(ts + interval '2 days', ts + interval '2 days 45 minutes'), case when j % 2 = 1 and ts + interval '2 days' < now() then 'attended' else 'scheduled' end);
          end if;
          if j % 5 = 1 and r.leads >= 6 and n_sales < 9 then
            set local role authenticated; perform set_config('request.jwt.claims', json_build_object('sub', mgr, 'role', 'authenticated')::text, true);
            sale := public.sale_create(p, ua, o, ('[{"product_id":"' || prod || '","qty":' || ((j % 3) + 1) || '}]')::jsonb, 0, 1, current_date, null, 'n25-' || r.ord || '-' || j); perform public.sale_confirm(sale); reset role;
            n_sales := n_sales + 1;
            select id into rec from public.receivables where sale_id = sale limit 1;
            if n_sales % 2 = 0 and rec is not null then insert into public.payments (org_id, unit_id, receivable_id, kind, amount_cents, paid_at, idempotency_key) values (v_org, ua, rec, 'payment', 100000, now(), 'n25-p-' || r.ord || '-' || j); end if;
          end if;
        end loop;
      end loop;
      reset role;
      -- dias com falha de sincronização na conta Meta (falha ≠ zero): dias 23 e 24 atrás, sem lançamento manual
      insert into public.mkt_day_status (account_id, org_id, day, status) values (acc_m, v_org, v_today - 23, 'failed'), (acc_m, v_org, v_today - 24, 'failed') on conflict (account_id, day) do update set status = 'failed';
    end $$;`);
    acc = ((await devSql(`select id from public.mkt_ad_accounts where name = '${TAG} conta Meta'`)) as { id: string }[])[0].id; S.acc = acc;
    const n = ((await devSql(`select count(*)::int n from public.mkt_campaigns where name like '${TAG} %'`)) as { n: number }[])[0].n; expect(n).toBe(15);
    const leads = ((await devSql(`select count(*)::int n from public.people where full_name like 'Lead ${TAG} %'`)) as { n: number }[])[0].n; expect(leads).toBe(63);
  });

  test("1440 px: cartões compactos (≈110–125 px, valor 28 px, sem textos longos), gráfico amplo, canais, funil por coorte e campanhas em cartões — sem overflow nem erros de console", async ({ page, context }) => {
    await loginAs(context, QA.manager); const errors = collectErrors(page);
    await page.goto("/admin/marketing?periodo=mes"); await ready(page);
    const kpis = page.getByTestId("mkt-kpis"); const cards = kpis.locator('[data-testid^="mkt-metric-"]'); await expect(cards).toHaveCount(6);
    for (const id of ["spend", "leads", "cpl", "sales", "revenue", "roas"]) await expect(page.getByTestId(`mkt-metric-${id}`)).toBeVisible();
    const boxes = await cards.evaluateAll((els) => els.map((e) => { const r = e.getBoundingClientRect(); const v = e.querySelector("p.tabular"); return { h: Math.round(r.height), vf: v ? parseFloat(getComputedStyle(v).fontSize) : 0 }; }));
    for (const b of boxes) { expect(b.h, "altura do cartão").toBeGreaterThanOrEqual(100); expect(b.h, "altura do cartão").toBeLessThanOrEqual(140); }
    expect(boxes.filter((b) => b.vf >= 26).length, "valores em destaque (≈28 px)").toBeGreaterThanOrEqual(5);
    // fórmulas ficam na dica (ícone), não dentro do cartão
    await expect(page.getByTestId("mkt-metric-cpl")).not.toContainText("Investimento ÷"); await page.getByTestId("mkt-metric-cpl").getByRole("button", { name: /Como é calculado/ }).click();
    await expect(page.getByRole("dialog").or(page.locator("[data-radix-popper-content-wrapper]")).first()).toContainText("Investimento ÷ leads"); await page.keyboard.press("Escape");
    await expect(page.getByTestId("mkt-trend-chart")).toBeVisible(); await expect(page.getByTestId("mkt-channels")).toContainText("Meta"); await expect(page.getByTestId("mkt-channel-cpl")).toBeVisible();
    await expect(page.getByTestId("mkt-funnel-step-lead")).toBeVisible({ timeout: 30_000 });
    const cc = page.getByTestId("mkt-campaign-card"); await expect(cc.first()).toBeVisible({ timeout: 30_000 }); await expect(cc).toHaveCount(9);
    expect(await noOverflow(page), "sem rolagem horizontal").toBe(true);
    // nome longo: o cartão quebra em até 2 linhas e não estoura
    const longCard = cc.filter({ hasText: "Avaliação gratuita SP Zona Sul" }).first(); await expect(longCard).toBeVisible();
    const w = await longCard.evaluate((e) => ({ sw: e.scrollWidth, cw: e.clientWidth })); expect(w.sw).toBeLessThanOrEqual(w.cw + 1);
    await shot(page, "dashboard");
    expect(errors, errors.join("\n")).toEqual([]);
  });

  test("seleção de métrica pelo cartão e pelos botões; comparação com o período anterior; plataforma; filtros ativos com limpar; busca e “Carregar mais”", async ({ page, context }) => {
    await loginAs(context, QA.manager); const errors = collectErrors(page);
    await page.goto("/admin/marketing?periodo=mes"); await ready(page);
    await page.getByTestId("mkt-metric-leads").getByRole("button", { name: /Mostrar Leads únicos no gráfico/ }).click(); await expect(page.getByTestId("mkt-trend")).toContainText("Evolução · Leads únicos");
    await expect(page.getByTestId("mkt-metric-leads")).toHaveAttribute("data-selected", "true");
    await page.getByTestId("mkt-trend-roas").click(); await expect(page.getByTestId("mkt-trend")).toContainText("Evolução · ROAS"); await expect(page.getByTestId("mkt-metric-roas")).toHaveAttribute("data-selected", "true");
    // comparação (período anterior): só aparece com a opção ligada e base real
    await page.goto("/admin/marketing?periodo=7dias&comparar=1"); await ready(page); await page.getByTestId("mkt-trend-spend").click(); await expect(page.getByTestId("mkt-trend")).toContainText("Evolução · Investimento");
    await expect(page.getByTestId("mkt-trend")).toContainText("período anterior"); await expect(page.getByTestId("mkt-metric-spend")).toContainText("vs. período anterior");
    await page.goto("/admin/marketing?periodo=7dias"); await ready(page); await expect(page.getByTestId("mkt-trend")).not.toContainText("Linha tracejada"); await expect(page.getByTestId("mkt-metric-spend")).not.toContainText("vs. período anterior");
    // plataforma Meta: filtro ativo aparece e limpa; comparação de canais ignora a plataforma e avisa
    await page.getByTestId("mkt-platform-toggle").getByRole("button", { name: "Meta" }).click(); await expect(page).toHaveURL(/plataforma=meta/);
    await expect(page.getByTestId("mkt-active-filters")).toContainText("Plataforma: Meta Ads"); await expect(page.getByTestId("mkt-channels")).toContainText("ignorada aqui");
    await expect(page.getByTestId("mkt-channels")).toContainText("Google"); await expect(page.getByTestId("mkt-campaign-card").first()).toContainText("Meta Ads");
    await expect(page.getByTestId("mkt-campaign-card").filter({ hasText: "Google Ads" })).toHaveCount(0);
    await page.getByRole("button", { name: /Remover filtro Plataforma/ }).click(); await expect(page).not.toHaveURL(/plataforma=/); await expect(page.getByTestId("mkt-active-filters")).toHaveCount(0);
    // vários filtros e “Limpar filtros” (mantém o período)
    await page.goto("/admin/marketing?periodo=mes&plataforma=google&conta=" + acc); await ready(page); await expect(page.getByTestId("mkt-active-filters")).toContainText("Plataforma: Google Ads"); await expect(page.getByTestId("mkt-active-filters")).toContainText("Conta:");
    await page.getByTestId("mkt-clear-filters").click(); await expect(page).not.toHaveURL(/plataforma=|conta=/); await expect(page).toHaveURL(/periodo=mes/);
    // busca e paginação das campanhas
    await ready(page); await page.getByTestId("mkt-campaign-search").fill("N25 Google | Pesquisa — pilates"); await expect(page.getByTestId("mkt-campaign-card")).toHaveCount(1); await page.getByTestId("mkt-campaign-search").fill("");
    await expect(page.getByTestId("mkt-campaign-card")).toHaveCount(9); await page.getByTestId("mkt-campaign-more").click(); await expect.poll(() => page.getByTestId("mkt-campaign-card").count()).toBeGreaterThanOrEqual(15);
    expect(errors, errors.join("\n")).toEqual([]);
  });

  test("objetivo do administrador: campanhas de Reconhecimento trocam os cartões (impressões, CPM, cliques, CTR, CPC); vendas priorizam receita e ROAS; escopo misto usa captação", async ({ page, context }) => {
    await loginAs(context, QA.manager); const errors = collectErrors(page);
    const purposeId = ((await devSql(`select id from public.mkt_purposes where label = '${TAG} Reconhecimento'`)) as { id: string }[])[0].id;
    const mentoriaId = ((await devSql(`select id from public.mkt_purposes where label = 'Vender mentoria' limit 1`)) as { id: string }[])[0].id;
    await page.goto(`/admin/marketing?periodo=mes&conta=${acc}&finalidade=${purposeId}`); await ready(page);
    await expect(page.getByTestId("mkt-objective")).toContainText("Reconhecimento");
    for (const id of ["spend", "impressions", "cpm", "clicks", "ctr", "cpc"]) await expect(page.getByTestId(`mkt-metric-${id}`)).toBeVisible();
    await expect(page.getByTestId("mkt-metric-leads")).toHaveCount(0); await expect(page.getByTestId("mkt-metric-impressions")).not.toContainText("Sem base");
    await expect(page.getByTestId("mkt-campaign-card").first()).toContainText("Impressões"); await shot(page, "dashboard-reconhecimento");
    await page.goto(`/admin/marketing?periodo=mes&finalidade=${mentoriaId}`); await ready(page);
    await expect(page.getByTestId("mkt-objective")).toContainText("Vendas"); for (const id of ["spend", "sales", "revenue", "roas", "cps", "leads"]) await expect(page.getByTestId(`mkt-metric-${id}`)).toBeVisible();
    expect(errors, errors.join("\n")).toEqual([]);
  });

  test("estados: período sem dados (“Sem base”, sem zero inventado), unidade sem conta (Conectar conta), falha de sincronização e período em andamento", async ({ page, context }) => {
    await loginAs(context, QA.manager); const errors = collectErrors(page);
    await page.goto("/admin/marketing?periodo=personalizado&de=2020-01-01&ate=2020-01-07"); await ready(page);
    await expect(page.getByTestId("mkt-metric-spend")).toContainText("Sem base"); await expect(page.getByTestId("mkt-metric-cpl")).toContainText("Sem base"); await expect(page.getByTestId("mkt-metric-roas")).toContainText("Sem base");
    await expect(page.getByTestId("mkt-trend-empty")).toBeVisible(); await expect(page.getByTestId("mkt-channels")).toBeVisible(); await expect(page.getByTestId("mkt-funnel")).toHaveCount(0);
    await expect(page.getByText("Indisponível")).toHaveCount(0); await shot(page, "dashboard-sem-dados");
    const emptyUnit = ((await devSql(`select id from public.units where slug = 'n25-sem-contas'`)) as { id: string }[])[0].id;
    await page.goto(`/admin/marketing?periodo=mes&unidade=${emptyUnit}`); await ready(page);
    await expect(page.getByTestId("mkt-coverage")).toContainText("Nenhuma conta de anúncios acompanhada"); await expect(page.getByTestId("mkt-coverage").getByRole("link", { name: "Conectar conta" })).toBeVisible();
    await expect(page.getByTestId("mkt-metric-spend")).toContainText("Sem base"); await expect(page.getByTestId("mkt-campaign-cards")).toContainText("Nenhuma campanha neste escopo"); await shot(page, "dashboard-conexao-pendente");
    await page.goto(`/admin/marketing?periodo=7dias&conta=${acc}`); await ready(page);
    await expect(page.getByTestId("mkt-coverage")).toContainText("Período em andamento"); await expect(page.getByTestId("mkt-coverage")).toContainText("Sem coleta pela API");
    await page.goto(`/admin/marketing?periodo=personalizado&de=${spDate(-25)}&ate=${spDate(-20)}&conta=${acc}`); await ready(page);
    await expect(page.getByTestId("mkt-coverage")).toContainText("Falha na atualização em 2 dia(s)"); await expect(page.getByTestId("mkt-coverage")).not.toContainText("Período em andamento");
    await expect(page.getByTestId("mkt-coverage").getByRole("link", { name: "ver integrações" })).toBeVisible(); await shot(page, "dashboard-falha-sincronizacao");
    expect(errors, errors.join("\n")).toEqual([]);
  });

  test("detalhamentos e conciliação: Registros dos cartões, etapas do funil por coorte e a conferência do gasto batem com os registros", async ({ page, context }) => {
    await loginAs(context, QA.manager); const errors = collectErrors(page);
    await page.goto(`/admin/marketing?periodo=mes&conta=${acc}`); await ready(page);
    await page.getByRole("button", { name: "Ver registros: Investimento" }).click(); const dlg = page.getByRole("dialog"); await expect(dlg).toContainText("N25 Meta"); await page.keyboard.press("Escape");
    await page.getByRole("button", { name: "Ver registros: Leads únicos" }).click(); await expect(page.getByRole("dialog")).toContainText("Lead N25"); await page.keyboard.press("Escape");
    await page.getByTestId("mkt-funnel-step-contacted").click(); await expect(page.getByRole("dialog")).toContainText("Contato realizado"); await page.keyboard.press("Escape");
    await expect(page.getByTestId("mkt-reconciliation")).toContainText("confere");
    // o número do cartão é o mesmo da consulta (spend do mês = soma das parcelas das campanhas)
    const spendText = (await page.getByTestId("mkt-metric-spend").locator("p.tabular").innerText()).replace(/\s/g, " ");
    expect(spendText).toMatch(/^R\$ [\d.]+(,\d{2})?( mil| mi)?$/);
    expect(errors, errors.join("\n")).toEqual([]);
  });

  test("390 px: indicadores em duas colunas, gráficos sem corte, sem overflow, tema claro e escuro", async ({ browser }) => {
    const ctx = await browser.newContext({ timezoneId: "America/Sao_Paulo", viewport: { width: 390, height: 844 }, isMobile: true, hasTouch: true }); await loginAs(ctx, QA.manager); const p = await ctx.newPage(); const errors = collectErrors(p);
    await p.goto("/admin/marketing?periodo=mes"); await ready(p);
    const xs = await p.getByTestId("mkt-kpis").locator('[data-testid^="mkt-metric-"]').evaluateAll((els) => els.map((e) => Math.round(e.getBoundingClientRect().left)));
    expect(new Set(xs).size, "duas colunas de indicadores").toBe(2);
    expect(await noOverflow(p), "sem rolagem horizontal").toBe(true);
    const clipped = await p.evaluate(() => [...document.querySelectorAll('[data-testid="mkt-trend"], [data-testid="mkt-channels"], [data-testid="mkt-funnel-card"], [data-testid="mkt-campaign-card"]')].filter((e) => e.getBoundingClientRect().right > window.innerWidth + 1).length);
    expect(clipped, "blocos que passam da tela").toBe(0);
    await shot(p, "dashboard-mobile");
    await p.goto("/admin/marketing/campanhas?periodo=mes"); await p.waitForLoadState("networkidle"); expect(await noOverflow(p), "campanhas sem rolagem horizontal").toBe(true);
    expect(errors, errors.join("\n")).toEqual([]); await ctx.close();
  });

  test("permissões e isolamento: comercial de outra unidade não vê o gasto; fisioterapeuta e aluno não entram; anônimo vai para o login", async ({ browser }) => {
    const c1 = await browser.newContext({ timezoneId: "America/Sao_Paulo" }); await loginAs(c1, QA.fisio); const p1 = await c1.newPage();
    await p1.goto("/admin/marketing"); await p1.waitForLoadState("networkidle"); await expect(p1.getByTestId("mkt-overview")).toHaveCount(0); await c1.close();
    const c2 = await browser.newContext({ timezoneId: "America/Sao_Paulo" }); await loginAs(c2, QA.aluno); const p2 = await c2.newPage();
    await p2.goto("/admin/marketing"); await p2.waitForLoadState("networkidle"); await expect(p2.getByTestId("mkt-overview")).toHaveCount(0); await c2.close();
    const c3 = await browser.newContext({ timezoneId: "America/Sao_Paulo" }); const p3 = await c3.newPage(); await p3.goto("/admin/marketing"); await p3.waitForLoadState("networkidle"); await expect(p3.getByTestId("mkt-overview")).toHaveCount(0); await c3.close();
  });
});
