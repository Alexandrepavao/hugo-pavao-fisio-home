// ACEITE da release v1 — CRM › Relatórios › Análises › “Conversão por funil”: todos os funis ativos lado a lado, com os mesmos números do servidor.
// A tela chama crm_analytics uma vez por funil; o teste lê o período que a própria tela usou e recalcula, pelas oportunidades que o gestor lê pela API (mesmas regras de acesso do app), criadas/ganhas/perdidas/em aberto e as duas taxas. Não precisa de token de gestão do Dev.
import { expect, test } from "@playwright/test";
import { api, collectErrors, expectNoFatal, loginAs, QA, signIn } from "./helpers-release";

test.use({ timezoneId: "America/Sao_Paulo", locale: "pt-BR" });
const pct = (v: number | null) => (v == null ? "—" : `${v.toString().replace(".", ",")}%`);
const LABEL: Record<string, string> = { patients: "Paciente", partners: "Fisioterapeuta · Equipe", education: "Fisioterapeuta · HP Academy", companies: "Empresa · B2B" };

test.describe("@release CRM: conversão por funil", () => {
  test.setTimeout(120_000);
  test("a tabela lista todos os funis ativos e cada linha bate com o banco (criadas, ganhas, perdidas, em aberto e conversão geral)", async ({ page, context }) => {
    await loginAs(context, QA.manager); const errors = collectErrors(page); const mgr = api(await signIn(QA.manager));
    const calls: { pipe: string; from: string; to: string }[] = [];
    page.on("request", (r) => { if (r.url().includes("/rpc/crm_analytics") && r.method() === "POST") { const b = JSON.parse(r.postData() ?? "{}"); if (b.p_pipeline && !b.p_owner && !b.p_unit) calls.push({ pipe: b.p_pipeline, from: b.p_from, to: b.p_to }); } });
    const raw = (await mgr.get("pipelines?select=id,name,kind&active=eq.true")).body as { id: string; name: string; kind: string }[];
    const order = ["patients", "partners", "education", "companies"]; const pipes = raw.map((p) => ({ id: p.id, name: LABEL[p.kind] ?? p.name })).sort((x, y) => { const kx = raw.find((p) => p.id === x.id)!.kind; const ky = raw.find((p) => p.id === y.id)!.kind; return (order.indexOf(kx) < 0 ? 9 : order.indexOf(kx)) - (order.indexOf(ky) < 0 ? 9 : order.indexOf(ky)); });
    expect(pipes.length).toBeGreaterThan(1);

    await page.goto("/admin/crm/relatorios");
    const section = page.getByTestId("conversao-por-funil"); await expect(section.getByRole("heading", { name: "Conversão por funil" })).toBeVisible({ timeout: 40_000 });
    const rows = section.getByTestId("conv-funil-row"); await expect(rows).toHaveCount(pipes.length, { timeout: 40_000 });
    expect(await rows.getByTestId("m-nome").allTextContents()).toEqual(pipes.map((p) => p.name));

    for (const p of pipes) {
      const c = calls.find((x) => x.pipe === p.id); expect(c, `a tela consultou o funil ${p.name}`).toBeTruthy();
      const opps = (await mgr.get(`opportunities?select=status,created_at,closed_at&pipeline_id=eq.${p.id}&limit=5000`)).body as { status: string; created_at: string; closed_at: string | null }[];
      const inR = (iso: string | null) => !!iso && iso >= new Date(c!.from).toISOString() && iso < new Date(c!.to).toISOString();
      const e = { created: opps.filter((o) => inR(o.created_at)).length, cohort_won: opps.filter((o) => inR(o.created_at) && o.status === "won").length,
        won: opps.filter((o) => o.status === "won" && inR(o.closed_at)).length, lost: opps.filter((o) => o.status === "lost" && inR(o.closed_at)).length, open: opps.filter((o) => o.status === "open").length };
      const conv = e.created > 0 ? Math.round((1000 * e.cohort_won) / e.created) / 10 : null; const rate = e.won + e.lost > 0 ? Math.round((1000 * e.won) / (e.won + e.lost)) / 10 : null;
      const row = rows.filter({ has: page.getByTestId("m-nome").getByText(p.name, { exact: true }) }); const t = async (id: string) => (await row.getByTestId(id).innerText()).trim();
      expect([await t("m-nome"), await t("m-conv"), await t("m-taxa"), await t("m-criadas"), await t("m-ganhas"), await t("m-perdidas"), await t("m-abertas")], p.name)
        .toEqual([p.name, pct(conv), pct(rate), String(e.created), String(e.won), String(e.lost), String(e.open)]);
    }
    await expectNoFatal(page); expect(errors, errors.join("\n")).toEqual([]);
  });

  test("celular: “Conversão entre etapas” e “Duração por etapa” são listas que cabem na tela (sem rolagem lateral) e mostram os números do servidor", async ({ browser }) => {
    const ctx = await browser.newContext({ viewport: { width: 390, height: 844 }, timezoneId: "America/Sao_Paulo", locale: "pt-BR", isMobile: true, hasTouch: true });
    await loginAs(ctx, QA.manager); const page = await ctx.newPage(); const errors = collectErrors(page);
    const resp = page.waitForResponse((r) => r.url().includes("/rpc/crm_analytics") && r.request().method() === "POST" && !JSON.parse(r.request().postData() ?? "{}").p_pipeline, { timeout: 40_000 });
    await page.goto("/admin/crm/relatorios");
    const a = (await (await resp).json()) as { chain: { name: string; reached: number; conv_prev_pct: number | null; conv_first_pct: number | null }[]; won_step: { won: number }; stage_history: { name: string; n: number }[] };
    const funil = page.getByTestId("funil-etapas"); await expect(funil).toBeVisible({ timeout: 40_000 });
    const steps = funil.getByTestId("funil-etapa"); await expect(steps).toHaveCount(a.chain.length + 1);
    for (const [i, c] of a.chain.entries()) {
      const t = (await steps.nth(i).innerText()).replace(/\s+/g, " ");
      expect(t, c.name).toContain(c.name); expect(t).toContain(String(c.reached)); expect(t).toContain(`${pct(c.conv_first_pct)} sobre a 1ª etapa`);
      if (i > 0) expect(t).toContain(`${pct(c.conv_prev_pct)} da etapa anterior`);
    }
    expect((await steps.last().innerText()).replace(/\s+/g, " ")).toContain(`Ganho ${a.won_step.won}`);
    const dur = page.getByTestId("duracao-etapas"); await expect(dur.getByTestId("duracao-etapa")).toHaveCount(a.stage_history.length);
    for (const box of [funil, dur, page.getByTestId("conversao-por-funil")]) expect(await box.evaluate((el) => el.scrollWidth <= el.clientWidth), "sem rolagem lateral no bloco").toBe(true);
    expect(await page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth), "sem rolagem lateral na página").toBe(true);
    await expect(page.locator("table").filter({ hasText: "Conversão da etapa anterior" })).toHaveCount(0);
    await expectNoFatal(page); expect(errors, errors.join("\n")).toEqual([]); await ctx.close();
  });
});
