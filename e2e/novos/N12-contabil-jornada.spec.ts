// NOVO (etapa ADM+Contábil) — jornada completa do app Contábil na interface, contra o Supabase DEV:
// escolher unidade/competência → lançamentos do Financeiro → classificar → comprovantes/dispensa → revisar → fechar →
// alteração posterior do Financeiro sinalizada → aceitar/reabrir (justificativa + auditoria) → refechar → exportar (ZIP).
// Também confere perfis (contador, comercial). Não faz parte da regressão (01–09).
import { expect, test, type Page } from "@playwright/test";
import JSZip from "jszip";
import { api, collectErrors, currentMonth, loginAs, patch, QA, shiftMonth, shot, signIn, TINY_PDF, unitId } from "./helpers-novos";

const run = Date.now().toString(36).toUpperCase();
const ask = (p: Page) => p.locator("#ask-input");
const dlgBtn = (p: Page, name: string | RegExp) => p.getByRole("dialog").getByRole("button", { name });
const monthFor = () => shiftMonth(currentMonth(), -(3 + (parseInt(run, 36) % 8)));             // 3 a 10 meses atrás (dentro do seletor)

test.describe("@novo Contábil — jornada completa", () => {
  test.setTimeout(240_000);

  test("da seleção da competência à exportação, com reabertura auditada e alterações do Financeiro sinalizadas", async ({ page, context, browser }) => {
    const errors = collectErrors(page);
    const mgr = await signIn(QA.manager); const fin = await loginAs(context, QA.financeiro);
    const unit = await unitId(mgr); const month = monthFor();
    const org = (await api(mgr).get("organizations?select=id&slug=eq.hp-group")).body[0].id as string;
    const A = `E2E Aluguel ${run}`, B = `E2E Insumos ${run}`, C = `E2E A pagar ${run}`, D = `E2E Novo pós-fechamento ${run}`;

    // ---- preparação (API): regras padrão, classificações, concessões, mês limpo
    await api(mgr).rpc("acc_seed_default_accounts");
    await api(mgr).rpc("acc_settings_save", { p_require_receipt: true, p_receipt_min_cents: 0, p_block_unclassified: true, p_reopen_min_len: 10 });
    await api(mgr).rpc("acc_grant_set", { p_user: fin.user.id, p_permission: "close", p_unit: null, p_on: true });
    await api(mgr).rpc("acc_grant_set", { p_user: fin.user.id, p_permission: "reopen", p_unit: null, p_on: true });
    const cfg = (await api(fin).rpc("acc_config")).body; const acct = cfg.accounts.find((a: { code: string }) => a.code === "D02").id as string;
    const detail = async () => (await api(fin).rpc("acc_period_detail", { p_unit: unit, p_month: month })).body;
    const cleanMonth = async () => {                               // deixa o mês aberto e sem pendência alheia (restos de execuções interrompidas)
      const d = await detail();
      if (d.status === "closed") await api(fin).rpc("acc_period_reopen", { p_unit: unit, p_month: month, p_reason: "Limpeza automática do teste E2E" });
      if ((await detail()).status === "in_review") await api(fin).rpc("acc_period_withdraw_review", { p_unit: unit, p_month: month, p_reason: null });
      const p = (await api(fin).rpc("acc_pendencies", { p_unit: unit, p_month: month, p_type: null })).body.rows as { type: string; source_type: string; source_id: string }[];
      for (const r of p) {
        if (r.type === "unclassified") await api(fin).rpc("acc_classify", { p_unit: unit, p_items: [{ source_type: r.source_type, source_id: r.source_id }], p_account: acct, p_note: "limpeza E2E" });
        if (r.type === "missing_receipt") await api(fin).rpc("acc_waive", { p_unit: unit, p_source_type: r.source_type, p_source_id: r.source_id, p_kind: "receipt", p_reason: "Limpeza automática do teste E2E" });
      }
    };
    await cleanMonth();
    const seq0 = (await detail()).close_seq as number;                                          // a versão do fechamento acumula entre execuções
    const due = month.slice(0, 8) + "05"; const paidAt = `${month.slice(0, 8)}12T15:00:00Z`;
    const mk = async (description: string, amount: number, paid: boolean) => {
      const r = await api(fin).post("payables", { org_id: org, unit_id: unit, description, supplier: `Fornecedor ${run}`, amount_cents: amount, due_date: due, competence_month: month, status: paid ? "paid" : "open", paid_at: paid ? paidAt : null, created_by: fin.user.id });
      expect(r.status, JSON.stringify(r.body)).toBe(201); return (r.body as { id: string }[])[0].id;
    };
    const idA = await mk(A, 120000, true); await mk(B, 45000, true); const idC = await mk(C, 30000, false);

    // ---- 1) visão geral com indicadores reais e clicáveis
    const base = `/admin/contabil`; const q = `u=${unit}&m=${month}`;
    await page.goto(`${base}?${q}`);
    await expect(page.getByRole("heading", { name: "Visão geral", exact: true })).toBeVisible();
    await expect(page.getByText("Jornada da competência")).toBeVisible();
    await shot(page, "01-contabil-visao-geral-com-pendencias");
    await page.getByRole("button", { name: /Sem classificação/ }).click();
    await expect(page).toHaveURL(/\/contabil\/lancamentos.*f=unclassified/);

    // ---- 2) lançamentos → classificar em lote
    await page.locator("#l-q").fill(run); await page.locator("#l-q").press("Enter");
    const rows = page.locator('[data-testid="acc-ledger"] tbody tr');
    await expect(rows).toHaveCount(3);
    await shot(page, "02-lancamentos-sem-classificacao");
    await expect(page.getByText("Competência", { exact: true }).first()).toBeVisible();
    await page.getByLabel("Selecionar todos da página").check();
    await page.getByRole("button", { name: /Classificar selecionados \(3\)/ }).click();
    const val = await ask(page).locator("option", { hasText: "D02" }).getAttribute("value"); await ask(page).selectOption(val!);
    await dlgBtn(page, "Classificar").click();
    await expect(page.getByText("Classificação registrada.")).toBeVisible();
    await expect(rows).toHaveCount(0);                                                          // filtro "sem classificação" agora vazio

    // ---- 3) comprovantes: anexar um, dispensar outro com justificativa
    await page.goto(`${base}/documentos?${q}`);
    await expect(page.getByRole("heading", { name: /Despesas pagas sem comprovante \(2\)/ })).toBeVisible();
    await page.getByRole("row", { name: new RegExp(A) }).getByRole("button", { name: "Anexar comprovante" }).click();
    await page.locator("#att-file").setInputFiles({ name: "recibo-aluguel.pdf", mimeType: "application/pdf", buffer: TINY_PDF });
    await page.locator("#att-title").fill(`Recibo ${A}`);
    await dlgBtn(page, "Anexar").click();
    await expect(page.getByRole("heading", { name: /Despesas pagas sem comprovante \(1\)/ })).toBeVisible();
    const myDoc = page.locator("[data-doc]").filter({ hasText: run }); await expect(myDoc).toHaveCount(1);              // (o mês pode ter documentos de execuções anteriores)
    await shot(page, "03-documentos-comprovante-anexado");
    const opened = page.waitForEvent("popup");
    await myDoc.getByRole("button", { name: "Abrir" }).click();                                 // abre por URL assinada, depois de o servidor autorizar
    const pop = await opened; await expect(pop).toHaveURL(/\/storage\/v1\/object\/sign\/accounting-private\//); await pop.close();
    await page.goto(`${base}/lancamentos?${q}&f=missing_receipt`);
    await page.locator("#l-q").fill(run); await page.locator("#l-q").press("Enter");
    await expect(rows).toHaveCount(1);
    await rows.first().getByRole("button", { name: "Dispensar" }).click();
    await ask(page).fill("Fornecedor informal, pagamento em dinheiro sem recibo"); await dlgBtn(page, "Dispensar").click();
    await expect(page.getByText("Pendência dispensada com justificativa.")).toBeVisible();

    // ---- 4) revisar e fechar (fechar exige a concessão específica, que este usuário tem)
    await page.goto(`${base}/fechamentos?${q}`);
    await expect(page.locator('[data-gate="unclassified"][data-ok="true"]')).toBeVisible();
    await expect(page.locator('[data-gate="missing_receipt"][data-ok="true"]')).toBeVisible();
    await page.getByRole("button", { name: "Enviar para revisão" }).click();
    await expect(page.getByText("Competência enviada para revisão.")).toBeVisible();
    await page.getByRole("button", { name: "Fechar competência" }).click();
    await ask(page).fill(`Fechamento E2E ${run}`); await dlgBtn(page, "Fechar competência").click();
    await expect(page.getByText("Competência fechada.")).toBeVisible();
    await expect(page.getByText(/Fechada por/)).toBeVisible();
    await shot(page, "04-fechamento-competencia-fechada");
    // fechada = leitura: a tela de lançamentos avisa e desabilita a edição
    await page.goto(`${base}/lancamentos?${q}`); await expect(page.getByText(/fechada: leitura somente/)).toBeVisible();

    // ---- 5) o Financeiro muda depois do fechamento: NÃO é bloqueado, é sinalizado
    expect((await patch(fin, `payables?id=eq.${idC}`, { amount_cents: 35000 })).status).toBe(200);
    await mk(D, 9900, false);
    await page.goto(`${base}?${q}`);
    await expect(page.getByRole("button", { name: /Alterações após o fechamento/ })).toContainText("2");
    await page.getByRole("button", { name: /Alterações após o fechamento/ }).click();
    await expect(page).toHaveURL(/\/contabil\/pendencias.*tipo=changed_after_close/);
    await expect(page.locator('[data-pend="changed_after_close"]')).toHaveCount(2);
    await shot(page, "05-pendencias-alteracao-pos-fechamento");
    await page.goto(`${base}/fechamentos?${q}`);
    await expect(page.getByRole("heading", { name: /Alterações do Financeiro após o fechamento \(2\)/ })).toBeVisible();
    await expect(page.locator('[data-change="changed"]')).toHaveCount(1); await expect(page.locator('[data-change="added"]')).toHaveCount(1);
    await shot(page, "06-fechamento-alteracoes-pos-fechamento");
    await page.locator('[data-change="changed"]').getByRole("button", { name: "Aceitar" }).click();
    await ask(page).fill("Ajuste de valor conferido com o contador"); await dlgBtn(page, "Aceitar").click();
    await expect(page.getByRole("heading", { name: /Alterações do Financeiro após o fechamento \(1\)/ })).toBeVisible();

    // ---- 6) reabertura: justificativa obrigatória, auditada
    await page.getByRole("button", { name: "Reabrir competência" }).click();
    await ask(page).fill("curto"); await dlgBtn(page, "Reabrir").click();
    await expect(page.getByRole("alert").filter({ hasText: /Justifique a reabertura/ })).toBeVisible();
    await page.getByRole("button", { name: "Reabrir competência" }).click();
    const reason = `Reabrindo para incorporar novo lançamento do Financeiro (${run})`;
    await ask(page).fill(reason); await dlgBtn(page, "Reabrir").click();
    await expect(page.getByText("Competência reaberta.")).toBeVisible();
    await expect(page.getByText(/Reaberta por/)).toBeVisible();
    await shot(page, "07-fechamento-reaberta-com-historico");
    await expect(page.getByText("Competência reaberta", { exact: true }).first()).toBeVisible();
    const audit = await api(mgr).get(`audit_log?select=action,new_values&action=eq.acc_period_reopen&order=id.desc&limit=1`);
    expect(audit.body[0].new_values.reason).toBe(reason);

    // ---- 7) classificar o novo lançamento pela tela de Pendências, revisar e refechar
    await page.goto(`${base}/pendencias?${q}&tipo=unclassified`);
    const pend = page.locator('[data-pend="unclassified"]'); await expect(pend).toHaveCount(1);
    await pend.getByRole("button", { name: "Classificar" }).click();
    const v2 = await ask(page).locator("option", { hasText: "D02" }).getAttribute("value"); await ask(page).selectOption(v2!); await dlgBtn(page, "Classificar").click();
    await expect(page.getByText("Lançamento classificado.")).toBeVisible();
    await page.goto(`${base}/fechamentos?${q}`);
    await page.getByRole("button", { name: "Enviar para revisão" }).click(); await expect(page.getByText("Competência enviada para revisão.")).toBeVisible();
    await page.getByRole("button", { name: "Fechar competência" }).click(); await dlgBtn(page, "Fechar competência").click();
    await expect(page.getByText(new RegExp(`\\(versão ${seq0 + 2}\\)`))).toBeVisible();

    // ---- 8) exportação: pacote ZIP com CSVs por base, LEIAME, manifesto e o documento autorizado
    await page.goto(`${base}/exportacoes?${q}`);
    const [zipDl] = await Promise.all([page.waitForEvent("download"), page.getByRole("button", { name: "Gerar pacote (ZIP)" }).click()]);
    const zip = await JSZip.loadAsync((await import("node:fs")).readFileSync(await zipDl.path()!));
    const names = Object.keys(zip.files);
    for (const n of ["LEIAME.txt", "lancamentos_competencia.csv", "lancamentos_caixa.csv", "pendencias.csv", "resumo.csv", "manifesto.csv"]) expect(names).toContain(n);
    expect(names.filter((n) => n.startsWith("documentos/") && n.endsWith(".pdf") && n.includes(run))).toHaveLength(1);
    const leia = await zip.file("LEIAME.txt")!.async("string");
    expect(leia).toMatch(/Competência fechada por/); expect(leia).not.toMatch(/PROVISÓRIOS/); expect(leia).toMatch(/não contém apuração de tributos/);
    const comp = await zip.file("lancamentos_competencia.csv")!.async("string");
    expect(comp).toContain(A); expect(comp).toContain("D02"); expect(comp).not.toContain("Recebimento —");
    const caixa = await zip.file("lancamentos_caixa.csv")!.async("string");
    expect(caixa).toContain(A); expect(caixa).not.toContain(C);                                 // conta em aberto não está no caixa
    expect(await zip.file("manifesto.csv")!.async("string")).toMatch(/documentos\/001-.*;[0-9a-f]{64}/);
    await expect(page.getByText("Pacote gerado:")).toBeVisible();
    await expect(page.locator("tbody tr").filter({ hasText: "ZIP" }).first()).toContainText("Definitivo");
    await shot(page, "08-exportacoes-pacote-e-historico");
    void idA;

    // ---- 9) perfis: contador vê tudo da unidade, mas não fecha/reabre e recebe pseudônimo de paciente
    const cctx = await browser.newContext(); const cs = await loginAs(cctx, QA.contador); const cp = await cctx.newPage(); const cerr = collectErrors(cp);
    await cp.goto("/admin");                                                                    // sem dashboard geral: a "casa" do contador é o Contábil
    await expect(cp).toHaveURL(/\/admin\/contabil$/);
    await cp.goto(`${base}/fechamentos?${q}`);
    await expect(cp.getByRole("button", { name: "Reabrir competência" })).toBeDisabled();
    await expect(cp.getByText(/Reabrir exige uma permissão específica/)).toBeVisible();
    await shot(cp, "09-contador-fechamento-somente-leitura");
    await cp.goto(`${base}/lancamentos?u=${unit}&m=${currentMonth()}&kind=income`);
    await expect(cp.getByText(/pseudonimizados/)).toBeVisible();
    const tbl = await cp.locator('[data-testid="acc-ledger"]').innerText();
    await shot(cp, "10-contador-lancamentos-pacientes-pseudonimizados");
    expect(tbl).toMatch(/Paciente [0-9A-F]{6}/); expect(tbl).not.toMatch(/Pessoa Financeiro/);
    expect((await api(cs).rpc("acc_period_close", { p_unit: unit, p_month: month, p_note: null })).status).toBe(403);
    expect(cerr).toEqual([]); await cctx.close();

    // ---- 10) comercial e aluno: sem acesso (interface e servidor)
    const sctx = await browser.newContext(); const ss = await loginAs(sctx, QA.comercial); const sp = await sctx.newPage();
    await sp.goto(`${base}?${q}`); await expect(sp.getByText("Sem permissão")).toBeVisible();
    expect((await api(ss).rpc("acc_context")).status).toBe(403);
    expect((await api(ss).get("acc_periods?select=id")).body).toEqual([]);
    expect((await api(ss).rpc("acc_documents_access", { p_ids: ["00000000-0000-0000-0000-000000000000"] })).status).toBe(403);
    await sctx.close();
    expect((await api(await signIn(QA.aluno)).rpc("acc_context")).status).toBe(403);

    // ---- limpeza: reabre, cancela o que ainda está aberto e deixa o mês aberto
    await cleanMonth();
    for (const id of [idC]) await patch(fin, `payables?id=eq.${id}&status=eq.open`, { status: "cancelled" });
    expect(errors).toEqual([]);
  });
});
