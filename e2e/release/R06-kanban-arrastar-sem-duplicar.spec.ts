// ACEITE da release v1 — arrastar e soltar no Kanban do CRM: o card nunca aparece duplicado (nem após soltar) e a etapa muda uma única vez.
// Regressão: o DragOverlay animava de volta à origem após soltar, e como a atualização otimista já punha o card na coluna nova, o card aparecia
// duas vezes por ~250 ms. Autossuficiente: cria a própria oportunidade.
import { expect, test } from "@playwright/test";
import { api, collectErrors, loginAs, QA, runId, signIn } from "./helpers-release";

test.use({ timezoneId: "America/Sao_Paulo", locale: "pt-BR", viewport: { width: 1440, height: 900 } });

test("@release Kanban: arrastar um card para a etapa seguinte não o duplica, nem durante nem depois de soltar", async ({ page, context }) => {
  const mgr = await signIn(QA.manager); const g = api(mgr); await loginAs(context, QA.manager); const errors = collectErrors(page);
  const unit = (await g.get("units?select=id&slug=eq.sao-paulo")).body[0].id as string;
  const pipe = (await g.get("pipelines?select=id&kind=eq.patients&active=eq.true&limit=1")).body[0].id as string;
  const person = await g.rpc("create_person", { p_full_name: `DnD R06 ${runId}`, p_unit_id: unit, p_kinds: ["patient"], p_email: `dnd.${runId}@t.local`, p_phone: null, p_notes: null, p_force: true });
  expect(person.status, JSON.stringify(person.body)).toBe(200);
  const title = `Card DnD ${runId}`;
  const opp = await g.rpc("crm_create_opportunity", { p_person_id: person.body.id, p_pipeline_id: pipe, p_unit_id: unit, p_title: title, p_source: "manual" }); expect(opp.status, JSON.stringify(opp.body)).toBe(200);
  const oppId = opp.body as string; const stageOf = async () => (await g.get(`opportunities?select=stage_id&id=eq.${oppId}`)).body[0].stage_id as string;
  const first = await stageOf();

  await page.goto("/admin/crm/oportunidades"); await page.getByRole("region", { name: "Quadro do funil" }).waitFor();
  await page.getByPlaceholder("Pessoa ou título").fill(title);                               // só o card deste teste, na primeira etapa
  const card = page.getByRole("button", { name: new RegExp(`^DnD R06 ${runId}, `) }); await expect(card).toHaveCount(1);
  const sections = page.locator("section[aria-label*=':']"); const box = (await card.boundingBox())!; const dest = (await sections.nth(1).locator("header").boundingBox())!;
  await page.mouse.move(box.x + 30, box.y + 20); await page.mouse.down(); await page.mouse.move(box.x + 60, box.y + 30, { steps: 4 }); await page.mouse.move(dest.x + dest.width / 2, dest.y + 60, { steps: 12 });
  // durante o arrasto: no máximo a cópia flutuante + um espaço tracejado na origem (o card original fica invisível), nunca duas cópias legíveis
  const visibleCopies = () => page.evaluate((t) => Array.from(document.querySelectorAll("p")).filter((p) => p.textContent?.trim() === t && (p as HTMLElement).offsetParent !== null && getComputedStyle(p).visibility !== "hidden").length, person.body.full_name ?? `DnD R06 ${runId}`);
  expect(await visibleCopies(), "durante o arrasto só a cópia flutuante é visível").toBe(1);
  // após soltar: amostra quadro a quadro por 900 ms (começa depois do soltar; o defeito original aparecia entre ~90 e ~330 ms)
  await page.mouse.up();
  await page.evaluate((t) => { (window as any).__s = []; const t0 = performance.now(); const tick = () => { const c = Array.from(document.querySelectorAll("p")).filter((p) => p.textContent?.trim() === t).length; (window as any).__s.push(c); if (performance.now() - t0 < 900) requestAnimationFrame(tick); }; requestAnimationFrame(tick); }, `DnD R06 ${runId}`);
  await page.waitForTimeout(1100);
  const frames = (await page.evaluate(() => (window as any).__s)) as number[];
  expect(frames.length).toBeGreaterThan(10); expect(Math.max(...frames), "o card nunca aparece duas vezes depois de soltar").toBeLessThanOrEqual(1);
  expect(await stageOf(), "a etapa mudou").not.toBe(first);
  expect(((await g.get(`opportunities?select=id&person_id=eq.${person.body.id}`)).body as unknown[]).length, "nenhuma oportunidade criada ou duplicada").toBe(1);
  expect(errors).toEqual([]);
});
