// ACEITE — Portais F2: responsável legal agindo pela criança (vínculo criado e verificado pela tela do admin), banner “em nome de”, consentimento registrado,
// leitura do prontuário pelo admin com registro visível ao paciente, e vínculo inexistente que não abre nada. Somente Dev.
import { expect, test } from "@playwright/test";
import { ANON, SUPABASE_URL } from "../helpers";
import { api, collectErrors, createConfirmedUser, devSql, loginAs, QA, runId, signIn, uiLogin } from "./helpers-release";

test.use({ locale: "pt-BR", timezoneId: "America/Sao_Paulo" });

test.describe.serial("@release Responsável legal, consentimentos e acesso do admin", () => {
  test.setTimeout(150_000);
  const mae = `Mae R36 ${runId}`, crianca = `Crianca R36 ${runId}`; const emailMae = `mae.r36.${runId}@hp-test.dev`; const pass = `Tmp-${runId}-aA1!`;
  let uMae = "", pMae = "", pKid = "";

  test("fixtures: mãe com conta confirmada ligada ao cadastro; criança de 8 anos com uma meta", async () => {
    const g = api(await signIn(QA.manager)); const unit = (await g.get("units?select=id&slug=eq.sao-paulo")).body[0].id;
    const a = await g.rpc("create_person", { p_full_name: mae, p_unit_id: unit, p_kinds: ["patient"], p_email: emailMae, p_phone: null, p_notes: null, p_force: true }); expect(a.status, JSON.stringify(a.body)).toBe(200); pMae = a.body.id;
    const b = await g.rpc("create_person", { p_full_name: crianca, p_unit_id: unit, p_kinds: ["patient"], p_email: `crianca.r36.${runId}@t.local`, p_phone: null, p_notes: null, p_force: true }); expect(b.status, JSON.stringify(b.body)).toBe(200); pKid = b.body.id;
    uMae = await createConfirmedUser(emailMae, pass);
    const link = await g.rpc("person_portal_access", { p_person: pMae, p_email: emailMae }); expect(link.status, JSON.stringify(link.body)).toBe(200);
    await devSql(`update public.people set birth_date = current_date - interval '8 years' where id = '${pKid}';
      insert into public.patient_goals (org_id, unit_id, person_id, title) select org_id, unit_id, id, 'Meta E2E ${runId}' from public.people where id = '${pKid}'`);
  });

  test("admin cria o vínculo pela tela e o verifica; antes disso ele não vale", async ({ page, context }) => {
    const errors = collectErrors(page); await loginAs(context, QA.manager);
    await page.goto("/admin/responsaveis"); await expect(page.getByRole("heading", { name: "Responsáveis e cuidadores" }).first()).toBeVisible({ timeout: 30_000 });
    const form = page.getByRole("form", { name: "Novo vínculo" });
    await form.getByLabel("Paciente (quem é representado)").fill(crianca.slice(0, 18)); await form.getByRole("button", { name: new RegExp(crianca) }).first().click();
    await form.getByLabel("Responsável, cuidador ou representante").fill(mae.slice(0, 14)); await form.getByRole("button", { name: new RegExp(mae) }).first().click();
    await form.getByRole("button", { name: "Criar vínculo" }).click(); await expect(page.getByText(/Vínculo criado/)).toBeVisible({ timeout: 20_000 });
    const row = page.getByTestId("rep-row").filter({ hasText: crianca }); await expect(row).toContainText("Aguardando verificação");
    await row.getByRole("button", { name: "Verificar" }).click();
    await page.getByRole("dialog").getByRole("button", { name: "Conferi o original" }).click();
    await expect(page.getByText("Vínculo verificado.")).toBeVisible({ timeout: 20_000 }); await expect(row).toContainText("Ativo");
    expect(errors, errors.join("\n")).toEqual([]);
  });

  test("mãe usa o aplicativo em nome da criança: banner, Início da criança, consentimento registrado “por um responsável”; volta para si", async ({ page }) => {
    const errors = collectErrors(page);
    await uiLogin(page, emailMae, pass); await expect(page).toHaveURL(/\/paciente$/, { timeout: 40_000 }); await expect(page.getByTestId("patient-home")).toBeVisible({ timeout: 30_000 });
    await expect(page.getByTestId("acting-banner")).toHaveCount(0);
    await page.getByRole("button", { name: "Menu do usuário" }).click(); await page.getByTestId("acting-option").filter({ hasText: crianca }).click();
    await expect(page.getByTestId("acting-banner")).toContainText(crianca); await expect(page.getByRole("heading", { level: 1 })).toContainText(`Olá, ${crianca.split(" ")[0]}`, { timeout: 30_000 });
    await page.goto("/paciente/evolucao"); await expect(page.getByText(`Meta E2E ${runId}`)).toBeVisible({ timeout: 30_000 });   // dado clínico da criança, visto pela mãe
    await page.goto("/paciente/mais"); await expect(page.getByTestId("acting-banner")).toBeVisible();
    const c = page.getByTestId("consent-saude"); await c.getByRole("button", { name: "Conceder" }).click();
    await expect(c).toContainText("Concedido", { timeout: 20_000 }); await expect(c).toContainText("por um responsável");
    const rows = (await devSql(`select granted, in_name_of from public.consents where person_id = '${pKid}' and kind = 'saude'`)) as { granted: boolean; in_name_of: boolean }[]; expect(rows).toEqual([{ granted: true, in_name_of: true }]);
    await page.getByTestId("acting-banner").getByRole("button", { name: "Voltar para mim" }).click(); await expect(page.getByTestId("acting-banner")).toHaveCount(0); await expect(page.getByTestId("patient-home")).toBeVisible({ timeout: 30_000 });
    expect(errors.filter((e) => !/403|42501/.test(e)), errors.join("\n")).toEqual([]);
  });

  test("admin (gestor) abre o prontuário: o acesso é registrado e a mãe o vê em “Quem acessou o prontuário”", async ({ page, context, browser }) => {
    await loginAs(context, QA.manager); await page.goto("/admin/responsaveis");
    const row = page.getByTestId("rep-row").filter({ hasText: crianca }); await row.getByRole("button", { name: "Ver prontuário" }).click();
    const sheet = page.getByTestId("admin-chart"); await expect(sheet).toContainText(`Meta E2E ${runId}`, { timeout: 30_000 });
    const n = (await devSql(`select count(*)::int n from public.clinical_access_log where person_id = '${pKid}' and accessed_by_role = 'admin'`)) as { n: number }[]; expect(n[0].n).toBe(1);
    const ctx = await browser.newContext({ locale: "pt-BR" }); const p2 = await ctx.newPage();
    await uiLogin(p2, emailMae, pass); await expect(p2.getByTestId("patient-home")).toBeVisible({ timeout: 30_000 });
    await p2.getByRole("button", { name: "Menu do usuário" }).click(); await p2.getByTestId("acting-option").filter({ hasText: crianca }).click();
    await p2.goto("/paciente/mais"); await expect(p2.getByRole("region", { name: "Quem acessou meu prontuário" })).toContainText("administração", { timeout: 30_000 });
    await ctx.close();
  });

  test("quem não tem vínculo não age pela criança, mesmo forçando o cabeçalho; cuidador/estranho recebe aviso e volta ao próprio perfil", async ({ page, context }) => {
    const s = await loginAs(context, QA.paciente);
    const r = await fetch(`${SUPABASE_URL}/rest/v1/rpc/my_home`, { method: "POST", headers: { apikey: ANON, authorization: `Bearer ${s.access_token}`, "content-type": "application/json", "x-acting-as": pKid }, body: "{}" });
    expect(r.status, "cabeçalho sozinho não dá acesso").not.toBe(200);
    await page.addInitScript((id) => localStorage.setItem("hp-acting-as", id), pKid);
    await page.goto("/paciente"); await expect(page.getByText(/não está mais ativo/)).toBeVisible({ timeout: 30_000 });
    await expect(page.getByText(crianca)).toHaveCount(0);
    await page.getByRole("button", { name: "Voltar para o meu perfil" }).click(); await expect(page.getByTestId("patient-home")).toBeVisible({ timeout: 30_000 });
  });

  test("limpeza: pessoas, conta, vínculo, consentimentos e registros de teste removidos", async () => {
    test.skip(!process.env.SUPABASE_ACCESS_TOKEN, "precisa de SUPABASE_ACCESS_TOKEN");
    const ids = `'${pMae}', '${pKid}'`;
    await devSql(`delete from public.clinical_access_log where person_id in (${ids}); delete from public.consents where person_id in (${ids}); delete from public.care_representations where patient_person_id in (${ids}) or representative_person_id in (${ids});
      delete from public.patient_goals where person_id in (${ids}); delete from public.invitations where email = '${emailMae}'; delete from public.user_accounts where user_id = '${uMae}'; delete from public.role_assignments where user_id = '${uMae}'`);
    await devSql(`delete from auth.users where id = '${uMae}'`);
    await devSql(`delete from public.person_kinds where person_id in (${ids})`).catch(() => null);
    await devSql(`delete from public.person_contacts where person_id in (${ids})`).catch(() => null);
    await devSql(`delete from public.people where id in (${ids})`).catch(() => null);
    const n = (await devSql(`select count(*)::int n from public.people where id in (${ids})`)) as { n: number }[]; expect(n[0].n).toBe(0);
  });
});
