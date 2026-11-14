// NOVO — N31: Captação de leads › segmento Parceiros ganha os filtros "Experiência profissional" e "Área de atuação" (migration 125), e os dois formulários continuam separados:
// quem preenche o de parceria não vira lead de paciente. Dados próprios (runId); as captações de teste ficam no Dev (a captação não tem exclusão pela tela).
import { expect, test, type Page } from "@playwright/test";
import { join } from "node:path";
import { ANON, SUPABASE_URL } from "../helpers";
import { collectErrors, devSql, loginAs, QA, runId } from "../release/helpers-release";

test.use({ timezoneId: "America/Sao_Paulo", locale: "pt-BR", viewport: { width: 1440, height: 1000 } });
const shot = async (p: Page, name: string) => { if (process.env.MKT_SHOTS) await p.screenshot({ path: join(process.env.MKT_SHOTS, `${name}.png`) }); };
const ip = `10.32.${Math.floor(Math.random() * 250) + 1}.${Math.floor(Math.random() * 250) + 1}`;   // o limite do quiz é por IP de origem
const rpc = async (fn: string, body: unknown) => { const r = await fetch(`${SUPABASE_URL}/rest/v1/rpc/${fn}`, { method: "POST", headers: { apikey: ANON, authorization: `Bearer ${ANON}`, "content-type": "application/json", "x-forwarded-for": ip }, body: JSON.stringify(body) }); return { status: r.status, body: await r.json().catch(() => null) }; };
const ans = (value: unknown, label: string, detalhe?: string) => ({ value, label, ...(detalhe ? { detalhe } : {}) });
const tag = runId.toLowerCase(); const phone = () => `(11) 9${Math.floor(1000 + Math.random() * 8999)}-${Math.floor(1000 + Math.random() * 8999)}`;
const nomes = { a: `Ana Atuante N31 ${runId}`, b: `Bia Estudante N31 ${runId}`, c: `Caio Gestor N31 ${runId}`, p: `Paula Paciente N31 ${runId}` };

const iniciar = async (journey: "atendimento" | "parceria", nome: string, email: string) => {
  const r = await rpc("quiz_start", { p_journey: journey, p_name: nome, p_email: email, p_phone: phone(), p_contact_consent_version: "contact-v1", p_origin_path: "/", p_page_slug: "n31", p_referrer: null, p_utm: {}, p_honeypot: null });
  expect(r.status, JSON.stringify(r.body)).toBe(200); return (r.body as { id: string }).id;
};
const parceiro = async (id: string, momento: [string, string], area: [string, string, string?], cidade: string, uf: string) => {
  const common = { situacao_registro: ans("nao_possuo", "Ainda não possuo"), modelo_atendimento: ans("domiciliar", "Atendimento domiciliar"), objetivos_parceria: ans(["equipe"], "Atuar na equipe"), interesses_desenvolvimento: ans(["gestao"], "Gestão"), interesse_programa_clinica: ans("nao_momento", "Não neste momento") };
  const s = await rpc("quiz_save_progress", { p_id: id, p_step: 9, p_answers: { ...common, momento_profissional: ans(momento[0], momento[1]), area_atuacao: ans(area[0], area[1], area[2]) }, p_city: cidade, p_uf: uf }); expect(s.status, JSON.stringify(s.body)).toBe(200);
  const c = await rpc("quiz_complete", { p_id: id, p_marketing_consent: false, p_marketing_consent_version: null }); expect(c.status, JSON.stringify(c.body)).toBe(200);
};

