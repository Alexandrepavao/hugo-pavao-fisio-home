// ACEITE da release v1 — o que a pessoa preencheu no formulário aparece no cadastro e no CRM; Distribuição geográfica no CRM (migration 088).
//  · caso didático: parceira que respondeu o quiz (registro ativo, área geriátrica, sem interesse na clínica no momento, Campinas/SP)
//  · Planilha administrativa (ficha da pessoa), card da oportunidade no CRM (Gestão de leads) e Contatos mostram cidade/UF e as respostas
//  · Distribuição geográfica no Dashboard do CRM e em Contatos (clicar no estado filtra a lista); local do quiz vai para o cadastro
import { expect, test } from "@playwright/test";
import { ANON, SUPABASE_URL } from "../helpers";
import { api, collectErrors, expectNoFatal, loginAs, QA, runId, signIn } from "./helpers-release";

test.use({ timezoneId: "America/Sao_Paulo", locale: "pt-BR" });

// o limite do quiz é por IP: o teste usa um IP de origem próprio (primeiro valor de x-forwarded-for)
const ip = `10.32.${Math.floor(Math.random() * 250) + 1}.${Math.floor(Math.random() * 250) + 1}`;
const anon = async (fn: string, body: unknown) => {
  const r = await fetch(`${SUPABASE_URL}/rest/v1/rpc/${fn}`, { method: "POST", headers: { apikey: ANON, authorization: `Bearer ${ANON}`, "content-type": "application/json", "x-forwarded-for": ip }, body: JSON.stringify(body) });
  return { status: r.status, body: await r.json().catch(() => null) };
};
const tag = runId.toLowerCase(); const nome = `Vanessa Exemplo R32 ${runId}`;
const ans = (value: unknown, label: string) => ({ value, label });
const phone = () => `(19) 9${Math.floor(1000 + Math.random() * 8999)}-${Math.floor(1000 + Math.random() * 8999)}`;

