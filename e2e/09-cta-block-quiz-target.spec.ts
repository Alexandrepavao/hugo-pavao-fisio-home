import { expect, test } from "@playwright/test";
import { MANAGER, api, runId, signIn, useSession } from "./helpers";

// Bloco "cta" do editor de páginas com destino de jornada (avaliação/parceria) — preview e página
// publicada usam o mesmo destino; um CTA antigo (sem `target`, comportamento anterior) continua
// funcionando; a landing page de origem chega até a captação/CRM.
test.describe("bloco cta com destino de jornada", () => {
  test("cta com target=avaliacao: preview e publicada usam o mesmo destino; visitante conclui e a origem chega ao CRM", async ({ page, browser }) => {
    const s = await signIn(MANAGER); const ctx = page.context(); await useSession(ctx, s);
    const slug = `e2e-cta-target-${runId}`;
    const g = api(s);

    const unit = await g.get("units?select=id&limit=1"); const unitId = unit.body[0].id;
    const pipeline = await g.get("pipelines?select=id&kind=eq.patients&limit=1"); const pipelineId = pipeline.body[0].id;
    const created = await g.rpc("page_create", {
      p_slug: slug, p_title: `E2E CTA Target ${runId}`, p_template: "blank",
      p_content: [{ type: "cta", title: "Avalie sua dor", text: "Responda o quiz", label: "Fazer avaliação", target: "avaliacao" }],
      p_unit_id: unitId, p_pipeline_id: pipelineId, p_owner: null,
    });
    const pageId = created.body.id ?? created.body;
    await g.rpc("page_publish", { p_id: pageId, p_publish_at: null, p_unpublish_at: null });

    // preview do rascunho no editor
    await page.goto(`/admin/paginas/${pageId}`);
    await page.getByRole("button", { name: "Pré-visualizar rascunho" }).click();
    const previewHref = await page.getByRole("link", { name: "Fazer avaliação" }).getAttribute("href");
    expect(previewHref).toBe(`/avaliacao?from=%2F${slug}`);

    // página publicada real, como visitante anônimo
    const anon = await browser.newContext(); const v = await anon.newPage();
    await v.goto(`/${slug}`);
    const publicHref = await v.getByRole("link", { name: "Fazer avaliação" }).getAttribute("href");
    expect(publicHref).toBe(previewHref); // preview e publicada nunca divergem

    await v.getByRole("link", { name: "Fazer avaliação" }).click();
    await expect(v).toHaveURL(new RegExp(`/avaliacao\\?from=%2F${slug}`));
    const email = `e2e.cta.target.${runId}@example.com`;
    await v.getByLabel("Como podemos chamar você?").fill(`E2E CTA Target ${runId}`);
    await v.getByLabel("Qual é seu e-mail?").fill(email);
    await v.getByLabel("Qual é seu WhatsApp com DDD?").fill(`(11) 9${Math.floor(1000 + Math.random() * 8999)}-${Math.floor(1000 + Math.random() * 8999)}`);
    await v.getByRole("checkbox").click();
    await v.getByRole("button", { name: "Continuar" }).click();
    await expect(v.getByText("Em qual cidade e estado")).toBeVisible(); // quiz_start aceitou — origem já registrada
    await anon.close();

    const rows = await g.rpc("list_quiz_leads", { p_journey: "atendimento", p_search: email, p_limit: 5, p_offset: 0 });
    expect(rows.body).toHaveLength(1);
    expect(rows.body[0]).toMatchObject({ origin_path: `/${slug}`, page_slug: slug });
  });

  test("cta legado sem `target` continua usando o link personalizado (custom), nunca muda de destino sozinho", async ({ page, browser }) => {
    const s = await signIn(MANAGER); const ctx = page.context(); await useSession(ctx, s);
    const slug = `e2e-cta-legacy-${runId}`;
    const g = api(s);
    const unit = await g.get("units?select=id&limit=1"); const unitId = unit.body[0].id;
    const pipeline = await g.get("pipelines?select=id&kind=eq.patients&limit=1"); const pipelineId = pipeline.body[0].id;
    // conteúdo deliberadamente SEM a chave `target` — simula um bloco cta salvo antes deste recurso existir.
    const created = await g.rpc("page_create", {
      p_slug: slug, p_title: `E2E CTA Legacy ${runId}`, p_template: "blank",
      p_content: [{ type: "cta", title: "Fale conosco", text: "Link antigo", label: "Abrir WhatsApp", url: "https://wa.me/5511999990000" }],
      p_unit_id: unitId, p_pipeline_id: pipelineId, p_owner: null,
    });
    const pageId = created.body.id ?? created.body;
    await g.rpc("page_publish", { p_id: pageId, p_publish_at: null, p_unpublish_at: null });

    const anon = await browser.newContext(); const v = await anon.newPage();
    await v.goto(`/${slug}`);
    await expect(v.getByRole("link", { name: "Abrir WhatsApp" })).toHaveAttribute("href", "https://wa.me/5511999990000");
    await anon.close();
  });
});
