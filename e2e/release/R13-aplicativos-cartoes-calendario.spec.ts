// ACEITE da release v1 — aplicativos contextuais (sidebar exclusiva por app, app ativo pela URL, aliases de rota), filtro de linha de negócio no filtro único,
// cartões corporativos de ponta a ponta (cadastro, bloqueio, compra única, fatura, conciliação sem duplicidade) e calendário. Só cria fixtures próprias e desfaz o que cria.
import { expect, test, type Page } from "@playwright/test";
import { api, collectErrors, devSql, expectNoFatal, loginAs, QA, runId, signIn } from "./helpers-release";

test.use({ timezoneId: "America/Sao_Paulo", locale: "pt-BR" });

const side = (page: Page) => page.locator("aside nav").first();
const links = async (page: Page) => (await side(page).getByRole("link").allInnerTexts()).map((t) => t.trim());
const noHScroll = async (page: Page, where: string) => {
  const w = await page.evaluate(() => ({ sw: document.documentElement.scrollWidth, iw: window.innerWidth }));
  expect(w.sw, `${where}: a página não pode rolar na horizontal (${w.sw} > ${w.iw})`).toBeLessThanOrEqual(w.iw + 1);
};

test.describe.serial("@release Aplicativos contextuais e filtros", () => {
  test.setTimeout(150_000);

  test("Hub: a sidebar lista só os aplicativos permitidos (sem bloco duplicado no dashboard); entrar troca a sidebar, “Voltar ao Hub” e o seletor funcionam", async ({ page, context }) => {
    await loginAs(context, QA.manager); const errors = collectErrors(page);
    await page.goto("/admin");
    // o acesso aos aplicativos é só pela sidebar do Hub (o dashboard não repete o bloco “Seus aplicativos”)
    await expect(page.getByRole("heading", { name: "Seus aplicativos" })).toHaveCount(0); await expect(page.getByRole("list", { name: "Aplicativos" })).toHaveCount(0);
    await expect(page.getByRole("link", { name: /^Abrir / })).toHaveCount(0);
    await expect(side(page).getByRole("link", { name: "Início" })).toBeVisible({ timeout: 40_000 });
    const hubLinks = await links(page); expect(hubLinks).toContain("Início");
    for (const a of ["Gestão", "Financeiro", "CRM", "Pages", "Operação", "Academy", "Parceiros", "Produtividade"]) expect(hubLinks, `sidebar do Hub lista ${a}`).toContain(a);
    await expect(page.getByRole("heading", { name: "Indicadores prioritários" }).first()).toBeVisible({ timeout: 40_000 });   // indicadores, alertas e gráficos continuam no dashboard
    await side(page).getByRole("link", { name: "Financeiro", exact: true }).click();
    await expect(page).toHaveURL(/\/admin\/financeiro$/);
    await expect(page.getByRole("navigation", { name: "Navegação do Financeiro" })).toBeVisible();
    const fin = await links(page);
    expect(fin).toContain("Cartões"); expect(fin).toContain("DRE"); expect(fin).not.toContain("Pipeline"); expect(fin).not.toContain("Pessoas"); expect(fin).not.toContain("Agenda");
    await expect(page.getByRole("link", { name: "Voltar ao Hub" }).first()).toBeVisible();
    // seletor de aplicativos (no cabeçalho)
    await page.locator("header").getByRole("button", { name: "Trocar de aplicativo" }).click();
    await page.getByRole("menuitem", { name: /CRM/ }).click();
    await expect(page).toHaveURL(/\/admin\/crm$/);
    await expect(page.getByRole("navigation", { name: "Navegação do CRM" }).getByRole("link", { name: "Pipeline" })).toBeVisible({ timeout: 30_000 });   // espera a sidebar do CRM renderizar antes de ler os links
    const crm = await links(page); expect(crm).toContain("Pipeline"); expect(crm).not.toContain("Cartões"); expect(crm).not.toContain("DRE");
    await page.getByRole("link", { name: "Voltar ao Hub" }).first().click();
    await expect(page).toHaveURL(/\/admin$/);
    const hub = await links(page); expect(hub).toContain("Início"); expect(hub).toContain("Financeiro"); expect(hub).not.toContain("Pipeline");
    await expectNoFatal(page); expect(errors, errors.join("\n")).toEqual([]);
  });

  test("o aplicativo ativo vem da URL: link direto, recarregar e voltar/avançar caem no app certo, com o item ativo marcado", async ({ page, context }) => {
    await loginAs(context, QA.manager);
    await page.goto("/admin/financeiro/dre");
    await expect(side(page).getByRole("link", { name: "DRE" })).toHaveAttribute("aria-current", "page", { timeout: 30_000 });
    await page.reload(); await expect(side(page).getByRole("link", { name: "DRE" })).toHaveAttribute("aria-current", "page", { timeout: 30_000 });
    await page.goto("/admin/crm/tarefas");
    await expect(side(page).getByRole("link", { name: "Tarefas" })).toHaveAttribute("aria-current", "page", { timeout: 30_000 }); expect(await links(page)).toContain("Pipeline");
    await page.goBack(); await expect(side(page).getByRole("link", { name: "DRE" })).toHaveAttribute("aria-current", "page", { timeout: 30_000 }); expect(await links(page)).not.toContain("Pipeline");
    await page.goForward(); await expect(side(page).getByRole("link", { name: "Tarefas" })).toHaveAttribute("aria-current", "page", { timeout: 30_000 });
    // telas gerais caem no aplicativo a que pertencem
    for (const [path, item, app] of [["/admin/pessoas", "Pessoas", "Gestão"], ["/admin/equipe", "Equipe e acessos", "Gestão"], ["/admin/auditoria", "Auditoria", "Gestão"], ["/admin/agenda", "Agenda", "Operação"], ["/admin/paginas", "Páginas", "Pages"], ["/admin/academy", "Cursos e alunos", "Academy"], ["/admin/parceiros", "Parceiros", "Parceiros"], ["/admin/meu-dia", "Meu dia", "Produtividade"], ["/admin/contas-corporativas", "Contas corporativas", "Financeiro"]] as const) {
      await page.goto(path);
      await expect(side(page).getByRole("link", { name: item, exact: true }), `${path} → ${app}`).toHaveAttribute("aria-current", "page", { timeout: 30_000 });
      await expect(page.locator("header h1")).toContainText(`${app} · `);
    }
  });

  test("configurações: Unidades, Produtos e serviços e Configurações são itens distintos do menu e abrem a categoria certa", async ({ page, context }) => {
    await loginAs(context, QA.manager);
    await page.goto("/admin/configuracoes?secao=org");
    await expect(side(page).getByRole("link", { name: "Unidades" })).toHaveAttribute("aria-current", "page", { timeout: 30_000 });
    await expect(side(page).getByRole("link", { name: "Configurações", exact: true })).not.toHaveAttribute("aria-current", "page");
    await expect(page.getByRole("button", { name: "Fechar" }).first()).toBeVisible();                       // a categoria “Organização e unidades” já abre
    await page.goto("/admin/configuracoes?secao=operacao");
    await expect(side(page).getByRole("link", { name: "Produtos e serviços" })).toHaveAttribute("aria-current", "page", { timeout: 30_000 });
    await page.goto("/admin/configuracoes");
    await expect(side(page).getByRole("link", { name: "Configurações", exact: true })).toHaveAttribute("aria-current", "page", { timeout: 30_000 });
  });

  test("rotas antigas e atalhos amigáveis levam ao destino certo, sem laço e mantendo os parâmetros", async ({ page, context }) => {
    await loginAs(context, QA.manager);
    for (const [from, to] of [["/admin/gestao", "/admin/adm"], ["/admin/gestao/pessoas", "/admin/pessoas"], ["/admin/gestao/equipe", "/admin/equipe"], ["/admin/administrativo/pendencias?aba=contratos", "/admin/adm/pendencias?aba=contratos"],
      ["/admin/operacao", "/admin/agenda"], ["/admin/pages", "/admin/paginas"], ["/admin/produtividade", "/admin/meu-dia"]] as const) {
      await page.goto(from); await expect(page, from).toHaveURL(new RegExp(`${to.replace(/[?.]/g, "\\$&")}$`), { timeout: 30_000 });
    }
    await page.goto("/admin/adm"); await expect(page).toHaveURL(/\/admin\/adm$/);                           // rota antiga continua valendo
  });

  test("Financeiro: linha de negócio dentro do filtro único (contador, chip, limpar) e o período não apaga a linha", async ({ page, context }) => {
    await loginAs(context, QA.manager);
    await page.goto("/admin/financeiro");
    const f = page.getByTestId("period-filter");
    await expect(f.getByRole("button", { name: /^Filtros/ })).toBeVisible({ timeout: 40_000 });
    await f.getByRole("button", { name: /^Filtros/ }).click();
    const grp = page.getByRole("group", { name: "Linha de negócio" });
    await expect(grp.getByRole("button", { name: "Geral" })).toHaveAttribute("aria-pressed", "true");
    for (const n of ["Geral", "HP Fisioterapia", "HP Academy"]) await expect(grp.getByRole("button", { name: n })).toBeVisible();
    await grp.getByRole("button", { name: "HP Academy" }).click();
    await expect(page).toHaveURL(/linha=academy/);
    await page.keyboard.press("Escape");
    await expect(f.getByRole("button", { name: /^Filtros\s*1$/ })).toBeVisible();
    await expect(f.getByRole("button", { name: "Limpar filtros" })).toBeVisible();
    // trocar o período preserva a linha
    await f.getByRole("button", { name: /^Período:/ }).click(); await page.getByRole("button", { name: "Ano atual", exact: true }).click(); await page.getByRole("button", { name: "Aplicar", exact: true }).click();
    await expect(page).toHaveURL(/linha=academy/); await expect(page).toHaveURL(/periodo=ano/);
    await expect(f.getByRole("button", { name: /^Filtros\s*2$/ })).toBeVisible();
    await f.getByRole("button", { name: "Limpar filtros" }).click();
    await expect(page).not.toHaveURL(/linha=/); await expect(f.getByRole("button", { name: "Limpar filtros" })).toHaveCount(0);
    // as telas mensais usam o mesmo padrão (mês + unidade visíveis; linha no popover)
    for (const path of ["/admin/financeiro/recorrencia", "/admin/financeiro/fluxo-caixa", "/admin/financeiro/dre", "/admin/financeiro/relatorios", "/admin/financeiro/cartoes"]) {
      await page.goto(path); const pf = page.getByTestId("period-filter");
      await expect(pf.getByRole("button", { name: /^Filtros/ }), path).toBeVisible({ timeout: 40_000 }); await expect(pf.getByLabel("Unidade"), path).toBeVisible();
    }
  });
});

