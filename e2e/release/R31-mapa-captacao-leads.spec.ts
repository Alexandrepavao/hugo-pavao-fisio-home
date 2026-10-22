// ACEITE da release v1 — Captação de leads com MAPA por estado e dados do formulário ao clicar no nome (migration 087).
//  · mapa do Brasil visível, com os segmentos Todos / Pacientes / Parceiros / HP Academy; clicar num estado filtra a lista
//  · clicar no NOME do lead abre o que ele preencheu, com cidade e estado em destaque (paciente, parceiro e Academy)
//  · cidade e estado são obrigatórios: o servidor recusa concluir o quiz sem eles e recusa UF inventada
// Dados próprios (runId); os leads de teste ficam no Dev (a captação não tem exclusão pela tela).
import { expect, test } from "@playwright/test";
import { ANON, SUPABASE_URL } from "../helpers";
import { collectErrors, expectNoFatal, loginAs, QA, runId } from "./helpers-release";

test.use({ timezoneId: "America/Sao_Paulo", locale: "pt-BR" });

// O limite do quiz é por IP (8 inícios a cada 10 min por jornada); o teste usa um IP de origem próprio (primeiro valor de x-forwarded-for) para não gastar o limite dos outros testes.
const ip = `10.31.${Math.floor(Math.random() * 250) + 1}.${Math.floor(Math.random() * 250) + 1}`;
const anon = () => ({
  rpc: async (fn: string, body: unknown) => {
    const r = await fetch(`${SUPABASE_URL}/rest/v1/rpc/${fn}`, { method: "POST", headers: { apikey: ANON, authorization: `Bearer ${ANON}`, "content-type": "application/json", "x-forwarded-for": ip }, body: JSON.stringify(body) });
    return { status: r.status, body: await r.json().catch(() => null) };
  },
});
const tag = runId.toLowerCase();
const nomes = { pac: `Paciente R31 ${runId}`, par: `Parceiro R31 ${runId}`, aca: `Academy R31 ${runId}`, sem: `Sem Cidade R31 ${runId}` };
const phone = () => `(11) 9${Math.floor(1000 + Math.random() * 8999)}-${Math.floor(1000 + Math.random() * 8999)}`;

async function iniciar(journey: "atendimento" | "parceria", nome: string, email: string) {
  const r = await anon().rpc("quiz_start", { p_journey: journey, p_name: nome, p_email: email, p_phone: phone(), p_contact_consent_version: "contact-v1", p_origin_path: "/", p_page_slug: "r31", p_referrer: null, p_utm: {}, p_honeypot: null });
  expect(r.status, JSON.stringify(r.body)).toBe(200); return (r.body as { id: string }).id;
}
const ans = (value: unknown, label = "x") => ({ value, label });
async function fimPaciente(id: string) {
  const a = await anon().rpc("quiz_save_progress", { p_id: id, p_step: 5, p_answers: { interesse_acompanhamento: ans("sim", "Sim"), faixa_investimento: ans("ate_250", "Até R$ 250") } }); expect(a.status, JSON.stringify(a.body)).toBe(200);
  return anon().rpc("quiz_complete", { p_id: id, p_marketing_consent: false, p_marketing_consent_version: null });
}
async function fimParceiro(id: string, programa: string) {
  const a = await anon().rpc("quiz_save_progress", { p_id: id, p_step: 5, p_answers: { momento_profissional: ans("em_atuacao"), situacao_registro: ans("ativo"), area_atuacao: ans("ortopedia"), modelo_atendimento: ans("domiciliar"), objetivos_parceria: ans(["desenvolver_negocio"]), interesses_desenvolvimento: ans(["gestao"]) } }); expect(a.status, JSON.stringify(a.body)).toBe(200);
  const b = await anon().rpc("quiz_save_progress", { p_id: id, p_step: 11, p_answers: { interesse_programa_clinica: ans(programa), ...(programa === "nao_momento" ? {} : { prazo_programa_clinica: ans("tres_meses", "Nos próximos 3 meses") }) } }); expect(b.status, JSON.stringify(b.body)).toBe(200);
  return anon().rpc("quiz_complete", { p_id: id, p_marketing_consent: false, p_marketing_consent_version: null });
}
const local = (id: string, city: string | null, uf: string | null) => anon().rpc("quiz_save_progress", { p_id: id, p_step: 4, p_answers: {}, p_city: city, p_uf: uf });