test.describe.serial("@release Formulário preenchido no cadastro e no CRM + Distribuição geográfica do CRM", () => {
  test.setTimeout(180_000);
  let personId = ""; const fone = phone(); const email = `vanessa.r32.${tag}@example.com`;

  test("fixture: parceira preenche o quiz (registro ativo, geriátrica, sem interesse na clínica; Campinas/SP) e o local chega ao cadastro", async () => {
    const s = await anon("quiz_start", { p_journey: "parceria", p_name: nome, p_email: email, p_phone: fone, p_contact_consent_version: "contact-v1", p_origin_path: "/trabalhe-conosco", p_page_slug: "trabalhe-conosco", p_referrer: null, p_utm: {}, p_honeypot: null });
    expect(s.status, JSON.stringify(s.body)).toBe(200); const id = (s.body as { id: string }).id;
    expect((await anon("quiz_save_progress", { p_id: id, p_step: 4, p_answers: {}, p_city: "Campinas", p_uf: "SP" })).status).toBe(200);
    expect((await anon("quiz_save_progress", { p_id: id, p_step: 5, p_answers: { momento_profissional: ans("em_atuacao", "Fisioterapeuta em atuação"), situacao_registro: ans("ativo", "Ativo"), crefito: ans("CREFITO-3/123456-F", "CREFITO-3/123456-F"), area_atuacao: ans("geriatrica", "Geriátrica"), modelo_atendimento: ans("domiciliar", "Atendimento domiciliar"), objetivos_parceria: ans(["equipe"], "Atuar na equipe"), interesses_desenvolvimento: ans(["nenhuma"], "Nenhuma no momento") } })).status).toBe(200);
    expect((await anon("quiz_save_progress", { p_id: id, p_step: 11, p_answers: { interesse_programa_clinica: ans("nao_momento", "Não neste momento") } })).status).toBe(200);
    expect((await anon("quiz_complete", { p_id: id, p_marketing_consent: false, p_marketing_consent_version: null })).status).toBe(200);
    const g = api(await signIn(QA.manager)); const p = (await g.get(`people?select=id,city,state_uf&full_name=eq.${encodeURIComponent(nome)}`)).body as { id: string; city: string | null; state_uf: string | null }[];
    const ficha = (await g.get(`opportunities?select=profile,pipeline:pipelines(kind)&person_id=eq.${p[0].id}`)).body as { profile: { council_registry?: string }; pipeline: { kind: string } }[];
    expect(ficha.find((o) => o.pipeline.kind === "partners")?.profile.council_registry, "CREFITO na ficha da oportunidade de parceiro").toBe("CREFITO-3/123456-F");
    expect(p).toHaveLength(1); personId = p[0].id; expect(p[0]).toMatchObject({ city: "Campinas", state_uf: "SP" });          // o quiz preencheu o cadastro
  });

  test("Planilha administrativa: a ficha da pessoa mostra o formulário preenchido, com cidade e estado", async ({ page, context }) => {
    await loginAs(context, QA.manager); const errors = collectErrors(page);
    await page.goto(`/admin/adm/diretorio?q=${encodeURIComponent(nome)}`); await page.getByRole("button", { name: nome }).click();
    const f = page.getByTestId("adm-formularios"); await expect(f).toBeVisible({ timeout: 30_000 });
    await expect(f.getByTestId("form-answers-city")).toHaveText("Campinas"); await expect(f.getByTestId("form-answers-uf")).toHaveText("SP");
    await expect(f.getByTestId("form-answers-crefito")).toHaveText("CREFITO-3/123456-F"); await expect(f).toContainText("Qual é o número do seu CREFITO?");
    await expect(f).toContainText("Qual é sua situação de registro profissional?"); await expect(f.getByText("Ativo", { exact: true })).toBeVisible();
    await expect(f).toContainText("Qual é sua principal área de atuação ou interesse?"); await expect(f.getByText("Geriátrica", { exact: true })).toBeVisible();
    await expect(f).toContainText("programa de ensino para você ter a sua própria clínica"); await expect(f.getByText("Não neste momento", { exact: true })).toBeVisible();
    await expect(page.locator("#pf-city")).toHaveValue("Campinas"); await expect(page.locator("#pf-uf")).toHaveValue("SP");   // e o cadastro em si também tem a cidade/UF
    await page.screenshot({ path: `${process.env.TEMP}\\r32-planilha.png` });
    await expectNoFatal(page); expect(errors, errors.join("\n")).toEqual([]);
  });

  test("CRM › Gestão de leads: o card da oportunidade tem a aba Formulário e a cidade/UF no resumo", async ({ page, context }) => {
    await loginAs(context, QA.comercial); const errors = collectErrors(page);
    await page.goto("/admin/crm/leads"); await page.getByRole("button", { name: nome }).first().click();
    await expect(page.getByTestId("opp-local")).toHaveText("Campinas/SP", { timeout: 30_000 });
    await page.getByRole("tab", { name: "Formulário" }).click();
    const f = page.getByTestId("opp-formulario"); await expect(f.getByTestId("form-answers-city")).toHaveText("Campinas"); await expect(f.getByTestId("form-answers-uf")).toHaveText("SP");
    await expect(f.getByText("Ativo", { exact: true })).toBeVisible(); await expect(f.getByText("Geriátrica", { exact: true })).toBeVisible(); await expect(f.getByText("Não neste momento", { exact: true })).toBeVisible();
    await page.screenshot({ path: `${process.env.TEMP}\\r32-card.png` });
    expect(errors, errors.join("\n")).toEqual([]);
  });

  test("CRM › Contatos: coluna Cidade/UF, clique no nome abre o formulário e clicar no estado do mapa filtra a lista", async ({ page, context }) => {
    await loginAs(context, QA.manager); const errors = collectErrors(page);
    await page.setViewportSize({ width: 1440, height: 1000 });
    await page.goto("/admin/crm/contatos"); await expect(page.getByTestId("crm-geo").getByTestId("brazil-map")).toBeVisible({ timeout: 40_000 });
    await page.locator("#ct-q").fill(nome);
    const linha = page.getByRole("row").filter({ hasText: nome }); await expect(linha).toHaveCount(1); await expect(linha).toContainText("Campinas/SP");
    await linha.getByRole("button", { name: new RegExp(`Ver formulário e dados de ${nome}`) }).click();
    const d = page.getByTestId("contato-detalhe"); await expect(d.getByTestId("form-answers-city")).toHaveText("Campinas"); await expect(d.getByText("Geriátrica", { exact: true })).toBeVisible();
    await page.keyboard.press("Escape"); await expect(d).toHaveCount(0);
    // mapa: clicar no estado filtra a lista de contatos por UF
    await page.locator("#ct-q").fill("");
    await page.getByTestId("crm-geo").locator('path[data-uf="SP"]').click();
    await expect(page.getByText("Filtrando pelo estado SP")).toBeVisible(); await expect(page.getByRole("row").filter({ hasText: nome })).toHaveCount(1);
    for (const r of await page.locator("tbody tr").all()) { const t = await r.innerText(); if (/\/[A-Z]{2}\b/.test(t)) expect(t, "só contatos de SP").toContain("/SP"); }
    await expectNoFatal(page); expect(errors, errors.join("\n")).toEqual([]);
  });

  test("CRM › Dashboard: Distribuição geográfica por tipo de lead, com a parceira em Campinas/SP", async ({ page, context }) => {
    await loginAs(context, QA.manager); const errors = collectErrors(page);
    await page.setViewportSize({ width: 1440, height: 1000 });
    await page.goto("/admin/crm"); const geo = page.getByTestId("crm-geo"); await expect(geo.getByTestId("brazil-map")).toBeVisible({ timeout: 40_000 });
    await expect(page.getByText("Distribuição geográfica").first()).toBeVisible();
    for (const t of ["Todos os contatos", "Pacientes", "Equipe", "HP Academy", "Empresas"]) await expect(geo.getByRole("tab", { name: t })).toBeVisible();
    await geo.getByRole("tab", { name: "Equipe" }).click();
    expect(Number(await geo.locator('path[data-uf="SP"]').getAttribute("data-class"))).toBeGreaterThan(0);
    await expect(geo.getByRole("row").filter({ hasText: "Campinas" })).toHaveCount(1);
    // clicar na cidade lista os contatos dela, com nome, telefone e e-mail
    await geo.getByRole("button", { name: "Campinas", exact: true }).click();
    const lista = geo.getByTestId("geo-cidade-contatos"); await expect(lista).toContainText("Contatos em Campinas/SP");
    const linha = lista.getByRole("row").filter({ hasText: nome }); await expect(linha).toHaveCount(1);
    await expect(linha).toContainText(fone); await expect(linha).toContainText(email);
    await linha.getByRole("button", { name: new RegExp(`Ver formulário e dados de ${nome}`) }).click();
    const det = page.getByTestId("geo-contato-detalhe"); await expect(det.getByTestId("form-answers-city")).toHaveText("Campinas"); await expect(det.getByText("Geriátrica", { exact: true })).toBeVisible();
    await page.keyboard.press("Escape"); await expect(det).toHaveCount(0);
    await page.screenshot({ path: `${process.env.TEMP}\\r32-geo.png` });
    await expectNoFatal(page); expect(errors, errors.join("\n")).toEqual([]);
  });

  test("permissões: fisioterapeuta não vê a distribuição do CRM nem as respostas dos formulários (servidor recusa)", async () => {
    const g = api(await signIn(QA.fisio));
    expect((await g.rpc("crm_geo_distribution", { p_kind: null, p_unit: null })).status).toBeGreaterThanOrEqual(400);
    expect((await g.rpc("person_form_answers", { p_person: personId })).status).toBeGreaterThanOrEqual(400);
  });
});