test.describe.serial("@release Cartões corporativos (tela e fluxo)", () => {
  test.setTimeout(240_000);
  const nick = `Cartão E2E ${runId}`; const desc1 = `Compra antiga E2E ${runId}`; const desc2 = `Compra atual E2E ${runId}`; const stmt = `DEBITO FATURA E2E ${runId}`;
  let unitId = ""; let accId = ""; let cardId = "";
  const clean = async () => {
    await devSql(`update public.bank_statement_lines set status = 'unmatched', matched_invoice_id = null, matched_by = null, matched_at = null where description = '${stmt}'`);
    await devSql(`delete from public.bank_statement_lines where description = '${stmt}'`);
    await devSql(`delete from public.bank_statement_imports where filename = 'extrato cartão E2E ${runId}'`);
    await devSql(`with c as (select id from public.corporate_cards where nickname = '${nick}'), p as (select payable_id from public.card_purchases where card_id in (select id from c))
      delete from public.card_purchases where card_id in (select id from c)`);
    await devSql(`delete from public.card_invoices where card_id in (select id from public.corporate_cards where nickname = '${nick}')`);
    await devSql(`delete from public.payables where description in ('${desc1}', '${desc2}')`);
    await devSql(`delete from public.corporate_cards where nickname = '${nick}'`);
    await devSql(`delete from public.financial_accounts where name = 'Conta cartão E2E ${runId}'`);
  };

  test("fixtures: conta financeira de teste na unidade de São Paulo", async () => {
    test.skip(!process.env.SUPABASE_ACCESS_TOKEN, "precisa de SUPABASE_ACCESS_TOKEN para preparar fixtures");
    const u = (await devSql(`select id, org_id from public.units where slug = 'sao-paulo'`)) as { id: string; org_id: string }[]; unitId = u[0].id;
    const a = (await devSql(`insert into public.financial_accounts (org_id, unit_id, name, kind) values ('${u[0].org_id}', '${unitId}', 'Conta cartão E2E ${runId}', 'bank') returning id`)) as { id: string }[]; accId = a[0].id;
    expect(unitId && accId).toBeTruthy();
  });

  test("cadastrar cartão: representação visual segura (sem número completo), KPIs reais e nada de CVV", async ({ page, context }) => {
    await loginAs(context, QA.manager); const errors = collectErrors(page);
    await page.goto("/admin/financeiro/cartoes");
    await expect(page.getByRole("heading", { name: "Cartões", exact: true })).toBeVisible({ timeout: 40_000 });
    await page.getByRole("button", { name: "Novo cartão" }).first().click();
    const dlg = page.getByRole("dialog");
    await expect(dlg.getByText(/nunca|Não informe o número completo/i).first()).toBeVisible();
    await expect(dlg.getByLabel(/cvv|código de segurança|número do cartão/i)).toHaveCount(0);                 // a tela nem pede
    await dlg.locator("#cc-unit").selectOption(unitId); await dlg.locator("#cc-nick").fill(nick); await dlg.locator("#cc-issuer").fill("Banco E2E");
    await dlg.locator("#cc-brand").selectOption("mastercard"); await dlg.locator("#cc-limit").fill("5000,00"); await dlg.locator("#cc-last4").fill("4242");
    await dlg.locator("#cc-close").fill("10"); await dlg.locator("#cc-due").fill("20"); await dlg.locator("#cc-acc").selectOption(accId);
    await dlg.getByRole("button", { name: "Cadastrar cartão" }).click();
    await expect(page.getByText("Cartão cadastrado.")).toBeVisible({ timeout: 20_000 });
    const visual = page.getByRole("button", { name: `Cartão ${nick}` }); await expect(visual).toBeVisible();
    await expect(visual).toContainText("•••• •••• •••• 4242"); await expect(visual).toContainText("Banco E2E"); await expect(visual).toContainText("Fecha dia 10"); await expect(visual).toContainText("Vence dia 20");
    await expect(visual).toContainText("Disponível"); await expect(visual).toContainText(/Limite R\$\s*5\.000,00/);
    expect(await visual.innerText()).not.toMatch(/\d{4}[ -]\d{4}[ -]\d{4}[ -]\d{4}/);                           // nenhum número completo
    cardId = ((await devSql(`select id from public.corporate_cards where nickname = '${nick}'`)) as { id: string }[])[0].id;
    // o banco só tem os campos seguros
    const cols = (await devSql(`select column_name from information_schema.columns where table_name = 'corporate_cards'`)) as { column_name: string }[];
    expect(cols.map((c) => c.column_name).filter((c) => /cvv|number|numero|pan|senha|pin/i.test(c))).toEqual([]);
    expect(errors, errors.join("\n")).toEqual([]);
  });

  test("compras: uma despesa por compra (fatura antiga e atual), categoria e linha; bloquear impede compra; limite é respeitado", async ({ page, context }) => {
    await loginAs(context, QA.manager);
    await page.goto("/admin/financeiro/cartoes"); await page.getByRole("button", { name: `Cartão ${nick}` }).click();
    const old = new Date(Date.now() - 45 * 864e5).toLocaleDateString("sv-SE", { timeZone: "America/Sao_Paulo" });
    const buy = async (date: string, amount: string, description: string, line = "physio") => {
      await page.getByRole("button", { name: "Registrar compra" }).first().click(); const dlg = page.getByRole("dialog");
      await dlg.locator("#cp-date").fill(date); await dlg.locator("#cp-amount").fill(amount); await dlg.locator("#cp-desc").fill(description); await dlg.locator("#cp-merchant").fill("Loja E2E");
      await dlg.locator("#cp-line").selectOption(line);
      await dlg.getByRole("button", { name: "Registrar compra" }).click();
    };
    await buy(old, "123,45", desc1); await expect(page.getByText("Compra registrada.")).toBeVisible({ timeout: 20_000 });
    await expect(page.getByRole("row").filter({ hasText: desc1 })).toContainText("R$ 123,45");
    await buy(new Date().toLocaleDateString("sv-SE", { timeZone: "America/Sao_Paulo" }), "50,00", desc2, "academy"); await expect(page.getByText("Compra registrada.").first()).toBeVisible({ timeout: 20_000 });
    await expect(page.getByRole("row").filter({ hasText: desc2 })).toContainText("HP Academy");
    // cada compra = UMA despesa (payables) — e nenhuma duplicata
    const rows = (await devSql(`select count(*)::int n, sum(amount_cents)::int total, bool_and(status = 'open') open_all from public.payables where description in ('${desc1}', '${desc2}')`)) as { n: number; total: number; open_all: boolean }[];
    expect(rows[0]).toEqual({ n: 2, total: 12345 + 5000, open_all: true });
    const lines = (await devSql(`select business_line from public.payables where description in ('${desc1}', '${desc2}') order by description`)) as { business_line: string }[];
    expect(lines.map((l) => l.business_line).sort()).toEqual(["academy", "physio"]);
    // a compra aparece UMA vez em Contas a pagar e é paga pela fatura
    await page.goto("/admin/financeiro/pagar");
    const prow = page.getByRole("row").filter({ hasText: desc1 }); await expect(prow).toHaveCount(1, { timeout: 30_000 });
    await expect(prow).toContainText("Cartão"); await expect(prow.getByRole("link", { name: "Pagar pela fatura" })).toBeVisible(); await expect(prow.getByRole("button", { name: "Marcar como paga" })).toHaveCount(0);
    // bloqueio
    await page.goto("/admin/financeiro/cartoes"); await page.getByRole("button", { name: `Cartão ${nick}` }).click();
    await page.getByRole("button", { name: "Bloquear" }).click(); await page.getByRole("dialog").locator("#ask-input").fill("Teste E2E de bloqueio"); await page.getByRole("dialog").getByRole("button", { name: "Bloquear" }).click();
    await expect(page.getByText(/Cartão bloqueado/)).toBeVisible({ timeout: 20_000 });
    await expect(page.getByRole("button", { name: "Registrar compra" }).first()).toBeDisabled();
    const s = await signIn(QA.manager);
    const blocked = await api(s).rpc("card_purchase_create", { p_card: cardId, p_date: new Date().toISOString().slice(0, 10), p_amount_cents: 100, p_description: `bloqueado ${runId}` });
    expect(blocked.status).not.toBe(200); expect(JSON.stringify(blocked.body)).toMatch(/bloqueado/);
    await page.getByRole("button", { name: "Desbloquear" }).click(); await page.getByRole("dialog").getByRole("button", { name: "Desbloquear" }).click();
    await expect(page.getByText("Cartão desbloqueado.")).toBeVisible({ timeout: 20_000 });
    const over = await api(s).rpc("card_purchase_create", { p_card: cardId, p_date: new Date().toISOString().slice(0, 10), p_amount_cents: 99_000_000, p_description: `acima do limite ${runId}` });
    expect(over.status).not.toBe(200); expect(JSON.stringify(over.body)).toMatch(/limite insuficiente/);
  });

  test("fatura: pagar paga as despesas do ciclo e a conciliação liga a linha agregada do extrato SEM criar despesa nem alterar o extrato", async ({ page, context }) => {
    await loginAs(context, QA.manager); const errors = collectErrors(page);
    await page.goto("/admin/financeiro/cartoes"); await page.getByRole("button", { name: `Cartão ${nick}` }).click();
    await page.getByRole("tab", { name: "Faturas" }).click();
    await expect(page.getByText(/Fechada — a pagar/)).toBeVisible({ timeout: 30_000 }); await expect(page.getByText(/Aberta/).first()).toBeVisible();
    await page.getByRole("button", { name: "Registrar pagamento" }).first().click();
    const dlg = page.getByRole("dialog"); await expect(dlg.getByText(/R\$\s*123,45/)).toBeVisible();
    await dlg.locator("#pi-acc").selectOption(accId); await dlg.getByRole("button", { name: "Confirmar pagamento" }).click();
    await expect(page.getByText("Fatura paga: as despesas do ciclo foram baixadas.")).toBeVisible({ timeout: 20_000 });
    const st = (await devSql(`select description, status, financial_account_id from public.payables where description in ('${desc1}', '${desc2}') order by description`)) as { description: string; status: string; financial_account_id: string | null }[];
    expect(st.find((x) => x.description === desc1)).toMatchObject({ status: "paid", financial_account_id: accId }); expect(st.find((x) => x.description === desc2)?.status).toBe("open");
    // extrato com a linha agregada do banco
    const imp = (await devSql(`insert into public.bank_statement_imports (org_id, unit_id, account_id, filename, row_count) select org_id, unit_id, id, 'extrato cartão E2E ${runId}', 1 from public.financial_accounts where id = '${accId}' returning id`)) as { id: string }[];
    await devSql(`insert into public.bank_statement_lines (org_id, unit_id, import_id, txn_date, description, amount_cents, external_ref) select org_id, unit_id, '${imp[0].id}', current_date, '${stmt}', -12345, 'E2E' from public.financial_accounts where id = '${accId}'`);
    const before = (await devSql(`select count(*)::int n, sum(amount_cents)::int t from public.payables where unit_id = '${unitId}'`)) as { n: number; t: number }[];
    const lineBefore = JSON.stringify(await devSql(`select txn_date, description, amount_cents, external_ref from public.bank_statement_lines where description = '${stmt}'`));
    await page.goto("/admin/financeiro/conciliacao");
    const li = page.getByRole("listitem").filter({ hasText: stmt }); await expect(li).toBeVisible({ timeout: 40_000 });
    await li.getByRole("button", { name: "Conciliar" }).click();
    await expect(li.getByText(/Fatura do cartão/)).toBeVisible({ timeout: 20_000 });
    await li.getByRole("button", { name: "Confirmar" }).click();
    await expect(page.getByText("Conciliado.")).toBeVisible({ timeout: 20_000 });
    const m = (await devSql(`select status, matched_invoice_id is not null inv, matched_payable_id is null pay, matched_payment_id is null pmt from public.bank_statement_lines where description = '${stmt}'`)) as { status: string; inv: boolean; pay: boolean; pmt: boolean }[];
    expect(m[0]).toEqual({ status: "matched", inv: true, pay: true, pmt: true });
    const after = (await devSql(`select count(*)::int n, sum(amount_cents)::int t from public.payables where unit_id = '${unitId}'`)) as { n: number; t: number }[];
    expect(after[0], "a conciliação não cria nem altera despesa").toEqual(before[0]);
    expect(JSON.stringify(await devSql(`select txn_date, description, amount_cents, external_ref from public.bank_statement_lines where description = '${stmt}'`)), "o extrato original não muda").toBe(lineBefore);
    // a fatura mostra a ligação
    await page.goto("/admin/financeiro/cartoes"); await page.getByRole("button", { name: `Cartão ${nick}` }).click(); await page.getByRole("tab", { name: "Faturas" }).click();
    await expect(page.getByText(/Conciliada com o extrato/)).toBeVisible({ timeout: 30_000 });
    expect(errors, errors.join("\n")).toEqual([]);
  });

  test("permissões: comercial e fisioterapeuta não cadastram cartão nem leem a lista (backend)", async () => {
    for (const email of [QA.comercial, QA.fisio]) {
      const s = await signIn(email); const a = api(s);
      const r = await a.rpc("card_create", { p_unit: unitId, p_nickname: `Intruso ${runId}`, p_issuer: "Banco", p_brand: "visa", p_limit_cents: 1000, p_closing_day: 5, p_due_day: 10 });
      expect(r.status, email).not.toBe(200);
      const l = await a.rpc("card_summary", { p_unit: null }); expect(l.body, email).toEqual([]);
    }
  });

  test("celular: Cartões cabe na tela (cartão visual, abas e tabela sem rolagem lateral)", async ({ page, context }) => {
    await page.setViewportSize({ width: 390, height: 844 });
    await loginAs(context, QA.manager);
    await page.goto("/admin/financeiro/cartoes"); await expect(page.getByRole("button", { name: `Cartão ${nick}` })).toBeVisible({ timeout: 40_000 });
    await page.getByRole("button", { name: `Cartão ${nick}` }).click(); await page.waitForTimeout(800); await noHScroll(page, "cartões (compras)");
    await page.getByRole("tab", { name: "Faturas" }).click(); await page.waitForTimeout(500); await noHScroll(page, "cartões (faturas)");
  });

  test("limpeza: cartão, faturas, compras, despesas, extrato e conta de teste removidos", async () => {
    test.skip(!process.env.SUPABASE_ACCESS_TOKEN, "precisa de SUPABASE_ACCESS_TOKEN");
    await clean();
    const n = (await devSql(`select (select count(*) from public.corporate_cards where nickname = '${nick}')::int c, (select count(*) from public.payables where description in ('${desc1}', '${desc2}'))::int p`)) as { c: number; p: number }[];
    expect(n[0]).toEqual({ c: 0, p: 0 });
  });
});

