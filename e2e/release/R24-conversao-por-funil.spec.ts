// ACEITE da release v1 — CRM › Relatórios › Análises › “Conversão por funil”: todos os funis ativos lado a lado, com os mesmos números do servidor.
// A tela chama crm_analytics uma vez por funil; o teste lê o período que a própria tela usou e recalcula, pelas oportunidades que o gestor lê pela API (mesmas regras de acesso do app), criadas/ganhas/perdidas/em aberto e as duas taxas. Não precisa de token de gestão do Dev.
import { expect, test } from "@playwright/test";
import { api, collectErrors, expectNoFatal, loginAs, QA, signIn } from "./helpers-release";

test.use({ timezoneId: "America/Sao_Paulo", locale: "pt-BR" });
const pct = (v: number | null) => (v == null ? "—" : `${v.toString().replace(".", ",")}%`);

test.describe("@release CRM: conversão por funil", () => {
  test.setTimeout(120_000);
  test("a tabela lista todos os funis ativos e cada linha bate com o banco (criadas, ganhas, perdidas, em aberto e conversão geral)", async ({ page, context }) => {
    await loginAs(context, QA.manager); const errors = collectErrors(page); const mgr = api(await signIn(QA.manager));
    const calls: { pipe: string; from: string; to: string }[] = [];
    page.on("request", (r) => { if (r.url().includes("/rpc/crm_analytics") && r.method() === "POST") { const b = JSON.parse(r.postData() ?? "{}"); if (b.p_pipeline && !b.p_owner && !b.p_unit) calls.push({ pipe: b.p_pipeline, from: b.p_from, to: b.p_to }); } });
    const pipes = (await mgr.get("pipelines?select=id,name&active=eq.true&order=name")).body as { id: string; name: string }[];
    expect(pipes.length).toBeGreaterThan(1);

    await page.goto("/admin/crm/relatorios");
    const section = page.getByTestId("conversao-por-funil"); await expect(section.getByRole("heading", { name: "Conversão por funil" })).toBeVisible({ timeout: 40_000 });
    const rows = section.getByTestId("conv-funil-row"); await expect(rows).toHaveCount(pipes.length, { timeout: 40_000 });
    expect(await rows.evaluateAll((r) => r.map((x) => (x.querySelector("td")?.textContent ?? "").trim()))).toEqual(pipes.map((p) => p.name));

    for (const p of pipes) {
      const c = calls.find((x) => x.pipe === p.id); expect(c, `a tela consultou o funil ${p.name}`).toBeTruthy();
      const opps = (await mgr.get(`opportunities?select=status,created_at,closed_at&pipeline_id=eq.${p.id}&limit=5000`)).body as { status: string; created_at: string; closed_at: string | null }[];
      const inR = (iso: string | null) => !!iso && iso >= new Date(c!.from).toISOString() && iso < new Date(c!.to).toISOString();
      const e = { created: opps.filter((o) => inR(o.created_at)).length, cohort_won: opps.filter((o) => inR(o.created_at) && o.status === "won").length,
        won: opps.filter((o) => o.status === "won" && inR(o.closed_at)).length, lost: opps.filter((o) => o.status === "lost" && inR(o.closed_at)).length, open: opps.filter((o) => o.status === "open").length };
      const conv = e.created > 0 ? Math.round((1000 * e.cohort_won) / e.created) / 10 : null; const rate = e.won + e.lost > 0 ? Math.round((1000 * e.won) / (e.won + e.lost)) / 10 : null;
      const cells = (await rows.filter({ has: page.getByRole("cell", { name: p.name, exact: true }) }).locator("td").allTextContents()).map((t) => t.trim());
      expect(cells, p.name).toEqual([p.name, pct(conv), pct(rate), String(e.created), String(e.won), String(e.lost), String(e.open)]);
    }
    await expectNoFatal(page); expect(errors, errors.join("\n")).toEqual([]);
  });
});
