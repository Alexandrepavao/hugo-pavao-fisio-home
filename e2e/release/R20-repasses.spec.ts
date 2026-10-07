// ACEITE da release v1 — REPASSES de ponta a ponta: regra de comissão configurada pelo Financeiro (percentual, produto e beneficiário vêm da regra — nada fixo no código),
// recebimento parcial → lançamento pendente com o percentual GUARDADO, autorização e pagamento pelo Financeiro (fluxo estrito), visão do profissional em “Meu resumo” com base, percentual, regra
// e produto (nunca o paciente), estorno proporcional, reconciliação com a Visão geral e permissões no servidor.
// FATO GERADOR: cada RECEBIMENTO (payment) de uma venda que contém o produto da regra gera UM lançamento = valor recebido × percentual da regra; estorno gera lançamento negativo proporcional.
// Dados próprios (runId); a regra, a venda e o profissional criados pelo teste são removidos no fim.
import { expect, test } from "@playwright/test";
import { api, collectErrors, devSql, expectNoFatal, loginAs, QA, rest, runId, signIn, spDate } from "./helpers-release";

test.use({ timezoneId: "America/Sao_Paulo", locale: "pt-BR" });

interface Pay { pending_cents: number; authorized_cents: number; paid_cents: number; reversed_cents: number; net_cents: number }
const sql1 = async <T,>(q: string) => ((await devSql(q)) as T[])[0];