test.describe("@release Calendário (Meu dia): navegação por mês, Hoje, Dia/Semana/Mês, categorias e Google Calendar", () => {
  test.setTimeout(120_000);
  test("barra do calendário, título do mês, categorias filtráveis e grade mensal legível", async ({ page, context }) => {
    await loginAs(context, QA.fisio); const errors = collectErrors(page);
    await page.goto("/admin/meu-dia");
    const views = page.getByRole("group", { name: "Visualização" });
    await expect(views.getByRole("button", { name: "Mês" })).toBeVisible({ timeout: 40_000 });
    await views.getByRole("button", { name: "Mês" }).click();
    const grid = page.getByRole("grid", { name: "Mês" }); await expect(grid).toBeVisible();
    const title = page.getByRole("toolbar", { name: "Navegação do calendário" }).locator("[aria-live=polite]");
    const monthName = new Date().toLocaleDateString("pt-BR", { month: "long", year: "numeric" });
    await expect(title).toHaveText(new RegExp(monthName.split(" ")[0], "i"));
    await page.getByRole("button", { name: "Próximo" }).click(); await expect(title).not.toHaveText(new RegExp(monthName.split(" ")[0] + ".*" + new Date().getFullYear(), "i"));
    await page.getByRole("button", { name: "Hoje" }).click(); await expect(title).toHaveText(new RegExp(monthName.split(" ")[0], "i"));
    expect(await grid.getByRole("button").count()).toBeGreaterThanOrEqual(35);
    await expect(page.locator(".hp-cal-cell.is-today")).toHaveCount(1);                                      // hoje destacado
    // categorias de evento: ligar/desligar (ao menos uma fica sempre ligada)
    const kinds = page.getByRole("group", { name: "Categorias de evento" });
    for (const k of ["Atendimentos", "Tarefas de CRM", "Tarefas pessoais", "Google Calendar"]) await expect(kinds.getByRole("button", { name: k })).toHaveAttribute("aria-pressed", "true");
    await kinds.getByRole("button", { name: "Google Calendar" }).click(); await expect(kinds.getByRole("button", { name: "Google Calendar" })).toHaveAttribute("aria-pressed", "false");
    await kinds.getByRole("button", { name: "Google Calendar" }).click();
    // somente Google Calendar: nada de iPhone/Apple/.ics
    await expect(page.getByText(/iPhone|Apple|webcal|\.ics|assinatura de calend/i)).toHaveCount(0);
    await expect(page.getByRole("region", { name: "Google Calendar" })).toBeVisible();
    await expectNoFatal(page); expect(errors, errors.join("\n")).toEqual([]);
  });

  test("celular: calendário mensal sem rolagem lateral e com navegação completa", async ({ page, context }) => {
    await page.setViewportSize({ width: 390, height: 844 });
    await loginAs(context, QA.fisio);
    await page.goto("/admin/meu-dia");
    await page.getByRole("group", { name: "Visualização" }).getByRole("button", { name: "Mês" }).click();
    await expect(page.getByRole("grid", { name: "Mês" })).toBeVisible({ timeout: 40_000 }); await page.waitForTimeout(800);
    await noHScroll(page, "calendário mensal");
    for (const n of ["Anterior", "Hoje", "Próximo"]) await expect(page.getByRole("button", { name: n })).toBeVisible();
  });
});
