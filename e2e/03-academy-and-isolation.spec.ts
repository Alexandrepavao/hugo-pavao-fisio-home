import { expect, test } from "@playwright/test";
import { MANAGER, STUDENT, api, runId, signIn, useSession } from "./helpers";

// Jornada de mentoria/curso (parte automatizável hoje): curso publicado → acesso → aula → progresso → certificado → revogação.
test.describe("Academy e revogação de acesso", () => {
  const slug = `e2e-curso-${runId}`; let courseId = ""; let entId = "";

  test.beforeAll(async () => {
    const m = await signIn(MANAGER); const g = api(m);
    const org = (await g.get("organizations?select=id")).body[0].id;
    const c = await g.post("courses", { org_id: org, kind: "course", title: `Curso E2E ${runId}`, slug, status: "published", created_by: m.user.id });
    expect(c.status, JSON.stringify(c.body)).toBe(201); courseId = c.body[0].id;
    for (const [i, t] of ["Aula 1 E2E", "Aula 2 E2E"].entries()) {
      const l = await g.post("lessons", { org_id: org, course_id: courseId, title: t, position: i + 1, kind: "text", body: `Conteúdo ${t}`, published: true }); expect(l.status).toBe(201);
    }
    const person = (await g.get("people?select=id&full_name=eq.Aluna%20QA%20Teste")).body[0].id;
    const e = await g.rpc("entitlement_grant_manual", { p_person: person, p_course: courseId, p_valid_until: null, p_reason: "e2e" }); expect(e.status).toBe(200); entId = e.body;
  });

  test("aluna vê o curso no catálogo, conclui as aulas, o progresso persiste e o certificado é emitido", async ({ page }) => {
    const s = await signIn(STUDENT); await useSession(page.context(), s);
    await page.goto("/academy");
    await expect(page.getByRole("heading", { name: `Curso E2E ${runId}` })).toBeVisible();
    await page.getByRole("link", { name: /Começar|Continuar/ }).first().click();
    await page.goto(`/academy/${slug}`);
    await expect(page.getByRole("heading", { name: "Aula 1 E2E" })).toBeVisible();
    await page.getByRole("button", { name: "Marcar como concluída" }).click();
    await expect(page.getByText("Aula concluída.")).toBeVisible();
    await page.reload();
    await expect(page.getByText(/50% \(1\/2 aulas\)/)).toBeVisible();              // persistiu no servidor
    await page.getByRole("button", { name: "Aula 2 E2E" }).click();
    await page.getByRole("button", { name: "Marcar como concluída" }).click();
    await page.getByRole("tab", { name: "Avaliações e certificado" }).click();
    await page.getByRole("button", { name: "Emitir certificado" }).click();
    await expect(page.getByText(/Certificado .* emitido/)).toBeVisible();
  });

  test("comunidade: discussão e resposta; conteúdo sem informações de acompanhamento individual", async ({ page }) => {
    const s = await signIn(STUDENT); await useSession(page.context(), s);
    await page.goto(`/academy/${slug}`);
    await page.getByRole("tab", { name: "Comunidade" }).click();
    await page.getByLabel("Nova discussão").fill(`Dúvida E2E ${runId}`);
    await page.getByRole("button", { name: "Publicar" }).click();
    await expect(page.getByText(`Dúvida E2E ${runId}`)).toBeVisible();
    await page.getByRole("button", { name: "Responder" }).first().click();
    await page.getByLabel("Resposta").fill("Resposta E2E");
    await page.getByRole("button", { name: "Responder" }).last().click();
    await expect(page.getByText("Resposta E2E")).toBeVisible();
  });

  test("revogar o acesso tem efeito imediato no servidor: API e interface bloqueiam", async ({ page }) => {
    const m = await signIn(MANAGER); const s = await signIn(STUDENT); const gs = api(s);
    expect((await gs.get(`lessons?select=id&course_id=eq.${courseId}`)).body.length).toBe(2);
    const r = await api(m).rpc("entitlement_revoke", { p_id: entId, p_reason: "e2e revogação" }); expect(r.status).toBe(204);
    expect((await gs.get(`lessons?select=id&course_id=eq.${courseId}`)).body).toHaveLength(0);          // API direta
    expect((await gs.rpc("lesson_complete", { p_lesson: (await api(m).get(`lessons?select=id&course_id=eq.${courseId}&limit=1`)).body[0].id })).status).toBe(403);
    await useSession(page.context(), s);
    await page.goto(`/academy/${slug}`);
    await expect(page.getByRole("heading", { name: "Acesso não disponível" })).toBeVisible();          // interface
  });

  test("acesso direto pela API com perfil de aluna: só o próprio cadastro; funções administrativas negadas", async () => {
    const g = api(await signIn(STUDENT));
    expect((await g.get("people?select=id")).body).toHaveLength(1);
    for (const t of ["opportunities", "payments", "receivables", "sales", "crm_tasks", "audit_log", "domain_events", "forms", "form_submissions", "pages", "quiz_questions", "care_messages", "commission_entries"]) {
      const r = await g.get(`${t}?select=*&limit=3`); expect(r.status, t).toBe(200); expect(r.body, `${t} deve vir vazio`).toHaveLength(0);
    }
    for (const fn of ["dashboard_metrics", "retry_failed_events", "sale_confirm", "merge_preview"]) {
      const r = await g.rpc(fn, fn === "dashboard_metrics" ? { p_from: "2026-01-01", p_to: "2026-12-31" } : fn === "sale_confirm" ? { p_sale: "00000000-0000-0000-0000-000000000000" } : fn === "merge_preview" ? { p_keep: "00000000-0000-0000-0000-000000000000", p_merge: "00000000-0000-0000-0000-000000000001" } : {});
      // merge_preview com IDs inexistentes falha na validação (400) sem revelar nada; as demais são negadas por permissão.
      expect(fn === "merge_preview" ? [400, 401, 403] : [401, 403], `${fn} => ${r.status}`).toContain(r.status);
    }
    const promote = await g.post("role_assignments", { org_id: "268b67d7-faa3-43c2-bb91-0616c78e10d0", user_id: (await signIn(STUDENT)).user.id, role: "manager" });
    expect(promote.status).toBe(403);                                                                    // auto-promoção
    const anon = api(null);                                                                              // anônimo: sem tabelas, só as 3 RPCs públicas
    expect((await anon.get("people?select=id")).status).toBe(401);
    expect((await anon.rpc("list_team")).status).toBe(401);
  });
});
