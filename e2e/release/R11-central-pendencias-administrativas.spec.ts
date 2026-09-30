// ACEITE da release v1 — central de pendências administrativas (Administrativo): cartões prioritários que batem com o servidor e abrem os registros do seu número,
// filtros, ciclo completo de uma pendência (criar, atribuir, concluir, reabrir, cancelar, histórico), lista de prioridades, documentos/contratos/contatos pelas telas,
// permissões e isolamento, e a jornada no celular. Só cria fixtures próprias e desfaz o que cria.
import { expect, test, type Page } from "@playwright/test";
import { api, collectErrors, expectNoFatal, loginAs, QA, rest, runId, signIn, spDate } from "./helpers-release";

test.use({ timezoneId: "America/Sao_Paulo", locale: "pt-BR" });

const FROM = () => new Date(Date.now() - 30 * 864e5).toISOString(), TO = () => new Date(Date.now() + 864e5).toISOString();
const central = async (s: Awaited<ReturnType<typeof signIn>>, extra: Record<string, unknown> = {}) => {
  const r = await api(s).rpc("adm_central", { p_from: FROM(), p_to: TO(), p_unit: null, p_owner: null, p_type: null, p_kind: null, p_status: null, ...extra });
  expect(r.status, JSON.stringify(r.body)).toBe(200); return r.body;
};
const fmt = (v: unknown) => Number(v).toLocaleString("pt-BR");
const cardBtn = (page: Page, label: string | RegExp) => page.getByRole("button", { name: label }).first();
const cardValue = async (page: Page, label: string | RegExp) => (await cardBtn(page, label).locator("p.tabular").innerText()).trim();
async function openAndCompare(page: Page, label: string | RegExp) {
  const shown = await cardValue(page, label); await cardBtn(page, label).click();
  const dlg = page.getByRole("dialog"); await expect(dlg).toBeVisible();
  await expect(dlg.locator("p.tabular").first()).toHaveText(shown);                         // a contagem do detalhamento = a do cartão
  await expect(dlg.getByRole("link", { name: "Abrir a lista completa" })).toBeVisible();
  await expect(dlg.getByText(/Sem permissão ou falha/)).toHaveCount(0);
  await dlg.getByRole("button", { name: "Fechar" }).first().click(); await expect(dlg).toHaveCount(0);
}
const CARDS: [string | RegExp, string][] = [[/^Pendências administrativas vencidas/, "overdue_pendencies"], [/^Cadastros incompletos/, "incomplete"], [/^Documentos vencendo em/, "docs_expiring"],
  [/^Contratos aguardando assinatura/, "contracts_awaiting"], [/^Pacientes aguardando agendamento/, "patients_waiting"], [/^Profissionais com integração administrativa incompleta/, "professionals_incomplete"]];

