import { writeFileSync } from "node:fs";
import { expect, test } from "@playwright/test";
import { MANAGER, api, runId, signIn, useSession } from "./helpers";

// Telas financeiras novas desta fase: comportamento, não só carregamento.
// - MRR contratual separado de forecast por pagamentos (item 1)
// - DRE por classificação, nunca "não classificado" virando zero/despesa operacional por padrão (item 2)
// - Comissão gerada automaticamente no recebimento
// - Conciliação: sugestão ≠ confirmação; reimportar não duplica; dupla conciliação é rejeitada
test.describe.serial("Financeiro — comportamentos", () => {
  let orgId = ""; let unitId = ""; let personId = ""; let productId = "";
  let categoryId = ""; let accountId = "";

  test.beforeAll(async () => {
    const m = await signIn(MANAGER); const g = api(m);
    orgId = (await g.get("organizations?select=id")).body[0].id;
    const person = (await g.get("people?select=id,unit_id&full_name=eq.Aluna%20QA%20Teste")).body[0];
    personId = person.id; unitId = person.unit_id;
    const p = await g.post("products", { org_id: orgId, kind: "service", name: `Serviço E2E Fin ${runId}`, price_cents: 15000, active: true });
    expect(p.status, JSON.stringify(p.body)).toBe(201); productId = p.body[0].id;
  });

  test("configurações: cria categoria com classificação DRE e conta financeira pela interface", async ({ page }) => {
    const m = await signIn(MANAGER); await useSession(page.context(), m);
    await page.goto("/admin/financeiro/config");
    await expect(page.getByRole("heading", { name: "Configurações" })).toBeVisible();
    await page.getByLabel("Nome da categoria").fill(`Custo E2E ${runId}`);
    await page.locator("#fc-class").selectOption("custo_direto");
    await page.getByRole("button", { name: "Criar categoria" }).click();
    await expect(page.getByText("Categoria criada.")).toBeVisible();
    await expect(page.getByRole("cell", { name: `Custo E2E ${runId}` })).toBeVisible();

    await page.getByPlaceholder("Nome da conta (ex.: Banco X — corrente)").fill(`Conta E2E ${runId}`);
    await page.locator("#fa-unit").selectOption(unitId);
    await page.getByRole("button", { name: "Criar" }).first().click();
    await expect(page.getByText("Criado.")).toBeVisible();

    const g = api(m);
    categoryId = (await g.get(`finance_categories?select=id&name=eq.${encodeURIComponent(`Custo E2E ${runId}`)}`)).body[0].id;
    accountId = (await g.get(`financial_accounts?select=id&name=eq.${encodeURIComponent(`Conta E2E ${runId}`)}`)).body[0].id;
    expect(categoryId).toBeTruthy(); expect(accountId).toBeTruthy();
  });

  test("MRR contratual não é inflado por uma venda avulsa da mesma pessoa no mesmo mês", async ({ page }) => {
    const m = await signIn(MANAGER); const g = api(m);
    const brl = (cents: number) => new Intl.NumberFormat("pt-BR", { style: "currency", currency: "BRL" }).format(cents / 100);
    const monthStart = `${new Date().toISOString().slice(0, 7)}-01`;
    const novoOf = async () => { const r = await g.rpc("mrr_report", { p_month: monthStart, p_unit: unitId }); expect(r.status, JSON.stringify(r.body)).toBe(200); return Number(r.body.bridge.novo_cents); };
    const before = await novoOf();
    // Reaproveita a pessoa QA existente; a asserção é por DELTA (antes/depois), não por valor absoluto —
    // continua correta mesmo que a suíte seja reexecutada e a pessoa já tenha outros contratos/vendas.
    const mrrPersonId = personId;
    // Contrato recorrente real: R$300,00/mês
    const rc = await g.rpc("recurring_contract_start", { p_person: mrrPersonId, p_unit: unitId, p_product: productId, p_billing_period: "monthly", p_period_amount_cents: 30000, p_period_discount_cents: 0, p_starts_on: new Date().toISOString().slice(0, 10), p_source_sale: null, p_notes: "e2e mrr" });
    expect(rc.status, JSON.stringify(rc.body)).toBe(200);
    const afterContract = await novoOf();
    expect(afterContract - before, "o contrato de R$300/mês deve aumentar 'Novo' em exatamente 30000 centavos").toBe(30000);
    // Venda avulsa (não recorrente) da MESMA pessoa, mesmo mês — não deve contar como MRR
    const sale = await g.rpc("sale_create", { p_person: mrrPersonId, p_unit: unitId, p_opportunity: null, p_items: [{ product_id: productId, qty: 1, unit_price_cents: 99900 }], p_discount_cents: 0, p_installments: 1, p_first_due: new Date().toISOString().slice(0, 10), p_notes: "e2e avulsa" });
    expect(sale.status, JSON.stringify(sale.body)).toBe(200); const saleId = sale.body;
    const conf = await g.rpc("sale_confirm", { p_sale: saleId }); expect(conf.status).toBe(204);
    const recv = (await g.get(`receivables?select=id&sale_id=eq.${saleId}`)).body[0].id;
    const pay = await g.rpc("payment_record", { p_receivable: recv, p_amount_cents: 99900, p_paid_at: new Date().toISOString(), p_method: "pix", p_account: accountId, p_idempotency_key: `e2e-avulsa-${runId}` });
    expect(pay.status, JSON.stringify(pay.body)).toBe(200);
    const afterAvulsa = await novoOf();
    expect(afterAvulsa, "a venda avulsa de R$999 não deve alterar 'Novo' — MRR vem só de contrato").toBe(afterContract);

    await useSession(page.context(), m);
    await page.goto("/admin/financeiro/recorrencia");
    await page.getByLabel("Unidade").selectOption(unitId);
    await expect(page.getByRole("heading", { name: "Recorrência e forecast" })).toBeVisible();
    await expect(page.getByText("MRR do mês", { exact: true })).toBeVisible();
    const novoRow = page.locator("li", { hasText: "+ Novo" });
    await expect(novoRow).toContainText(brl(afterAvulsa));                             // exatamente o valor do contrato, nunca o da venda avulsa
    await expect(novoRow).not.toContainText("999,00");
    // O forecast por pagamentos é textualmente separado do MRR contratual
    await expect(page.getByText("Forecast por pagamentos — não é MRR contratual nem conta a receber.")).toBeVisible();
  });

  test("DRE: lançamento classificado aparece por categoria e habilita margem do produto", async ({ page }) => {
    const m = await signIn(MANAGER); const g = api(m);
    const today = new Date().toISOString().slice(0, 10);
    const pay = await g.post("payables", { org_id: orgId, unit_id: unitId, category_id: categoryId, product_id: productId, description: `Custo direto E2E ${runId}`, amount_cents: 5000, due_date: today, competence_month: today.slice(0, 8) + "01", created_by: m.user.id });
    expect(pay.status, JSON.stringify(pay.body)).toBe(201);
    const payId = pay.body[0].id;
    const paid = await g.rpc("payable_pay", { p_id: payId, p_account: accountId });
    expect(paid.status).toBe(204);

    await useSession(page.context(), m);
    await page.goto("/admin/financeiro/dre");
    await expect(page.getByRole("heading", { name: "Rentabilidade e DRE" })).toBeVisible();
    await expect(page.getByRole("cell", { name: `Custo E2E ${runId}` }).first()).toBeVisible();
    const catRow = page.locator("tr", { hasText: `Custo E2E ${runId}` }).first();
    await expect(catRow).toContainText("Custo direto");
    await expect(catRow).toContainText("R$ 50,00");
    await expect(page.getByText(`Custo direto E2E ${runId}`)).toBeVisible();          // "Lançamentos do período"
    const marginRow = page.locator("tr", { hasText: `Serviço E2E Fin ${runId}` });
    await expect(marginRow).toBeVisible();
    await expect(marginRow).not.toContainText("Indisponível");                        // produto tem custo direto atribuído a ele
  });

  test("comissão é gerada automaticamente no recebimento, conforme a regra ativa", async ({ page }) => {
    const m = await signIn(MANAGER); const g = api(m);
    await useSession(page.context(), m);
    await page.goto("/admin/financeiro/comissoes");
    await page.getByRole("tab", { name: "Regras de comissão" }).click();
    await page.getByLabel("Nome da regra").fill(`Regra E2E ${runId}`);
    await page.getByLabel("Produto (opcional)").selectOption({ label: `Serviço E2E Fin ${runId}` });
    await page.getByLabel("Beneficiário (opcional)").selectOption({ label: "QA Gestor" });
    await page.getByLabel("Percentual (%)").fill("10");
    await page.getByRole("button", { name: "Criar regra" }).click();
    await expect(page.getByText("Regra criada.")).toBeVisible();

    const sale = await g.rpc("sale_create", { p_person: personId, p_unit: unitId, p_opportunity: null, p_items: [{ product_id: productId, qty: 1, unit_price_cents: 20000 }], p_discount_cents: 0, p_installments: 1, p_first_due: new Date().toISOString().slice(0, 10), p_notes: "e2e comissao" });
    expect(sale.status).toBe(200); const saleId = sale.body;
    await g.rpc("sale_confirm", { p_sale: saleId });
    const recv = (await g.get(`receivables?select=id&sale_id=eq.${saleId}`)).body[0].id;
    const payRes = await g.rpc("payment_record", { p_receivable: recv, p_amount_cents: 20000, p_paid_at: new Date().toISOString(), p_method: "pix", p_account: accountId, p_idempotency_key: `e2e-comissao-${runId}` });
    expect(payRes.status, JSON.stringify(payRes.body)).toBe(200);

    await page.goto("/admin/financeiro/comissoes");                                   // aba padrão: Lançamentos
    await expect(page.getByText("R$ 20,00").first()).toBeVisible();                    // 10% de R$ 200,00
    await page.getByRole("button", { name: "Autorizar" }).first().click();
    await expect(page.getByText("Autorizada").first()).toBeVisible();
    await page.getByRole("button", { name: "Marcar paga" }).first().click();
    await expect(page.getByText("Paga", { exact: true }).first()).toBeVisible();
  });

  test("conciliação: sugestão exige confirmação explícita, reimportar o mesmo extrato não duplica, e dupla conciliação é rejeitada", async ({ page }) => {
    const m = await signIn(MANAGER); const g = api(m);
    const today = new Date().toISOString().slice(0, 10);
    const sale = await g.rpc("sale_create", { p_person: personId, p_unit: unitId, p_opportunity: null, p_items: [{ product_id: productId, qty: 1, unit_price_cents: 15000 }], p_discount_cents: 0, p_installments: 1, p_first_due: today, p_notes: "e2e conciliacao" });
    expect(sale.status).toBe(200); const saleId = sale.body;
    await g.rpc("sale_confirm", { p_sale: saleId });
    const recv = (await g.get(`receivables?select=id&sale_id=eq.${saleId}`)).body[0].id;
    await g.rpc("payment_record", { p_receivable: recv, p_amount_cents: 15000, p_paid_at: `${today}T12:00:00Z`, p_method: "pix", p_account: accountId, p_idempotency_key: `e2e-rec-${runId}` });

    const desc = `Extrato E2E ${runId}`;
    const csvPath = `${process.env.TEMP ?? "/tmp"}\\e2e-extrato-${runId}.csv`;
    writeFileSync(csvPath, `data,descricao,valor,referencia\n${today},${desc},150.00,REF-${runId}\n`, "utf8");

    await useSession(page.context(), m);
    await page.goto("/admin/financeiro/conciliacao");
    await page.getByLabel("Conta bancária").selectOption({ label: `Conta E2E ${runId}` });
    await page.setInputFiles("#rec-file", csvPath);
    await expect(page.getByText("1 linha(s) importada(s).", { exact: false })).toBeVisible();
    await expect(page.getByText(desc)).toBeVisible();

    const line = page.locator(".hp-card", { hasText: desc }).first();
    await line.getByRole("button", { name: "Conciliar" }).click();
    await expect(line.getByText("R$ 150,00")).toBeVisible();                           // sugestão aparece, mas nada foi conciliado ainda
    const beforeConfirm = await g.get(`bank_statement_lines?select=id,status&description=eq.${encodeURIComponent(desc)}`);
    expect(beforeConfirm.body[0].status).toBe("unmatched");
    await line.getByRole("button", { name: "Confirmar" }).first().click();
    await expect(page.getByText("Conciliado.")).toBeVisible();
    const afterConfirm = await g.get(`bank_statement_lines?select=id,status&description=eq.${encodeURIComponent(desc)}`);
    expect(afterConfirm.body[0].status).toBe("matched");
    const lineId = afterConfirm.body[0].id;

    // dupla conciliação: confirmar de novo a mesma linha é explicitamente rejeitada, nunca associação silenciosa
    const dup = await g.rpc("bank_reconcile_confirm", { p_line: lineId, p_payment_id: (await g.get(`payments?select=id&receivable_id=eq.${recv}`)).body[0].id, p_payable_id: null });
    expect(dup.status, JSON.stringify(dup.body)).toBe(400);
    expect(JSON.stringify(dup.body)).toContain("já conciliada");

    // reimportar o MESMO extrato: não duplica a linha
    await page.setInputFiles("#rec-file", csvPath);
    await expect(page.getByText("0 linha(s) importada(s). 1 já existente(s) na conta", { exact: false })).toBeVisible();
    const total = await g.get(`bank_statement_lines?select=id&description=eq.${encodeURIComponent(desc)}`);
    expect(total.body).toHaveLength(1);
  });
});