test.describe.serial("@novos Captação de leads: filtros do parceiro", () => {
  test.setTimeout(240_000);

  test("fixtures: 3 parceiros (atuação · ortopedia, estudante · neurológica, gestor · outra) e 1 paciente; formulário de parceria não vira paciente e cada formulário recusa a resposta do outro", async () => {
    const a = await iniciar("parceria", nomes.a, `ana.n31.${tag}@example.com`); await parceiro(a, ["em_atuacao", "Fisioterapeuta em atuação"], ["ortopedia", "Ortopedia"], "São Paulo", "SP");
    const b = await iniciar("parceria", nomes.b, `bia.n31.${tag}@example.com`); await parceiro(b, ["estudante", "Estudante"], ["neurologica", "Neurológica"], "Campinas", "SP");
    const c = await iniciar("parceria", nomes.c, `caio.n31.${tag}@example.com`); await parceiro(c, ["gestor_proprietario", "Gestor ou proprietário de clínica"], ["outra", "Outra", "Fisioterapia pélvica"], "Niterói", "RJ");
    const p = await iniciar("atendimento", nomes.p, `paula.n31.${tag}@example.com`);
    expect((await rpc("quiz_set_health_consent", { p_id: p, p_version: "health-v1" })).status).toBe(204);
    const sp = await rpc("quiz_save_progress", { p_id: p, p_step: 5, p_answers: { dor_intensidade: ans("5", "5"), motivacao_melhora: ans("8", "8"), impacto_qualidade_vida: ans("7", "7"), atividade_desejada: ans("trabalhar", "Trabalhar"), interesse_acompanhamento: ans("sim", "Sim"), faixa_investimento: ans("ate_250", "Até R$ 250") }, p_city: "São Paulo", p_uf: "SP" });
    expect(sp.status, JSON.stringify(sp.body)).toBe(200); expect((await rpc("quiz_complete", { p_id: p, p_marketing_consent: false, p_marketing_consent_version: null })).status).toBe(200);
    // cada formulário recusa a resposta do outro
    // (em captações ainda abertas, como acontece com quem chama a API direto no meio do formulário)
    const xp = await iniciar("parceria", `Aberta Parceria N31 ${runId}`, `abp.n31.${tag}@example.com`); const xa = await iniciar("atendimento", `Aberta Paciente N31 ${runId}`, `aba.n31.${tag}@example.com`);
    const x1 = await rpc("quiz_save_progress", { p_id: xp, p_step: 3, p_answers: { dor_intensidade: ans("7", "7") } }); expect(x1.status, "parceria recusa pergunta de paciente").toBeGreaterThanOrEqual(400);
    const x2 = await rpc("quiz_save_progress", { p_id: xa, p_step: 3, p_answers: { area_atuacao: ans("ortopedia", "Ortopedia") } }); expect(x2.status, "paciente recusa pergunta de parceria").toBeGreaterThanOrEqual(400);
    if (process.env.SUPABASE_ACCESS_TOKEN) {
      const rows = await devSql(`select q.full_name, q.journey,
          (select count(*)::int from public.opportunities o join public.pipelines pl on pl.id = o.pipeline_id where o.person_id = q.person_id and pl.kind = 'patients') opp_paciente,
          (select count(*)::int from public.opportunities o join public.pipelines pl on pl.id = o.pipeline_id where o.person_id = q.person_id and pl.kind = 'partners') opp_parceiro,
          (select count(*)::int from public.person_kinds k where k.person_id = q.person_id and k.kind::text = 'patient') kind_paciente
        from public.quiz_leads q where q.full_name like '% N31 ${runId}'`) as { full_name: string; journey: string; opp_paciente: number; opp_parceiro: number; kind_paciente: number }[];
      expect(rows).toHaveLength(6);   // 4 concluídas + 2 abertas
      for (const r of rows.filter((x) => x.journey === "parceria")) expect(r, `${r.full_name}: parceiro não vira paciente`).toMatchObject({ opp_paciente: 0, opp_parceiro: 1, kind_paciente: 0 });
      for (const r of rows.filter((x) => x.journey === "atendimento")) expect(r, `${r.full_name}: paciente não vira parceiro`).toMatchObject({ opp_paciente: 1, opp_parceiro: 0, kind_paciente: 0 });
    }
  });

  test("segmento Parceiros: filtros de experiência e de área, a lista mostra as duas respostas e o resumo dos filtros ativos", async ({ page, context }) => {
    await loginAs(context, QA.manager); const errors = collectErrors(page);
    await page.goto("/admin/captacao-leads"); const mapa = page.getByTestId("lead-map"); await expect(mapa.getByTestId("brazil-map")).toBeVisible({ timeout: 40_000 });
    const abrir = async () => { if (!(await page.locator("#lc-search").isVisible())) await page.getByRole("button", { name: /^Filtros/ }).first().click(); await expect(page.locator("#lc-search")).toBeVisible(); };
    // sem segmento de parceiros, os filtros de parceiro não aparecem
    await abrir(); await page.locator("#lc-search").fill(runId); await expect(page.locator("#lc-exp")).toHaveCount(0); await expect(page.locator("#lc-area")).toHaveCount(0); await page.keyboard.press("Escape");
    await mapa.getByRole("tab", { name: "Parceiros" }).click();
    const linhas = page.getByRole("row").filter({ hasText: `N31 ${runId}` }); await expect(linhas).toHaveCount(4, { timeout: 30_000 });   // 3 concluídos + 1 aberto, todos de parceria; as pacientes não entram
    await expect(page.getByRole("columnheader", { name: "Experiência · Área" })).toBeVisible();
    await expect(linhas.filter({ hasText: nomes.a })).toContainText("Fisioterapeuta em atuação"); await expect(linhas.filter({ hasText: nomes.a })).toContainText("Ortopedia");
    await expect(linhas.filter({ hasText: nomes.c })).toContainText("Outra — Fisioterapia pélvica");
    await abrir(); await expect(page.locator("#lc-exp option")).toHaveText(["Todas", "Estudante", "Formado iniciando atuação", "Fisioterapeuta em atuação", "Gestor ou proprietário de clínica"]);
    await expect(page.locator("#lc-area option")).toHaveText(["Todas", "Ortopedia", "Esportiva", "Neurológica", "Geriátrica", "Outra"]);
    await page.locator("#lc-exp").selectOption("estudante"); await expect(linhas).toHaveCount(1, { timeout: 20_000 }); await expect(linhas.first()).toContainText(nomes.b);
    await expect(page.getByLabel("Filtros ativos").first()).toContainText("Estudante");
    await page.locator("#lc-exp").selectOption(""); await page.locator("#lc-area").selectOption("ortopedia"); await expect(linhas).toHaveCount(1, { timeout: 20_000 }); await expect(linhas.first()).toContainText(nomes.a);
    await page.locator("#lc-exp").selectOption("gestor_proprietario"); await expect(linhas).toHaveCount(0, { timeout: 20_000 }); await expect(page.getByText("Nenhuma captação encontrada com esses filtros.")).toBeVisible();   // gestor + ortopedia: ninguém
    await page.locator("#lc-exp").selectOption("em_atuacao"); await expect(linhas).toHaveCount(1, { timeout: 20_000 });
    await page.keyboard.press("Escape"); await expect(page.locator("#lc-exp")).toHaveCount(0); await linhas.first().scrollIntoViewIfNeeded(); await shot(page, "captacao-filtros-parceiro"); await abrir();
    await page.locator("#lc-exp").selectOption(""); await page.locator("#lc-area").selectOption("outra"); await expect(linhas).toHaveCount(1, { timeout: 20_000 }); await expect(linhas.first()).toContainText(nomes.c);
    // o mapa acompanha os filtros: só Niterói/RJ
    await page.keyboard.press("Escape"); await expect(mapa.locator('path[data-uf="RJ"]')).toHaveAttribute("data-class", /[1-9]/); await expect(mapa.getByRole("button", { name: /^SP/ })).toHaveCount(0);
    // sair do segmento de parceiros limpa os dois filtros
    await mapa.getByRole("tab", { name: "Pacientes" }).click(); await expect(page.getByRole("row").filter({ hasText: nomes.p })).toHaveCount(1, { timeout: 20_000 });
    await mapa.getByRole("tab", { name: "Parceiros" }).click(); await expect(linhas).toHaveCount(4, { timeout: 20_000 });
    expect(errors, errors.join("\n")).toEqual([]);
  });

  test("390 px: os filtros de parceiro cabem na gaveta e a lista não gera rolagem horizontal da página", async ({ browser }) => {
    const ctx = await browser.newContext({ timezoneId: "America/Sao_Paulo", viewport: { width: 390, height: 800 }, isMobile: true, hasTouch: true }); await loginAs(ctx, QA.manager); const p = await ctx.newPage(); const errors = collectErrors(p);
    await p.goto("/admin/captacao-leads"); await expect(p.getByTestId("lead-map").getByTestId("brazil-map")).toBeVisible({ timeout: 40_000 });
    await p.getByTestId("lead-map").getByRole("tab", { name: "Parceiros" }).click();
    await p.getByRole("button", { name: /^Filtrar/ }).first().click(); await expect(p.locator("#lc-exp")).toBeVisible(); await expect(p.locator("#lc-area")).toBeVisible();
    const box = await p.locator("#lc-exp").boundingBox(); expect(box && box.x >= 0 && box.x + box.width <= 391, "campo dentro da tela").toBe(true);
    await shot(p, "captacao-filtros-parceiro-mobile"); await p.keyboard.press("Escape");
    expect(await p.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth + 1)).toBe(true); expect(errors, errors.join("\n")).toEqual([]); await ctx.close();
  });
});
