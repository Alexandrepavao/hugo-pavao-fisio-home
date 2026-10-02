// ACEITE da release v1 — HP ACADEMY: produto educacional ligado ao curso → oportunidade de educação → venda → recebimento → ACESSO conforme a regra do produto → aluno entra, assiste e progride →
// estorno/cancelamento revogam → reflexo financeiro na linha HP Academy e na visão Geral (sem tocar nas outras linhas). A administração do Academy (/admin/academy) é separada da área do aluno (/academy).
// REGRAS (já existentes, não alteradas): products.access_rule = 'on_first_payment' (qualquer recebimento libera) ou 'on_full_payment' (só a quitação libera); validade em products.validity_days;
// acesso é revogado quando o valor líquido recebido da venda chega a zero (estorno total) ou a venda é cancelada; estorno PARCIAL não revoga.
// Migration 079 (desta rodada): a etapa final da oportunidade de educação segue a mesma regra (antes avançava no 1º recebimento mesmo sem acesso liberado).
import { expect, test } from "@playwright/test";
import { api, collectErrors, createConfirmedUser, devSql, expectNoFatal, loginAs, QA, rest, runId, signIn, signInWith, spDate, uiLogin } from "./helpers-release";

test.use({ timezoneId: "America/Sao_Paulo", locale: "pt-BR" });

interface Line { key: string; receipts_cents: number; refunds_cents: number; sales_cents: number }
const sql = async <T,>(q: string) => (await devSql(q)) as T[];

