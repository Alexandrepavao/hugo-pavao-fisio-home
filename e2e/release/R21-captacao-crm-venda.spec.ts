// ACEITE da release v1 — CAPTAÇÃO → CADASTRO CENTRAL → CRM → CONVERSAS/TAREFAS → VENDA, com contato JÁ cadastrado e contato novo:
//  · o formulário do Pages reaproveita a pessoa só com contato igual E nome semelhante; homônimo com outro contato e mesmo contato com outro nome NUNCA são mesclados (revisão de duplicidade);
//  · reenvio, duplo envio e envios simultâneos não duplicam pessoa, oportunidade nem captação; origem e campanha ficam na oportunidade;
//  · o indicador de captação reconcilia com os registros criados;
//  · da oportunidade: abrir conversa, tarefa vinculada ao contato certo e “Converter em venda” (pessoa, produto, unidade e linha de negócio) — duplo clique e retentativa não geram duas vendas (migration 078).
// Dados próprios (runId), removidos no fim.
import { expect, test, type Page } from "@playwright/test";
import { ANON, SUPABASE_URL } from "../helpers";
import { api, collectErrors, devSql, expectNoFatal, loginAs, QA, rest, runId, signIn, spDate } from "./helpers-release";

test.use({ timezoneId: "America/Sao_Paulo", locale: "pt-BR" });

const sql = async <T,>(q: string) => (await devSql(q)) as T[];
const anonRpc = async (fn: string, body: unknown) => { const r = await fetch(`${SUPABASE_URL}/rest/v1/rpc/${fn}`, { method: "POST", headers: { apikey: ANON, authorization: `Bearer ${ANON}`, "content-type": "application/json" }, body: JSON.stringify(body) }); return { status: r.status, body: await r.json().catch(() => null) }; };

