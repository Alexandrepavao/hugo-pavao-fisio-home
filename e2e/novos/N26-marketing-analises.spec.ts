// NOVO — N26: Marketing › Análises — seis blocos (qualidade por campanha, onde se perdem, tempo, região, dia/horário, retorno por mês), números que conferem entre si e com a Visão geral,
// filtros, estados (sem leads), 390 px, tema escuro e permissões. Também confere que o jargão “coorte” não aparece na tela.
// DADOS SINTÉTICOS APENAS DE FIXTURE (prefixo "N26", gasto lançado manualmente): nunca aparecem como resultado real; tudo é removido no fim. Nada aqui prova a comunicação com Meta/Google.
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
const readyA = async (p: Page, full = true) => { await expect(p.getByTestId("mkt-analytics")).toBeVisible({ timeout: 40_000 }); await expect(p.getByTestId("mkt-an-cards")).toBeVisible(); if (full) await expect(p.getByTestId("mkt-an-quality")).toBeVisible({ timeout: 40_000 }); await p.waitForLoadState("networkidle"); await p.waitForTimeout(800); };
// período fixo de 30 dias: os leads de teste ficam entre 1 e 21 dias atrás, então os totais não dependem do dia do mês em que o teste roda
const RANGE = () => `periodo=personalizado&de=${spDate(-30)}&ate=${spDate(0)}`;
const num = (s: string) => Number(s.replace(/[^\d]/g, ""));