test.describe.serial("@release Repasses (regra → recebimento → autorização → pagamento → visão do profissional)", () => {
  test.setTimeout(240_000);
  const patient = `Paciente R20 ${runId}`; const ruleName = `Repasse R20 ${runId}`; const productName = `Pacote R20 ${runId}`;
  const S: Record<string, string> = {}; let createdProf = false; let before: Pay;
  const physioSummary = async (): Promise<Pay> => {
    const s = await signIn(QA.fisio); const r = await api(s).rpc("my_professional_summary", { p_from: spDate(-30), p_to: spDate(1) });
    expect(r.status, JSON.stringify(r.body)).toBe(200); return (r.body as { payouts: Pay & { visible: boolean } }).payouts;
  };
  const clean = async () => {
    const sales = `select id from public.sales where person_id in (select id from public.people where full_name = '${patient}')`;
    await devSql(`set local session_replication_role = replica;
      delete from public.commission_entries where sale_id in (${sales});
      delete from public.payments where receivable_id in (select id from public.receivables where sale_id in (${sales}));
      delete from public.session_ledger where client_package_id in (select id from public.client_packages where sale_id in (${sales}));
      delete from public.client_packages where sale_id in (${sales});
      delete from public.receivables where sale_id in (${sales});
      delete from public.contracts where sale_id in (${sales});
      delete from public.sale_items where sale_id in (${sales});
      delete from public.sales where id in (${sales});
      delete from public.commission_rules where name = '${ruleName}';
      delete from public.products where name = '${productName}';
      delete from public.services where name = 'Serviço ${ruleName}';
      delete from public.interactions where person_id in (select id from public.people where full_name = '${patient}');
      delete from public.person_kinds where person_id in (select id from public.people where full_name = '${patient}');
      delete from public.people where full_name = '${patient}';`).catch(() => null);
    if (createdProf && S.prof) await devSql(`delete from public.professional_units where professional_id = '${S.prof}'; delete from public.professionals where id = '${S.prof}'`).catch(() => null);
  };
  test.afterAll(async () => { if (process.env.SUPABASE_ACCESS_TOKEN) await clean(); });

  test("fixtures: produto, venda confirmada de R$ 500,00 e a fisioterapeuta QA como profissional", async () => {
    test.skip(!process.env.SUPABASE_ACCESS_TOKEN, "precisa de SUPABASE_ACCESS_TOKEN para preparar e limpar fixtures");
    await clean();
    const mgr = await signIn(QA.manager); const g = api(mgr); const fis = await signIn(QA.fisio); S.fisUser = fis.user.id;
    S.org = (await g.get("organizations?select=id&slug=eq.hp-group")).body[0].id; S.unit = (await g.get("units?select=id&slug=eq.sao-paulo")).body[0].id;
    let prof = ((await g.get(`professionals?select=id,display_name&user_id=eq.${S.fisUser}`)).body as { id: string; display_name: string }[])[0];
    if (!prof) { const r = await rest(mgr, "POST", "professionals", { org_id: S.org, display_name: "Fisio QA (aceite)", active: true, user_id: S.fisUser }); prof = r.body[0]; createdProf = true; await rest(mgr, "POST", "professional_units", { professional_id: prof.id, unit_id: S.unit }); }
    S.prof = prof.id;
    const svc = await rest(mgr, "POST", "services", { org_id: S.org, name: `Serviço ${ruleName}`, duration_min: 30, price_cents: 0, active: true }); S.svc = svc.body[0].id;
    const pkg = await rest(mgr, "POST", "products", { org_id: S.org, kind: "package", name: productName, price_cents: 50000, sessions_count: 5, validity_days: 90, consume_on_no_show: true, late_cancel_hours: 24, service_id: S.svc, active: true, access_rule: "on_first_payment" });
    expect(pkg.status, JSON.stringify(pkg.body)).toBe(201); S.pkg = pkg.body[0].id;
    const p = await g.rpc("create_person", { p_full_name: patient, p_unit_id: S.unit, p_kinds: ["patient"], p_email: `r20.${runId.toLowerCase()}@example.com`, p_phone: null, p_notes: null, p_force: true }); expect(p.status, JSON.stringify(p.body)).toBe(200); S.person = p.body.id;
    const sale = await g.rpc("sale_create", { p_person: S.person, p_unit: S.unit, p_opportunity: null, p_items: [{ product_id: S.pkg, qty: 1 }], p_discount_cents: 0, p_installments: 1, p_first_due: spDate(0) });
    expect(sale.status, JSON.stringify(sale.body)).toBe(200); S.sale = sale.body; expect((await g.rpc("sale_confirm", { p_sale: S.sale })).status).toBeLessThan(300);
    S.rec = (await g.get(`receivables?select=id&sale_id=eq.${S.sale}`)).body[0].id;
    before = await physioSummary();                                                                                    // a fisioterapeuta QA pode ter repasses de execuções antigas: comparamos DIFERENÇAS
    expect(((await g.get(`commission_entries?select=id&sale_id=eq.${S.sale}`)).body as unknown[]).length, "sem regra ainda: nenhum lançamento").toBe(0);
  });

  test("Financeiro cria a regra pela tela: produto, beneficiário (a fisioterapeuta) e percentual vêm da regra", async ({ page, context }) => {
    await loginAs(context, QA.manager); const errors = collectErrors(page);
    await page.goto("/admin/financeiro/comissoes"); await page.getByRole("tab", { name: "Regras de comissão" }).click();
    await page.locator("#crn").fill(ruleName); await page.locator("#crp").selectOption(S.pkg); await page.locator("#crb").selectOption(S.fisUser); await page.locator("#crv").fill("20");
    await page.getByRole("button", { name: "Criar regra" }).click(); await expect(page.getByText("Regra criada.")).toBeVisible({ timeout: 20_000 });
    await expect(page.getByRole("row").filter({ hasText: ruleName })).toContainText("20,00%");
    const rule = await sql1<{ percent_bp: number; product_id: string; beneficiary_user_id: string; active: boolean }>(`select percent_bp, product_id, beneficiary_user_id, active from public.commission_rules where name = '${ruleName}'`);
    expect(rule).toEqual({ percent_bp: 2000, product_id: S.pkg, beneficiary_user_id: S.fisUser, active: true });
    expect(errors, errors.join("\n")).toEqual([]);
  });

  test("recebimento parcial (R$ 300,00) e a quitação (R$ 200,00) pela tela geram os lançamentos pela regra — duplo clique e repetição não duplicam", async ({ page, context }) => {
    await loginAs(context, QA.manager); const errors = collectErrors(page); const g = api(await signIn(QA.manager));
    await page.goto("/admin/financeiro/vendas");
    const row = () => page.getByRole("row").filter({ hasText: patient });
    await row().getByRole("button", { name: "Receber" }).click(); await page.locator("#pa").fill("300,00"); await page.getByRole("button", { name: "Registrar" }).dblclick();
    await expect(page.getByText("Recebimento registrado.")).toBeVisible({ timeout: 20_000 });
    let ent = (await g.get(`commission_entries?select=amount_cents,status,percent_bp,beneficiary_user_id,rule_id&sale_id=eq.${S.sale}&order=created_at`)).body as { amount_cents: number; status: string; percent_bp: number; beneficiary_user_id: string }[];
    expect(ent, "duplo clique: um recebimento, um lançamento").toHaveLength(1); expect(ent[0]).toMatchObject({ amount_cents: 6000, status: "pending", percent_bp: 2000, beneficiary_user_id: S.fisUser });   // 20% × R$ 300,00
    const key = (await g.get(`payments?select=idempotency_key&receivable_id=eq.${S.rec}`)).body[0].idempotency_key;
    await g.rpc("payment_record", { p_receivable: S.rec, p_amount_cents: 30000, p_paid_at: new Date().toISOString(), p_method: "pix", p_account: null, p_idempotency_key: key });   // retentativa da mesma chave
    expect(((await g.get(`commission_entries?select=id&sale_id=eq.${S.sale}`)).body as unknown[]).length).toBe(1);
    await page.reload(); await row().getByRole("button", { name: "Receber" }).click(); await expect(page.locator("#pa")).toHaveValue("200,00"); await page.getByRole("button", { name: "Registrar" }).click();
    await expect(page.getByText("Recebimento registrado.")).toBeVisible({ timeout: 20_000 });
    ent = (await g.get(`commission_entries?select=amount_cents,status,percent_bp,beneficiary_user_id&sale_id=eq.${S.sale}&order=created_at`)).body as typeof ent;
    expect(ent.map((e) => e.amount_cents)).toEqual([6000, 4000]); expect(ent.every((e) => e.percent_bp === 2000 && e.status === "pending")).toBe(true);
    expect(errors, errors.join("\n")).toEqual([]);
  });

  test("Financeiro: o lançamento mostra data, base, percentual, regra e estado; autorizar → pagar segue o fluxo e a conferência fecha com a Visão geral", async ({ page, context }) => {
    await loginAs(context, QA.manager); const errors = collectErrors(page); const g = api(await signIn(QA.manager));
    await page.goto("/admin/financeiro/comissoes");
    const r60 = page.getByRole("row").filter({ hasText: ruleName }).filter({ hasText: "R$ 60,00" }); const r40 = page.getByRole("row").filter({ hasText: ruleName }).filter({ hasText: "R$ 40,00" });
    await expect(r60).toHaveCount(1, { timeout: 30_000 }); await expect(r60).toContainText("R$ 300,00"); await expect(r60).toContainText("20,00%"); await expect(r60).toContainText("Pendente"); await expect(r60).not.toContainText("da regra atual");
    await expect(r40).toContainText("R$ 200,00");
    // fluxo estrito: não há “Marcar paga” enquanto está pendente; pelo servidor, pendente → pago é recusado
    await expect(r60.getByRole("button", { name: "Marcar paga" })).toHaveCount(0);
    const id60 = (await sql1<{ id: string }>(`select id from public.commission_entries where sale_id = '${S.sale}' and amount_cents = 6000`)).id; const id40 = (await sql1<{ id: string }>(`select id from public.commission_entries where sale_id = '${S.sale}' and amount_cents = 4000`)).id;
    const skip = await g.rpc("commission_set_status", { p_entry: id60, p_status: "paid" }); expect(skip.status).not.toBe(200); expect(JSON.stringify(skip.body)).toContain("transição inválida");
    await r60.getByRole("button", { name: "Autorizar" }).click(); await expect(r60).toContainText("Autorizada", { timeout: 20_000 });
    await r60.getByRole("button", { name: "Marcar paga" }).dblclick(); await expect(r60).toContainText("Paga", { timeout: 20_000 });                  // duplo clique: segue sendo uma transição
    await r40.getByRole("button", { name: "Autorizar" }).click(); await expect(r40).toContainText("Autorizada", { timeout: 20_000 });
    expect((await g.rpc("commission_set_status", { p_entry: id60, p_status: "authorized" })).status, "pago é final").not.toBe(200);
    expect(await sql1<{ s60: string; s40: string; aud: number }>(`select (select status from public.commission_entries where id = '${id60}') s60, (select status from public.commission_entries where id = '${id40}') s40,
      (select count(*)::int from public.audit_log where entity_type = 'commission_entries' and entity_id in ('${id60}', '${id40}'))::int aud`)).toEqual({ s60: "paid", s40: "authorized", aud: 3 });        // autorizada, paga, autorizada — quem e quando ficam na auditoria
    // conferência do período: o total das comissões é o mesmo da Visão geral (diferença R$ 0,00) e o recálculo bate
    const panel = page.getByRole("region", { name: "Conferência das comissões" }); await expect(panel).toContainText("diferença: R$ 0,00", { timeout: 30_000 }); await expect(panel).toContainText("Conferido");
    await expect(panel).toContainText("todos os lançamentos batem");
    const rec = (await g.rpc("commission_reconciliation", { p_from: new Date(Date.now() - 864e5).toISOString(), p_to: new Date(Date.now() + 864e5).toISOString(), p_unit: null })).body as { ok: boolean; diff_vs_finance_cents: number; mismatch_count: number };
    expect(rec).toMatchObject({ ok: true, diff_vs_finance_cents: 0, mismatch_count: 0 });
    expect(errors, errors.join("\n")).toEqual([]);
  });

  test("a fisioterapeuta vê o próprio repasse em “Meu resumo”: pendente, autorizado, pago e líquido (base, percentual, regra e produto — nunca o paciente)", async ({ page, context }) => {
    await loginAs(context, QA.fisio); const errors = collectErrors(page);
    const now = await physioSummary();
    expect({ pend: now.pending_cents - before.pending_cents, auth: now.authorized_cents - before.authorized_cents, paid: now.paid_cents - before.paid_cents, net: now.net_cents - before.net_cents }).toEqual({ pend: 0, auth: 4000, paid: 6000, net: 10000 });
    await page.goto("/admin/meu-resumo?periodo=mes"); await expect(page.getByRole("heading", { name: "Meu resumo" }).first()).toBeVisible({ timeout: 40_000 });
    const card = (label: string) => page.getByRole("listitem").filter({ has: page.getByText(label, { exact: true }) }).locator(".hp-kpi-value");
    await expect(card("Repasses autorizados")).toHaveText(new RegExp(`${(now.authorized_cents / 100).toFixed(2).replace(".", ",")}`)); await expect(card("Repasses pagos")).toContainText((now.paid_cents / 100).toFixed(2).replace(".", ","));
    await expect(card("Líquido do período")).toContainText((now.net_cents / 100).toFixed(2).replace(".", ","));
    const row60 = page.getByRole("row").filter({ hasText: ruleName }).filter({ hasText: "R$ 60,00" }); await expect(row60).toContainText(productName); await expect(row60).toContainText("R$ 300,00"); await expect(row60).toContainText("20,00%"); await expect(row60).toContainText("Pago");
    await expect(page.getByRole("row").filter({ hasText: ruleName }).filter({ hasText: "R$ 40,00" })).toContainText("Autorizado");
    await expect(page.getByText(patient)).toHaveCount(0);                                                           // o detalhamento não expõe o paciente
    await page.screenshot({ path: "docs/screenshots/repasses/meu-resumo-desktop.png", fullPage: true });
    // a fisioterapeuta não autoriza nem paga a própria comissão e não abre o Financeiro
    const f = api(await signIn(QA.fisio)); const ids = (await devSql(`select id from public.commission_entries where sale_id = '${S.sale}'`)) as { id: string }[];
    for (const { id } of ids) expect((await f.rpc("commission_set_status", { p_entry: id, p_status: "paid" })).status).not.toBe(200);
    expect(((await f.get("commission_rules?select=id")).body as unknown[]).length).toBe(0);
    await page.goto("/admin/financeiro/comissoes"); await expect(page.getByRole("heading", { name: "Comissões e repasses" })).toHaveCount(0);
    await expectNoFatal(page); expect(errors, errors.join("\n")).toEqual([]);
  });

  test("estorno de R$ 100,00 pela tela gera UM lançamento negativo proporcional (−R$ 20,00) e reduz o líquido do profissional; repetir não duplica", async ({ page, context }) => {
    await loginAs(context, QA.manager); const errors = collectErrors(page); const g = api(await signIn(QA.manager));
    await page.goto("/admin/financeiro/vendas");
    await page.getByRole("row").filter({ hasText: "Recebimento" }).filter({ hasText: "R$ 300,00" }).first().getByRole("button", { name: "Estornar" }).click();
    await page.locator("#ask-input").fill("100,00"); await page.getByRole("dialog").getByRole("button", { name: "Confirmar" }).click();
    await page.locator("#ask-input").fill(`Estorno R20 ${runId}`); await page.getByRole("dialog").getByRole("button", { name: "Estornar" }).click();
    await expect(page.getByText("Estorno registrado.")).toBeVisible({ timeout: 20_000 });
    const ent = (await g.get(`commission_entries?select=amount_cents,status,percent_bp&sale_id=eq.${S.sale}&order=created_at`)).body as { amount_cents: number; status: string; percent_bp: number }[];
    expect(ent.map((e) => e.amount_cents)).toEqual([6000, 4000, -2000]); expect(ent[2]).toMatchObject({ status: "reversed", percent_bp: 2000 });
    const refundId = (await sql1<{ id: string; key: string }>(`select id, idempotency_key as key from public.payments where kind = 'refund' and receivable_id = '${S.rec}'`));
    const dup = await g.rpc("payment_refund", { p_payment: (await sql1<{ id: string }>(`select refund_of as id from public.payments where id = '${refundId.id}'`)).id, p_amount_cents: 10000, p_reason: "repetido", p_idempotency_key: refundId.key });
    expect(dup.status).toBeLessThan(300); expect(((await g.get(`commission_entries?select=id&sale_id=eq.${S.sale}`)).body as unknown[]).length, "mesma chave de estorno não duplica o lançamento").toBe(3);
    await page.goto("/admin/financeiro/comissoes"); const rr = page.getByRole("row").filter({ hasText: ruleName }).filter({ hasText: "estorno" }); await expect(rr).toHaveCount(1, { timeout: 30_000 }); await expect(rr).toContainText("-R$ 20,00"); await expect(rr).toContainText("Estornada");
    await expect(page.getByRole("region", { name: "Conferência das comissões" })).toContainText("diferença: R$ 0,00", { timeout: 30_000 });
    const now = await physioSummary(); expect({ net: now.net_cents - before.net_cents, rev: now.reversed_cents - before.reversed_cents }).toEqual({ net: 8000, rev: -2000 });   // 100 + 60 + 20 − 20... = 6000 + 4000 − 2000
    await loginAs(context, QA.fisio); await page.goto("/admin/meu-resumo?periodo=mes"); await expect(page.getByRole("row").filter({ hasText: ruleName }).filter({ hasText: "estorno" })).toContainText("-R$ 20,00", { timeout: 40_000 });
    expect(errors, errors.join("\n")).toEqual([]);
  });

  test("permissões: comercial, paciente e outro profissional não leem nem alteram lançamentos; o gestor da unidade não vê o repasse individual", async () => {
    const ids = (await devSql(`select id from public.commission_entries where sale_id = '${S.sale}'`)) as { id: string }[];
    for (const mail of [QA.comercial, QA.paciente, QA.parceiro]) {
      const a = api(await signIn(mail)); const rows = (await a.get(`commission_entries?select=id&sale_id=eq.${S.sale}`)).body as unknown[]; expect(rows.length, mail).toBe(0);
      expect((await a.rpc("commission_set_status", { p_entry: ids[0].id, p_status: "authorized" })).status, mail).not.toBe(200);
      expect((await a.rpc("commission_reconciliation", { p_from: new Date(Date.now() - 864e5).toISOString(), p_to: new Date(Date.now() + 864e5).toISOString(), p_unit: null })).status, mail).not.toBe(200);
    }
    const gu = api(await signIn(QA.gestorUnidade)); const sm = await gu.rpc("my_professional_summary", { p_professional: S.prof, p_from: spDate(-30), p_to: spDate(1) });
    expect(sm.status).toBe(200); expect((sm.body as { payouts: { visible: boolean } }).payouts.visible, "repasse individual é só do próprio profissional").toBe(false);
  });

  test("celular: Comissões e “Meu resumo” cabem na tela, sem rolagem lateral", async ({ browser }) => {
    for (const [mail, path, shot] of [[QA.manager, "/admin/financeiro/comissoes", "comissoes-celular"], [QA.fisio, "/admin/meu-resumo?periodo=mes", "meu-resumo-celular"]] as const) {
      const ctx = await browser.newContext({ viewport: { width: 390, height: 844 }, timezoneId: "America/Sao_Paulo", locale: "pt-BR", isMobile: true, hasTouch: true }); await loginAs(ctx, mail); const p = await ctx.newPage(); const errors = collectErrors(p);
      await p.goto(path); await p.waitForLoadState("networkidle"); await expect(p.getByText(ruleName).first()).toBeVisible({ timeout: 40_000 });
      expect(await p.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth), `${path} sem rolagem lateral`).toBe(true);
      await p.screenshot({ path: `docs/screenshots/repasses/${shot}.png` }); expect(errors, errors.join("\n")).toEqual([]); await ctx.close();
    }
  });
});
