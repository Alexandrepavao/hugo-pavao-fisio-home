// ACEITE da release v1 (escopo ampliado, etapa 2) — financeiro por linha de negócio (HP Fisioterapia / HP Academy) em Visão geral, DRE, Recorrência,
// Relatórios e Conciliação: Geral = soma das linhas (conferência do servidor aparece e está "Conferido"), seletor na URL, e na Conciliação o extrato
// original fica intacto enquanto a alocação por linha é uma camada à parte. Só cria fixtures próprias (conta e movimentos de teste).
import { expect, test, type Page } from "@playwright/test";
import { api, collectErrors, expectNoFatal, loginAs, QA, rest, runId, signIn, spDate } from "./helpers-release";

test.use({ timezoneId: "America/Sao_Paulo", locale: "pt-BR" });

const region = (page: Page) => page.getByRole("region", { name: "Por linha de negócio" });
const lineBtn = (page: Page, name: string) => page.getByRole("group", { name: "Linha de negócio" }).getByRole("button", { name });
// a linha de negócio fica dentro do filtro único (Filtros ▸ Linha de negócio): abre o popover se ainda não estiver aberto
const pickLine = async (page: Page, name: string) => {
  if (!(await page.getByRole("group", { name: "Linha de negócio" }).isVisible())) await page.getByRole("button", { name: /^Filtros/ }).first().click();
  await lineBtn(page, name).click();
};

