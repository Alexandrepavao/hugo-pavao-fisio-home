// NOVO — N22: módulo Marketing, jornada ponta a ponta no Dev:
//   link com origem (utm) → formulário do Pages → CRM → agendamento → comparecimento → venda → recebimento → dashboard com valores conciliados.
// Gastos: LANÇAMENTO MANUAL (não há acesso real às APIs da Meta/Google neste ambiente). Nada aqui prova a comunicação com as plataformas.
// Dados próprios (runId), removidos no fim; as configurações de Marketing alteradas pelo teste são restauradas.
import { expect, test, type Page } from "@playwright/test";
import { join } from "node:path";
import { SUPABASE_URL } from "../helpers";
import { api, collectErrors, devSql, loginAs, QA, runId, signIn, spDate } from "../release/helpers-release";

test.use({ timezoneId: "America/Sao_Paulo", locale: "pt-BR", viewport: { width: Number(process.env.MKT_W ?? 1280), height: Number(process.env.MKT_H ?? 900) } });
const sql = async <T,>(q: string) => (await devSql(q)) as T[];
const shot = async (p: Page, name: string) => {   // só para revisão visual (MKT_SHOTS=pasta; MKT_TAG=sufixo, ex. 1440; MKT_THEMES=light,dark)
  if (!process.env.MKT_SHOTS) return;
  const tag = process.env.MKT_TAG ? `-${process.env.MKT_TAG}` : ""; const themes = (process.env.MKT_THEMES ?? "light").split(",");
  for (const t of themes) {
    await p.evaluate((th) => { try { localStorage.setItem("hp-theme", th); } catch { /* sem storage */ } document.documentElement.dataset.theme = th; }, t); await p.waitForTimeout(700);
    await p.screenshot({ path: join(process.env.MKT_SHOTS, `${name}${tag}-${t}.png`), fullPage: true });
  }
  await p.evaluate(() => { try { localStorage.setItem("hp-theme", "light"); } catch { /* sem storage */ } document.documentElement.dataset.theme = "light"; });
};
const noOverflow = (p: Page) => p.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth + 1);

