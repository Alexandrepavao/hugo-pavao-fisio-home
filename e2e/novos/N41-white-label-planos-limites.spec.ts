import { test, expect } from "@playwright/test";
import { execFileSync } from "node:child_process";
import { mkdirSync, writeFileSync } from "node:fs";
import { signIn, useSession, runId, type Session } from "../helpers";
import { call, get, haveHarness, mkUser, PLATFORM, provision } from "./helpers-wl";

// @novo — WHITE LABEL: planos, assinatura por organização, consumo, histórico e limites. Plano QA criado PELA INTERFACE da plataforma; organização criada pelo motor de provisionamento.
// Prova: criar plano (sem preço), definir módulos e limites (não configurado × ilimitado × zero), associar a organização, consultar consumo e histórico, e o limite de NOVAS criações sob 8 requisições SIMULTÂNEAS
// (só passam as que cabem no limite; o resto recebe P0011; nada é apagado). O faturamento da plataforma continua separado do financeiro da clínica. Só Dev.
const SHOTS = "docs/white-label/screenshots/planos"; mkdirSync(SHOTS, { recursive: true });
const PLANO = `qa_n41_${runId.slice(-6)}`; const SUB = `plano-${runId.slice(-6)}`; const GESTOR = `plano.gestor.${runId}@example.test`;