test.describe.serial("@release Captação de leads: mapa por estado e dados do formulário", () => {
  test.setTimeout(180_000);

  test("fixtures: paciente (SP), parceiro (RJ), Academy (MG) e um lead que parou antes da cidade; o servidor exige cidade e estado", async () => {
    const pac = await iniciar("atendimento", nomes.pac, `pac.r31.${tag}@example.com`); expect((await local(pac, "Santo André", "SP")).status).toBe(200); expect((await fimPaciente(pac)).status).toBe(200);
    const par = await iniciar("parceria", nomes.par, `par.r31.${tag}@example.com`); expect((await local(par, "Niterói", "RJ")).status).toBe(200); expect((await fimParceiro(par, "nao_momento")).status).toBe(200);
    const aca = await iniciar("parceria", nomes.aca, `aca.r31.${tag}@example.com`); expect((await local(aca, "Uberlândia", "MG")).status).toBe(200); expect((await fimParceiro(aca, "quero_entender")).status).toBe(200);
    const sem = await iniciar("atendimento", nomes.sem, `sem.r31.${tag}@example.com`);
    const xx = await local(sem, "Cidade Inventada", "XX"); expect(xx.status, "UF inventada é recusada").toBeGreaterThanOrEqual(400); expect(JSON.stringify(xx.body)).toContain("estado inv");
    const semLocal = await fimPaciente(sem); expect(semLocal.status, "não conclui sem cidade e estado").toBeGreaterThanOrEqual(400); expect(JSON.stringify(semLocal.body)).toContain("Informe a cidade e o estado");
  });

  test("o mapa aparece com os segmentos; clicar num estado filtra a lista e o segmento HP Academy mostra só quem tem interesse no programa", async ({ page, context }) => {
    await loginAs(context, QA.manager); const errors = collectErrors(page);
    await page.setViewportSize({ width: 1440, height: 1000 });
    await page.goto("/admin/captacao-leads");
    const mapa = page.getByTestId("lead-map"); await expect(mapa.getByTestId("brazil-map")).toBeVisible({ timeout: 40_000 });
    await expect(mapa.getByText("Onde estão os leads")).toBeVisible();
    for (const t of ["Todos", "Pacientes", "Parceiros", "HP Academy"]) await expect(mapa.getByRole("tab", { name: t })).toBeVisible();
    // os estados dos leads de teste estão coloridos (data-class > 0)
    for (const uf of ["SP", "RJ", "MG"]) expect(Number(await mapa.locator(`path[data-uf="${uf}"]`).getAttribute("data-class")), `${uf} tem leads no mapa`).toBeGreaterThan(0);
    await page.screenshot({ path: `${process.env.TEMP}\\r31-mapa.png`, fullPage: false });

    const linha = (nome: string) => page.getByRole("row").filter({ hasText: nome });
    await expect(linha(nomes.pac)).toHaveCount(1); await expect(linha(nomes.par)).toHaveCount(1); await expect(linha(nomes.aca)).toHaveCount(1);
    await expect(linha(nomes.sem)).toContainText("não informado");                                   // quem parou antes da etapa aparece sem inventar local

    await mapa.locator('path[data-uf="RJ"]').click();                                               // clique no estado = filtro da lista
    await expect(page.getByRole("heading", { name: "Captações em RJ" })).toBeVisible();
    await expect(linha(nomes.par)).toHaveCount(1); await expect(linha(nomes.pac)).toHaveCount(0); await expect(linha(nomes.aca)).toHaveCount(0);
    await mapa.getByRole("button", { name: "limpar" }).click(); await expect(page.getByRole("heading", { name: "Todas as captações" })).toBeVisible();

    await mapa.getByRole("tab", { name: "HP Academy" }).click();
    await expect(linha(nomes.aca)).toHaveCount(1); await expect(linha(nomes.par)).toHaveCount(0); await expect(linha(nomes.pac)).toHaveCount(0);
    await mapa.getByRole("tab", { name: "Pacientes" }).click();
    await expect(linha(nomes.pac)).toHaveCount(1); await expect(linha(nomes.par)).toHaveCount(0);
    await mapa.getByRole("tab", { name: "Parceiros" }).click();
    await expect(linha(nomes.par)).toHaveCount(1); await expect(linha(nomes.aca)).toHaveCount(1); await expect(linha(nomes.pac)).toHaveCount(0);   // a Academy também é parceria
    await expectNoFatal(page); expect(errors, errors.join("\n")).toEqual([]);
  });

  test("clicar no nome do lead mostra o que ele preencheu, com cidade e estado em destaque (paciente, parceiro, Academy e quem parou antes)", async ({ page, context }) => {
    await loginAs(context, QA.manager); const errors = collectErrors(page);
    await page.setViewportSize({ width: 1440, height: 1000 });
    await page.goto("/admin/captacao-leads");
    await expect(page.getByTestId("brazil-map")).toBeVisible({ timeout: 40_000 });
    const casos: [string, string, string, string][] = [[nomes.pac, "Santo André", "SP", "Paciente"], [nomes.par, "Niterói", "RJ", "Parceiro"], [nomes.aca, "Uberlândia", "MG", "HP Academy"]];
    for (const [nome, cidade, uf, tipo] of casos) {
      await page.getByRole("button", { name: `Ver o que ${nome} preencheu` }).click();
      const d = page.getByTestId("lead-detail"); await expect(d.getByRole("heading", { name: nome })).toBeVisible({ timeout: 20_000 });
      await expect(d.getByTestId("lead-city")).toHaveText(cidade); await expect(d.getByTestId("lead-uf")).toHaveText(uf);
      await expect(d.getByText("Localização informada no formulário")).toBeVisible(); await expect(d.getByText(tipo, { exact: true }).first()).toBeVisible();
      await expect(d.getByText(`${nome.slice(0, 3).toLowerCase()}.r31.${tag}@example.com`)).toBeVisible();       // e-mail preenchido
      await expect(d.getByText("Respostas do formulário")).toBeVisible();
      await expect.poll(async () => { const b = await d.boundingBox(); return b ? b.x + b.width : 9999; }, { message: "o painel cabe na tela (depois da animação)" }).toBeLessThanOrEqual(1440);
      if (nome === nomes.pac) await page.screenshot({ path: `${process.env.TEMP}\\r31-detalhe.png` });
      await page.keyboard.press("Escape"); await expect(d).toHaveCount(0);
    }
    await page.getByRole("button", { name: `Ver o que ${nomes.sem} preencheu` }).click();
    const d = page.getByTestId("lead-detail"); await expect(d.getByRole("heading", { name: nomes.sem })).toBeVisible({ timeout: 20_000 });
    await expect(d.getByTestId("lead-city")).toContainText("Não informada"); await expect(d.getByTestId("lead-uf")).toContainText("Não informado");
    await expect(d.getByText(/parou o formulário antes da etapa de cidade e estado/)).toBeVisible();
    await expectNoFatal(page); expect(errors, errors.join("\n")).toEqual([]);
  });

  test("comercial também vê o mapa e abre o lead; o formulário público exige cidade e UF", async ({ page, context, browser }) => {
    await loginAs(context, QA.comercial); const errors = collectErrors(page);
    await page.goto("/admin/captacao-leads"); await expect(page.getByTestId("brazil-map")).toBeVisible({ timeout: 40_000 });
    await page.getByRole("button", { name: `Ver o que ${nomes.pac} preencheu` }).click();
    await expect(page.getByTestId("lead-city")).toHaveText("Santo André"); await expect(page.getByTestId("lead-uf")).toHaveText("SP");
    expect(errors, errors.join("\n")).toEqual([]);
    // formulário público: a etapa da cidade não avança em branco
    const ctx = await browser.newContext({ viewport: { width: 1280, height: 900 }, locale: "pt-BR" }); const p = await ctx.newPage();
    await p.goto("/avaliacao"); await p.getByLabel("Nome completo").fill(`Teste Local R31 ${runId}`); await p.getByLabel("E-mail", { exact: true }).fill(`teste.local.r31.${tag}@example.com`);
    await p.getByLabel("WhatsApp com DDD").fill(phone()); await p.getByRole("checkbox").click(); await p.getByRole("button", { name: "Continuar" }).click();
    await expect(p.getByLabel("Cidade")).toBeVisible({ timeout: 20_000 });
    await p.getByRole("button", { name: "Continuar" }).click();
    await expect(p.getByLabel("Cidade")).toBeVisible();                                              // continua na mesma etapa: não avançou sem cidade/UF
    await ctx.close();
  });
});