test.describe.serial("@release Central de pendências administrativas (desktop)", () => {
  test.setTimeout(180_000);
  const S: Record<string, string> = {}; const title = `Pendência E2E R11 ${runId}`;

  test("dashboard: os seis cartões batem com o servidor e cada um abre os registros do seu número", async ({ page, context }) => {
    const s = await loginAs(context, QA.manager); const errors = collectErrors(page);
    await api(s).rpc("adm_sync");                                                     // estabiliza as pendências automáticas antes de comparar
    const srv = await central(s);
    await page.goto("/admin/adm");
    await expect(page.getByRole("heading", { name: "Prioridades administrativas" })).toBeVisible({ timeout: 40_000 });
    await expectNoFatal(page);
    for (const [label, key] of CARDS) expect(await cardValue(page, label), `cartão ${key}`).toBe(fmt(srv.cards[key].value));
    for (const [label] of CARDS) await openAndCompare(page, label);
    // seções exigidas pela tarefa
    for (const h of ["Indicadores complementares", "Lista de prioridades"]) await expect(page.getByRole("heading", { name: h })).toBeVisible();
    for (const t of ["Evolução de pendências abertas e concluídas", "Tempo de resolução por tipo", "Pendências por responsável", "Pendências por unidade"]) await expect(page.getByText(t, { exact: true })).toBeVisible();
    // situação de hoje × período, explicados na tela
    await expect(page.getByText(/situação de hoje/i).first()).toBeVisible(); await expect(page.getByText("No período").first()).toBeVisible();
    // KPIs complementares: números da tela = servidor
    const dup = page.getByRole("region", { name: "Possíveis duplicidades" });
    await expect(dup.getByRole("button", { name: /Grupos para revisar/ }).locator("span.tabular")).toHaveText(fmt(srv.kpis.duplicates.groups));
    const docs = page.getByRole("region", { name: "Documentos" });
    await expect(docs.getByRole("button", { name: /^Vencidos/ }).locator("span.tabular")).toHaveText(fmt(srv.kpis.documents.expired));
    // contatos verificados e formato válido são indicadores SEPARADOS
    const ct = page.getByRole("region", { name: "Contatos" });
    await expect(ct.getByText("Com formato válido", { exact: true })).toBeVisible(); await expect(ct.getByText("Verificados (registro humano)", { exact: true })).toBeVisible();
    if (!srv.kpis.contacts.verified_available) await expect(ct.getByText(/indisponível/i).first()).toBeVisible();        // sem verificação registrada: motivo, não zero
    // os totais PF/PJ anteriores continuam
    for (const l of [/^Total de cadastros/, /^Pessoas físicas/, /^Pessoas jurídicas/]) await expect(cardBtn(page, l)).toBeVisible();
    expect(errors, errors.join("\n")).toEqual([]);
  });

  test("filtros: PF/PJ e vínculo mudam os cartões exatamente como no servidor; limpar volta ao total", async ({ page, context }) => {
    const s = await loginAs(context, QA.manager); await api(s).rpc("adm_sync");
    const base = await central(s), pj = await central(s, { p_type: "pj" }), pat = await central(s, { p_kind: "patient" });
    await page.goto("/admin/adm");
    await expect(cardBtn(page, /^Cadastros incompletos/)).toBeVisible({ timeout: 40_000 });
    await page.getByRole("button", { name: /^Filtros/ }).click();
    await page.locator("#adm-f-type").selectOption("pj");
    await expect(cardBtn(page, /^Cadastros incompletos/).locator("p.tabular")).toHaveText(fmt(pj.cards.incomplete.value), { timeout: 30_000 });
    await expect(cardBtn(page, /^Pacientes aguardando agendamento/).locator("p.tabular")).toHaveText("0");      // paciente é PF: fora do recorte PJ
    await page.locator("#adm-f-type").selectOption(""); await page.locator("#adm-f-kind").selectOption("patient");
    await expect(cardBtn(page, /^Cadastros incompletos/).locator("p.tabular")).toHaveText(fmt(pat.cards.incomplete.value), { timeout: 30_000 });
    await expect(cardBtn(page, /^Pacientes aguardando agendamento/).locator("p.tabular")).toHaveText(fmt(pat.cards.patients_waiting.value));
    // o detalhe respeita o mesmo filtro
    await page.keyboard.press("Escape");
    await openAndCompare(page, /^Cadastros incompletos/);
    await page.getByRole("button", { name: /^Filtros/ }).click(); await page.getByRole("button", { name: "Limpar" }).click();
    await expect(cardBtn(page, /^Cadastros incompletos/).locator("p.tabular")).toHaveText(fmt(base.cards.incomplete.value), { timeout: 30_000 });
  });

  test("pendência pela tela: criar, atribuir, concluir, reabrir, cancelar — e o histórico registra tudo", async ({ page, context }) => {
    const mgr = await loginAs(context, QA.manager); const errors = collectErrors(page);
    await page.goto("/admin/adm/pendencias");
    await expect(page.getByRole("heading", { name: "Pendências administrativas" })).toBeVisible({ timeout: 30_000 });
    await page.getByRole("button", { name: "Nova pendência" }).click();
    const form = page.getByRole("form", { name: "Nova pendência" });
    await form.getByLabel("Tipo", { exact: true }).selectOption("documento"); await form.getByLabel("Motivo", { exact: true }).fill(title);
    await form.getByLabel("Responsável", { exact: true }).selectOption({ index: 1 }); await form.getByLabel(/^Prazo/).fill(spDate(-1));
    await form.getByRole("button", { name: "Registrar pendência" }).click();
    await expect(page.getByText("Pendência registrada.")).toBeVisible({ timeout: 20_000 });
    const row = () => page.getByRole("row").filter({ hasText: title });
    await expect(row()).toHaveCount(1); await expect(row().getByText("Atrasada")).toBeVisible();
    const pend = async () => { const l = await api(mgr).rpc("adm_pendency_list", { p_unit: null, p_owner: null, p_type: null, p_kind: null, p_status: null, p_limit: 500 }); return (l.body as { id: string; title: string; status: string; responsible: string | null; reopened_count: number }[]).find((x) => x.title === title)!; };
    const p0 = await pend(); S.pend = p0.id; expect(p0.status).toBe("open");
    // atribuir a outra pessoa
    await row().getByRole("button", { name: "Responsável" }).click();
    await page.locator("#ask-input").selectOption({ index: 2 }); await page.getByRole("dialog").getByRole("button", { name: "Confirmar" }).click();
    await expect(page.getByText("Responsável atualizado.")).toBeVisible();
    expect((await pend()).responsible).not.toBe(p0.responsible);
    // concluir exige descrever a resolução
    await row().getByRole("button", { name: "Concluir" }).click();
    await page.getByRole("dialog").getByRole("button", { name: "Concluir" }).click(); await expect(page.getByRole("dialog").getByText("Preencha este campo.")).toBeVisible();
    await page.locator("#ask-input").fill("Documento renovado e conferido"); await page.getByRole("dialog").getByRole("button", { name: "Concluir" }).click();
    await expect(page.getByText("Pendência concluída.")).toBeVisible(); await expect(row()).toHaveCount(0);            // some de "Abertas"
    await page.locator("#pd-status").selectOption("resolved"); await expect(row().getByText("Concluída")).toBeVisible();
    expect((await pend()).status).toBe("resolved");
    // reabrir
    await row().getByRole("button", { name: "Reabrir" }).click(); await page.locator("#ask-input").fill("Arquivo estava ilegível");
    await page.getByRole("dialog").getByRole("button", { name: "Reabrir" }).click(); await expect(page.getByText("Pendência reaberta.")).toBeVisible();
    await page.locator("#pd-status").selectOption("open"); await expect(row().getByText("reaberta 1×")).toBeVisible(); await expect(row().getByText("Atrasada")).toBeVisible();
    expect((await pend()).reopened_count).toBe(1);
    // histórico na tela
    await row().getByRole("button", { name: "Histórico" }).click();
    const hist = page.getByRole("list", { name: "Histórico da pendência" });
    await expect(hist.getByText("Reaberta")).toBeVisible(); await expect(hist.getByText("Concluída")).toBeVisible(); await expect(hist.getByText("Responsável definido")).toBeVisible();
    // cancelar
    await row().getByRole("button", { name: "Cancelar" }).click(); await page.locator("#ask-input").fill("Registrada para teste");
    await page.getByRole("dialog").getByRole("button", { name: "Cancelar pendência" }).click(); await expect(page.getByText("Pendência cancelada.")).toBeVisible();
    await page.locator("#pd-status").selectOption("cancelled"); await expect(row().locator(".hp-badge").filter({ hasText: "Cancelada" })).toBeVisible();
    const h = await api(mgr).rpc("adm_pendency_history", { p_id: S.pend });
    expect((h.body as { action: string }[]).map((e) => e.action)).toEqual(["created", "assigned", "resolved", "reopened", "cancelled"]);
    await expectNoFatal(page);
    expect(errors, errors.join("\n")).toEqual([]);
  });

  test("lista de prioridades do dashboard: registro, motivo, responsável, prazo e ação; concluir direto do dashboard", async ({ page, context }) => {
    const mgr = await loginAs(context, QA.manager); const errors = collectErrors(page); const t2 = `Prioridade E2E R11 ${runId}`;
    const unit = (await api(mgr).get("units?select=id&slug=eq.sao-paulo")).body[0].id as string;
    const me = mgr.user.id;
    const c = await api(mgr).rpc("adm_pendency_create", { p_kind: "outro", p_title: t2, p_detail: null, p_subject_type: null, p_subject: null, p_unit: unit, p_responsible: me, p_due: spDate(-300) });
    expect(c.status, JSON.stringify(c.body)).toBe(200); S.prio = c.body as string;
    await page.goto("/admin/adm");
    const box = page.getByRole("region", { name: "Lista de prioridades" });
    const row = box.getByRole("row").filter({ hasText: t2 });
    await expect(row).toBeVisible({ timeout: 40_000 });
    await expect(row.getByText(/atraso/)).toBeVisible();
    await expect(row.getByRole("button", { name: "Concluir" })).toBeVisible();
    for (const h of ["Registro", "Motivo", "Responsável", "Prazo", "Ação"]) await expect(box.getByRole("columnheader", { name: h })).toBeVisible();
    await row.getByRole("button", { name: "Concluir" }).click(); await page.locator("#ask-input").fill("Resolvido pelo dashboard");
    await page.getByRole("dialog").getByRole("button", { name: "Concluir" }).click();
    await expect(page.getByText("Pendência concluída.")).toBeVisible({ timeout: 20_000 });
    await expect(box.getByRole("row").filter({ hasText: t2 })).toHaveCount(0);
    const l = await api(mgr).rpc("adm_pendency_list", { p_unit: null, p_owner: null, p_type: null, p_kind: null, p_status: "resolved", p_limit: 500 });
    expect((l.body as { id: string }[]).some((x) => x.id === S.prio)).toBe(true);
    expect(errors, errors.join("\n")).toEqual([]);
  });

  test("documentos, contratos e verificação de contato pelas telas (e os indicadores reagem)", async ({ page, context }) => {
    const mgr = await loginAs(context, QA.manager); const errors = collectErrors(page); const g = api(mgr);
    const pac = await signIn(QA.paciente); const person = ((await api(pac).get("people?select=id,full_name,org_id")).body as { id: string; full_name: string; org_id: string }[])[0];
    const before = await central(mgr); const nm = person.full_name;                                                     // nome inteiro: a busca mostra só 6 sugestões e há muitos "Paciente…" no Dev
    // contato de teste (formato válido) para verificar; sobras de execuções interrompidas são removidas antes
    await rest(mgr, "DELETE", `person_contacts?person_id=eq.${person.id}&value=like.e2e.r11.*`);
    const ctc = await rest(mgr, "POST", "person_contacts", { org_id: person.org_id, person_id: person.id, type: "email", value: `e2e.r11.${runId}@example.com`, normalized: `e2e.r11.${runId}@example.com` });
    expect(ctc.status, JSON.stringify(ctc.body)).toBeLessThan(300); S.contact = ctc.body[0].id;

    // tipo de documento (Requisitos)
    await page.goto("/admin/adm/pendencias?aba=requisitos");
    await expect(page.getByRole("heading", { name: "Requisitos por tipo de cadastro e vínculo" })).toBeVisible({ timeout: 30_000 });
    const tf = page.getByRole("form", { name: "Novo tipo de documento" });
    await tf.getByLabel("Nome").fill(`Doc E2E R11 ${runId}`); await tf.getByLabel(/^Código/).fill(`e2e${runId}`); await tf.getByRole("button", { name: "Criar tipo" }).click();
    await expect(page.getByText("Tipo de documento criado.")).toBeVisible({ timeout: 20_000 });
    S.dtCode = `e2e${runId}`;

    // documento vencendo em 10 dias
    await page.goto("/admin/adm/pendencias?aba=documentos");
    await page.getByRole("button", { name: "Registrar documento" }).click();
    const df = page.getByRole("form", { name: "Registrar documento" });
    await df.getByLabel("Cadastro", { exact: true }).fill(nm); await df.getByRole("button", { name: person.full_name }).first().click();
    await df.getByLabel("Tipo de documento").selectOption({ label: `Doc E2E R11 ${runId}` }); await df.getByLabel("Título").fill(`Documento E2E ${runId}`); await df.getByLabel("Validade").fill(spDate(10));
    await df.getByRole("button", { name: "Registrar", exact: true }).click(); await expect(page.getByText("Documento registrado.")).toBeVisible({ timeout: 20_000 });
    await page.locator("#dc-state").selectOption("vencendo");
    const drow = page.getByRole("row").filter({ hasText: `Doc E2E R11 ${runId}` }); await expect(drow.getByText("Vencendo")).toBeVisible();
    expect(Number((await central(mgr)).cards.docs_expiring.value)).toBe(Number(before.cards.docs_expiring.value) + 1);

    // contrato: rascunho → enviado → assinatura registrada
    await page.goto("/admin/adm/pendencias?aba=contratos");
    await page.getByRole("button", { name: "Novo contrato" }).click();
    const cf = page.getByRole("form", { name: "Novo contrato" });
    await cf.getByLabel("Título", { exact: true }).fill(`Contrato E2E R11 ${runId}`); await cf.getByLabel("Nome", { exact: true }).fill(nm); await cf.getByRole("button", { name: person.full_name }).first().click();
    await cf.getByRole("button", { name: "Registrar contrato" }).click(); await expect(page.getByText("Contrato registrado como rascunho.")).toBeVisible({ timeout: 20_000 });
    const crow = page.getByRole("row").filter({ hasText: `Contrato E2E R11 ${runId}` }); await expect(crow.getByText("Rascunho")).toBeVisible();
    await crow.getByRole("button", { name: "Enviar para assinatura" }).click(); await page.getByRole("dialog").getByRole("button", { name: "Enviar" }).click();
    await expect(page.getByText("Contrato enviado para assinatura.")).toBeVisible(); await expect(crow.getByText("Aguardando assinatura")).toBeVisible();
    expect(Number((await central(mgr)).cards.contracts_awaiting.value)).toBe(Number(before.cards.contracts_awaiting.value) + 1);
    await crow.getByRole("button", { name: "Registrar assinatura" }).click(); await page.getByRole("dialog").getByRole("button", { name: "Registrar" }).click();
    await expect(page.getByText("Assinatura registrada.")).toBeVisible(); await expect(crow.getByText("Vigente")).toBeVisible();
    expect(Number((await central(mgr)).cards.contracts_awaiting.value)).toBe(Number(before.cards.contracts_awaiting.value));
    await expect(page.getByText(/não há assinatura eletrônica/i)).toBeVisible();                       // escopo dito claramente
    const cid = ((await g.rpc("adm_contracts_list", { p_unit: null, p_owner: null, p_type: null, p_status: null, p_limit: 500 })).body as { id: string; title: string }[]).find((x) => x.title === `Contrato E2E R11 ${runId}`)!.id; S.contract = cid;

    // verificação de contato: formato válido ≠ verificado
    await page.goto("/admin/adm/pendencias?aba=contatos");
    await page.getByLabel("Buscar cadastro pelo nome").fill(nm);
    const krow = page.getByRole("row").filter({ hasText: "example.com" }).filter({ hasText: person.full_name });
    await expect(krow).toBeVisible({ timeout: 20_000 }); await expect(krow.getByText("Válido")).toBeVisible(); await expect(krow.getByText("Não verificado")).toBeVisible();
    await expect(krow.getByText(`e2e.r11.${runId}@example.com`)).toHaveCount(0);                        // valor mascarado
    await krow.getByRole("button", { name: "Registrar verificação" }).click(); await page.getByRole("dialog").getByRole("button", { name: "Registrar" }).click();
    await expect(page.getByText("Verificação registrada.")).toBeVisible(); await expect(krow.getByText("Verificado", { exact: true })).toBeVisible();
    const after = await central(mgr); expect(after.kpis.contacts.verified_available).toBe(true); expect(Number(after.kpis.contacts.verified)).toBeGreaterThanOrEqual(1);
    expect(Number(after.kpis.contacts.valid_format)).toBeGreaterThanOrEqual(1);                        // continuam indicadores diferentes
    await expectNoFatal(page);
    expect(errors, errors.join("\n")).toEqual([]);
  });

  test("permissões: comercial lê e não escreve; fisioterapeuta não abre; gestor de unidade só vê a própria unidade", async ({ page, context }) => {
    const com = await signIn(QA.comercial); const c = api(com);
    expect((await c.rpc("adm_central", { p_from: FROM(), p_to: TO(), p_unit: null, p_owner: null, p_type: null, p_kind: null, p_status: null })).status).toBe(200);
    expect((await c.rpc("adm_pendency_create", { p_kind: "outro", p_title: "comercial não escreve", p_detail: null, p_subject_type: null, p_subject: null, p_unit: null, p_responsible: null, p_due: null })).status).toBeGreaterThanOrEqual(400);
    expect((await c.rpc("adm_sync")).status).toBeGreaterThanOrEqual(400);
    const fis = await signIn(QA.fisio); expect((await api(fis).rpc("adm_central", { p_from: FROM(), p_to: TO(), p_unit: null, p_owner: null, p_type: null, p_kind: null, p_status: null })).status).toBeGreaterThanOrEqual(400);
    expect((await api(fis).rpc("adm_pendency_list", { p_unit: null, p_owner: null, p_type: null, p_kind: null, p_status: null, p_limit: 10 })).status).toBeGreaterThanOrEqual(400);
    // gestor de unidade: lê a própria unidade e é recusado nas demais; nada de escrita de configuração
    const gu = await signIn(QA.gestorUnidade); const mgr = await signIn(QA.manager);
    const units = (await api(mgr).get("units?select=id,name")).body as { id: string }[];
    const res = await Promise.all(units.map(async (u) => (await api(gu).rpc("adm_central", { p_from: FROM(), p_to: TO(), p_unit: u.id, p_owner: null, p_type: null, p_kind: null, p_status: null })).status));
    expect(res.filter((x) => x === 200).length).toBeGreaterThanOrEqual(1); if (units.length > 1) expect(res.filter((x) => x >= 400).length).toBeGreaterThanOrEqual(1);
    expect((await api(gu).rpc("adm_settings_save", { p_expiring_days: 30, p_package_low_sessions: 2, p_waiting_alert_days: 7, p_due_days: {} })).status).toBeGreaterThanOrEqual(400);
    // telas: fisioterapeuta vê "Sem permissão"; comercial abre o dashboard (leitura)
    await loginAs(context, QA.fisio); await page.goto("/admin/adm"); await expect(page.getByRole("heading", { name: "Sem permissão" })).toBeVisible({ timeout: 20_000 });
    const ctx2 = await page.context().browser()!.newContext(); const p2 = await ctx2.newPage(); await loginAs(ctx2, QA.comercial); await p2.goto("/admin/adm");
    await expect(p2.getByRole("heading", { name: "Prioridades administrativas" })).toBeVisible({ timeout: 40_000 }); await ctx2.close();
  });

  test("limpeza: documento removido, contrato cancelado, contato e tipo de teste desfeitos", async () => {
    // remove TUDO que este spec cria (inclusive sobras de execuções interrompidas): pelo prefixo dos títulos de teste
    const mgr = await signIn(QA.manager); const g = api(mgr);
    const contracts = (await g.rpc("adm_contracts_list", { p_unit: null, p_owner: null, p_type: null, p_status: null, p_limit: 500 })).body as { id: string; title: string; status: string }[];
    for (const c of contracts) if (c.title.startsWith("Contrato E2E R11 ") && c.status !== "cancelled") await g.rpc("adm_contract_cancel", { p_id: c.id, p_reason: "limpeza do teste E2E" });
    const docs = (await g.rpc("adm_documents_list", { p_unit: null, p_type: "pf", p_state: null, p_limit: 500 })).body as { doc_id?: string; title?: string }[];
    for (const d of docs) if (d.doc_id && d.title?.startsWith("Documento E2E ")) await g.rpc("adm_document_remove", { p_subject_type: "person", p_id: d.doc_id });
    await rest(mgr, "DELETE", "person_contacts?value=like.e2e.r11.*");
    const cfg = (await g.rpc("adm_config_get")).body as { doc_types: { id: string; code: string; label: string; applies_to: string; has_expiry: boolean; active: boolean }[] };
    for (const t of cfg.doc_types) if (t.label.startsWith("Doc E2E R11 ") && t.active) await g.rpc("adm_doc_type_save", { p_id: t.id, p_code: t.code, p_label: t.label, p_applies_to: t.applies_to, p_has_expiry: t.has_expiry, p_active: false });
    const open = (await g.rpc("adm_pendency_list", { p_unit: null, p_owner: null, p_type: null, p_kind: null, p_status: "open", p_limit: 500 })).body as { id: string; title: string }[];
    for (const p of open) if (/ E2E R11 /.test(p.title)) await g.rpc("adm_pendency_cancel", { p_id: p.id, p_reason: "limpeza do teste E2E" });
  });
});