test.describe.serial("@release Financeiro por linha de negócio", () => {
  test.setTimeout(150_000);
  const S: Record<string, string> = {};

  test("Visão geral e DRE: quadro por linha conferido com o Geral; seletor na URL", async ({ page, context }) => {
    const s = await loginAs(context, QA.manager); const errors = collectErrors(page);
    // servidor: Geral = soma das quatro colunas em toda métrica somável
    const from = new Date(Date.now() - 400 * 864e5).toISOString(), to = new Date(Date.now() + 30 * 864e5).toISOString();
    const srv = await api(s).rpc("finance_by_line", { p_from: from, p_to: to, p_unit: null }); expect(srv.status, JSON.stringify(srv.body)).toBe(200);
    expect(srv.body.reconciliation.ok).toBe(true);
    for (const f of ["sales_cents", "receipts_cents", "refunds_cents", "expenses_paid_cents", "commissions_cents", "recognized_cents"]) {
      const sum = (srv.body.lines as Record<string, number>[]).reduce((a, l) => a + Number(l[f]), 0); expect(sum, f).toBe(Number(srv.body.total[f]));
    }
    for (const path of ["/admin/financeiro", "/admin/financeiro/dre"]) {
      await page.goto(path);
      await expect(region(page).getByText(/Conferido: o total das linhas bate/)).toBeVisible({ timeout: 30_000 });
      await expect(region(page).getByRole("columnheader", { name: "HP Fisioterapia" })).toBeVisible();
      await expect(region(page).getByRole("columnheader", { name: "HP Academy" })).toBeVisible();
      await expect(region(page).getByRole("columnheader", { name: "Geral" })).toBeVisible();
      await pickLine(page, "HP Academy");
      await expect(page).toHaveURL(/linha=academy/);
      await expect(lineBtn(page, "HP Academy")).toHaveAttribute("aria-pressed", "true");
      await expect(region(page).getByText(/— HP Academy/).first()).toBeVisible();
      await pickLine(page, "Geral"); await expect(page).not.toHaveURL(/linha=/);
      await expectNoFatal(page);
    }
    expect(errors, errors.join("\n")).toEqual([]);
  });

  test("Recorrência: MRR/ARR por linha com conferência contra o consolidado", async ({ page, context }) => {
    const s = await loginAs(context, QA.manager); const errors = collectErrors(page);
    const month = new Date().toLocaleDateString("sv-SE", { timeZone: "America/Sao_Paulo" }).slice(0, 7) + "-01";
    const bl = await api(s).rpc("mrr_by_line", { p_month: month, p_unit: null }); expect(bl.status, JSON.stringify(bl.body)).toBe(200);
    const direct = await api(s).rpc("mrr_report", { p_month: month, p_unit: null });
    expect(bl.body.reconciliation.ok).toBe(true);
    expect(Number(bl.body.total.mrr_cents)).toBe(Number(direct.body.mrr_cents.value));                     // soma das linhas = MRR consolidado
    expect((bl.body.lines as { ponte_fecha: boolean }[]).every((l) => l.ponte_fecha)).toBe(true);
    await page.goto("/admin/financeiro/recorrencia");
    await expect(page.getByRole("heading", { name: "Por linha de negócio" })).toBeVisible({ timeout: 30_000 });
    await expect(page.getByText(/Conferido: a soma das linhas bate com o MRR consolidado/)).toBeVisible();
    await pickLine(page, "HP Fisioterapia");
    await expect(page).toHaveURL(/linha=physio/);
    await expect(page.getByText(/MRR do mês — HP Fisioterapia/)).toBeVisible();
    await expect(page.getByText(/Ponte de movimentação do MRR — HP Fisioterapia/)).toBeVisible();
    await pickLine(page, "HP Academy");
    await expect(page.getByText(/MRR do mês — HP Academy/)).toBeVisible();
    await pickLine(page, "Geral");
    await expect(page.getByText("MRR do mês", { exact: true })).toBeVisible();
    await expectNoFatal(page);
    expect(errors, errors.join("\n")).toEqual([]);
  });

  test("Relatórios de eficiência: por linha, com conferência; CAC/LTV continuam indisponíveis", async ({ page, context }) => {
    await loginAs(context, QA.manager); const errors = collectErrors(page);
    await page.goto("/admin/financeiro/relatorios");
    await expect(page.getByRole("heading", { name: /Por linha de negócio — Geral/ })).toBeVisible({ timeout: 30_000 });
    await expect(page.getByText(/Conferido: o total das linhas bate com o Geral/)).toBeVisible();
    await pickLine(page, "HP Fisioterapia");
    await expect(page.getByRole("heading", { name: /Por linha de negócio — HP Fisioterapia/ })).toBeVisible();
    await expect(page.getByText("CAC", { exact: true }).first()).toBeVisible();
    await expect(page.getByText(/indispon/i).first()).toBeVisible();
    await expectNoFatal(page);
    expect(errors, errors.join("\n")).toEqual([]);
  });

  test("Conciliação: o extrato original não muda; a linha de negócio é uma alocação à parte", async ({ page, context }) => {
    const mgr = await signIn(QA.manager); const g = api(mgr); await loginAs(context, QA.manager); const errors = collectErrors(page);
    const org = (await g.get("organizations?select=id&slug=eq.hp-group")).body[0].id as string; const unit = (await g.get("units?select=id&slug=eq.sao-paulo")).body[0].id as string;
    const acc = await rest(mgr, "POST", "financial_accounts", { org_id: org, unit_id: unit, name: `Conta E2E R08 ${runId}`, kind: "bank", active: true });
    expect(acc.status, JSON.stringify(acc.body)).toBeLessThan(300); S.acc = acc.body[0].id; S.accName = `Conta E2E R08 ${runId}`;
    const today = spDate(0);
    const imp = await g.rpc("bank_statement_import", { p_account: S.acc, p_lines: [
      { date: today, description: `Credito avulso E2E R08 ${runId}`, amount_cents: 12345, ref: `R08A-${runId}` },
      { date: today, description: `Credito dividido E2E R08 ${runId}`, amount_cents: 20000, ref: `R08B-${runId}` },
      { date: today, description: `Tarifa E2E R08 ${runId}`, amount_cents: -777, ref: `R08C-${runId}` }] });
    expect(imp.status, JSON.stringify(imp.body)).toBe(200); expect(imp.body.inserted).toBe(3);
    const lines = (await g.get(`bank_statement_lines?select=id,description,amount_cents,external_ref,txn_date&import_id=eq.${imp.body.import_id}&order=external_ref`)).body as { id: string; description: string; amount_cents: number; external_ref: string; txn_date: string }[];
    S.l1 = lines[0].id; S.l2 = lines[1].id; S.l3 = lines[2].id; const original = JSON.stringify(lines);

    await page.goto("/admin/financeiro/conciliacao");
    const row = (text: string) => page.locator("li").filter({ hasText: text });
    const r1 = row(`Credito avulso E2E R08 ${runId}`);
    await expect(r1).toBeVisible({ timeout: 30_000 });
    await expect(r1.getByText(/Linha de negócio: Não classificado/)).toBeVisible();                        // sem alocação ainda
    // 100% Academy
    await r1.getByRole("button", { name: "Linha de negócio" }).click();
    await r1.getByLabel("Linha de negócio deste movimento").selectOption("academy");
    await r1.getByRole("button", { name: "Salvar alocação" }).click();
    await expect(r1.getByText(/Linha de negócio: HP Academy/)).toBeVisible();
    await expect(r1.getByText(/alocação manual/)).toBeVisible();
    // 70/30
    const r2 = row(`Credito dividido E2E R08 ${runId}`);
    await r2.getByRole("button", { name: "Linha de negócio" }).click();
    await r2.getByLabel("Linha de negócio deste movimento").selectOption("split");
    await r2.getByLabel(/% HP Fisioterapia/).fill("70");
    await r2.getByRole("button", { name: "Salvar alocação" }).click();
    await expect(r2.getByText(/HP Fisioterapia 70% \/ HP Academy 30%|HP Academy 30% \/ HP Fisioterapia 70%/)).toBeVisible();
    // valor inválido é recusado pela interface (e pelo servidor)
    await r2.getByRole("button", { name: "Linha de negócio" }).click();
    await r2.getByLabel("Linha de negócio deste movimento").selectOption("split");
    await r2.getByLabel(/% HP Fisioterapia/).fill("150");
    await r2.getByRole("button", { name: "Salvar alocação" }).click();
    await expect(r2.getByRole("alert")).toContainText(/entre 1 e 99/);
    await r2.getByRole("button", { name: "Fechar" }).click();

    // o extrato original continua idêntico (data, descrição, valor, referência)
    const after = (await g.get(`bank_statement_lines?select=id,description,amount_cents,external_ref,txn_date&import_id=eq.${imp.body.import_id}&order=external_ref`)).body;
    expect(JSON.stringify(after)).toBe(original);
    const shares = (await g.rpc("bank_line_shares", { p_line_ids: [S.l1, S.l2, S.l3] })).body as { line_id: string; bucket: string; cents: number; origin: string }[];
    const of = (id: string, b: string) => shares.filter((x) => x.line_id === id && x.bucket === b).reduce((a, x) => a + Number(x.cents), 0);
    expect(of(S.l1, "academy")).toBe(12345);
    expect(of(S.l2, "physio")).toBe(14000); expect(of(S.l2, "academy")).toBe(6000);
    expect(shares.filter((x) => x.line_id === S.l3).map((x) => `${x.bucket}:${x.origin}`)).toEqual(["unclassified:sem_alocacao"]);

    // quadro por linha (filtrado pela conta de teste): entradas e saídas separadas, conferido com o extrato
    const box = page.getByRole("region", { name: "Movimentos bancários por linha de negócio" });
    await box.getByLabel("Conta bancária").selectOption({ label: S.accName });
    await expect(box.getByText(/Conferido: a soma das linhas bate com o extrato importado/)).toBeVisible({ timeout: 30_000 });
    const tr = (name: string) => box.getByRole("row", { name: new RegExp(`^${name}`) });
    await expect(tr("HP Academy")).toContainText("R$ 183,45");        // 123,45 + 60,00 (30% de 200,00)
    await expect(tr("HP Fisioterapia")).toContainText("R$ 140,00");
    await expect(tr("Não classificado")).toContainText("R$ 7,77");    // a tarifa: saída, sem alocação
    const q = (await g.rpc("bank_by_line", { p_from: today, p_to: spDate(1), p_unit: null, p_account: S.acc })).body;
    expect(q.reconciliation.ok).toBe(true); expect(Number(q.total.inflow_cents)).toBe(32345); expect(Number(q.total.outflow_cents)).toBe(777);
    await expectNoFatal(page);
    expect(errors, errors.join("\n")).toEqual([]);
  });

  test("Conciliação: outro papel sem acesso financeiro não lê nem aloca os movimentos", async () => {
    const com = await signIn(QA.comercial); const c = api(com);
    expect(((await c.get(`bank_statement_lines?select=id&id=eq.${S.l1}`)).body as unknown[]).length).toBe(0);
    expect(((await c.rpc("bank_line_shares", { p_line_ids: [S.l1] })).body as unknown[]).length).toBe(0);
    const r = await c.rpc("bank_line_set_allocation", { p_line: S.l3, p_allocations: [{ line: "physio", basis_points: 10000 }] });
    expect(r.status).toBeGreaterThanOrEqual(400);
    const mgr = await signIn(QA.manager);                               // limpeza: a conta de teste sai da lista de contas ativas
    await rest(mgr, "PATCH", `financial_accounts?id=eq.${S.acc}`, { active: false });
  });
});