test.describe.serial("@novos Marketing: do anúncio ao recebimento", () => {
  test.setTimeout(300_000);
  const slug = `n22-${runId}`; const camp = `n22-camp-${runId}`; const campPending = `n22-pend-${runId}`; const personName = `Lead Marketing N22 ${runId}`; const email = `lead.n22.${runId.toLowerCase()}@example.com`; const phone = `(11) 9${Math.floor(1000 + Math.random() * 8999)}-${Math.floor(1000 + Math.random() * 8999)}`;
  const S: Record<string, string> = {}; let before: { settings: Record<string, unknown>; metaEnabled: boolean } | null = null;
  const clean = async () => {
    await devSql(`set local session_replication_role = replica;
      delete from public.mkt_touches where utm_campaign = '${camp}' or person_id in (select id from public.people where full_name = '${personName}');
      delete from public.payments where receivable_id in (select id from public.receivables where sale_id in (select id from public.sales where person_id in (select id from public.people where full_name = '${personName}')));
      delete from public.receivables where sale_id in (select id from public.sales where person_id in (select id from public.people where full_name = '${personName}'));
      delete from public.contracts where person_id in (select id from public.people where full_name = '${personName}');
      delete from public.client_packages where person_id in (select id from public.people where full_name = '${personName}');
      delete from public.sale_items where sale_id in (select id from public.sales where person_id in (select id from public.people where full_name = '${personName}'));
      delete from public.sales where person_id in (select id from public.people where full_name = '${personName}');
      delete from public.appointments where person_id in (select id from public.people where full_name = '${personName}');
      delete from public.form_submissions where page_id in (select id from public.pages where slug = '${slug}');
      delete from public.interactions where person_id in (select id from public.people where full_name = '${personName}');
      delete from public.opportunities where person_id in (select id from public.people where full_name = '${personName}');
      delete from public.person_contacts where person_id in (select id from public.people where full_name = '${personName}');
      delete from public.person_kinds where person_id in (select id from public.people where full_name = '${personName}');
      delete from public.people where full_name = '${personName}';
      delete from public.forms where page_id in (select id from public.pages where slug = '${slug}');
      delete from public.page_versions where page_id in (select id from public.pages where slug = '${slug}');
      delete from public.pages where slug = '${slug}';
      delete from public.mkt_spend_daily where account_id in (select id from public.mkt_ad_accounts where name like 'N22 conta %');
      delete from public.mkt_entity_daily where account_id in (select id from public.mkt_ad_accounts where name like 'N22 conta %');
      delete from public.mkt_breakdown_daily where account_id in (select id from public.mkt_ad_accounts where name like 'N22 conta %');
      delete from public.mkt_day_status where account_id in (select id from public.mkt_ad_accounts where name like 'N22 conta %');
      delete from public.mkt_campaign_class_history where campaign_id in (select id from public.mkt_campaigns where name like 'n22-%');
      delete from public.mkt_campaign_class where campaign_id in (select id from public.mkt_campaigns where name like 'n22-%');
      delete from public.mkt_funnels where name like 'n23-%';
      delete from public.mkt_dashboards where name like 'n23-%';
      delete from public.mkt_campaigns where name like 'n22-%';
      delete from public.mkt_ad_accounts where name like 'N22 conta %';
      delete from public.mkt_attributions where opportunity_id not in (select id from public.opportunities);
      delete from public.mkt_sale_attributions where sale_id not in (select id from public.sales);
      delete from public.mkt_person_origin where person_id not in (select id from public.people);
      delete from public.products where name = 'Pacote N22 ${runId}';
      delete from public.services where name = 'Avaliação N22 ${runId}';`).catch(() => null);
    if (before) await devSql(`update public.mkt_settings set qualified_stage_ids = '${(before.settings.qualified_stage_ids as string[] ?? []).length ? `{${(before.settings.qualified_stage_ids as string[]).join(",")}}` : "{}"}', evaluation_service_ids = '${(before.settings.evaluation_service_ids as string[] ?? []).length ? `{${(before.settings.evaluation_service_ids as string[]).join(",")}}` : "{}"}'
      where org_id = (select id from public.organizations where slug = 'hp-group'); update public.mkt_connections set enabled = ${before.metaEnabled} where platform = 'meta' and org_id = (select id from public.organizations where slug = 'hp-group');`).catch(() => null);
  };
  test.afterAll(async () => { if (process.env.SUPABASE_ACCESS_TOKEN) await clean(); });
  const createPage = async (page: Page) => {
    await page.goto("/admin/paginas"); await page.getByRole("button", { name: "Nova página" }).click(); await page.getByLabel("Endereço (/…)").fill(slug);
    await expect(page.getByLabel("Funil de destino")).not.toHaveValue(""); await expect(page.getByLabel("Unidade")).not.toHaveValue("");
    await page.getByRole("button", { name: "Criar e editar" }).click(); await expect(page).toHaveURL(/\/admin\/paginas\/[0-9a-f-]{36}$/);
    await page.getByRole("button", { name: "Publicar", exact: true }).click(); await expect(page.getByText("Página publicada.")).toBeVisible();
  };
  const kpi = (page: Page, label: string) => page.locator('[data-testid^="mkt-kpi-"], [data-testid^="mkt-metric-"]', { has: page.getByText(label, { exact: true }) }).first();

  test("fixtures: Marketing habilitado, conta e campanhas manuais classificadas, gasto de 5 dias, etapas de qualificação, serviço de avaliação, página com formulário e produto", async ({ page, context }) => {
    test.skip(!process.env.SUPABASE_ACCESS_TOKEN, "precisa de SUPABASE_ACCESS_TOKEN para preparar e limpar fixtures");
    await clean(); const mgr = await signIn(QA.manager); const g = api(mgr); await loginAs(context, QA.manager);
    S.org = (await g.get("organizations?select=id&slug=eq.hp-group")).body[0].id; S.unit = (await g.get("units?select=id&slug=eq.sao-paulo")).body[0].id;
    const cfg = (await g.rpc("mkt_config_get")).body; expect(cfg.settings, JSON.stringify(cfg)).toBeTruthy();
    before = { settings: { qualified_stage_ids: cfg.settings.qualified_stage_ids, evaluation_service_ids: cfg.settings.evaluation_service_ids }, metaEnabled: !!cfg.connections.find((c: { platform: string }) => c.platform === "meta")?.enabled };
    expect((await g.rpc("mkt_connection_enable", { p_platform: "meta", p_enabled: true })).status).toBeLessThan(300);
    S.acc = (await g.rpc("mkt_manual_account_create", { p_platform: "meta", p_name: `N22 conta ${runId}`, p_currency: "BRL", p_timezone: "America/Sao_Paulo", p_unit: S.unit })).body as string; expect(S.acc).toBeTruthy();
    S.camp = (await g.rpc("mkt_manual_campaign_create", { p_account: S.acc, p_name: camp })).body as string; S.pend = (await g.rpc("mkt_manual_campaign_create", { p_account: S.acc, p_name: campPending })).body as string;
    const front = cfg.fronts.find((f: { label: string }) => f.label === "HP Fisioterapia").id; const purpose = cfg.purposes.find((p: { label: string }) => p.label === "Captar pacientes").id; S.front = front; S.purpose = purpose;
    expect((await g.rpc("mkt_class_save", { p_campaign: S.camp, p_patch: { front_id: front, purpose_id: purpose, unit_id: S.unit, primary_result: "evaluation_done" } })).body.saved).toBe(true);
    for (let i = 1; i <= 5; i++) { const r = await g.rpc("mkt_spend_manual_upsert", { p_campaign: S.camp, p_day: spDate(-i), p_amount: 100, p_currency: "BRL", p_impressions: 1000, p_clicks: 20, p_note: "N22", p_prefer_manual: false }); expect(r.status, JSON.stringify(r.body)).toBeLessThan(300); }
    const pac = cfg.pipelines.find((p: { name: string }) => p.name === "Pacientes"); S.pipeline = pac.id; const q = pac.stages.filter((s: { position: number; kind: string }) => s.position >= 2 && s.kind !== "lost"); S.qstage = q[0].id;
    await sql(`insert into public.services (org_id, name, duration_min) values ('${S.org}', 'Avaliação N22 ${runId}', 60)`); S.svc = (await sql<{ id: string }>(`select id from public.services where name = 'Avaliação N22 ${runId}'`))[0].id;
    expect((await g.rpc("mkt_settings_set", { p: { qualified_stage_ids: q.map((s: { id: string }) => s.id), evaluation_service_ids: [S.svc] } })).status).toBeLessThan(300);
    S.prod = (await sql<{ id: string }>(`insert into public.products (org_id, kind, name, price_cents, sessions_count, validity_days, service_id, active) values ('${S.org}', 'package', 'Pacote N22 ${runId}', 100000, 5, 120, '${S.svc}', true) returning id`))[0].id;
    await createPage(page);
  });

  test("link com origem → formulário público: utm gravado higienizado, toque pago ligado à campanha, clique SEM consentimento não é guardado, uma pessoa e uma oportunidade atribuída", async ({ browser }) => {
    const ctx = await browser.newContext({ timezoneId: "America/Sao_Paulo" }); const v = await ctx.newPage(); const errors = collectErrors(v);
    const sent: string[] = []; v.on("request", (r) => { if (r.url().includes("submit_public_form")) sent.push(r.postData() ?? ""); });
    await v.goto(`/${slug}?utm_source=facebook&utm_medium=cpc&utm_campaign=${camp}&hp_adset_id=11122233&hp_ad_id=44455566&fbclid=IwAR_clique_secreto_123456&email=nao@guardar.com`);
    await expect(v.getByRole("textbox", { name: /Nome completo/ })).toBeVisible({ timeout: 30_000 });
    await v.getByRole("textbox", { name: /Nome completo/ }).fill(personName); await v.getByRole("textbox", { name: /WhatsApp/ }).fill(phone); await v.getByRole("textbox", { name: "E-mail" }).fill(email);
    await v.getByRole("button", { name: "Enviar" }).click(); await expect(v.getByText(/Recebemos seus dados/)).toBeVisible({ timeout: 30_000 }); expect(errors, errors.join("\n")).toEqual([]);
    expect(sent.join("")).not.toContain("fbclid"); expect(sent.join("")).not.toContain("IwAR_clique"); await ctx.close();                       // o navegador nem envia o identificador de clique sem consentimento
    const people = await sql<{ id: string }>(`select id from public.people where full_name = '${personName}'`); expect(people).toHaveLength(1); S.person = people[0].id;
    const opps = await sql<{ id: string; utm: Record<string, string> }>(`select id, utm from public.opportunities where person_id = '${S.person}'`); expect(opps).toHaveLength(1); S.opp = opps[0].id;
    expect(opps[0].utm).toMatchObject({ utm_source: "facebook", utm_medium: "cpc", utm_campaign: camp, hp_adset_id: "11122233", hp_ad_id: "44455566" }); expect(Object.keys(opps[0].utm)).not.toEqual(expect.arrayContaining(["email", "fbclid"]));
    const t = await sql<{ platform: string; is_paid: boolean; campaign_id: string; campaign_link_basis: string; click_id: string | null; entry_path: string; ext_adset_id: string }>(`select platform, is_paid, campaign_id, campaign_link_basis, click_id, entry_path, ext_adset_id from public.mkt_touches where person_id = '${S.person}'`);
    expect(t).toHaveLength(1); expect(t[0]).toMatchObject({ platform: "meta", is_paid: true, campaign_id: S.camp, campaign_link_basis: "name_exact", click_id: null, entry_path: `/${slug}`, ext_adset_id: "11122233" });
    const a = await sql<{ outcome: string }>(`select outcome from public.mkt_attributions where opportunity_id = '${S.opp}'`); expect(a).toEqual([{ outcome: "attributed" }]);
  });

  test("CRM → agenda → venda → recebimento (funções reais do Hub; o atendimento realizado entra por SQL de fixture)", async () => {
    const mgr = await signIn(QA.manager); const g = api(mgr);
    await sql(`update public.opportunities set stage_id = '${S.qstage}', first_response_at = created_at + interval '20 minutes' where id = '${S.opp}'`);                                          // lead qualificado + 1º contato humano em 20 min
    const prof = (await sql<{ id: string }>(`select id from public.professionals where org_id = '${S.org}' order by created_at limit 1`))[0]?.id; expect(prof, "precisa de um profissional no Dev").toBeTruthy();
    await sql(`insert into public.appointments (org_id, unit_id, professional_id, person_id, service_id, opportunity_id, period, status) values ('${S.org}', '${S.unit}', '${prof}', '${S.person}', '${S.svc}', '${S.opp}', tstzrange(now() - interval '2 days', now() - interval '2 days' + interval '60 minutes'), 'attended')`);
    const sale = await g.rpc("sale_create", { p_person: S.person, p_unit: S.unit, p_opportunity: S.opp, p_items: [{ product_id: S.prod, qty: 1 }], p_discount_cents: 0, p_installments: 2, p_first_due: spDate(0), p_notes: null, p_idempotency_key: `n22-${runId}` });
    expect(sale.status, JSON.stringify(sale.body)).toBeLessThan(300); S.sale = sale.body as string; expect((await g.rpc("sale_confirm", { p_sale: S.sale })).status).toBeLessThan(300);
    const rec = (await sql<{ id: string }>(`select id from public.receivables where sale_id = '${S.sale}' and installment_no = 1`))[0].id;
    const pay = await g.rpc("payment_record", { p_receivable: rec, p_amount_cents: 50000, p_paid_at: new Date().toISOString(), p_method: "pix", p_account: null, p_idempotency_key: `n22-p-${runId}`, p_note: null }); expect(pay.status, JSON.stringify(pay.body)).toBeLessThan(300);
    const sa = await sql<{ customer_type: string; outcome: string; link_basis: string }>(`select customer_type, outcome, link_basis from public.mkt_sale_attributions where sale_id = '${S.sale}'`);
    expect(sa).toEqual([{ customer_type: "new", outcome: "attributed", link_basis: "sale_opportunity" }]);
  });

  test("dashboard: cartões, funil, reconciliação e detalhamento conciliam com os dados criados; visão por coorte confere", async ({ page, context }) => {
    await loginAs(context, QA.manager); const errors = collectErrors(page);
    await page.goto(`/admin/marketing?periodo=7dias&campanha=${S.camp}&visao=evento`); await expect(page.getByTestId("mkt-overview")).toBeVisible({ timeout: 30_000 });
    await expect(page.getByTestId("mkt-coverage")).toContainText("Gasto coletado"); await expect(page.getByTestId("mkt-coverage")).toContainText(/último toque pago/i);
    await expect(page.getByTestId("mkt-metric-spend")).toContainText("R$ 500,00"); await expect(page.getByTestId("mkt-metric-leads")).toContainText("1"); await expect(page.getByTestId("mkt-metric-cpl")).toContainText("R$ 500,00");
    await expect(page.getByTestId("mkt-metric-sales")).toContainText("1"); await expect(page.getByTestId("mkt-metric-revenue")).toContainText("R$ 1.000"); await expect(page.getByTestId("mkt-metric-roas")).toContainText("2x");
    // funil por COORTE (lead → contato → agendamento → comparecimento → protocolo vendido): a mesma pessoa percorre as 5 etapas
    const f = page.getByTestId("mkt-funnel"); await expect(f).toBeVisible({ timeout: 30_000 });
    for (const k of ["lead", "contacted", "scheduled", "attended", "sold"]) await expect(f.getByTestId(`mkt-funnel-step-${k}`)).toContainText("1");
    // o mesmo número vem do servidor (cartão = RPC)
    const mgr = await signIn(QA.manager); const r = (await api(mgr).rpc("mkt_kpis", { p_from: spDate(-6), p_to: spDate(0), p_filters: { scope: "hub", campaign: S.camp }, p_view: "event" })).body;
    const val = (k: string) => r.kpis.find((x: { key: string }) => x.key === k).value; expect(val("spend")).toBe(500); expect(val("leads")).toBe(1); expect(val("sold")).toBe(1000); expect(val("received")).toBe(500); expect(val("media_cost_per_new_customer")).toBe(500); expect(val("roas_sales")).toBe(2); expect(val("first_response_min")).toBe(20);
    expect(val("eval_done")).toBe(1); expect(val("cost_per_eval")).toBe(500); expect(val("attendance_rate")).toBe(100);
    // detalhamento com os mesmos filtros
    await page.getByRole("button", { name: "Ver registros: Investimento" }).click(); await expect(page.getByRole("dialog")).toContainText(camp); await expect(page.getByRole("dialog")).toContainText("R$ 500,00"); await page.keyboard.press("Escape");
    await f.getByTestId("mkt-funnel-step-sold").click(); await expect(page.getByRole("dialog")).toContainText(personName); await page.keyboard.press("Escape");
    // coorte: os leads captados no período e o que aconteceu com eles
    await page.getByRole("button", { name: "Por data de captação do lead" }).click(); await expect(page).toHaveURL(/visao=coorte/); await expect(page.getByTestId("mkt-metric-revenue")).toContainText("R$ 1.000"); await expect(page.getByTestId("mkt-coverage")).toContainText("por data de captação do lead");
    await expect(page.getByTestId("mkt-reconciliation")).toContainText("confere"); await expect(page.getByTestId("mkt-campaign-card").filter({ hasText: camp })).toBeVisible(); await shot(page, "visao-geral");
    await page.goto(`/admin/marketing/funil?periodo=7dias&campanha=${S.camp}&visao=coorte`); await expect(page.getByTestId("mkt-model")).toBeVisible({ timeout: 30_000 });
    await expect(kpi(page, "Leads qualificados")).toContainText("1"); await expect(kpi(page, "Novos compradores")).toContainText("1"); await expect(kpi(page, "Valor recebido (líquido de estornos)")).toContainText("R$ 500"); await expect(kpi(page, "ROAS sobre vendas")).toContainText("2x"); await page.waitForTimeout(1500); await shot(page, "funil-atribuicao");
    expect(errors, errors.join("\n")).toEqual([]);
  });

  test("campanhas: nova campanha fica aguardando classificação; o administrador classifica vendo o efeito e o histórico; objetivo original não muda", async ({ page, context }) => {
    await loginAs(context, QA.manager); const errors = collectErrors(page);
    await page.goto(`/admin/marketing/campanhas?periodo=7dias&campanha=${S.pend}`); await expect(page.getByTestId("mkt-campaigns")).toBeVisible({ timeout: 30_000 });
    const row = page.getByRole("row", { name: new RegExp(campPending) }); await expect(row).toContainText("Aguardando classificação"); await row.getByRole("button", { name: "Classificar" }).click();
    const dlg = page.getByTestId("classify-dialog"); await expect(dlg).toContainText("só interna"); await expect(dlg.getByTestId("classify-effect")).toContainText("Nenhuma alteração", { timeout: 15_000 });
    const sels = dlg.locator("select"); await sels.nth(0).selectOption({ index: 1 }); await sels.nth(1).selectOption({ index: 1 }); await expect(dlg.getByTestId("classify-effect")).toContainText("aplicada na leitura", { timeout: 15_000 }); await expect(dlg.getByTestId("classify-effect")).toContainText("todos os períodos");
    await dlg.getByRole("button", { name: "Salvar classificação" }).click(); await expect(dlg).toBeHidden({ timeout: 15_000 });
    await expect(page.getByRole("row", { name: new RegExp(campPending) })).not.toContainText("Aguardando classificação"); await page.goto("/admin/marketing/campanhas?periodo=7dias"); await expect(page.getByTestId("mkt-campaigns")).toBeVisible(); await page.waitForTimeout(1500); await shot(page, "campanhas");
    expect(errors, errors.join("\n")).toEqual([]);
  });

  test("integrações: URLs de retorno exatas do ambiente; sem credenciais do app a conexão aparece como INDISPONÍVEL (nada simulado); Lead Ads não conectado; conversões desativadas", async ({ page, context }) => {
    await loginAs(context, QA.manager); const errors = collectErrors(page);
    await page.goto("/admin/marketing/integracoes"); await expect(page.getByTestId("mkt-integrations")).toBeVisible({ timeout: 30_000 });
    await expect(page.getByTestId("redirect-meta")).toHaveText(`${SUPABASE_URL}/functions/v1/marketing-ads/callback/meta`); await expect(page.getByTestId("redirect-google")).toHaveText(`${SUPABASE_URL}/functions/v1/marketing-ads/callback/google`);
    const metaCard = page.getByTestId("mkt-platform-meta"); await expect(metaCard).toContainText("Somente leitura");
    const cfgd = await metaCard.getByText("Conexão ainda indisponível").count(); if (cfgd > 0) await expect(metaCard.getByTestId("connect-meta")).toBeDisabled();
    await expect(page.getByTestId("mkt-leadads")).toContainText("Não conectado"); await expect(page.getByTestId("mkt-leadads")).toContainText("Não está implementado"); await expect(page.getByTestId("mkt-conversions")).toContainText("Desativado");
    await expect(page.getByTestId("mkt-manual").getByRole("row", { name: /N22 conta/ }).first()).toBeVisible(); await shot(page, "integracoes");
    expect(errors, errors.join("\n")).toEqual([]);
  });

  test("permissões na interface: comercial vê o painel mas não configura; fisioterapeuta e aluno não entram", async ({ browser }) => {
    const ctx = await browser.newContext({ timezoneId: "America/Sao_Paulo" }); const s = await signIn(QA.comercial); await loginAs(ctx, QA.comercial);
    const p = await ctx.newPage(); await p.goto("/admin/marketing"); await expect(p.getByTestId("mkt-overview")).toBeVisible({ timeout: 30_000 });
    await p.goto("/admin/marketing/campanhas?periodo=7dias"); await expect(p.getByRole("button", { name: "Classificar" })).toHaveCount(0);
    await p.goto("/admin/marketing/integracoes"); await expect(p.getByText("Somente administradores configuram as integrações")).toBeVisible();
    await p.goto("/admin/marketing/configuracoes"); await expect(p.getByTestId("mkt-settings")).toHaveCount(0);
    expect((await api(s).rpc("mkt_config_get")).status).toBeGreaterThanOrEqual(400); expect((await api(s).rpc("mkt_settings_set", { p: { attribution_window_days: 5 } })).status).toBeGreaterThanOrEqual(400);
    const alu = await signIn(QA.aluno); expect((await api(alu).rpc("mkt_kpis", { p_from: spDate(-6), p_to: spDate(0) })).status).toBeGreaterThanOrEqual(400);
    expect((await api(null).rpc("mkt_filters")).status).toBeGreaterThanOrEqual(400); await ctx.close();
  });

  test("gerenciador, funil visual, painéis, leads com nota e assistente: tudo com os dados da jornada; assistente sem chave diz INDISPONÍVEL (nada simulado)", async ({ page, context }) => {
    await loginAs(context, QA.manager); const errors = collectErrors(page); const fname = `n23-funil-${runId}`; const dname = `n23-painel-${runId}`;
    // 1) gerenciador campanha → conjunto → anúncio, colunas MQL/SAL/CPMQL, total e janelas 7-3-1
    await page.goto(`/admin/marketing/anuncios?periodo=7dias&campanha=${S.camp}`); await expect(page.getByTestId("mkt-manager")).toBeVisible({ timeout: 30_000 });
    const crow = page.getByTestId("mgr-campaign"); await expect(crow).toContainText(camp); await expect(crow).toContainText("R$ 500");
    for (const h of ["MQL", "SAL", "CPMQL", "CPL"]) await expect(page.getByRole("columnheader", { name: h, exact: true })).toBeVisible();
    await expect(page.getByTestId("mgr-total")).toContainText("R$ 500");
    await crow.getByRole("button").first().click(); await expect(page.getByTestId("mgr-unidentified")).toBeVisible();
    await page.getByRole("button", { name: "Janelas 7-3-1" }).click(); await expect(page.getByRole("columnheader", { name: "ROAS 7d" })).toBeVisible(); await shot(page, "gerenciador");
    await page.getByRole("tab", { name: "Criativos" }).click(); await expect(page.getByTestId("mkt-creatives")).toBeVisible();
    // 2) funil visual: padrão + funil novo criado pelo administrador
    await page.goto(`/admin/marketing/funil?periodo=7dias&campanha=${S.camp}&visao=evento`); await expect(page.getByTestId("mkt-funnel-section")).toBeVisible({ timeout: 30_000 });
    await expect(page.getByTestId("mkt-funnel-visual")).toBeVisible({ timeout: 20_000 }); await expect(page.getByTestId("mkt-funnel-step-lead")).toContainText("1");
    await page.getByTestId("mkt-funnel-new").click(); await page.getByTestId("mkt-funnel-name").fill(fname); await page.getByTestId("mkt-funnel-save").click();
    await expect(page.getByText("Funil salvo.")).toBeVisible({ timeout: 15_000 }); await expect(page.getByRole("tab", { name: fname })).toHaveAttribute("aria-selected", "true");
    await expect(page.getByTestId("mkt-funnel-step-sold")).toContainText("1", { timeout: 15_000 }); await shot(page, "funil-visual");
    await page.getByRole("button", { name: "Excluir", exact: true }).click(); await page.getByRole("dialog").getByRole("button", { name: "Excluir" }).click(); await expect(page.getByRole("tab", { name: fname })).toHaveCount(0, { timeout: 15_000 });
    // 3) painéis: criar o próprio, ver os mesmos números do Hub, excluir
    await page.goto(`/admin/marketing/paineis?periodo=7dias&campanha=${S.camp}`); await expect(page.getByTestId("mkt-dashboards-page")).toBeVisible({ timeout: 30_000 }); await expect(page.getByTestId("mkt-dash-grid")).toBeVisible({ timeout: 20_000 });
    await page.getByTestId("mkt-dash-new").click(); await page.getByTestId("mkt-dash-name").fill(dname); await page.getByTestId("mkt-dash-add-campaigns").click(); await page.getByTestId("mkt-dash-add-series").click(); await page.getByTestId("mkt-dash-save").click();
    await expect(page.getByText("Painel criado.")).toBeVisible({ timeout: 15_000 }); await expect(page.getByTestId("mkt-dash-widget-kpi").first()).toContainText("R$ 500", { timeout: 20_000 });
    await expect(page.getByTestId("mkt-dash-widget-campaigns")).toContainText(camp, { timeout: 20_000 }); await shot(page, "painel-personalizado");
    await page.getByRole("button", { name: "Excluir", exact: true }).click(); await page.getByRole("dialog").getByRole("button", { name: "Excluir" }).click(); await expect(page.getByRole("tab", { name: new RegExp(dname) })).toHaveCount(0, { timeout: 15_000 });
    // 4) leads com nota explicável; pesos só para o administrador
    await page.goto(`/admin/marketing/leads?periodo=7dias&campanha=${S.camp}`); await expect(page.getByTestId("mkt-leads-page")).toBeVisible({ timeout: 30_000 });
    const lrow = page.getByTestId("mkt-lead-row").filter({ hasText: personName }); await expect(lrow).toBeVisible({ timeout: 20_000 }); await expect(lrow).toContainText(/\+\d+ /); await shot(page, "leads-pontuacao");
    await page.getByRole("tab", { name: "Pesos da nota" }).click(); await expect(page.getByTestId("mkt-score-settings")).toContainText("nunca"); await expect(page.getByTestId("mkt-score-rule-quick_response")).toBeVisible();
    // 5) assistente de IA: sem a chave do provedor responde INDISPONÍVEL; nunca inventa resposta
    await page.getByRole("tab", { name: "Leads" }).click(); await page.getByTestId("mkt-assistant-open").click(); const as = page.getByTestId("mkt-assistant"); await expect(as).toContainText("nunca dados de pessoas");
    await as.getByRole("button", { name: /O que mudou/ }).click();
    await expect(as.locator('[data-testid="mkt-assistant-unavailable"], [data-testid="mkt-assistant-answer"]').first()).toBeVisible({ timeout: 40_000 });
    if (!process.env.ANTHROPIC_KEY_CONFIGURED) await expect(as.getByTestId("mkt-assistant-unavailable")).toContainText("ANTHROPIC_API_KEY");
    expect(errors.filter((e) => !/marketing-assistant|503|Failed to load resource/i.test(e)), errors.join("\n")).toEqual([]);
  });

  test("configurações do administrador e responsividade: 390 px sem rolagem horizontal em todas as páginas", async ({ browser }) => {
    const ctx = await browser.newContext({ timezoneId: "America/Sao_Paulo", viewport: { width: 390, height: 844 }, isMobile: true, hasTouch: true }); await loginAs(ctx, QA.manager); const p = await ctx.newPage(); const errors = collectErrors(p);
    for (const path of ["/admin/marketing", "/admin/marketing/campanhas", "/admin/marketing/anuncios", "/admin/marketing/funil", "/admin/marketing/leads", "/admin/marketing/paineis", "/admin/marketing/integracoes", "/admin/marketing/configuracoes"]) {
      await p.goto(`${path}?periodo=7dias`); await p.waitForLoadState("networkidle"); await expect(p.locator("main, [role=main], body").first()).toBeVisible(); expect(await noOverflow(p), `${path} sem rolagem horizontal`).toBe(true);
    }
    await p.goto("/admin/marketing?periodo=7dias"); await p.waitForTimeout(2500); await shot(p, "mobile-visao-geral");
    await p.goto("/admin/marketing/configuracoes"); await expect(p.getByTestId("mkt-rules")).toContainText("não recalcula o histórico sozinho"); await expect(p.getByTestId("mkt-links")).toContainText("hp_campaign_id");
    expect(errors, errors.join("\n")).toEqual([]); await ctx.close();
  });
});
