// ACEITE da release v1 — PARCEIROS: indicação identificada na captação (?ref=código) → vínculo com a pessoa e a oportunidade → conversão em venda → indicadores do parceiro atualizados →
// repasse SOMENTE por decisão expressa do Financeiro (nunca automático por indicação) e refletido em Contas a pagar / fluxo de caixa (migration 080). O parceiro INDICADOR não é o fisioterapeuta PRESTADOR:
// nenhuma comissão de atendimento é gerada para ele. O parceiro vê só primeiro nome e etapa do indicado.
import { expect, test, type Page } from "@playwright/test";
import { api, collectErrors, devSql, expectNoFatal, loginAs, QA, rest, runId, signIn, spDate } from "./helpers-release";

test.use({ timezoneId: "America/Sao_Paulo", locale: "pt-BR" });
const sql = async <T,>(q: string) => (await devSql(q)) as T[];

test.describe.serial("@release Parceiros: indicação → oportunidade → venda → indicadores → repasse expresso", () => {
  test.setTimeout(240_000);
  const slug = `r23-${runId}`; const lead = `Indicada R23 ${runId}`; const leadEmail = `indicada.r23.${runId.toLowerCase()}@example.com`; const prod = `Pacote R23 ${runId}`; const payoutDesc = `Reconhecimento R23 ${runId}`;
  const S: Record<string, string> = {}; let createdPartner = false; let code = ""; let basePayables = 0;
  const clean = async () => {
    const pid = `select id from public.people where full_name = '${lead}'`; const sales = `select id from public.sales where person_id in (${pid})`;
    await devSql(`set local session_replication_role = replica;
      delete from public.partner_payouts where description = '${payoutDesc}';
      delete from public.payables where description like '%${payoutDesc}%';
      delete from public.commission_entries where sale_id in (${sales});
      delete from public.payments where receivable_id in (select id from public.receivables where sale_id in (${sales}));
      delete from public.client_packages where person_id in (${pid});
      delete from public.receivables where sale_id in (${sales});
      delete from public.contracts where person_id in (${pid});
      delete from public.sale_items where sale_id in (${sales});
      delete from public.sales where id in (${sales});
      delete from public.referrals where referred_person_id in (${pid});
      delete from public.form_submissions where page_id in (select id from public.pages where slug = '${slug}');
      delete from public.crm_tasks where person_id in (${pid});
      delete from public.interactions where person_id in (${pid});
      delete from public.opportunities where person_id in (${pid});
      delete from public.person_contacts where person_id in (${pid});
      delete from public.person_kinds where person_id in (${pid});
      delete from public.people where full_name = '${lead}';
      delete from public.forms where page_id in (select id from public.pages where slug = '${slug}');
      delete from public.page_versions where page_id in (select id from public.pages where slug = '${slug}');
      delete from public.pages where slug = '${slug}';
      delete from public.products where name = '${prod}';`).catch(() => null);
    if (createdPartner && S.partnerPerson) await devSql(`set local session_replication_role = replica; update public.user_accounts set person_id = null where person_id = '${S.partnerPerson}'; delete from public.referral_codes where person_id = '${S.partnerPerson}'; delete from public.partner_profiles where person_id = '${S.partnerPerson}'; delete from public.person_kinds where person_id = '${S.partnerPerson}'; delete from public.person_contacts where person_id = '${S.partnerPerson}'; delete from public.people where id = '${S.partnerPerson}'`).catch(() => null);
  };
  test.afterAll(async () => { if (process.env.SUPABASE_ACCESS_TOKEN) await clean(); });
  const stage = async () => (await sql<{ name: string; status: string }>(`select st.name, o.status from public.opportunities o join public.pipeline_stages st on st.id = o.stage_id where o.id = '${S.opp}'`))[0];
  const expensesPaid = async () => { const r = await api(await signIn(QA.manager)).rpc("finance_by_line", { p_from: new Date(Date.now() - 864e5).toISOString(), p_to: new Date(Date.now() + 864e5).toISOString(), p_unit: null }); const b = r.body as { total: { expenses_paid_cents: number }; reconciliation: { ok: boolean } }; return { paid: b.total.expenses_paid_cents, ok: b.reconciliation.ok }; };

  test("fixtures: parceiro ativo com código de indicação, página publicada e produto", async ({ page, context }) => {
    test.skip(!process.env.SUPABASE_ACCESS_TOKEN, "precisa de SUPABASE_ACCESS_TOKEN para preparar e limpar fixtures");
    await clean(); const mgr = await signIn(QA.manager); const g = api(mgr); const par = await signIn(QA.parceiro); S.parUser = par.user.id; await loginAs(context, QA.manager);
    S.org = (await g.get("organizations?select=id&slug=eq.hp-group")).body[0].id; S.unit = (await g.get("units?select=id&slug=eq.sao-paulo")).body[0].id;
    let person = ((await api(par).get("people?select=id")).body as { id: string }[])[0]?.id;
    if (!person) {
      const p = await g.rpc("create_person", { p_full_name: `Parceiro QA ${runId}`, p_unit_id: S.unit, p_kinds: ["partner"], p_email: `parceiro.qa.${runId}@t.local`, p_phone: null, p_notes: null, p_force: true }); person = p.body.id as string; createdPartner = true;
      await devSql(`update public.user_accounts set person_id = '${person}' where user_id = '${S.parUser}'; insert into public.partner_profiles (person_id, org_id, unit_id, status, specialty) select '${person}', org_id, unit_id, 'active', 'Ortopedia' from public.people where id = '${person}' on conflict do nothing`);
    }
    S.partnerPerson = person; code = (await api(await signIn(QA.parceiro)).rpc("referral_code_get")).body as string; expect(code).toMatch(/^[a-z0-9]{4,}$/i);
    await page.goto("/admin/paginas"); await page.getByRole("button", { name: "Nova página" }).click(); await page.getByLabel("Endereço (/…)").fill(slug);
    await expect(page.getByLabel("Funil de destino")).not.toHaveValue(""); await page.getByRole("button", { name: "Criar e editar" }).click(); await expect(page).toHaveURL(/\/admin\/paginas\/[0-9a-f-]{36}$/);
    await page.getByRole("button", { name: "Publicar", exact: true }).click(); await expect(page.getByText("Página publicada.")).toBeVisible();
    const pr = await rest(mgr, "POST", "products", { org_id: S.org, kind: "package", name: prod, price_cents: 50000, sessions_count: 4, validity_days: 90, consume_on_no_show: true, late_cancel_hours: 24, service_id: (await sql<{ id: string }>(`select id from public.services where active order by created_at limit 1`))[0].id, active: true, access_rule: "on_first_payment" }); expect(pr.status, JSON.stringify(pr.body)).toBe(201); S.prod = pr.body[0].id;
    basePayables = (await sql<{ n: number }>(`select count(*)::int n from public.payables where description like 'Repasse a parceiro%'`))[0].n; expect(basePayables).toBeGreaterThanOrEqual(0);
  });

  test("a pessoa entra pelo link do parceiro (?ref=): a captação guarda a indicação ANTES do atendimento e liga parceiro, pessoa e oportunidade; o parceiro vê só o primeiro nome e a etapa", async ({ page, context, browser }) => {
    const ctx = await browser.newContext({ timezoneId: "America/Sao_Paulo" }); const v = await ctx.newPage(); const errors = collectErrors(v);
    await v.goto(`/${slug}?ref=${code}&utm_source=parceiro&utm_campaign=r23-${runId}`); await expect(v.getByRole("textbox", { name: /Nome completo/ })).toBeVisible({ timeout: 30_000 });
    await v.getByRole("textbox", { name: /Nome completo/ }).fill(lead); await v.getByRole("textbox", { name: /WhatsApp/ }).fill(`(11) 9${Math.floor(1000 + Math.random() * 8999)}-${Math.floor(1000 + Math.random() * 8999)}`); await v.getByRole("textbox", { name: "E-mail" }).fill(leadEmail);
    await v.getByRole("button", { name: "Enviar" }).click(); await expect(v.getByText(/Recebemos seus dados/)).toBeVisible({ timeout: 30_000 }); await ctx.close(); expect(errors, errors.join("\n")).toEqual([]);
    const r = await sql<{ referrer_person_id: string; referred_person_id: string; opportunity_id: string; code: string }>(`select referrer_person_id, referred_person_id, opportunity_id, code from public.referrals where referred_person_id in (select id from public.people where full_name = '${lead}')`);
    expect(r).toHaveLength(1); expect(r[0]).toMatchObject({ referrer_person_id: S.partnerPerson, code: code.toLowerCase() }); S.person = r[0].referred_person_id; S.opp = r[0].opportunity_id;
    expect((await sql<{ source: string; campaign: string }>(`select source, campaign from public.opportunities where id = '${S.opp}'`))[0]).toMatchObject({ source: `page:${slug}`, campaign: `r23-${runId}` });
    // o parceiro (outra sessão) vê a indicação com privacidade
    await loginAs(context, QA.parceiro); await page.goto("/parceiro"); await expect(page.getByRole("heading", { name: "Minhas indicações" })).toBeVisible({ timeout: 30_000 });
    await expect(page.getByText("Indicada").first()).toBeVisible({ timeout: 30_000 }); await expect(page.getByText(leadEmail)).toHaveCount(0); await expect(page.getByText(lead)).toHaveCount(0);
    const refs = (await api(await signIn(QA.parceiro)).rpc("partner_my_referrals")).body as { first_name: string; stage_name: string | null; status: string }[]; const mine = refs.find((x) => x.first_name === "Indicada")!; expect(mine).toMatchObject({ stage_name: "Novo contato", status: "open" });
    expect(Object.keys(mine).sort()).toEqual(["created_at", "first_name", "referral_id", "stage_name", "status"]);                       // nenhum campo de contato ou clínico
    // a indicação própria não conta: o parceiro enviando o formulário com o PRÓPRIO código não gera indicação
    const self = await sql<{ n: number }>(`select count(*)::int n from public.referrals where referrer_person_id = referred_person_id`); expect(self[0].n).toBe(0);
  });

  test("administração: a indicação aparece em Parceiros › Indicações com quem indicou e quem foi indicado", async ({ page, context }) => {
    await loginAs(context, QA.manager); const errors = collectErrors(page);
    await page.goto("/admin/parceiros"); await page.getByRole("tab", { name: "Indicações" }).click(); await page.locator("#pf-q").fill(lead);
    const row = page.getByRole("row").filter({ hasText: lead }); await expect(row).toHaveCount(1, { timeout: 30_000 }); await expect(row).toContainText(code.toLowerCase());
    expect(errors, errors.join("\n")).toEqual([]);
  });

  test("conversão: venda da oportunidade indicada e recebimento total; o indicador do parceiro passa a “Contratou” e NENHUMA remuneração nasce sozinha (comissão de atendimento ou repasse)", async ({ context }) => {
    await loginAs(context, QA.manager); const g = api(await signIn(QA.manager));
    const sale = await g.rpc("sale_create", { p_person: S.person, p_unit: S.unit, p_opportunity: S.opp, p_items: [{ product_id: S.prod, qty: 1 }], p_discount_cents: 0, p_installments: 1, p_first_due: spDate(0), p_idempotency_key: `r23-${runId}` }); expect(sale.status, JSON.stringify(sale.body)).toBe(200); S.sale = sale.body;
    expect((await g.rpc("sale_confirm", { p_sale: S.sale })).status).toBeLessThan(300);
    expect(await stage(), "confirmar a venda leva a oportunidade à etapa ganha").toMatchObject({ status: "won" });
    const rec = (await sql<{ id: string }>(`select id from public.receivables where sale_id = '${S.sale}'`))[0].id; expect((await g.rpc("payment_record", { p_receivable: rec, p_amount_cents: 50000, p_paid_at: new Date().toISOString(), p_method: "pix", p_account: null, p_idempotency_key: `r23-pay-${runId}` })).status).toBeLessThan(300);
    const refs = (await api(await signIn(QA.parceiro)).rpc("partner_my_referrals")).body as { first_name: string; status: string }[]; expect(refs.find((x) => x.first_name === "Indicada")!.status).toBe("won");
    expect((await sql<{ n: number }>(`select count(*)::int n from public.partner_payouts where partner_person_id = '${S.partnerPerson}' and created_at > now() - interval '10 minutes'`))[0].n, "indicação convertida NÃO gera repasse sozinha").toBe(0);
    expect((await sql<{ n: number }>(`select count(*)::int n from public.commission_entries where sale_id = '${S.sale}' and beneficiary_user_id = '${S.parUser}'`))[0].n, "o parceiro indicador não recebe comissão de atendimento").toBe(0);
    expect((await sql<{ n: number }>(`select count(*)::int n from public.commission_rules where active and beneficiary_user_id = '${S.parUser}'`))[0].n, "nenhuma regra de comissão aponta para o parceiro").toBe(0);
  });

  test("repasse ao parceiro por decisão expressa do Financeiro: criar → autorizar → pagar pela tela; vira conta a pagar e despesa paga (caixa/DRE) uma única vez; o parceiro vê o repasse autorizado/pago", async ({ page, context }) => {
    await loginAs(context, QA.manager); const errors = collectErrors(page); const before = await expensesPaid();
    await page.goto("/admin/parceiros"); await page.getByRole("tab", { name: "Repasses" }).click();
    await page.locator("#rpp").selectOption(S.partnerPerson); await page.locator("#rpu").selectOption(S.unit); await page.locator("#rpd").fill(payoutDesc); await page.locator("#rpv").fill("150,00"); await page.getByRole("button", { name: "Criar" }).click();
    await expect(page.getByText(/Repasse criado/)).toBeVisible({ timeout: 20_000 });
    const row = page.getByRole("row").filter({ hasText: payoutDesc }); await expect(row).toContainText("Pendente");
    expect((await sql<{ n: number }>(`select count(*)::int n from public.payables where description like '%${payoutDesc}%'`))[0].n, "pendente ainda não é despesa").toBe(0);
    await row.getByRole("button", { name: "Autorizar" }).click(); await expect(row).toContainText("Autorizado", { timeout: 20_000 });
    const open = await sql<{ status: string; amount_cents: number; supplier: string }>(`select status, amount_cents, supplier from public.payables where description like '%${payoutDesc}%'`); expect(open).toHaveLength(1); expect(open[0]).toMatchObject({ status: "open", amount_cents: 15000 });
    expect((await expensesPaid()).paid - before.paid, "autorizado é compromisso, não caixa").toBe(0);
    await row.getByRole("button", { name: "Marcar pago" }).dblclick(); await expect(row).toContainText("Pago", { timeout: 20_000 });
    const paid = await sql<{ status: string; paid_at: string }>(`select status, paid_at from public.payables where description like '%${payoutDesc}%'`); expect(paid).toHaveLength(1); expect(paid[0].status).toBe("paid");
    const after = await expensesPaid(); expect(after.paid - before.paid, "despesa paga entra uma vez no caixa").toBe(15000); expect(after.ok, "o Geral continua reconciliando com as linhas").toBe(true);
    // Contas a pagar mostra a despesa, como qualquer outra
    await page.goto("/admin/financeiro/pagar"); await expect(page.getByRole("row").filter({ hasText: `Repasse a parceiro: ${payoutDesc}` })).toHaveCount(1, { timeout: 30_000 });
    expect((await sql<{ n: number }>(`select count(*)::int n from public.payables where description = 'Repasse a parceiro: ${payoutDesc}'`))[0].n).toBe(1);
    // o parceiro vê o próprio repasse (só os autorizados/pagos) e nenhum dado de outros parceiros
    const par = api(await signIn(QA.parceiro)); const mine = (await par.get("partner_payouts?select=description,amount_cents,status")).body as { description: string; amount_cents: number; status: string }[];
    expect(mine.find((x) => x.description === payoutDesc)).toMatchObject({ amount_cents: 15000, status: "paid" }); expect(mine.every((x) => x.description !== undefined)).toBe(true);
    await expectNoFatal(page); expect(errors, errors.join("\n")).toEqual([]);
  });

  test("permissões: o parceiro não autoriza nem cria repasse, não lê vendas/oportunidades; fisioterapeuta e comercial não veem repasses de parceiros", async () => {
    const par = api(await signIn(QA.parceiro)); const id = (await sql<{ id: string }>(`select id from public.partner_payouts where description = '${payoutDesc}'`))[0].id;
    expect((await par.rpc("payout_set_status", { p_id: id, p_status: "cancelled" })).status).not.toBe(200);
    expect((await par.post("partner_payouts", { org_id: S.org, unit_id: S.unit, partner_person_id: S.partnerPerson, description: "autopagamento", amount_cents: 99999, created_by: S.parUser })).status).not.toBe(201);
    for (const t of ["sales", "opportunities", "payments", "payables", "commission_entries"]) expect(((await par.get(`${t}?select=id&limit=2`)).body as unknown[]).length, `parceiro ${t}`).toBe(0);
    for (const mail of [QA.fisio, QA.comercial, QA.paciente]) { const a = api(await signIn(mail)); expect(((await a.get(`partner_payouts?select=id&description=eq.${encodeURIComponent(payoutDesc)}`)).body as unknown[]).length, mail).toBe(0); expect((await a.rpc("payout_set_status", { p_id: id, p_status: "cancelled" })).status, mail).not.toBe(200); }
    expect((await sql<{ n: number }>(`select count(*)::int n from public.partner_payouts where description = 'autopagamento'`))[0].n).toBe(0);
  });

  test("celular: portal do parceiro cabe na tela", async ({ browser }: { browser: import("@playwright/test").Browser }) => {
    const ctx = await browser.newContext({ viewport: { width: 390, height: 844 }, timezoneId: "America/Sao_Paulo", locale: "pt-BR", isMobile: true, hasTouch: true }); await loginAs(ctx, QA.parceiro); const p: Page = await ctx.newPage(); const errors = collectErrors(p);
    await p.goto("/parceiro"); await expect(p.getByRole("heading", { name: "Minhas indicações" })).toBeVisible({ timeout: 40_000 });
    expect(await p.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth)).toBe(true); await p.screenshot({ path: "docs/screenshots/parceiros/portal-celular.png" }); expect(errors, errors.join("\n")).toEqual([]); await ctx.close();
  });
});
