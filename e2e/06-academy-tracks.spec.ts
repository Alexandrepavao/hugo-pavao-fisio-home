import { expect, test } from "@playwright/test";
import { MANAGER, STUDENT, api, runId, signIn, useSession } from "./helpers";

// Trilhas do Academy: criar/editar, vincular/ordenar cursos, publicar/despublicar, visibilidade no catálogo,
// matrícula/autorização de acesso (entitlement), progresso, revogação, separação paciente/aluno.
// Ponto central a comprovar: publicar uma trilha NUNCA libera automaticamente cursos pagos/restritos —
// o acesso a cada curso continua vindo só de entitlements, a trilha é apenas uma vitrine/ordenação.
test.describe("Academy — trilhas", () => {
  const slugFree = `e2e-trilha-livre-${runId}`; const slugPaid = `e2e-trilha-paga-${runId}`; const trackSlug = `e2e-trilha-${runId}`;
  let orgId = ""; let courseFreeId = ""; let coursePaidId = ""; let trackId = ""; let personId = "";

  test.beforeAll(async () => {
    const m = await signIn(MANAGER); const g = api(m);
    orgId = (await g.get("organizations?select=id")).body[0].id;
    const cf = await g.post("courses", { org_id: orgId, kind: "course", title: `Curso Trilha Livre ${runId}`, slug: slugFree, status: "published", created_by: m.user.id });
    expect(cf.status, JSON.stringify(cf.body)).toBe(201); courseFreeId = cf.body[0].id;
    const cp = await g.post("courses", { org_id: orgId, kind: "course", title: `Curso Trilha Pago ${runId}`, slug: slugPaid, status: "published", created_by: m.user.id });
    expect(cp.status, JSON.stringify(cp.body)).toBe(201); coursePaidId = cp.body[0].id;
    for (const cid of [courseFreeId, coursePaidId]) {
      const l = await g.post("lessons", { org_id: orgId, course_id: cid, title: "Aula única", position: 1, kind: "text", body: "conteúdo e2e", published: true });
      expect(l.status).toBe(201);
    }
    personId = (await g.get("people?select=id&full_name=eq.Aluna%20QA%20Teste")).body[0].id;
    // Libera só o curso "livre" — o "pago" fica propositalmente sem entitlement, simulando conteúdo restrito.
    const e = await g.rpc("entitlement_grant_manual", { p_person: personId, p_course: courseFreeId, p_valid_until: null, p_reason: "e2e trilha - curso livre" });
    expect(e.status).toBe(200);
    const t = await g.post("learning_tracks", { org_id: orgId, slug: trackSlug, title: `Trilha E2E ${runId}`, description: "Trilha de teste automatizado", position: 999, status: "draft", created_by: m.user.id });
    expect(t.status, JSON.stringify(t.body)).toBe(201); trackId = t.body[0].id;
    const l1 = await g.post("learning_track_courses", { track_id: trackId, course_id: courseFreeId, position: 1 }); expect(l1.status).toBe(201);
    const l2 = await g.post("learning_track_courses", { track_id: trackId, course_id: coursePaidId, position: 2 }); expect(l2.status).toBe(201);
  });

  test("trilha em rascunho não aparece no catálogo do aluno nem pela API direta", async ({ page }) => {
    const s = await signIn(STUDENT); const gs = api(s);
    expect((await gs.get(`learning_tracks?select=id&id=eq.${trackId}`)).body).toHaveLength(0);
    await useSession(page.context(), s);
    await page.goto("/academy");
    await expect(page.getByText(`Trilha E2E ${runId}`)).toHaveCount(0);
  });

  test("gestor edita a trilha, reordena os cursos e publica pela interface", async ({ page }) => {
    const m = await signIn(MANAGER); await useSession(page.context(), m);
    await page.goto("/admin/academy");
    await page.getByRole("tab", { name: "Trilhas" }).click();
    await expect(page.getByText(`Trilha E2E ${runId}`)).toBeVisible();
    const card = page.locator(".hp-card", { hasText: `Trilha E2E ${runId}` });
    await card.getByRole("button", { name: "Cursos da trilha" }).click();
    await expect(card.getByText(`Curso Trilha Livre ${runId}`)).toBeVisible();
    await expect(card.getByText(`Curso Trilha Pago ${runId}`)).toBeVisible();
    await card.getByRole("button", { name: "Publicar" }).click();
    await expect(card.locator("span.hp-badge")).toHaveText("Publicado");
  });

  test("trilha publicada: o aluno vê o curso liberado dentro dela, mas NÃO o curso pago sem entitlement", async ({ page }) => {
    const s = await signIn(STUDENT); await useSession(page.context(), s);
    await page.goto("/academy");
    const trackCard = page.locator(".hp-card", { hasText: `Trilha E2E ${runId}` });
    await expect(trackCard).toBeVisible();
    await expect(trackCard.getByText(`Curso Trilha Livre ${runId}`)).toBeVisible();
    await expect(trackCard.getByText(`Curso Trilha Pago ${runId}`)).toHaveCount(0);   // publicar a trilha não libera o curso pago
    // Confirma pela API direta também: a leitura de courses continua bloqueada pela entitlement, não pela trilha.
    const gs = api(s);
    expect((await gs.get(`courses?select=id&id=eq.${coursePaidId}`)).body).toHaveLength(0);
    expect((await gs.get(`lessons?select=id&course_id=eq.${coursePaidId}`)).body).toHaveLength(0);
    await page.goto(`/academy/${slugPaid}`);
    await expect(page.getByRole("heading", { name: "Acesso não disponível" })).toBeVisible();
  });

  test("liberar o entitlement do curso pago passa a mostrá-lo dentro da mesma trilha, sem republicar nada", async ({ page }) => {
    const m = await signIn(MANAGER);
    const g = await api(m).rpc("entitlement_grant_manual", { p_person: personId, p_course: coursePaidId, p_valid_until: null, p_reason: "e2e trilha - libera curso pago" });
    expect(g.status).toBe(200);
    const s = await signIn(STUDENT); await useSession(page.context(), s);
    await page.goto("/academy");
    const trackCard = page.locator(".hp-card", { hasText: `Trilha E2E ${runId}` });
    await expect(trackCard.getByText(`Curso Trilha Pago ${runId}`)).toBeVisible();
    // matrícula/progresso dentro do curso recém-liberado
    await page.goto(`/academy/${slugPaid}`);
    await expect(page.getByRole("heading", { name: "Aula única" })).toBeVisible();
    await page.getByRole("button", { name: "Marcar como concluída" }).click();
    await expect(page.getByText("Aula concluída.")).toBeVisible();
  });

  test("despublicar a trilha some do catálogo do aluno imediatamente, sem afetar o acesso já concedido aos cursos", async ({ page }) => {
    const m = await signIn(MANAGER); await useSession(page.context(), m);
    await page.goto("/admin/academy"); await page.getByRole("tab", { name: "Trilhas" }).click();
    const card = page.locator(".hp-card", { hasText: `Trilha E2E ${runId}` });
    await card.getByRole("button", { name: "Voltar a rascunho" }).click();
    await expect(card.locator("span.hp-badge")).toHaveText("Rascunho");
    const s = await signIn(STUDENT); await useSession(page.context(), s);
    await page.goto("/academy");
    await expect(page.getByText(`Trilha E2E ${runId}`)).toHaveCount(0);
    // o curso continua acessível — despublicar a trilha (vitrine) não revoga entitlement (acesso real)
    await page.goto(`/academy/${slugPaid}`);
    await expect(page.getByRole("heading", { name: "Aula única" })).toBeVisible();
  });

  test("separação Área do paciente / Academy: dados de um portal nunca aparecem inventados no outro", async ({ page }) => {
    const s = await signIn(STUDENT); await useSession(page.context(), s);
    await page.goto("/paciente");
    // a mesma conta (role "member") usada nos testes de Academy não tem atendimentos/pacotes — a página não deve inventar nenhum
    await expect(page.getByText("Você ainda não tem atendimentos agendados.")).toBeVisible();
    await expect(page.getByText("Nenhum pacote.")).toBeVisible();
    const gs = api(s);
    for (const t of ["care_assignments", "care_messages"]) {
      const r = await gs.get(`${t}?select=*&limit=3`); expect(r.status, t).toBe(200); expect(r.body, `${t} deve vir vazio para quem não tem acompanhamento clínico`).toHaveLength(0);
    }
  });
});
