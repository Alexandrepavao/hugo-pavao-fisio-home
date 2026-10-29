// ACEITE — Finanças pessoais dentro do Financeiro (migrations 092–095), no navegador e pela API.
//  · só o proprietário autorizado vê a entrada na sidebar e abre as telas; gestor, financeiro e comercial NÃO (nem pela API)
//  · jornada completa: contas e cartão → receita, despesa recorrente, parcelado no cartão → pagar/receber → indicadores que abrem os lançamentos → calendário → orçamento e custo de vida → reserva e metas → importação sem duplicar
// Dados próprios (runId); o usuário-dono de teste é criado e apagado pelo próprio spec (as tabelas pessoais caem em cascata).
import { expect, test, type Page } from "@playwright/test";
import { api, collectErrors, createConfirmedUser, deleteAuthUser, devSql, expectNoFatal, loginAs, QA, runId, signIn, signInWith } from "./helpers-release";
import { useSession } from "../helpers";

test.use({ timezoneId: "America/Sao_Paulo", locale: "pt-BR" });
const PW = process.env.HP_QA_PASSWORD ?? "";
const email = `qa.pf.${runId.toLowerCase()}@hp-test.dev`;
const ymd = (d: Date) => new Intl.DateTimeFormat("sv-SE", { timeZone: "America/Sao_Paulo" }).format(d);
const today = ymd(new Date()); const cur = `${today.slice(0, 8)}01`; const eom = ymd(new Date(Date.UTC(Number(today.slice(0, 4)), Number(today.slice(5, 7)), 0, 12)));
const shot = (name: string) => `${process.env.TEMP}\\pf-${name}.png`;

let uid = ""; let tok: Awaited<ReturnType<typeof signInWith>>;
const own = () => api(tok);
const login = async (page: Page) => { await useSession(page.context(), tok); };