test.describe.serial("@release Captação → CRM → venda (contato existente e novo)", () => {
  test.setTimeout(240_000);
  const slug1 = `r21a-${runId}`; const slug2 = `r21b-${runId}`; const campaign = `r21-${runId}`;
  const existing = `Contato Existente R21 ${runId}`; const emailEx = `existente.r21.${runId.toLowerCase()}@example.com`; const phoneEx = `(11) 9${Math.floor(1000 + Math.random() * 8999)}-${Math.floor(1000 + Math.random() * 8999)}`;
  const phone2 = `(21) 9${Math.floor(1000 + Math.random() * 8999)}-${Math.floor(1000 + Math.random() * 8999)}`; const email2 = `homonimo.r21.${runId.toLowerCase()}@example.com`;
  const otherName = `Nome Totalmente Diferente ${runId}`; const prodName = `Pacote R21 ${runId}`;
  const S: Record<string, string> = {}; let formId1 = ""; let formId2 = "";
  const personIds = () => `select id from public.people where full_name in ('${existing}', '${otherName}') or full_name like '%R21 ${runId}%'`;
  const clean = async () => {
    await devSql(`set local session_replication_role = replica;
      delete from public.commission_entries where sale_id in (select id from public.sales where person_id in (${personIds()}));
      delete from public.payments where receivable_id in (select id from public.receivables where sale_id in (select id from public.sales where person_id in (${personIds()})));
      delete from public.session_ledger where client_package_id in (select id from public.client_packages where person_id in (${personIds()}));
      delete from public.client_packages where person_id in (${personIds()});
      delete from public.receivables where sale_id in (select id from public.sales where person_id in (${personIds()}));
      delete from public.contracts where person_id in (${personIds()});
      delete from public.sale_items where sale_id in (select id from public.sales where person_id in (${personIds()}));
      delete from public.sales where person_id in (${personIds()});
      delete from public.crm_scheduled_messages where person_id in (${personIds()});
      delete from public.crm_conversations where person_id in (${personIds()});
      delete from public.crm_tasks where person_id in (${personIds()});
      delete from public.form_submissions where page_id in (select id from public.pages where slug in ('${slug1}', '${slug2}'));
      delete from public.interactions where person_id in (${personIds()});
      delete from public.opportunities where person_id in (${personIds()});
      delete from public.person_contacts where person_id in (${personIds()});
      delete from public.person_kinds where person_id in (${personIds()});
      delete from public.people where id in (${personIds()});
      delete from public.forms where page_id in (select id from public.pages where slug in ('${slug1}', '${slug2}'));
      delete from public.page_versions where page_id in (select id from public.pages where slug in ('${slug1}', '${slug2}'));
      delete from public.pages where slug in ('${slug1}', '${slug2}');
      delete from public.products where name = '${prodName}';`).catch(() => null);
  };
  test.afterAll(async () => { if (process.env.SUPABASE_ACCESS_TOKEN) await clean(); });

  const createPage = async (page: Page, slug: string) => {
    await page.goto("/admin/paginas"); await page.getByRole("button", { name: "Nova página" }).click(); await page.getByLabel("Endereço (/…)").fill(slug);
    await expect(page.getByLabel("Funil de destino")).not.toHaveValue(""); await expect(page.getByLabel("Unidade")).not.toHaveValue("");
    await page.getByRole("button", { name: "Criar e editar" }).click(); await expect(page).toHaveURL(/\/admin\/paginas\/[0-9a-f-]{36}$/);
    await page.getByRole("button", { name: "Publicar", exact: true }).click(); await expect(page.getByText("Página publicada.")).toBeVisible();
  };
  const submitUi = async (browser: import("@playwright/test").Browser, slug: string, name: string, phone: string, email: string) => {
    const ctx = await browser.newContext({ timezoneId: "America/Sao_Paulo" }); const v = await ctx.newPage(); const errors = collectErrors(v);
    await v.goto(`/${slug}?utm_source=e2e&utm_campaign=${campaign}`); await expect(v.getByRole("textbox", { name: /Nome completo/ })).toBeVisible({ timeout: 30_000 });
    await v.getByRole("textbox", { name: /Nome completo/ }).fill(name); await v.getByRole("textbox", { name: /WhatsApp/ }).fill(phone); await v.getByRole("textbox", { name: "E-mail" }).fill(email);
    await v.getByRole("button", { name: "Enviar" }).click(); await expect(v.getByText(/Recebemos seus dados/)).toBeVisible({ timeout: 30_000 }); expect(errors, errors.join("\n")).toEqual([]); await ctx.close();
  };

  test("fixtures: pessoa JÁ cadastrada (paciente, com e-mail e telefone), duas páginas publicadas e um produto da linha HP Fisioterapia", async ({ page, context }) => {
    test.skip(!process.env.SUPABASE_ACCESS_TOKEN, "precisa de SUPABASE_ACCESS_TOKEN para preparar e limpar fixtures");
    await clean(); const mgr = await signIn(QA.manager); const g = api(mgr); await loginAs(context, QA.manager);
    S.org = (await g.get("organizations?select=id&slug=eq.hp-group")).body[0].id; S.unit = (await g.get("units?select=id&slug=eq.sao-paulo")).body[0].id;
    const p = await g.rpc("create_person", { p_full_name: existing, p_unit_id: S.unit, p_kinds: ["patient"], p_email: emailEx, p_phone: phoneEx, p_notes: null, p_force: true }); expect(p.status, JSON.stringify(p.body)).toBe(200); S.person = p.body.id;
    await createPage(page, slug1); await createPage(page, slug2);
    const f = await sql<{ id: string; slug: string }>(`select f.id, pg.slug from public.forms f join public.pages pg on pg.id = f.page_id where pg.slug in ('${slug1}', '${slug2}')`);
    formId1 = f.find((x) => x.slug === slug1)!.id; formId2 = f.find((x) => x.slug === slug2)!.id; expect(formId1 && formId2).toBeTruthy();
    const pr = await rest(mgr, "POST", "products", { org_id: S.org, kind: "package", name: prodName, price_cents: 90000, sessions_count: 6, validity_days: 120, consume_on_no_show: true, late_cancel_hours: 24, service_id: (await sql<{ id: string }>(`select id from public.services where active order by created_at limit 1`))[0].id, active: true, access_rule: "on_first_payment" });
    expect(pr.status, JSON.stringify(pr.body)).toBe(201); S.prod = pr.body[0].id; expect((await g.rpc("product_set_line", { p_product: S.prod, p_line: "physio" })).status).toBeLessThan(300);
  });

  test("contato JÁ cadastrado: o formulário reaproveita a pessoa (mesmo e-mail e nome), cria UMA oportunidade com origem e campanha e preserva o vínculo de paciente; reenviar no mesmo dia não duplica", async ({ browser }) => {
    await submitUi(browser, slug1, existing, phoneEx, emailEx);
    const people = await sql<{ id: string }>(`select distinct c.person_id id from public.person_contacts c where c.normalized = '${emailEx}'`); expect(people, "uma única pessoa para o e-mail").toEqual([{ id: S.person }]);
    const kinds = (await sql<{ kind: string }>(`select kind from public.person_kinds where person_id = '${S.person}' order by kind`)).map((k) => k.kind); expect(kinds).toEqual(expect.arrayContaining(["patient", "lead"]));
    const opps = await sql<{ id: string; source: string; campaign: string; status: string }>(`select id, source, campaign, status from public.opportunities where person_id = '${S.person}'`);
    expect(opps).toHaveLength(1); expect(opps[0]).toMatchObject({ source: `page:${slug1}`, campaign, status: "open" }); S.opp = opps[0].id;
    const sub = await sql<{ person_id: string; opportunity_id: string; utm: { utm_campaign: string } }>(`select person_id, opportunity_id, utm from public.form_submissions where form_id = '${formId1}'`);
    expect(sub).toHaveLength(1); expect(sub[0]).toMatchObject({ person_id: S.person, opportunity_id: S.opp }); expect(sub[0].utm.utm_campaign).toBe(campaign);
    expect((await sql<{ n: number }>(`select count(*)::int n from public.crm_tasks where opportunity_id = '${S.opp}' and kind = 'first_contact'`))[0].n).toBe(1);
    expect((await sql<{ n: number }>(`select count(*)::int n from public.crm_tasks where person_id = '${S.person}' and kind = 'dedupe_review'`))[0].n, "mesmo contato e nome: não precisa de revisão").toBe(0);
    await submitUi(browser, slug1, existing, phoneEx, emailEx);                                                     // reenvio (outro navegador, mesmo dia)
    expect((await sql<{ n: number }>(`select count(*)::int n from public.opportunities where person_id = '${S.person}'`))[0].n).toBe(1);
    expect((await sql<{ n: number }>(`select count(*)::int n from public.form_submissions where form_id = '${formId1}'`))[0].n).toBe(1);
  });

  test("CRM: da oportunidade, abrir conversa (pessoa e oportunidade certas) e criar tarefa vinculada ao contato correto", async ({ page, context }) => {
    await loginAs(context, QA.comercial); const errors = collectErrors(page);
    // o comercial vê a oportunidade se for responsável/da unidade; a distribuição automática pode ter escolhido outro comercial: garantimos o responsável deste teste
    await devSql(`update public.opportunities set owner_user_id = '${(await signIn(QA.comercial)).user.id}' where id = '${S.opp}'`);
    await page.goto("/admin/crm/oportunidades"); await page.getByRole("region", { name: "Quadro do funil" }).waitFor({ timeout: 40_000 });
    await page.getByPlaceholder("Pessoa ou título").fill(existing); const card = page.getByRole("button", { name: new RegExp(`^${existing}, `) }); await expect(card).toHaveCount(1, { timeout: 30_000 }); await card.click();
    const sheet = page.getByRole("dialog"); await expect(sheet).toContainText(`page:${slug1}`.replace("page:", "")); await expect(sheet).toContainText(campaign);
    await sheet.getByRole("tab", { name: /Tarefas/ }).click(); await sheet.locator("#tk").fill(`Retornar contato R21 ${runId}`); await sheet.getByRole("button", { name: "Adicionar tarefa" }).click(); await expect(sheet.getByText("Tarefa criada.")).toBeVisible({ timeout: 20_000 });
    const t = await sql<{ person_id: string; opportunity_id: string; kind: string }>(`select person_id, opportunity_id, kind from public.crm_tasks where title = 'Retornar contato R21 ${runId}'`);
    expect(t).toEqual([{ person_id: S.person, opportunity_id: S.opp, kind: "follow_up" }]);
    await sheet.getByRole("tab", { name: "Resumo" }).click(); await sheet.getByTestId("opp-open-conversation").click(); await expect(page).toHaveURL(/\/admin\/crm\/conversas\?c=/, { timeout: 30_000 });
    await expect(page.getByTestId("conv-title")).toHaveText(existing, { timeout: 30_000 });
    const c = await sql<{ person_id: string; opportunity_id: string }>(`select person_id, opportunity_id from public.crm_conversations where id = '${new URL(page.url()).searchParams.get("c")}'`); expect(c).toEqual([{ person_id: S.person, opportunity_id: S.opp }]);
    await expect(page.getByText(`Retornar contato R21 ${runId}`)).toHaveCount(0);                                    // a ficha está recolhida; a tarefa aparece ao abrir
    await page.getByTestId("conv-title").click(); await expect(page.getByTestId("lead-tasks")).toContainText(`Retornar contato R21 ${runId}`, { timeout: 20_000 });
    await expectNoFatal(page); expect(errors, errors.join("\n")).toEqual([]);
  });

  test("Converter em venda: pessoa, produto, unidade e linha de negócio levados; duplo clique e retentativa NÃO geram duas vendas", async ({ page, context }) => {
    await loginAs(context, QA.manager); const errors = collectErrors(page); const g = api(await signIn(QA.manager));
    await page.goto("/admin/crm/oportunidades"); await page.getByRole("region", { name: "Quadro do funil" }).waitFor({ timeout: 40_000 });
    await page.getByPlaceholder("Pessoa ou título").fill(existing); await page.getByRole("button", { name: new RegExp(`^${existing}, `) }).click();
    await page.getByRole("dialog").getByRole("link", { name: "Converter em venda" }).click(); await expect(page).toHaveURL(/\/admin\/financeiro\/vendas\?venda=/); await expect(page.getByText("Venda originada de uma oportunidade")).toBeVisible();
    await expect(page.locator("#sp")).toHaveValue(existing, { timeout: 20_000 }); await expect(page.locator("#su")).toHaveValue(S.unit);                    // pessoa e unidade já preenchidas
    await page.locator("#pr").selectOption(S.prod); await page.locator("#in").fill("1"); await page.locator("#fd").fill(spDate(0));
    await page.getByRole("button", { name: "Criar venda" }).dblclick();                                              // duplo clique
    await expect(page.getByText(/Venda criada como pendente/)).toBeVisible({ timeout: 20_000 });
    let sales = await sql<{ id: string; status: string; total_cents: number; opportunity_id: string; unit_id: string; person_id: string }>(`select id, status, total_cents, opportunity_id, unit_id, person_id from public.sales where person_id = '${S.person}'`);
    expect(sales, "duplo clique: UMA venda").toHaveLength(1); expect(sales[0]).toMatchObject({ status: "pending", total_cents: 90000, opportunity_id: S.opp, unit_id: S.unit, person_id: S.person }); S.sale = sales[0].id;
    const items = await sql<{ product_id: string; description: string; qty: number }>(`select product_id, description, qty from public.sale_items where sale_id = '${S.sale}'`); expect(items).toEqual([{ product_id: S.prod, description: prodName, qty: 1 }]);
    // retentativa pela API (mesmos dados, sem chave): recusada porque já há venda pendente da oportunidade; nada novo é criado
    const again = await g.rpc("sale_create", { p_person: S.person, p_unit: S.unit, p_opportunity: S.opp, p_items: [{ product_id: S.prod, qty: 1 }], p_discount_cents: 0, p_installments: 1, p_first_due: spDate(0) });
    expect(again.status).not.toBe(200); expect(JSON.stringify(again.body)).toContain("já existe uma venda pendente");
    expect((await sql<{ n: number }>(`select count(*)::int n from public.sales where person_id = '${S.person}'`))[0].n).toBe(1);
    // a linha de negócio da venda é a do PRODUTO (HP Fisioterapia): rótulo na lista e divisão do servidor
    await expect(page.getByRole("row").filter({ hasText: existing }).first()).toContainText(/Fisioterapia/);
    const shares = (await g.rpc("sale_line_shares", { p_sale_ids: [S.sale] })).body as { sale_id: string; line: string; cents: number }[]; expect(shares.map((x) => [x.line, Number(x.cents)])).toEqual([["physio", 90000]]);
    // oportunidade duplicada: criar outra aberta da mesma pessoa no mesmo funil é recusado (a existente foi criada pelo formulário e segue aberta até a venda ser confirmada)
    const pipe = (await sql<{ pipeline_id: string }>(`select pipeline_id from public.opportunities where id = '${S.opp}'`))[0].pipeline_id;
    const dupOpp = await g.rpc("crm_create_opportunity", { p_person_id: S.person, p_pipeline_id: pipe, p_unit_id: S.unit, p_title: "Duplicada", p_source: "manual" }); expect(dupOpp.status).not.toBe(200);
    expect((await sql<{ n: number }>(`select count(*)::int n from public.opportunities where person_id = '${S.person}' and status = 'open'`))[0].n).toBeLessThanOrEqual(1);
    // confirmar duas vezes (clique repetido) mantém um contrato, um pacote e as parcelas
    await page.getByRole("row").filter({ hasText: existing }).getByRole("button", { name: "Confirmar" }).dblclick(); await expect(page.getByText(/Venda confirmada/).first()).toBeVisible({ timeout: 20_000 });
    expect((await sql<{ n: number; c: number; p: number }>(`select (select count(*) from public.receivables where sale_id = '${S.sale}')::int n, (select count(*) from public.contracts where sale_id = '${S.sale}')::int c, (select count(*) from public.client_packages where sale_id = '${S.sale}')::int p`))[0]).toEqual({ n: 1, c: 1, p: 1 });
    // a oportunidade avança sozinha para a etapa ganha, leva o valor da venda e mostra a venda confirmada no histórico
    expect((await sql<{ status: string; value_cents: number }>(`select status, value_cents::int value_cents from public.opportunities where id = '${S.opp}'`))[0]).toEqual({ status: "won", value_cents: 90000 });
    expect((await g.get(`interactions?select=summary&opportunity_id=eq.${S.opp}&channel=eq.system`)).body.some((i: { summary: string }) => /Venda confirmada/.test(i.summary))).toBe(true);
    expect(errors, errors.join("\n")).toEqual([]);
  });

  test("não une pessoas só pelo nome: homônimo com OUTRO contato vira outra pessoa; mesmo contato com nome muito diferente vira outra pessoa marcada como contato compartilhado, com revisão", async () => {
    const homonym = await anonRpc("submit_public_form", { p_form_id: formId1, p_answers: { name: existing, phone: phone2, email: email2 }, p_utm: { utm_campaign: campaign }, p_honeypot: null, p_referrer: null });
    expect(homonym.status, JSON.stringify(homonym.body)).toBe(200);
    expect((await sql<{ n: number }>(`select count(*)::int n from public.people where full_name = '${existing}'`))[0].n, "dois cadastros (um por contato) — nunca mesclados só pelo nome").toBe(2);
    const hom = (await sql<{ id: string }>(`select p.id from public.people p join public.person_contacts c on c.person_id = p.id where c.normalized = '${email2}'`))[0].id; expect(hom).not.toBe(S.person); S.homonym = hom;
    expect((await sql<{ n: number }>(`select count(*)::int n from public.people where id in ('${S.person}', '${hom}') and merged_into_id is not null`))[0].n).toBe(0);
    // (em OUTRO formulário: no mesmo formulário e dia o mesmo contato é tratado como reenvio — ver docs/integracao-ponta-a-ponta.md)
    const shared = await anonRpc("submit_public_form", { p_form_id: formId2, p_answers: { name: otherName, phone: phoneEx, email: emailEx }, p_utm: { utm_campaign: campaign }, p_honeypot: null, p_referrer: null });
    expect(shared.status, JSON.stringify(shared.body)).toBe(200);
    const diff = (await sql<{ id: string; shared: boolean }>(`select p.id, c.is_shared shared from public.people p join public.person_contacts c on c.person_id = p.id where p.full_name = '${otherName}' and c.type = 'email'`)); expect(diff).toHaveLength(1);
    expect(diff[0].id).not.toBe(S.person); expect(diff[0].shared, "contato marcado como compartilhado").toBe(true);
    expect((await sql<{ n: number }>(`select count(*)::int n from public.crm_tasks where person_id = '${diff[0].id}' and kind = 'dedupe_review'`))[0].n, "tarefa de revisão de duplicidade").toBe(1);
    expect((await sql<{ full_name: string }>(`select full_name from public.people where id = '${S.person}'`))[0].full_name, "o cadastro original não foi alterado").toBe(existing);
    expect((await sql<{ n: number }>(`select count(*)::int n from public.opportunities where person_id = '${S.person}'`))[0].n, "a pessoa original segue com UMA oportunidade").toBe(1);
  });

  test("envios simultâneos do mesmo contato novo (3 ao mesmo tempo) geram UMA pessoa, UMA oportunidade e UMA captação", async () => {
    const mail = `novo.r21.${runId.toLowerCase()}@example.com`; const name = `Contato Novo R21 ${runId}`; const ph = `(31) 9${Math.floor(1000 + Math.random() * 8999)}-${Math.floor(1000 + Math.random() * 8999)}`;
    const res = await Promise.all([1, 2, 3].map(() => anonRpc("submit_public_form", { p_form_id: formId2, p_answers: { name, phone: ph, email: mail }, p_utm: { utm_campaign: campaign }, p_honeypot: null, p_referrer: null })));
    expect(res.some((r) => r.status === 200), JSON.stringify(res.map((r) => r.body))).toBe(true);
    const n = (q: string) => sql<{ n: number }>(q).then((r) => r[0].n);
    expect(await n(`select count(distinct person_id)::int n from public.person_contacts where normalized = '${mail}'`)).toBe(1);
    expect(await n(`select count(*)::int n from public.opportunities o join public.person_contacts c on c.person_id = o.person_id where c.normalized = '${mail}'`)).toBe(1);
    expect(await n(`select count(*)::int n from public.form_submissions where form_id = '${formId2}' and answers ->> 'email' = '${mail}'`)).toBe(1);
    // e a oportunidade nova nasce no funil/etapa inicial com a primeira tarefa de contato
    const o = (await sql<{ stage: string; source: string }>(`select s.name stage, o.source from public.opportunities o join public.pipeline_stages s on s.id = o.stage_id join public.person_contacts c on c.person_id = o.person_id where c.normalized = '${mail}'`))[0]; expect(o.source).toBe(`page:${slug2}`);
    expect(await n(`select count(*)::int n from public.crm_tasks t join public.person_contacts c on c.person_id = t.person_id where c.normalized = '${mail}' and t.kind = 'first_contact'`)).toBe(1);
  });

  test("indicador de captação reconcilia com os registros: respostas, pessoas e oportunidades por origem da página", async () => {
    const g = api(await signIn(QA.manager)); const r = await g.rpc("capture_analytics", { p_from: new Date(Date.now() - 864e5).toISOString(), p_to: new Date(Date.now() + 864e5).toISOString(), p_unit: null }); expect(r.status, JSON.stringify(r.body)).toBe(200);
    const by = (r.body as { by_source: { source_key: string; responses: number; people: number; opportunities: number }[]; by_campaign: { campaign: string; responses: number; people: number; opportunities: number }[] });
    const src = by.by_source.find((x) => x.source_key === `form:${formId1}`); expect(src, "a origem (formulário da página) aparece no indicador").toBeTruthy();
    expect({ resp: src!.responses, ppl: src!.people, opps: src!.opportunities }, JSON.stringify(src)).toEqual({ resp: 2, ppl: 2, opps: 2 });      // existente + homônimo (o reenvio do mesmo dia não conta)
    const camp = by.by_campaign.find((x) => x.campaign === campaign); expect(camp, "a campanha aparece no indicador").toBeTruthy();
    expect({ resp: camp!.responses, ppl: camp!.people, opps: camp!.opportunities }, JSON.stringify(camp)).toEqual({ resp: 4, ppl: 4, opps: 4 });      // + contato compartilhado e contato novo da outra página
    // o detalhamento clicável traz os MESMOS registros do cartão
    const det = (await api(await signIn(QA.manager)).rpc("capture_indicator_detail", { p_kind: "responses", p_dim: "campaign", p_value: campaign, p_from: new Date(Date.now() - 864e5).toISOString(), p_to: new Date(Date.now() + 864e5).toISOString(), p_unit: null })).body as { total?: number; items?: unknown[] };
    expect(JSON.stringify(det)).toContain(existing); expect(Number(det.total ?? (det.items ?? []).length)).toBe(4);
  });

  test("permissões: fisioterapeuta e paciente não veem a captação, as oportunidades, as conversas nem criam venda; o link da venda não abre dado clínico", async () => {
    for (const mail of [QA.fisio, QA.paciente]) {
      const a = api(await signIn(mail));
      for (const t of ["form_submissions", "opportunities", "crm_conversations", "sales"]) expect((await a.get(`${t}?select=id&limit=3`)).body, `${mail} ${t}`).toEqual([]);
      expect((await a.rpc("capture_analytics", { p_from: new Date(Date.now() - 864e5).toISOString(), p_to: new Date().toISOString(), p_unit: null })).status, mail).not.toBe(200);
      expect((await a.rpc("sale_create", { p_person: S.person, p_unit: S.unit, p_opportunity: null, p_items: [{ product_id: S.prod, qty: 1 }], p_idempotency_key: `intruso-${runId}` })).status, mail).not.toBe(200);
    }
    // comercial e financeiro não chegam a dados clínicos pelo cadastro/ficha do lead: a jornada clínica exige vínculo assistencial
    for (const mail of [QA.comercial, QA.financeiro]) { const a = api(await signIn(mail)); expect((await a.rpc("professional_journey", { p_person: S.person })).status, mail).not.toBe(200); }
    expect((await sql<{ n: number }>(`select count(*)::int n from public.sales where idempotency_key = 'intruso-${runId}'`))[0].n).toBe(0);
  });
});