test.describe.serial("@release Academy: venda → matrícula → acesso → financeiro", () => {
  test.setTimeout(240_000);
  const student = `Aluna R22 ${runId}`; const email = `aluna.r22.${runId.toLowerCase()}@hp-test.dev`; const pass = `R22-Senha-${runId}-Aa1!`;
  const courseA = `Curso Quitação R22 ${runId}`; const courseB = `Mentoria 1º Pagamento R22 ${runId}`; const slugA = `r22a-${runId}`; const slugB = `r22b-${runId}`;
  const S: Record<string, string> = {}; let userId = ""; let base: Record<string, Line> = {};
  const win = () => ({ p_from: new Date(Date.now() - 864e5).toISOString(), p_to: new Date(Date.now() + 864e5).toISOString(), p_unit: null });
  const lines = async () => { const r = await api(await signIn(QA.manager)).rpc("finance_by_line", win()); expect(r.status, JSON.stringify(r.body)).toBe(200); const b = r.body as { lines: Line[]; total: Line; reconciliation: { ok: boolean } }; return { map: Object.fromEntries(b.lines.map((l) => [l.key, l])) as Record<string, Line>, total: b.total, ok: b.reconciliation.ok }; };
  const stage = async () => (await sql<{ name: string; kind: string; status: string }>(`select st.name, st.kind, o.status from public.opportunities o join public.pipeline_stages st on st.id = o.stage_id where o.id = '${S.opp}'`))[0];
  const ents = async () => sql<{ course_id: string; source: string; source_ref: string; valid_until: string | null; revoked_at: string | null }>(`select course_id, source, source_ref, valid_until, revoked_at from public.entitlements where person_id = '${S.person}' order by created_at`);
  const clean = async () => {
    const pid = `select id from public.people where full_name = '${student}'`; const sales = `select id from public.sales where person_id in (${pid})`;
    await devSql(`set local session_replication_role = replica;
      delete from public.entitlements where person_id in (${pid});
      delete from public.lesson_progress where person_id in (${pid});
      delete from public.payments where receivable_id in (select id from public.receivables where sale_id in (${sales}));
      delete from public.commission_entries where sale_id in (${sales});
      delete from public.receivables where sale_id in (${sales});
      delete from public.contracts where sale_id in (${sales});
      delete from public.sale_items where sale_id in (${sales});
      delete from public.sales where id in (${sales});
      delete from public.interactions where person_id in (${pid});
      delete from public.crm_tasks where person_id in (${pid});
      delete from public.opportunities where person_id in (${pid});
      delete from public.invitations where email = '${email}';
      delete from auth.users where email = '${email}';
      delete from public.lessons where course_id in (select id from public.courses where slug in ('${slugA}', '${slugB}'));
      delete from public.courses where slug in ('${slugA}', '${slugB}');
      delete from public.products where name in ('${courseA}', '${courseB}');
      delete from public.person_contacts where person_id in (${pid});
      delete from public.person_kinds where person_id in (${pid});
      delete from public.people where full_name = '${student}';`).catch(() => null);
  };
  test.afterAll(async () => { if (process.env.SUPABASE_ACCESS_TOKEN) await clean(); });

  test("fixtures: dois produtos educacionais da linha Academy ligados a cursos publicados (um libera na quitação, outro no 1º recebimento), a aluna com conta e a oportunidade de educação", async () => {
    test.skip(!process.env.SUPABASE_ACCESS_TOKEN, "precisa de SUPABASE_ACCESS_TOKEN para preparar e limpar fixtures");
    await clean(); const mgr = await signIn(QA.manager); const g = api(mgr);
    S.org = (await g.get("organizations?select=id&slug=eq.hp-group")).body[0].id; S.unit = (await g.get("units?select=id&slug=eq.sao-paulo")).body[0].id;
    const mk = async (name: string, kind: string, price: number, rule: string, slug: string, validity: number | null) => {
      const pr = await rest(mgr, "POST", "products", { org_id: S.org, kind, name, price_cents: price, validity_days: validity, access_rule: rule, active: true }); expect(pr.status, JSON.stringify(pr.body)).toBe(201);
      expect((await g.rpc("product_set_line", { p_product: pr.body[0].id, p_line: "academy" })).status).toBeLessThan(300);
      const c = await rest(mgr, "POST", "courses", { org_id: S.org, kind: kind === "mentoring" ? "mentoring" : "course", title: name, slug, status: "published", product_id: pr.body[0].id, created_by: mgr.user.id }); expect(c.status, JSON.stringify(c.body)).toBe(201);
      for (const [i, t] of [`Aula 1 ${slug}`, `Aula 2 ${slug}`].entries()) expect((await rest(mgr, "POST", "lessons", { org_id: S.org, course_id: c.body[0].id, title: t, position: i + 1, kind: "text", body: `Conteúdo ${t}`, published: true })).status).toBe(201);
      return { product: pr.body[0].id as string, course: c.body[0].id as string };
    };
    const A = await mk(courseA, "course", 120000, "on_full_payment", slugA, 90); const B = await mk(courseB, "mentoring", 60000, "on_first_payment", slugB, null);
    S.prodA = A.product; S.courseA = A.course; S.prodB = B.product; S.courseB = B.course;
    const p = await g.rpc("create_person", { p_full_name: student, p_unit_id: S.unit, p_kinds: ["lead"], p_email: email, p_phone: null, p_notes: null, p_force: true }); expect(p.status, JSON.stringify(p.body)).toBe(200); S.person = p.body.id;
    userId = await createConfirmedUser(email, pass);
    const link = await g.rpc("person_portal_access", { p_person: S.person, p_email: email }); expect(link.status, JSON.stringify(link.body)).toBe(200); expect((link.body as { status: string }).status).toBe("linked");
    const edu = (await g.get("pipelines?select=id&kind=eq.education&active=eq.true&limit=1")).body[0].id;
    const o = await g.rpc("crm_create_opportunity", { p_person_id: S.person, p_pipeline_id: edu, p_unit_id: S.unit, p_title: `Mentoria R22 ${runId}`, p_source: "quiz:parceria" }); expect(o.status, JSON.stringify(o.body)).toBe(200); S.opp = o.body;
    const l0 = await lines(); base = l0.map; expect(l0.ok, "a conferência Geral = linhas já estava fechada antes").toBe(true);
    expect((await ents())).toHaveLength(0);
  });

  test("venda do curso de QUITAÇÃO (2 × R$ 600,00) a partir da oportunidade: identificada como HP Academy; a oportunidade vai para “Pagamento” e a aluna ainda NÃO tem acesso", async ({ page, context }) => {
    await loginAs(context, QA.manager); const errors = collectErrors(page); const g = api(await signIn(QA.manager));
    await page.goto(`/admin/financeiro/vendas?venda=${S.opp}&pessoa=${S.person}&unidade=${S.unit}`); await expect(page.getByText("Venda originada de uma oportunidade")).toBeVisible();
    await page.locator("#pr").selectOption(S.prodA); await page.locator("#in").fill("2"); await page.locator("#fd").fill(spDate(0)); await page.getByRole("button", { name: "Criar venda" }).click(); await expect(page.getByText(/Venda criada como pendente/)).toBeVisible({ timeout: 20_000 });
    S.saleA = (await sql<{ id: string }>(`select id from public.sales where person_id = '${S.person}' and opportunity_id = '${S.opp}'`))[0].id;
    await page.getByRole("row").filter({ hasText: student }).getByRole("button", { name: "Confirmar" }).click(); await expect(page.getByText(/Venda confirmada/).first()).toBeVisible({ timeout: 20_000 });
    await expect(page.getByRole("row").filter({ hasText: student }).first()).toContainText(/Academy/);                 // linha de negócio exibida pelo produto
    const sh = (await g.rpc("sale_line_shares", { p_sale_ids: [S.saleA] })).body as { line: string; cents: number }[]; expect(sh.map((x) => [x.line, Number(x.cents)])).toEqual([["academy", 120000]]);
    expect((await sql<{ kind: string }>(`select kind from public.person_kinds where person_id = '${S.person}' order by kind`)).map((k) => k.kind)).toEqual(expect.arrayContaining(["student"]));
    expect(await stage()).toMatchObject({ name: "Pagamento", status: "open" }); expect(await ents(), "confirmar a venda não libera acesso").toHaveLength(0);
    S.recs = (await sql<{ id: string }>(`select id from public.receivables where sale_id = '${S.saleA}' order by installment_no`)).map((r) => r.id).join(",");
    expect(errors, errors.join("\n")).toEqual([]);
  });

  test("1ª parcela paga: com a regra de quitação NÃO há acesso e a oportunidade NÃO vai para “Acesso liberado”; o aluno não vê o curso (interface e servidor)", async ({ page, context, browser }) => {
    await loginAs(context, QA.manager); const [r1] = S.recs.split(",");
    await page.goto("/admin/financeiro/vendas"); const row = page.getByRole("row").filter({ hasText: student }).filter({ has: page.getByRole("cell", { name: "1/2", exact: true }) });
    await row.getByRole("button", { name: "Receber" }).click(); await page.getByRole("button", { name: "Registrar" }).click(); await expect(page.getByText("Recebimento registrado.")).toBeVisible({ timeout: 20_000 });
    expect((await sql<{ s: string }>(`select status s from public.receivables where id = '${r1}'`))[0].s).toBe("paid");
    expect(await ents(), "1ª parcela não quita: sem acesso").toHaveLength(0); expect(await stage(), "o funil não diz “Acesso liberado” sem acesso").toMatchObject({ name: "Pagamento", status: "open" });
    const s = await signInWith(email, pass); const a = api(s);
    expect(((await a.get(`entitlements?select=id`)).body as unknown[]).length).toBe(0);
    const sctx = await browser.newContext({ timezoneId: "America/Sao_Paulo", locale: "pt-BR" }); const pg = await sctx.newPage(); const errors = collectErrors(pg); await uiLogin(pg, email, pass); await expect(pg).toHaveURL(/\/(academy|paciente|portal|admin)/, { timeout: 40_000 });
    await pg.goto("/academy"); await expect(pg.getByRole("heading", { name: courseA })).toHaveCount(0); await pg.waitForLoadState("networkidle");
    await pg.goto(`/academy/${slugA}`); await expect(pg.getByRole("heading", { name: `Aula 1 ${slugA}` })).toHaveCount(0);                  // acesso direto pela URL também é bloqueado
    expect(((await a.get(`lessons?select=id&course_id=eq.${S.courseA}`)).body as unknown[]).length, "o servidor não entrega as aulas sem acesso").toBe(0);
    await pg.close(); expect(errors, errors.join("\n")).toEqual([]);
  });

  test("quitação (2ª parcela): acesso liberado com validade do produto, oportunidade em “Acesso liberado”; a aluna entra, assiste e o progresso persiste; a administração do Academy segue fechada para ela", async ({ context, browser }) => {
    await loginAs(context, QA.manager); const g = api(await signIn(QA.manager)); const [, r2] = S.recs.split(",");
    const pay = await g.rpc("payment_record", { p_receivable: r2, p_amount_cents: 60000, p_paid_at: new Date().toISOString(), p_method: "pix", p_account: null, p_idempotency_key: `r22-${runId}-2` }); expect(pay.status, JSON.stringify(pay.body)).toBeLessThan(300);
    const dup = await g.rpc("payment_record", { p_receivable: r2, p_amount_cents: 60000, p_paid_at: new Date().toISOString(), p_method: "pix", p_account: null, p_idempotency_key: `r22-${runId}-2` }); expect(dup.status).toBeLessThan(300);   // retentativa: nada novo
    const e = await ents(); expect(e, "uma matrícula (a retentativa não duplica)").toHaveLength(1); expect(e[0]).toMatchObject({ course_id: S.courseA, source: "purchase", source_ref: S.saleA, revoked_at: null });
    const days = (new Date(e[0].valid_until!).getTime() - Date.now()) / 864e5; expect(days).toBeGreaterThan(88); expect(days).toBeLessThan(91);                       // validade de 90 dias do produto
    expect(await stage()).toMatchObject({ name: "Acesso liberado", status: "won" });
    expect((await sql<{ n: number }>(`select count(*)::int n from public.payments where receivable_id = '${r2}'`))[0].n).toBe(1);
    const sctx = await browser.newContext({ timezoneId: "America/Sao_Paulo", locale: "pt-BR" }); const pg = await sctx.newPage(); const errors = collectErrors(pg); await uiLogin(pg, email, pass); await expect(pg).toHaveURL(/\/(academy|paciente|portal|admin)/, { timeout: 40_000 });
    await pg.goto("/academy"); await expect(pg.getByRole("heading", { name: courseA })).toBeVisible({ timeout: 30_000 });
    await pg.goto(`/academy/${slugA}`); await expect(pg.getByRole("heading", { name: `Aula 1 ${slugA}` })).toBeVisible({ timeout: 30_000 });
    await pg.getByRole("button", { name: "Marcar como concluída" }).click(); await expect(pg.getByText("Aula concluída.")).toBeVisible(); await pg.reload(); await expect(pg.getByText(/50% \(1\/2 aulas\)/)).toBeVisible({ timeout: 30_000 });
    expect((await sql<{ n: number }>(`select count(*)::int n from public.lesson_progress where person_id = '${S.person}'`))[0].n).toBe(1);
    // administração separada da área do aluno
    await pg.goto("/admin/academy"); await expect(pg.getByRole("heading", { name: "Sem permissão" })).toBeVisible({ timeout: 20_000 });                   // a administração do Academy não abre para a aluna
    const a = api(await signInWith(email, pass)); expect((await a.rpc("entitlement_grant_manual", { p_person: S.person, p_course: S.courseB, p_valid_until: null, p_reason: "autoliberação" })).status).not.toBe(200);
    expect(((await a.get("sales?select=id")).body as unknown[]).length).toBe(0);
    await expectNoFatal(pg); await sctx.close(); expect(errors, errors.join("\n")).toEqual([]);
  });

  test("estorno PARCIAL (R$ 100,00) não revoga o acesso; estorno que zera o líquido revoga; o aluno perde o acesso na hora", async ({ context }) => {
    await loginAs(context, QA.manager); const g = api(await signIn(QA.manager)); const [r1] = S.recs.split(",");
    const pay1 = (await sql<{ id: string }>(`select id from public.payments where receivable_id = '${r1}' and kind = 'payment'`))[0].id;
    const k = `r22-ref1-${runId}`;
    expect((await g.rpc("payment_refund", { p_payment: pay1, p_amount_cents: 10000, p_reason: "estorno parcial R22", p_idempotency_key: k })).status).toBeLessThan(300);
    expect((await g.rpc("payment_refund", { p_payment: pay1, p_amount_cents: 10000, p_reason: "estorno parcial R22", p_idempotency_key: k })).status, "mesma chave: nada novo").toBeLessThan(300);
    expect((await sql<{ n: number }>(`select count(*)::int n from public.payments where kind = 'refund' and refund_of = '${pay1}'`))[0].n).toBe(1);
    expect((await ents())[0].revoked_at, "líquido ainda positivo: acesso mantido").toBeNull();
    // cancelar a venda COM recebimentos é recusado: primeiro estorna-se (regra existente); estornar o restante zera o líquido e revoga
    const early = await g.rpc("sale_cancel", { p_sale: S.saleA, p_reason: "cancelamento R22" }); expect(early.status).not.toBe(200); expect(JSON.stringify(early.body)).toContain("estorne antes de cancelar");
    const [, r2] = S.recs.split(","); const pay2 = (await sql<{ id: string }>(`select id from public.payments where receivable_id = '${r2}' and kind = 'payment'`))[0].id;
    expect((await g.rpc("payment_refund", { p_payment: pay1, p_amount_cents: 50000, p_reason: "estorno do restante R22", p_idempotency_key: `r22-ref2-${runId}` })).status).toBeLessThan(300);
    expect((await ents())[0].revoked_at, "ainda resta R$ 600,00 líquidos da 2ª parcela").toBeNull();
    expect((await g.rpc("payment_refund", { p_payment: pay2, p_amount_cents: 60000, p_reason: "estorno da 2ª parcela R22", p_idempotency_key: `r22-ref3-${runId}` })).status).toBeLessThan(300);
    expect((await ents())[0].revoked_at, "líquido zerado revoga o acesso").not.toBeNull();
    expect((await g.rpc("sale_cancel", { p_sale: S.saleA, p_reason: "cancelamento R22" })).status, "sem recebimento líquido, a venda pode ser cancelada").toBeLessThan(300);
    const a = api(await signInWith(email, pass)); expect(((await a.get(`lessons?select=id&course_id=eq.${S.courseA}`)).body as unknown[]).length).toBe(0);
  });

  test("curso do 1º RECEBIMENTO (R$ 600,00): um recebimento parcial de R$ 100,00 libera o acesso (regra configurada no produto); estornar tudo revoga", async ({ context }) => {
    await loginAs(context, QA.manager); const g = api(await signIn(QA.manager));
    const sale = await g.rpc("sale_create", { p_person: S.person, p_unit: S.unit, p_opportunity: null, p_items: [{ product_id: S.prodB, qty: 1 }], p_discount_cents: 0, p_installments: 1, p_first_due: spDate(0), p_idempotency_key: `r22-saleB-${runId}` });
    expect(sale.status, JSON.stringify(sale.body)).toBe(200); S.saleB = sale.body; expect((await g.rpc("sale_confirm", { p_sale: S.saleB })).status).toBeLessThan(300);
    const rec = (await sql<{ id: string }>(`select id from public.receivables where sale_id = '${S.saleB}'`))[0].id; expect((await ents()).filter((x) => x.course_id === S.courseB)).toHaveLength(0);
    const p = await g.rpc("payment_record", { p_receivable: rec, p_amount_cents: 10000, p_paid_at: new Date().toISOString(), p_method: "pix", p_account: null, p_idempotency_key: `r22-b1-${runId}` }); expect(p.status, JSON.stringify(p.body)).toBeLessThan(300);
    const eb = (await ents()).filter((x) => x.course_id === S.courseB); expect(eb).toHaveLength(1); expect(eb[0]).toMatchObject({ source: "purchase", source_ref: S.saleB, valid_until: null, revoked_at: null });
    const a = api(await signInWith(email, pass)); expect(((await a.get(`lessons?select=id&course_id=eq.${S.courseB}`)).body as unknown[]).length, "a aluna lê as aulas liberadas").toBe(2);
    const payId = (await sql<{ id: string }>(`select id from public.payments where receivable_id = '${rec}' and kind = 'payment'`))[0].id;
    expect((await g.rpc("payment_refund", { p_payment: payId, p_amount_cents: 10000, p_reason: "estorno total R22", p_idempotency_key: `r22-b-ref-${runId}` })).status).toBeLessThan(300);
    expect((await ents()).find((x) => x.course_id === S.courseB)!.revoked_at, "líquido zerado revoga").not.toBeNull();
    expect(((await a.get(`lessons?select=id&course_id=eq.${S.courseB}`)).body as unknown[]).length).toBe(0);
  });

  test("Financeiro: HP Academy recebe o que é da Academy; HP Fisioterapia e demais linhas não mudam; o Geral reconcilia com as partes", async ({ page, context }) => {
    await loginAs(context, QA.manager); const errors = collectErrors(page); const now = await lines();
    const d = (key: string, f: keyof Line) => now.map[key][f] - base[key][f];
    expect({ sales: d("academy", "sales_cents"), receipts: d("academy", "receipts_cents"), refunds: d("academy", "refunds_cents") }).toEqual({ sales: 60000, receipts: 130000, refunds: 130000 });   // venda A cancelada sai das vendas (B, R$ 600, fica); recebimentos 1.200 + 100; estornos 1.200 + 100
    for (const k of ["physio", "shared", "unclassified"]) expect(d(k, "receipts_cents") + d(k, "sales_cents") + d(k, "refunds_cents"), `linha ${k} não muda`).toBe(0);
    expect(now.ok, "Geral = soma das linhas (conferência do servidor)").toBe(true);
    // pela tela: Visão geral com o seletor de linha Academy mostra o mesmo recebimento e a conferência
    await page.goto("/admin/financeiro?linha=academy"); await expect(page.getByText(/HP Academy/).first()).toBeVisible({ timeout: 40_000 });
    await page.goto("/admin/financeiro/vendas"); await page.getByRole("tab", { name: "Vendas" }).click(); await page.locator("#sale-line").selectOption("academy");
    await expect(page.getByRole("row").filter({ hasText: student }).first()).toContainText(/Academy/, { timeout: 20_000 });
    await expect(page.getByRole("row").filter({ hasText: student }).filter({ hasText: /Cancelada/ })).toHaveCount(1);               // a venda cancelada continua no histórico, não nas vendas confirmadas
    await expectNoFatal(page); expect(errors, errors.join("\n")).toEqual([]);
  });

  test("celular: catálogo e curso da aluna cabem na tela, sem rolagem lateral", async ({ browser }) => {
    const ctx = await browser.newContext({ viewport: { width: 390, height: 844 }, timezoneId: "America/Sao_Paulo", locale: "pt-BR", isMobile: true, hasTouch: true }); const p = await ctx.newPage(); const errors = collectErrors(p);
    await uiLogin(p, email, pass); await expect(p).toHaveURL(/\/(academy|paciente|portal|admin)/, { timeout: 40_000 }); await p.goto("/academy"); await p.waitForLoadState("networkidle");
    expect(await p.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth)).toBe(true); await p.screenshot({ path: "docs/screenshots/academy/catalogo-celular.png" });
    expect(errors, errors.join("\n")).toEqual([]); await ctx.close(); expect(userId).toBeTruthy();
  });
});