test.use({ timezoneId: "America/Sao_Paulo", locale: "pt-BR", viewport: { width: 1440, height: 900 }, actionTimeout: 30_000 });
test.describe.serial("@novo White label — planos, assinatura, consumo e limites", () => {
  test.skip(!haveHarness, "precisa de SUPABASE_ACCESS_TOKEN e HP_QA_PASSWORD");
  test.setTimeout(180_000);
  let plat: Session; let org = ""; let gestor: Session; let unit = ""; const m: Record<string, unknown> = {};

  test.beforeAll(async () => {
    execFileSync("node", ["supabase/tools/wl-limpar-orgs-teste.mjs", "plano-"], { stdio: "pipe" }); plat = await signIn(PLATFORM);
    const p = await provision(plat, { name: `Clínica Plano ${runId}`, sub: SUB, email: GESTOR }); org = p.org_id; await mkUser(GESTOR); gestor = await signIn(GESTOR);   // conta do gestor SIMULADA (e-mail do convite não clicado)
    unit = (await get(gestor, "units?select=id&limit=1", org)).body[0].id;
  });

  test("1. plataforma cria o plano QA pela interface: rascunho, SEM preço; módulos e limites (vazio = não configurado, ilimitado, 0)", async ({ page, context }) => {
    await useSession(context, plat); await page.goto("/plataforma/planos");
    await page.getByTestId("novo-plano-chave").fill(PLANO); await page.getByTestId("novo-plano-nome").fill("Plano QA N41"); await page.getByTestId("criar-plano").click();
    await expect(page.getByText(/Plano criado em rascunho, sem preço/)).toBeVisible({ timeout: 20_000 });
    const row = page.getByRole("row").filter({ hasText: "Plano QA N41" }); await expect(row).toBeVisible({ timeout: 20_000 }); await expect(row).toContainText("a definir");   // implantação e mensalidade
    await page.getByLabel("Unidades", { exact: true }).fill("2"); await page.getByLabel("Profissionais", { exact: true }).fill("ilimitado"); await page.getByLabel("Usuários da equipe").fill("0");
    await page.getByLabel("Módulos incluídos").getByLabel(/CRM/i).check().catch(() => undefined);
    await page.getByRole("button", { name: "Salvar plano" }).click(); await expect(page.getByText(/Plano salvo/)).toBeVisible({ timeout: 20_000 });
    const saved = (await call(plat, "platform_catalog")).body.plans.find((x: { key: string }) => x.key === PLANO);
    expect(saved.monthly_fee_cents).toBeNull(); expect(saved.implementation_fee_cents).toBeNull();
    expect(saved.limits).toEqual({ max_units: 2, max_professionals: null, max_staff_users: 0 });     // pacientes: chave ausente = não configurado
    expect("max_active_patients" in saved.limits).toBe(false);
    // valores inválidos são recusados no servidor e na tela
    await page.getByLabel("Unidades", { exact: true }).fill("-3"); await page.getByRole("button", { name: "Salvar plano" }).click(); await expect(page.getByRole("alert").filter({ hasText: /inteiros não negativos|inválidos/ })).toBeVisible();
    await page.getByLabel("Unidades", { exact: true }).fill("2");
    await expect(page.getByTestId("plan-history")).toContainText("criado"); await page.screenshot({ path: `${SHOTS}/01-plano-qa-limites.png` });
    // o gestor de uma clínica NÃO enxerga nem altera planos
    expect((await call(gestor, "platform_plan_save", { p_key: PLANO, p_patch: { name: "x" } }, org)).status).toBeGreaterThanOrEqual(400);
  });

  test("2. associar a organização ao plano, ver consumo e histórico (antes → depois)", async ({ page, context }) => {
    await useSession(context, plat); await page.goto("/plataforma");
    await page.getByRole("row").filter({ hasText: `Clínica Plano ${runId}` }).getByRole("button", { name: "Detalhes" }).click();
    const box = page.getByTestId("assinatura"); await expect(box).toBeVisible();
    await box.getByTestId("sub-plano").selectOption(PLANO); await box.getByTestId("sub-imposicao").selectOption("block_new"); await box.getByTestId("salvar-assinatura").click();
    await expect(box.getByText(/Assinatura salva/)).toBeVisible({ timeout: 20_000 });
    await expect(page.getByTestId("estado-staff_users")).toBeVisible({ timeout: 20_000 });
    await expect(page.getByTestId("estado-active_patients")).toContainText("não configurado"); await expect(page.getByTestId("estado-professionals")).toContainText("ilimitado");
    await expect(page.getByTestId("estado-units")).toContainText(/dentro|perto/);
    // exceção só desta organização: unidades = 1 (sobrepõe o plano) → o histórico mostra o antes e o depois
    await box.getByTestId("sub-unidades").fill("1"); await box.getByTestId("salvar-assinatura").click(); await expect(box.getByTestId("sub-history")).toContainText("limits_override", { timeout: 20_000 });
    await page.screenshot({ path: `${SHOTS}/02-assinatura-e-consumo.png`, fullPage: true });
    const h = (await call(plat, "platform_history", { p_type: "subscription", p_id: org })).body as { before: Record<string, unknown> | null; after: { plan_key: string; limits_override: Record<string, number> } }[];
    expect(h.length).toBeGreaterThanOrEqual(2); expect(h[0].after.limits_override).toEqual({ max_units: 1 }); expect(h[0].before).toMatchObject({ plan_key: PLANO });
    // o faturamento da plataforma não vira venda/recebível da clínica
    expect((await get(gestor, "sales?select=id", org)).body).toEqual([]); expect((await get(gestor, "receivables?select=id", org)).body).toEqual([]);
  });

  test("3. imposição só de NOVAS criações, sob 8 requisições simultâneas (limite de profissionais = 1): exatamente uma passa; nada é apagado; leitura e exportação continuam", async () => {
    await call(plat, "platform_subscription_set", { p_org: org, p_patch: { limits_override: { max_professionals: 1, max_units: null }, enforcement: "block_new" } });
    const mk = (i: number) => call(gestor, "professional_save", { p_id: null, p_person: null, p_name: `Profissional Concorrente ${i} ${runId}`, p_registration: null, p_units: [unit], p_active: true }, org);
    const t0 = Date.now(); const res = await Promise.all([1, 2, 3, 4, 5, 6, 7, 8].map(mk)); m.concorrencia_ms = Date.now() - t0;
    const ok = res.filter((r) => r.status < 300), blocked = res.filter((r) => r.status >= 400 && /limite do plano atingido/.test(JSON.stringify(r.body)));
    expect(ok, JSON.stringify(res.map((r) => [r.status, String(JSON.stringify(r.body)).slice(0, 80)]))).toHaveLength(1); expect(blocked).toHaveLength(7);
    expect((await get(gestor, "professionals?select=id", org)).body).toHaveLength(1);
    // zero = nenhuma criação nova; "ilimitado" libera de novo
    await call(plat, "platform_subscription_set", { p_org: org, p_patch: { limits_override: { max_professionals: 0 } } });
    expect((await mk(9)).status).toBeGreaterThanOrEqual(400);
    await call(plat, "platform_subscription_set", { p_org: org, p_patch: { limits_override: { max_professionals: null } } });
    expect((await mk(10)).status).toBeLessThan(300);
    // com o limite atingido: o histórico e a exportação NÃO são bloqueados
    await call(plat, "platform_subscription_set", { p_org: org, p_patch: { limits_override: { max_professionals: 1 } } });
    expect((await get(gestor, "people?select=id&limit=1", org)).status).toBe(200); expect((await call(gestor, "org_usage", {}, org)).status).toBe(200);
    expect((await call(gestor, "org_export_request", {}, org)).status).toBeLessThan(300);
    writeFileSync("test-results/wl-planos-concorrencia.json", JSON.stringify({ ...m, requisicoes: 8, aceitas: ok.length, bloqueadas_por_limite: blocked.length }, null, 2));
  });
});