test.describe.serial("@release Central de pendências administrativas (celular)", () => {
  test.setTimeout(150_000);
  test.use({ viewport: { width: 390, height: 844 }, hasTouch: true, isMobile: true });

  test("dashboard no celular: sem rolagem lateral da página, cartões legíveis, filtro em gaveta e detalhe abre", async ({ page, context }) => {
    const s = await loginAs(context, QA.manager); await api(s).rpc("adm_sync"); const srv = await central(s); const pj = await central(s, { p_type: "pj" });
    await page.goto("/admin/adm");
    await expect(page.getByRole("heading", { name: "Prioridades administrativas" })).toBeVisible({ timeout: 40_000 });
    for (const [label, key] of CARDS) { await expect(cardBtn(page, label)).toBeVisible(); expect(await cardValue(page, label)).toBe(fmt(srv.cards[key].value)); }
    const w = await page.evaluate(() => ({ sw: document.documentElement.scrollWidth, iw: window.innerWidth }));
    expect(w.sw, `a página não pode rolar na horizontal (${w.sw} > ${w.iw})`).toBeLessThanOrEqual(w.iw + 1);
    // filtro em gaveta
    await page.getByRole("button", { name: /^Filtrar/ }).click();
    await expect(page.getByRole("heading", { name: "Filtros" })).toBeVisible();
    await page.locator("#adm-f-type").selectOption("pj"); await page.getByRole("button", { name: "Aplicar" }).click();
    await expect(cardBtn(page, /^Cadastros incompletos/).locator("p.tabular")).toHaveText(fmt(pj.cards.incomplete.value), { timeout: 30_000 });
    // detalhe em tela cheia
    await openAndCompare(page, /^Cadastros incompletos/);
    const w2 = await page.evaluate(() => ({ sw: document.documentElement.scrollWidth, iw: window.innerWidth })); expect(w2.sw).toBeLessThanOrEqual(w2.iw + 1);
  });

  test("pendências no celular: abas, nova pendência e ações cabem na tela", async ({ page, context }) => {
    const mgr = await loginAs(context, QA.manager); const t3 = `Pendência celular E2E R11 ${runId}`;
    await page.goto("/admin/adm/pendencias");
    await expect(page.getByRole("tab", { name: "Pendências" })).toBeVisible({ timeout: 30_000 });
    await page.getByRole("button", { name: "Nova pendência" }).click();
    const form = page.getByRole("form", { name: "Nova pendência" });
    await form.getByLabel("Motivo", { exact: true }).fill(t3); await form.getByRole("button", { name: "Registrar pendência" }).click();
    await expect(page.getByText("Pendência registrada.")).toBeVisible({ timeout: 20_000 });
    const row = page.getByRole("row").filter({ hasText: t3 }); await expect(row).toBeVisible(); await expect(row.getByRole("button", { name: "Concluir" })).toBeVisible();
    const w = await page.evaluate(() => ({ sw: document.documentElement.scrollWidth, iw: window.innerWidth })); expect(w.sw, "tabela rola dentro do cartão, não a página").toBeLessThanOrEqual(w.iw + 1);
    for (const tab of ["Documentos", "Contratos", "Contatos", "Requisitos e prazos"]) { await page.getByRole("tab", { name: tab }).click(); await expect(page.getByRole("tab", { name: tab })).toHaveAttribute("aria-selected", "true"); const wx = await page.evaluate(() => document.documentElement.scrollWidth - window.innerWidth); expect(wx, `aba ${tab} sem rolagem lateral da página`).toBeLessThanOrEqual(1); }
    const l = (await api(mgr).rpc("adm_pendency_list", { p_unit: null, p_owner: null, p_type: null, p_kind: null, p_status: "open", p_limit: 500 })).body as { id: string; title: string }[];
    const mine = l.find((x) => x.title === t3); if (mine) await api(mgr).rpc("adm_pendency_cancel", { p_id: mine.id, p_reason: "limpeza do teste E2E" });
  });
});