test.describe.serial("@novos Marketing: Análises", () => {
  test.setTimeout(420_000);
  const TAG = "N26";
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
      delete from public.units where slug = 'n26-sem-contas';`).catch(() => null);
  };
  test.beforeAll(async () => { if (process.env.SUPABASE_ACCESS_TOKEN) await clean(); });
  test.afterAll(async () => { if (process.env.SUPABASE_ACCESS_TOKEN) await clean(); });

  test("fixtures sintéticas identificadas (N26): 2 contas, 15 campanhas (nomes longos), 21 dias de gasto, 60 leads com contato, agendamento, comparecimento e vendas; unidade sem contas; dias com falha", async () => {
    await devSql(`
    create temp table n26_c (ord int, platform text, name text, purpose text, front text, status text, spend numeric, impr int, clk int, leads int, classified boolean);
    insert into n26_c values
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
      insert into public.units (org_id, name, slug) values (v_org, '${TAG} Unidade sem contas', 'n26-sem-contas') on conflict do nothing;
      perform private.mkt_seed_defaults(v_org);
      set local role authenticated; perform set_config('request.jwt.claims', json_build_object('sub', mgr, 'role', 'authenticated')::text, true);
      acc_m := public.mkt_manual_account_create('meta', '${TAG} conta Meta', 'BRL', 'America/Sao_Paulo', ua); acc_g := public.mkt_manual_account_create('google', '${TAG} conta Google', 'BRL', 'America/Sao_Paulo', ua);
      reset role; update public.mkt_connections set enabled = true where org_id = v_org and platform in ('meta', 'google');
      for r in select * from n26_c order by ord loop
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
          perform private.mkt_touch_upsert(v_org, ua, p, null, ts - interval '2 hours', 'form', 'form:n26', gen_random_uuid(),
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
            sale := public.sale_create(p, ua, o, ('[{"product_id":"' || prod || '","qty":' || ((j % 3) + 1) || '}]')::jsonb, 0, 1, current_date, null, 'n26-' || r.ord || '-' || j); perform public.sale_confirm(sale); reset role;
            n_sales := n_sales + 1;
            select id into rec from public.receivables where sale_id = sale limit 1;
            if n_sales % 2 = 0 and rec is not null then insert into public.payments (org_id, unit_id, receivable_id, kind, amount_cents, paid_at, idempotency_key) values (v_org, ua, rec, 'payment', 100000, now(), 'n26-p-' || r.ord || '-' || j); end if;
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
    // regiões sintéticas: zonas e cidade nos leads de teste (ordem estável pelo id); ~28% ficam sem localização
    await devSql(`update public.people p set zone = case z.k when 0 then 'sul' when 1 then 'norte' when 2 then 'leste' when 3 then 'oeste' else p.zone end,
        city = case when z.k = 4 then 'Campinas' else p.city end, state_uf = case when z.k = 4 then 'SP' else p.state_uf end
      from (select id, abs(hashtext(id::text)) % 7 k from public.people where full_name like 'Lead ${TAG} %') z where p.id = z.id`);
  });

  test("1440 px: dez cartões compactos, gráficos nos seis blocos de análise, sem overflow, sem erros de console e sem o jargão “coorte”", async ({ page, context }) => {
    await loginAs(context, QA.manager); const errors = collectErrors(page);
    await page.goto(`/admin/marketing/analises?${RANGE()}`); await readyA(page);
    const cards = page.getByTestId("mkt-an-cards").locator('[data-testid^="mkt-an-card-"]'); await expect(cards).toHaveCount(10);
    const hs = await cards.evaluateAll((els) => els.map((e) => Math.round(e.getBoundingClientRect().height))); for (const h of hs) { expect(h).toBeGreaterThanOrEqual(100); expect(h).toBeLessThanOrEqual(140); }
    expect(num(await page.getByTestId("mkt-an-card-leads").locator("p.tabular").innerText())).toBeGreaterThan(20);
    await expect(page.getByTestId("mkt-an-card-conv")).toContainText("%"); await expect(page.getByTestId("mkt-an-card-sale-time")).toContainText(/dia|h|min/);
    for (const id of ["cpl", "cps", "roas", "ticket"]) { await expect(page.getByTestId(`mkt-an-card-${id}`)).toContainText(id === "roas" ? "x" : "R$"); await expect(page.getByTestId(`mkt-an-card-${id}`)).not.toContainText("Sem base"); }
    for (const id of ["sched", "attend"]) await expect(page.getByTestId(`mkt-an-card-${id}`)).toContainText("%"); await expect(page.getByTestId("mkt-an-card-contact-time")).toContainText(/min|h|dia/);
    // gráficos de verdade (não só barras de CSS): funil empilhado, curva de tempo, regiões e meses
    for (const id of ["mkt-an-drop-chart", "mkt-an-curve", "mkt-an-region-chart", "mkt-an-monthly-chart"]) await expect(page.getByTestId(id).locator("svg.recharts-surface").first()).toBeVisible();
    for (const id of ["quality", "dropoff", "timing", "regions", "hours", "monthly"]) await expect(page.getByTestId(`mkt-an-${id}`)).toBeVisible();
    await expect(page.getByTestId("mkt-an-scatter").locator("svg").first()).toBeVisible(); expect(await page.getByTestId("mkt-an-quality-row").count()).toBeGreaterThanOrEqual(5);
    await expect(page.getByTestId("mkt-an-heat")).toBeVisible(); await expect(page.getByTestId("mkt-an-month-row").first()).toBeVisible();
    await expect(page.getByText(/coorte/i)).toHaveCount(0); await expect(page.getByText("Indisponível")).toHaveCount(0);
    expect(await noOverflow(page), "sem rolagem horizontal").toBe(true);
    // fórmula na dica, não dentro do bloco
    await page.getByTestId("mkt-an-quality").getByRole("button", { name: /Como é calculado/ }).click(); await expect(page.locator("[data-radix-popper-content-wrapper]").first()).toContainText("Custo por lead = investimento ÷ leads"); await page.keyboard.press("Escape");
    await shot(page, "analises");
    expect(errors, errors.join("\n")).toEqual([]);
  });

  test("os números conferem entre si e com a Visão geral: leads = funil = regiões = horários = meses; contatos iguais ao funil da Visão geral", async ({ page, context }) => {
    await loginAs(context, QA.manager); const errors = collectErrors(page);
    await page.goto(`/admin/marketing/analises?${RANGE()}`); await readyA(page);
    const leads = num(await page.getByTestId("mkt-an-card-leads").locator("p.tabular").innerText()); expect(leads).toBeGreaterThan(20);
    const sum = (sel: string, attr: string) => page.locator(sel).evaluateAll((els, a) => els.reduce((s, e) => s + Number(e.getAttribute(a) ?? 0), 0), attr);
    const counts = JSON.parse((await page.getByTestId("mkt-an-drop-chart").getAttribute("data-counts")) ?? "{}") as { leads: number; contacted: number };
    expect(counts.leads, "leads do gráfico do funil").toBe(leads);
    expect(await sum('[data-testid="mkt-an-region-row"]', "data-leads"), "regiões somam os leads").toBe(leads);
    expect(await sum('[data-testid="mkt-an-heat"] [role="cell"]', "data-n"), "horários somam os leads").toBe(leads);
    expect(await sum('[data-testid="mkt-an-month-row"]', "data-leads"), "meses somam os leads").toBe(leads);
    const q = await sum('[data-testid="mkt-an-quality-row"]', "data-leads"); expect(q, "campanhas somam no máximo os leads").toBeLessThanOrEqual(leads); expect(q).toBeGreaterThan(0);
    const contacted = counts.contacted;
    // a Visão geral conta a mesma coisa pelo funil dos leads do período
    await page.goto(`/admin/marketing?${RANGE()}&visao=coorte`); await ready(page);
    await expect(page.getByTestId("mkt-funnel-step-lead")).toBeVisible({ timeout: 30_000 });
    expect(num(await page.getByTestId("mkt-funnel-step-lead").locator("span.tabular").first().innerText()), "leads do funil da Visão geral").toBe(leads);
    expect(num(await page.getByTestId("mkt-funnel-step-contacted").locator("span.tabular").first().innerText()), "contatos do funil da Visão geral").toBe(contacted);
    await expect(page.getByText(/coorte/i)).toHaveCount(0); await expect(page.getByTestId("mkt-funnel-card")).toContainText("Funil dos leads do período");
    expect(errors, errors.join("\n")).toEqual([]);
  });

  test("detalhes sob demanda e filtros: por campanha (perdas e tempo), mês a mês, uma campanha só e leitura honesta com pouco volume", async ({ page, context }) => {
    await loginAs(context, QA.manager); const errors = collectErrors(page);
    await page.goto(`/admin/marketing/analises?${RANGE()}`); await readyA(page);
    await page.getByTestId("mkt-an-dropoff").getByRole("button", { name: /por campanha/ }).click(); await expect(page.getByTestId("mkt-an-drop-campaigns")).toBeVisible(); expect(await page.getByTestId("mkt-an-drop-campaigns").locator("tbody tr").count()).toBeGreaterThanOrEqual(5);
    await page.getByTestId("mkt-an-timing").getByRole("button", { name: /por campanha/ }).click(); await expect(page.getByTestId("mkt-an-time-campaigns")).toBeVisible();
    // o quadro mês a mês só existe quando há mais de um mês de acompanhamento (leads do mês passado ou anterior); no mesmo mês só há o “+0” e o botão não aparece
    const tri = page.getByTestId("mkt-an-monthly").getByRole("button", { name: /mês a mês/ });
    if (await tri.count()) { await tri.click(); await expect(page.getByTestId("mkt-an-triangle")).toBeVisible(); await expect(page.getByTestId("mkt-an-triangle")).toContainText("+0"); await tri.click(); await expect(page.getByTestId("mkt-an-triangle")).toHaveCount(0); }
    else await expect(page.getByTestId("mkt-an-monthly")).not.toContainText("Ocultar mês a mês");
    await page.getByTestId("mkt-an-dropoff").getByRole("button", { name: /Ocultar por campanha/ }).click(); await expect(page.getByTestId("mkt-an-drop-campaigns")).toHaveCount(0);
    await expect(page.getByTestId("mkt-an-region-row").first()).toContainText("leads"); await expect(page.getByTestId("mkt-an-regions")).toContainText("Zona");
    await expect(page.getByTestId("mkt-an-slot").or(page.getByText(/ainda é pouco para apontar/))).toBeVisible();
    // uma campanha só (poucos leads): leitura “volume baixo”, sem dispersão, sem gargalo apontado
    const camp = ((await devSql(`select id from public.mkt_campaigns where name like '${TAG} Google | Pesquisa — pilates'`)) as { id: string }[])[0].id;
    await page.goto(`/admin/marketing/analises?${RANGE()}&campanha=${camp}`); await readyA(page);
    await expect(page.getByTestId("mkt-active-filters")).toContainText("Campanha:");
    await expect(page.getByTestId("mkt-an-card-leads").locator("p.tabular")).toHaveText("5"); await expect(page.getByTestId("mkt-an-quality-row")).toHaveCount(1); await expect(page.getByTestId("mkt-an-quality-row")).toContainText("Volume baixo");
    await expect(page.getByTestId("mkt-an-scatter")).toContainText("ao menos duas campanhas"); await expect(page.getByTestId("mkt-an-worst")).toContainText("Volume pequeno");
    await expect(page.getByTestId("mkt-an-dropoff")).toContainText("Volume pequeno");
    expect(errors, errors.join("\n")).toEqual([]);
  });

  test("estados: período sem leads e unidade sem contas mostram “Sem base” e explicação, sem zeros inventados nem blocos vazios", async ({ page, context }) => {
    await loginAs(context, QA.manager); const errors = collectErrors(page);
    await page.goto("/admin/marketing/analises?periodo=personalizado&de=2020-01-01&ate=2020-01-07"); await readyA(page, false);
    await expect(page.getByTestId("mkt-an-empty")).toBeVisible({ timeout: 30_000 }); await expect(page.getByTestId("mkt-an-empty")).toContainText("Nenhum lead de campanha neste período");
    await expect(page.getByTestId("mkt-an-ghosts").locator('[data-testid^="mkt-an-ghost-"]')).toHaveCount(6); await expect(page.getByTestId("mkt-an-ghost-quality")).toContainText("Aparece quando há");
    await expect(page.getByTestId("mkt-an-card-leads").locator("p.tabular")).toHaveText("0"); await expect(page.getByTestId("mkt-an-card-leads")).toContainText("Nenhum lead no período"); await expect(page.getByTestId("mkt-an-card-conv")).toContainText("Sem base");
    await expect(page.getByTestId("mkt-an-quality")).toHaveCount(0); await expect(page.getByText("Indisponível")).toHaveCount(0); await shot(page, "analises-sem-leads");
    const emptyUnit = ((await devSql(`select id from public.units where slug = 'n26-sem-contas'`)) as { id: string }[])[0].id;
    await page.goto(`/admin/marketing/analises?${RANGE()}&unidade=${emptyUnit}`); await readyA(page, false); await expect(page.getByTestId("mkt-an-empty")).toBeVisible({ timeout: 30_000 }); await expect(page.getByTestId("mkt-an-card-sale-time")).toContainText("Sem base");
    expect(errors, errors.join("\n")).toEqual([]);
  });

  test("390 px: cartões em duas colunas, blocos sem corte, mapa de horários dentro da tela, sem overflow; tema claro e escuro", async ({ browser }) => {
    const ctx = await browser.newContext({ timezoneId: "America/Sao_Paulo", viewport: { width: 390, height: 844 }, isMobile: true, hasTouch: true }); await loginAs(ctx, QA.manager); const p = await ctx.newPage(); const errors = collectErrors(p);
    await p.goto(`/admin/marketing/analises?${RANGE()}`); await readyA(p);
    const xs = await p.getByTestId("mkt-an-cards").locator('[data-testid^="mkt-an-card-"]').evaluateAll((els) => els.map((e) => Math.round(e.getBoundingClientRect().left))); expect(new Set(xs).size, "duas colunas").toBe(2);
    expect(await noOverflow(p), "sem rolagem horizontal").toBe(true);
    const clipped = await p.evaluate(() => [...document.querySelectorAll('section[data-testid^="mkt-an-"], [data-testid="mkt-an-heat"], [data-testid="mkt-an-quality-row"]')].filter((e) => e.getBoundingClientRect().right > window.innerWidth + 1).length);
    expect(clipped, "elementos que passam da tela").toBe(0);
    await shot(p, "analises-mobile"); expect(errors, errors.join("\n")).toEqual([]); await ctx.close();
  });

  test("menu e permissões: “Análises” aparece no menu do Marketing; fisioterapeuta e aluno não entram; anônimo vai para o login", async ({ page, context, browser }) => {
    await loginAs(context, QA.manager); await page.goto(`/admin/marketing/analises?${RANGE()}`); await readyA(page, false);
    await expect(page.getByRole("link", { name: "Análises" }).first()).toBeVisible();
    for (const who of [QA.fisio, QA.aluno, null] as const) {
      const c = await browser.newContext({ timezoneId: "America/Sao_Paulo" }); if (who) await loginAs(c, who); const p = await c.newPage();
      await p.goto("/admin/marketing/analises"); await p.waitForLoadState("networkidle"); await expect(p.getByTestId("mkt-analytics")).toHaveCount(0); await c.close();
    }
  });
});