test.describe.serial("@release Finanças pessoais", () => {
  test.setTimeout(240_000);

  test("preparação: proprietário de teste com acesso individual e recurso ligado na organização", async () => {
    uid = await createConfirmedUser(email, PW);
    await devSql(`insert into public.user_accounts (user_id, org_id, display_name) select '${uid}', id, 'Dono PF QA' from public.organizations where slug = 'hp-group' on conflict do nothing;
      insert into public.role_assignments (org_id, user_id, role) select id, '${uid}', 'manager' from public.organizations where slug = 'hp-group';
      update public.organizations set features = features || '{"personal_finance": true}'::jsonb where slug = 'hp-group';
      insert into public.pf_access (org_id, user_id) select id, '${uid}' from public.organizations where slug = 'hp-group' on conflict do nothing;`);
    tok = await signInWith(email, PW);
    expect((await own().rpc("pf_my_access")).body).toMatchObject({ enabled: true });
  });

  test("acesso: só o proprietário vê a entrada e abre as telas; gestor/financeiro/comercial e anônimo não (inclusive pela API)", async ({ page, context }) => {
    // proprietário
    await login(page); const errors = collectErrors(page);
    await page.goto("/admin/financeiro"); await expect(page.getByRole("link", { name: "Finanças pessoais", exact: true })).toBeVisible({ timeout: 40_000 });
    await page.screenshot({ path: shot("sidebar") });
    await page.getByRole("link", { name: "Finanças pessoais", exact: true }).click();
    await expect(page.getByRole("heading", { name: "Visão geral" })).toBeVisible(); await expect(page.getByTestId("pf-subnav")).toContainText("Privado");
    for (const s of ["Receitas e despesas", "Contas e cartões", "Calendário financeiro", "Orçamento e custo de vida", "Reserva e metas", "Importação e conciliação", "Configurações pessoais"]) await expect(page.getByTestId("pf-subnav").getByRole("link", { name: s })).toBeVisible();
    await expectNoFatal(page); expect(errors, errors.join("\n")).toEqual([]);
    // gestor, financeiro e comercial sem autorização
    for (const who of [QA.manager, QA.financeiro, QA.comercial]) {
      const ctx = await page.context().browser()!.newContext(); const p = await ctx.newPage(); await loginAs(ctx, who);
      await p.goto("/admin/financeiro/pessoal"); await expect(p.getByRole("heading", { name: "Sem permissão" })).toBeVisible({ timeout: 30_000 });
      await p.goto("/admin/financeiro"); await expect(p.getByRole("heading", { name: "Visão geral" }).first()).toBeVisible({ timeout: 30_000 });
      await expect(p.getByRole("link", { name: "Finanças pessoais", exact: true })).toHaveCount(0);
      const g = api(await signIn(who));
      expect((await g.rpc("pf_overview", { p_from: cur, p_to: eom })).status, `${who}: pf_overview recusado`).toBeGreaterThanOrEqual(400);
      expect((await g.rpc("pf_agenda", { p_from: cur, p_to: eom })).status).toBeGreaterThanOrEqual(400);
      expect((await g.rpc("pf_business_withdrawals")).status).toBeGreaterThanOrEqual(400);
      for (const t of ["pf_entries", "pf_accounts", "pf_cards", "pf_settlements", "pf_series", "pf_budgets", "pf_goals", "pf_business_links", "pf_imports"]) expect((await g.get(`${t}?select=id`)).body, `${who} não lê ${t}`).toEqual([]);
      expect((await g.rpc("pf_my_access")).body).toMatchObject({ enabled: false });
      await ctx.close();
    }
    const anon = api(null);
    expect((await anon.rpc("pf_my_access")).status).toBeGreaterThanOrEqual(400); expect((await anon.get("pf_entries?select=id")).status).toBeGreaterThanOrEqual(400);
  });

  test("contas e cartão pelo navegador; receita, recorrência e parcelado criados e conferidos na lista", async ({ page }) => {
    await login(page); const errors = collectErrors(page);
    await page.goto("/admin/financeiro/pessoal"); await expect(page.getByTestId("pf-comece")).toBeVisible({ timeout: 40_000 });
    await page.getByRole("link", { name: "contas e cartões", exact: true }).first().click();
    await page.getByRole("button", { name: "Nova conta" }).click(); const dlg = page.getByTestId("pf-conta-dialog");
    await dlg.getByLabel("Nome", { exact: true }).fill("Conta QA"); await dlg.getByLabel("Data do saldo inicial").fill("2026-01-01"); await dlg.getByLabel("Saldo inicial", { exact: true }).fill("1.000,00");
    await dlg.getByRole("button", { name: "Salvar conta" }).click(); await expect(page.getByTestId("pf-conta").filter({ hasText: "Conta QA" })).toContainText("R$ 1.000,00", { timeout: 20_000 });
    await page.getByRole("button", { name: "Nova conta" }).click(); const d2 = page.getByTestId("pf-conta-dialog");
    await d2.getByLabel("Nome", { exact: true }).fill("Reserva QA"); await d2.getByLabel("Tipo").selectOption("savings"); await d2.getByLabel("Data do saldo inicial").fill("2026-01-01"); await d2.getByLabel("Esta conta compõe a reserva de emergência").check();
    await d2.getByRole("button", { name: "Salvar conta" }).click(); await expect(page.getByTestId("pf-conta").filter({ hasText: "Reserva QA" })).toContainText("Compõe a reserva", { timeout: 20_000 });
    await page.getByRole("tab", { name: "Cartões e faturas" }).click(); await page.getByRole("button", { name: "Novo cartão" }).click(); const cd = page.getByTestId("pf-cartao-dialog");
    await cd.getByLabel("Apelido").fill("Cartão QA"); await cd.getByLabel("Emissor").fill("Banco QA"); await cd.getByLabel("Limite").fill("5.000,00"); await cd.getByLabel("Dia de fechamento (1–28)").fill("28"); await cd.getByLabel("Dia de vencimento (1–28)").fill("5");
    await cd.getByRole("button", { name: "Salvar cartão" }).click(); await expect(page.getByTestId("pf-cartao")).toContainText("Cartão QA", { timeout: 20_000 });
    await expect(page.getByTestId("pf-cartao-resumo")).toContainText("R$ 5.000,00"); await page.screenshot({ path: shot("cartoes") });

    // lançamentos pela tela: salário (avulso), aluguel (recorrente fixo, 6 ocorrências) e TV (parcelado no cartão)
    await page.goto("/admin/financeiro/pessoal/lancamentos"); await page.getByRole("button", { name: "Novo lançamento" }).first().click(); let e = page.getByTestId("pf-entry-dialog");
    await e.getByRole("radio", { name: "Receita" }).click(); await e.getByLabel("Descrição").fill("Salário QA"); await e.getByLabel("Valor", { exact: true }).fill("8.000,00"); await e.getByLabel("Vencimento").fill(cur);
    await e.getByRole("button", { name: "Salvar lançamento" }).click(); await expect(page.getByTestId("pf-linha").filter({ hasText: "Salário QA" })).toBeVisible({ timeout: 20_000 });
    await page.getByRole("button", { name: "Novo lançamento" }).first().click(); e = page.getByTestId("pf-entry-dialog");
    await e.getByLabel("Descrição").fill("Aluguel QA"); await e.getByLabel("Valor", { exact: true }).fill("2.500,00"); await e.getByRole("radio", { name: "Recorrente" }).click();
    await e.getByLabel("Data inicial").fill(cur); await e.getByLabel("Dia do vencimento").fill("1"); await e.getByLabel("Término").selectOption("count"); await e.getByLabel("Número de ocorrências").fill("6");
    await e.getByRole("button", { name: "Salvar lançamento" }).click(); await expect(page.getByTestId("pf-linha").filter({ hasText: "Aluguel QA" })).toBeVisible({ timeout: 20_000 });
    await page.getByRole("button", { name: "Novo lançamento" }).first().click(); e = page.getByTestId("pf-entry-dialog");
    await e.getByLabel("Descrição").fill("TV QA"); await e.getByRole("radio", { name: "Parcelado" }).click(); await e.getByLabel("Valor total da compra").fill("300,00"); await e.getByLabel("Paga com").selectOption("card"); await e.getByLabel("Cartão", { exact: true }).selectOption({ label: "Cartão QA" });
    await e.getByLabel("Quantidade de parcelas").fill("3"); await e.getByLabel("Data da compra (1ª parcela)").fill(cur);
    await e.getByRole("button", { name: "Salvar lançamento" }).click(); await expect(page.getByTestId("pf-linha").filter({ hasText: "TV QA" })).toContainText("Parcela 1/3", { timeout: 20_000 });
    await page.screenshot({ path: shot("lancamentos") });
    // recorrência aparece com as 6 ocorrências calculadas (nada gravado além da regra) e some depois da sexta
    const series = (await own().get("pf_series?select=id,end_count,description&description=eq.Aluguel%20QA")).body as { id: string; end_count: number }[]; expect(series).toHaveLength(1); expect(series[0].end_count).toBe(6);
    expect(((await own().get(`pf_entries?select=id&series_id=eq.${series[0].id}`)).body as unknown[]).length, "nenhuma ocorrência gravada antes de tocar nela").toBe(0);
    await page.getByRole("tab", { name: "Recorrências" }).click(); const row = page.getByTestId("pf-serie").filter({ hasText: "Aluguel QA" }); await expect(row).toContainText(today > cur ? "5 restante(s)" : "6 restante(s)"); await expect(row).toContainText("Ativa");   // a 1ª ocorrência (dia 1) já passou quando hoje é depois do dia 1
    await expectNoFatal(page); expect(errors, errors.join("\n")).toEqual([]);
  });

  test("pagar e receber: salário recebido, energia variável com valor real, e os indicadores do mês batem com o detalhamento", async ({ page }) => {
    await login(page); const errors = collectErrors(page); const o = own();
    const acc = ((await o.get("pf_accounts?select=id&name=eq.Conta%20QA")).body as { id: string }[])[0].id;
    const catH = ((await o.get("pf_categories?select=id&name=eq.Energia%20e%20%C3%A1gua")).body as { id: string }[])[0].id;
    expect((await o.rpc("pf_entry_create", { p: { kind: "expense", description: "Energia QA", amount_cents: 30000, category_id: catH, account_id: acc, nature: "variable", repetition: "recurring", recurrence: { frequency: "monthly", start_date: cur, due_day: 1 } } })).status).toBe(200);
    expect((await o.rpc("pf_entry_create", { p: { kind: "expense", description: "Dentista QA", amount_cents: 50000, account_id: acc, due_date: eom } })).status).toBe(200);
    // salário: Receber pela lista
    await page.goto("/admin/financeiro/pessoal/lancamentos"); const sal = page.getByTestId("pf-linha").filter({ hasText: "Salário QA" });
    await sal.getByRole("button", { name: "Receber" }).click(); let d = page.getByTestId("pf-settle-dialog"); await expect(d.getByLabel("Valor recebido")).toHaveValue("8000,00"); await d.getByLabel("Conta", { exact: true }).selectOption({ label: "Conta QA" }); await d.getByRole("button", { name: "Confirmar recebimento" }).click();
    await expect(sal).toContainText("Recebido", { timeout: 20_000 });
    // energia: valor real substitui a previsão
    await page.getByRole("button", { name: "Energia QA" }).first().click(); const sheet = page.getByTestId("pf-item-sheet"); await expect(sheet).toContainText("Ocorrência calculada"); await sheet.getByRole("button", { name: "Pagar" }).click();
    d = page.getByTestId("pf-settle-dialog"); await expect(d.getByLabel(/Este é o valor real/)).toBeChecked(); await d.getByLabel("Valor pago").fill("310,00"); await d.getByLabel("Conta", { exact: true }).selectOption({ label: "Conta QA" }); await d.getByRole("button", { name: "Confirmar pagamento" }).click();
    await expect(page.getByTestId("pf-item-sheet")).toContainText("Previsão original", { timeout: 20_000 }).catch(() => undefined); await page.keyboard.press("Escape");
    const en = (await o.get("pf_entries?select=amount_cents,estimated_cents,status,is_estimate&description=eq.Energia%20QA")).body as { amount_cents: number; estimated_cents: number; status: string; is_estimate: boolean }[];
    expect(en[0]).toMatchObject({ amount_cents: 31000, estimated_cents: 30000, status: "settled", is_estimate: false });
    // aluguel do mês: pagar 2.500,00 (ocorrência calculada vira lançamento liquidado)
    const al = page.getByTestId("pf-linha").filter({ hasText: "Aluguel QA" }).first(); await al.getByRole("button", { name: "Pagar" }).click(); d = page.getByTestId("pf-settle-dialog"); await d.getByLabel("Conta", { exact: true }).selectOption({ label: "Conta QA" }); await d.getByRole("button", { name: "Confirmar pagamento" }).click();
    await expect(al).toContainText("Pago", { timeout: 20_000 });
    // visão geral: valores conferidos e detalhamento com o mesmo total
    await page.goto("/admin/financeiro/pessoal"); await expect(page.getByTestId("pf-comece")).toHaveCount(0, { timeout: 20_000 });
    const card = (name: string) => page.getByRole("button", { name: new RegExp(`^${name}`) });
    await expect(card("Receitas recebidas")).toContainText("R$ 8.000,00", { timeout: 30_000 });
    await expect(card("Despesas realizadas")).toContainText("R$ 2.910,00");       // aluguel 2.500 + energia 310 + 1ª parcela da TV no cartão 100
    await page.screenshot({ path: shot("visao-geral") });
    await expectNoFatal(page); expect(errors, errors.join("\n")).toEqual([]);
  });

  test("indicador abre os lançamentos (mesmo total) e o calendário mostra, reagenda e preserva a data original", async ({ page }) => {
    await login(page); const errors = collectErrors(page);
    await page.goto("/admin/financeiro/pessoal"); const card = page.getByRole("button", { name: /^Despesas realizadas/ }); await expect(card).toContainText("R$ 2.910,00", { timeout: 30_000 });
    await card.click(); const ks = page.getByTestId("pf-kpi-sheet"); await expect(ks.getByTestId("pf-kpi-total")).toHaveText("R$ 2.910,00"); await expect(ks).toContainText("Aluguel QA"); await expect(ks).toContainText("Energia QA"); await expect(ks).toContainText("TV QA");
    await ks.getByRole("button", { name: "Abrir lançamento" }).first().click(); await expect(page.getByTestId("pf-item-sheet")).toBeVisible(); await page.keyboard.press("Escape"); await expect(page.getByTestId("pf-item-sheet")).toHaveCount(0); await page.keyboard.press("Escape"); await expect(page.getByTestId("pf-kpi-sheet")).toHaveCount(0);
    await page.getByRole("button", { name: /^Despesas previstas/ }).click(); await expect(page.getByTestId("pf-kpi-total")).toHaveText("R$ 500,00"); await expect(page.getByTestId("pf-kpi-sheet")).toContainText("Dentista QA"); await page.keyboard.press("Escape"); await expect(page.getByTestId("pf-kpi-sheet")).toHaveCount(0);
    // calendário
    await page.goto("/admin/financeiro/pessoal/calendario"); await expect(page.getByTestId("pf-cal-grade")).toBeVisible({ timeout: 30_000 });
    expect(await page.getByTestId("pf-cal-item").count()).toBeGreaterThanOrEqual(4);   // cada dia mostra até 3 itens e “+n mais”
    await expect(page.getByTestId("pf-cal-mes")).toContainText("Previsto no mês"); await expect(page.getByRole("list", { name: "Legenda" })).toContainText("Fatura");
    const ent = page.locator('[data-testid="pf-cal-item"][data-kind="income"]').first(); await expect(ent).toHaveAttribute("aria-label", /Entrada/);   // entrada identificada por texto, não só por cor
    await page.screenshot({ path: shot("calendario") });
    await page.getByTestId("pf-cal-grade").getByRole("button", { name: /Dentista QA/ }).first().click(); const sh = page.getByTestId("pf-item-sheet"); await expect(sh).toContainText("Dentista QA");
    await sh.getByRole("button", { name: "Reagendar" }).click(); const ed = page.getByTestId("pf-edit-dialog"); const novo = ymd(new Date(new Date(`${eom}T12:00:00Z`).getTime() - 864e5)); await ed.getByLabel(/Vencimento/).fill(novo); await ed.getByRole("button", { name: "Salvar alteração" }).click();
    await expect(page.getByTestId("pf-item-sheet")).toContainText("Vencimento original", { timeout: 20_000 }); await expect(page.getByTestId("pf-item-sheet")).toContainText("Reagendado");
    const dent = (await own().get("pf_entries?select=due_date,original_due_date&description=eq.Dentista%20QA")).body as { due_date: string; original_due_date: string }[]; expect(dent[0]).toMatchObject({ due_date: novo, original_due_date: eom });
    // visões semana e lista
    await page.keyboard.press("Escape"); await page.getByRole("tab", { name: "Lista" }).click(); await expect(page.getByTestId("pf-cal-lista")).toContainText("Salário QA"); await page.getByRole("tab", { name: "Semana" }).click(); await expect(page.getByTestId("pf-cal-semana")).toBeVisible();
    await expectNoFatal(page); expect(errors, errors.join("\n")).toEqual([]);
  });

  test("editar “esta e as próximas” divide a série sem tocar no liquidado", async ({ page }) => {
    await login(page); const errors = collectErrors(page);
    await page.goto("/admin/financeiro/pessoal/lancamentos?aba=recorrencias"); const row = page.getByTestId("pf-serie").filter({ hasText: "Aluguel QA" }); await expect(row).toBeVisible({ timeout: 30_000 });
    await row.getByRole("button", { name: "Abrir próxima" }).click(); await page.getByTestId("pf-item-sheet").getByRole("button", { name: "Editar" }).click(); const ed = page.getByTestId("pf-edit-dialog");
    await expect(ed.getByTestId("pf-scope").getByRole("radio")).toHaveCount(3); await ed.getByLabel("Esta e as próximas").check(); await ed.getByLabel("Valor", { exact: true }).fill("2.600,00"); await ed.getByRole("button", { name: "Salvar alteração" }).click();
    await expect(page.getByTestId("pf-edit-dialog")).toHaveCount(0, { timeout: 20_000 });
    const ser = (await own().get("pf_series?select=id,amount_cents,status,parent_series_id,start_date,ended_on&description=eq.Aluguel%20QA&order=start_date")).body as { id: string; amount_cents: number; status: string; parent_series_id: string | null; ended_on: string | null }[];
    expect(ser).toHaveLength(2); expect(ser[0]).toMatchObject({ amount_cents: 250000, status: "ended" }); expect(ser[1]).toMatchObject({ amount_cents: 260000, parent_series_id: ser[0].id });
    const pago = (await own().get(`pf_entries?select=amount_cents,status&series_root_id=eq.${ser[0].id}&status=eq.settled`)).body as { amount_cents: number }[]; expect(pago).toHaveLength(1); expect(pago[0].amount_cents).toBe(250000);   // o mês pago continua R$ 2.500,00
    await page.reload(); const novo = page.getByTestId("pf-serie").filter({ hasText: "Aluguel QA" }).filter({ hasText: "R$ 2.600,00" }); await expect(novo).toBeVisible(); await expect(novo.getByRole("button", { name: "Encerrar" })).toBeVisible();
    await expectNoFatal(page); expect(errors, errors.join("\n")).toEqual([]);
  });

  test("fatura do cartão: pagar liquida a obrigação sem criar despesa; o limite não é saldo", async ({ page }) => {
    await login(page); const errors = collectErrors(page);
    await page.goto("/admin/financeiro/pessoal/contas?aba=cartoes"); const resumo = page.getByTestId("pf-cartao-resumo"); await expect(resumo).toContainText("Utilizado", { timeout: 30_000 });
    await expect(resumo).toContainText("R$ 300,00");                                                    // 3 parcelas de R$ 100,00 nas faturas em aberto
    const fat = page.getByTestId("pf-fatura").first(); await expect(fat).toContainText("R$ 100,00"); await fat.getByRole("button", { name: "Pagar fatura" }).click();
    const d = page.getByTestId("pf-fatura-dialog"); await expect(d.getByLabel("Valor pago")).toHaveValue("100,00"); await d.getByLabel("Conta", { exact: true }).selectOption({ label: "Conta QA" }); await d.getByRole("button", { name: "Confirmar pagamento" }).click();
    await expect(page.getByTestId("pf-fatura").first()).toContainText("Paga", { timeout: 20_000 }); await expect(page.getByTestId("pf-cartao-resumo")).toContainText("R$ 4.800,00");   // disponível = 5.000 − 200 em aberto
    await page.getByRole("tab", { name: "Contas" }).click(); await expect(page.getByTestId("pf-saldo-total")).toHaveText(/R\$ 6\.090,00/);                              // 1.000 + 8.000 − 2.500 − 310 − 100 (fatura)
    await page.goto("/admin/financeiro/pessoal"); await expect(page.getByRole("button", { name: /^Despesas realizadas/ })).toContainText("R$ 2.910,00", { timeout: 30_000 });   // pagar a fatura não é despesa nova
    await expectNoFatal(page); expect(errors, errors.join("\n")).toEqual([]);
  });

  test("orçamento por categoria e custo de vida: as perguntas, 12 meses e fonte dos números", async ({ page }) => {
    await login(page); const errors = collectErrors(page);
    await page.goto("/admin/financeiro/pessoal/orcamento"); await expect(page.getByRole("heading", { name: "Orçamento e custo de vida", level: 2 })).toBeVisible({ timeout: 30_000 });
    for (const q of ["Quanto custa manter meu padrão de vida por mês?", "Quanto está comprometido nos próximos meses?", "Quanto já gastei e quanto ainda está previsto?", "Quanto preciso receber por mês para cobrir meu orçamento?"]) await expect(page.getByText(q)).toBeVisible();
    await expect(page.getByTestId("pf-custo-mes")).toHaveCount(12); await expect(page.getByText("De onde vêm os números")).toBeVisible();
    await page.screenshot({ path: shot("custo-de-vida") });
    await page.getByRole("radio", { name: "Ano-calendário" }).click(); await expect(page.getByTestId("pf-custo-mes")).toHaveCount(12, { timeout: 20_000 });
    await page.getByRole("tab", { name: "Orçamento por categoria" }).click(); await expect(page.getByTestId("pf-orc-linha").first()).toBeVisible({ timeout: 20_000 });
    await page.getByLabel("Orçamento de Moradia").fill("5.000,00"); await page.getByLabel("Orçamento de Moradia").blur(); await expect(page.getByText("Orçamento salvo.")).toBeVisible({ timeout: 20_000 });
    await page.goto("/admin/financeiro/pessoal"); await expect(page.getByRole("button", { name: /^Orçamento utilizado/ })).not.toContainText("Sem base", { timeout: 30_000 });
    await page.getByRole("button", { name: /^Orçamento utilizado/ }).click(); await expect(page).toHaveURL(/orcamento\?aba=orcamento/);
    await page.goto("/admin/financeiro/pessoal/orcamento?aba=planejar"); await expect(page.getByTestId("pf-plano")).toContainText("Renda de referência");
    await expectNoFatal(page); expect(errors, errors.join("\n")).toEqual([]);
  });

  test("reserva e metas: aporte na reserva não vira despesa; meta com progresso", async ({ page }) => {
    await login(page); const errors = collectErrors(page);
    await page.goto("/admin/financeiro/pessoal/contas"); await page.getByRole("button", { name: "Transferir / aportar" }).click(); const t = page.getByTestId("pf-transfer-dialog");
    await t.getByLabel("Tipo").selectOption("reserve"); await t.getByLabel("De", { exact: true }).selectOption({ label: "Conta QA" }); await t.getByLabel("Para", { exact: true }).selectOption({ label: "Reserva QA" }); await t.getByLabel("Valor", { exact: true }).fill("1.000,00"); await t.getByRole("button", { name: "Registrar" }).click();
    await expect(page.getByTestId("pf-transfer-dialog")).toHaveCount(0, { timeout: 20_000 });
    await page.goto("/admin/financeiro/pessoal/reserva"); await expect(page.getByTestId("pf-reserva-valor")).toHaveText("R$ 1.000,00", { timeout: 30_000 });
    await page.getByRole("button", { name: "Nova meta" }).click(); const g = page.getByTestId("pf-meta-dialog"); await g.getByLabel("Nome", { exact: true }).fill("Viagem QA"); await g.getByLabel("Valor-alvo").fill("10.000,00"); await g.getByLabel("Aporte mensal planejado").fill("500,00"); await g.getByRole("button", { name: "Salvar meta" }).click();
    const meta = page.getByTestId("pf-meta").filter({ hasText: "Viagem QA" }); await expect(meta).toContainText("0%", { timeout: 20_000 });
    await meta.getByRole("button", { name: "Aportar" }).click(); const a = page.getByTestId("pf-aporte-dialog"); await a.getByLabel("De", { exact: true }).selectOption({ label: "Conta QA" }); await a.getByLabel("Para", { exact: true }).selectOption({ label: "Reserva QA" }); await a.getByRole("button", { name: "Registrar aporte" }).click();
    await expect(meta).toContainText("5%", { timeout: 20_000 }); await page.screenshot({ path: shot("reserva") });
    await page.goto("/admin/financeiro/pessoal"); await expect(page.getByRole("button", { name: /^Despesas realizadas/ })).toContainText("R$ 2.910,00", { timeout: 30_000 });       // aportes não inflam despesas
    await expect(page.getByRole("button", { name: /^Reserva disponível/ })).toContainText("R$ 1.500,00");
    await expectNoFatal(page); expect(errors, errors.join("\n")).toEqual([]);
  });

  test("importação: prévia, decisões, confirmação e reimportação sem duplicar", async ({ page }) => {
    await login(page); const errors = collectErrors(page); const br = (iso: string) => `${iso.slice(8)}/${iso.slice(5, 7)}/${iso.slice(0, 4)}`;
    const csv = `Data;Descrição;Valor\n${br(today)};PIX DENTISTA;-500,00\n${br(today)};MERCADO QA;-87,45\n${br(today)};CAFE QA;-10,00\n${br(today)};LINHA RUIM;abc`;
    await page.goto("/admin/financeiro/pessoal/importacao"); await expect(page.getByRole("heading", { name: "Importação e conciliação", level: 2 })).toBeVisible({ timeout: 30_000 });
    await page.getByLabel("Conta pessoal do extrato").selectOption({ label: "Conta QA" }); await page.getByLabel(/cole o conteúdo do CSV/).fill(csv); await expect(page.getByTestId("pf-import-mapeamento")).toBeVisible();
    await page.getByRole("button", { name: /Gerar prévia/ }).click(); await expect(page.getByTestId("pf-import-contagem")).toContainText("nova(s)", { timeout: 20_000 });
    const linhas = page.getByTestId("pf-import-linha"); await expect(linhas).toHaveCount(4);
    await expect(linhas.filter({ hasText: "PIX DENTISTA" })).toContainText("Sugestão"); await expect(linhas.filter({ hasText: "LINHA RUIM" })).toHaveAttribute("data-status", "invalid");
    expect(((await own().get("pf_entries?select=id&description=eq.Mercado%20QA")).body as unknown[]).length, "a prévia não grava nada").toBe(0);
    await linhas.filter({ hasText: "MERCADO QA" }).getByLabel(/Ação da linha/).selectOption("create"); await linhas.filter({ hasText: "CAFE QA" }).getByLabel(/Ação da linha/).selectOption("ignore");
    await page.getByRole("button", { name: "Confirmar decisões" }).click(); await expect(page.getByTestId("pf-import-resultado")).toContainText("1 conciliada(s), 1 criada(s), 1 ignorada(s)", { timeout: 30_000 });
    const dent = (await own().get("pf_entries?select=status,settled_cents&description=eq.Dentista%20QA")).body as { status: string; settled_cents: number }[]; expect(dent).toHaveLength(1); expect(dent[0]).toMatchObject({ status: "settled", settled_cents: 50000 });   // conciliou: não criou despesa nova
    expect(((await own().get("pf_entries?select=id&description=eq.PIX%20DENTISTA")).body as unknown[]).length).toBe(0);
    // reimportação do MESMO arquivo
    await page.getByLabel("Conta pessoal do extrato").selectOption({ label: "Conta QA" }); await page.getByLabel(/cole o conteúdo do CSV/).fill(csv); await page.getByRole("button", { name: /Gerar prévia/ }).click();
    await expect(page.getByTestId("pf-import-contagem")).toContainText("já importada(s)", { timeout: 20_000 }); await expect(page.getByTestId("pf-import-linha").filter({ hasText: "PIX DENTISTA" })).toHaveAttribute("data-status", "duplicate"); await expect(page.getByTestId("pf-import-linha").filter({ hasText: "MERCADO QA" })).toHaveAttribute("data-status", "duplicate");
    expect(((await own().get("pf_entries?select=id&description=eq.MERCADO%20QA")).body as unknown[]).length).toBe(1);
    await page.screenshot({ path: shot("importacao") }); await page.getByRole("button", { name: "Cancelar importação" }).click();
    await expectNoFatal(page); expect(errors, errors.join("\n")).toEqual([]);
  });

  test("retirada paga na empresa vinculada à entrada pessoal; o lado empresarial não muda", async ({ page }) => {
    await login(page); const errors = collectErrors(page);
    await devSql(`insert into public.payables (org_id, unit_id, description, amount_cents, due_date, competence_month, status, paid_at) select o.id, u.id, 'Retirada pró-labore QA ${runId}', 120000, current_date, date_trunc('month', current_date)::date, 'paid', now() from public.organizations o join public.units u on u.org_id = o.id where o.slug = 'hp-group' order by u.created_at limit 1`);
    await page.goto("/admin/financeiro/pessoal/importacao?aba=retiradas"); const row = page.getByTestId("pf-retirada").filter({ hasText: `Retirada pró-labore QA ${runId}` }); await expect(row).toBeVisible({ timeout: 30_000 });
    await row.getByRole("button", { name: "Registrar entrada pessoal" }).click(); const d = page.getByTestId("pf-retirada-dialog"); await d.getByLabel("Conta que recebeu").selectOption({ label: "Conta QA" }); await d.getByRole("button", { name: "Criar entrada e vincular" }).click();
    await expect(row).toContainText("Vinculada", { timeout: 30_000 });
    const link = (await own().get("pf_business_links?select=status,entry_id")).body as { status: string; entry_id: string }[]; expect(link).toHaveLength(1); expect(link[0].status).toBe("linked");
    const ent = (await own().get(`pf_entries?select=amount_cents,status,kind&id=eq.${link[0].entry_id}`)).body as { amount_cents: number; status: string; kind: string }[]; expect(ent[0]).toMatchObject({ amount_cents: 120000, status: "settled", kind: "income" });
    const biz = (await devSql(`select status, description, amount_cents from public.payables where description like 'Retirada pró-labore QA ${runId}'`)) as { status: string; description: string; amount_cents: number }[]; expect(biz).toHaveLength(1); expect(biz[0]).toMatchObject({ status: "paid", amount_cents: 120000 });   // o empresarial continua igual
    // o gestor da empresa não enxerga o vínculo nem a entrada pessoal
    const g = api(await signIn(QA.manager)); expect((await g.get("pf_business_links?select=id")).body).toEqual([]);
    await expectNoFatal(page); expect(errors, errors.join("\n")).toEqual([]);
  });

  test("configurações pessoais e visual no celular (sem rolagem lateral)", async ({ page }) => {
    await login(page); const errors = collectErrors(page);
    await page.goto("/admin/financeiro/pessoal/configuracoes"); await expect(page.getByTestId("pf-config-form")).toBeVisible({ timeout: 30_000 });
    await page.getByLabel(/Lembrar vencimentos/).fill("7"); await page.getByRole("button", { name: "Salvar preferências" }).click(); await expect(page.getByText("Configurações salvas.")).toBeVisible({ timeout: 20_000 });
    expect(((await own().get("pf_settings?select=reminder_days_before")).body as { reminder_days_before: number }[])[0].reminder_days_before).toBe(7);
    await page.getByRole("button", { name: "Despesa", exact: true }).click(); const c = page.getByTestId("pf-categoria-dialog"); await c.getByLabel("Nome").fill("Pets QA"); await c.getByRole("button", { name: "Salvar" }).click(); await expect(page.getByText("Pets QA")).toBeVisible({ timeout: 20_000 });
    await page.setViewportSize({ width: 390, height: 844 });
    for (const rota of ["", "/lancamentos", "/contas", "/calendario", "/orcamento", "/reserva", "/importacao", "/configuracoes"]) {
      await page.goto(`/admin/financeiro/pessoal${rota}`); await expect(page.getByTestId("pf-subnav")).toBeVisible({ timeout: 30_000 }); await page.waitForTimeout(600);
      expect(await page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth + 1), `sem rolagem lateral em ${rota || "visão geral"}`).toBe(true);
    }
    await page.goto("/admin/financeiro/pessoal"); await page.waitForTimeout(800); await page.screenshot({ path: shot("celular"), fullPage: false });
    await expectNoFatal(page); expect(errors, errors.join("\n")).toEqual([]);
  });
});

test.afterAll(async () => { if (uid) await deleteAuthUser(uid).catch(() => undefined); await devSql(`delete from public.payables where description like 'Retirada pró-labore QA ${runId}'`).catch(() => undefined); });
