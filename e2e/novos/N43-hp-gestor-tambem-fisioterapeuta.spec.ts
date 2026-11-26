import { test, expect } from "@playwright/test";
import { ANON, PASSWORD, SUPABASE_URL, signIn, useSession as injetarSessao, type Session } from "../helpers";
import { devSql, runId } from "../release/helpers-release";

// @novo — GESTOR QUE TAMBÉM É FISIOTERAPEUTA (Dev): dois papéis na mesma pessoa; avalia e monta o plano só dos pacientes com vínculo assistencial.
// Real: tudo pela interface (Equipe → "Dar outro papel"), pelo banco Dev e pelas funções. Contexto: paciente de exemplo deixado pela jornada N42.
const EMAIL = `n43.${runId}@hp-test.dev`; const S: Record<string, string> = {};
const q1 = async <T,>(sql: string) => ((await devSql(sql)) as T[])[0];
const rpc = async (s: Session, fn: string, body: unknown) => { const r = await fetch(`${SUPABASE_URL}/rest/v1/rpc/${fn}`, { method: "POST", headers: { apikey: ANON, authorization: `Bearer ${s.access_token}`, "content-type": "application/json" }, body: JSON.stringify(body) }); return { status: r.status, text: await r.text() }; };
const entrar = async (): Promise<Session> => signIn(EMAIL);

test.use({ timezoneId: "America/Sao_Paulo", locale: "pt-BR", viewport: { width: 1440, height: 900 }, actionTimeout: 30_000, trace: "off" });
test.describe.serial("@novo HP — gestor que também é fisioterapeuta", () => {
  test.skip(!process.env.SUPABASE_ACCESS_TOKEN || !PASSWORD, "precisa de SUPABASE_ACCESS_TOKEN e HP_QA_PASSWORD");
  test.setTimeout(180_000);

  test.beforeAll(async () => {
    const r = await fetch(`${SUPABASE_URL}/auth/v1/signup`, { method: "POST", headers: { apikey: ANON, "content-type": "application/json" }, body: JSON.stringify({ email: EMAIL, password: PASSWORD }) });
    expect(r.status).toBeLessThan(300); S.user = ((await r.json()) as { id?: string; user?: { id: string } }).id ?? "";
    if (!S.user) S.user = (await q1<{ id: string }>(`select id::text from auth.users where lower(email) = '${EMAIL}'`)).id;
    const o = await q1<{ org: string; unit: string; enr: string; person: string }>(`select (select id::text from public.organizations where slug = 'hp-group') org, (select id::text from public.units where slug = 'sao-paulo') unit,
      (select e.id::text from public.patient_enrollments e join public.people p on p.id = e.person_id where p.full_name like 'Marina Costa (exemplo) N42%' and e.status <> 'ended' order by e.created_at desc limit 1) enr,
      (select e.person_id::text from public.patient_enrollments e join public.people p on p.id = e.person_id where p.full_name like 'Marina Costa (exemplo) N42%' and e.status <> 'ended' order by e.created_at desc limit 1) person`);
    Object.assign(S, o); test.skip(!S.enr, "sem paciente de exemplo da jornada N42 no Dev (rode a N42 antes)");
    // conta de gestão confirmada, SÓ com o papel de gestor (sem papel de fisioterapeuta)
    await devSql(`update auth.users set email_confirmed_at = coalesce(email_confirmed_at, now()), updated_at = now() where id = '${S.user}';
      insert into public.user_accounts (user_id, org_id, email, display_name) values ('${S.user}', '${S.org}', '${EMAIL}', 'Gestor-Fisio N43') on conflict (user_id) do nothing;
      insert into public.org_memberships (user_id, org_id, status, is_default) values ('${S.user}', '${S.org}', 'active', true) on conflict (user_id, org_id) do update set status = 'active';
      insert into public.role_assignments (org_id, user_id, role, unit_id) values ('${S.org}', '${S.user}', 'manager', null) on conflict do nothing`);
  });
  test.afterAll(async () => {
    if (!S.user) return;
    await devSql(`delete from public.care_relationships where professional_user_id = '${S.user}'; delete from public.role_assignments where user_id = '${S.user}'; delete from public.org_memberships where user_id = '${S.user}'; delete from public.user_accounts where user_id = '${S.user}'`).catch(() => null);
    await devSql(`delete from auth.users where id = '${S.user}'`).catch(() => null);
  });

  test("1. só com o papel de gestor: sem portal do fisioterapeuta e sem acesso à avaliação", async ({ browser }) => {
    const c = await browser.newContext(); await injetarSessao(c, await entrar()); const p = await c.newPage();
    await p.goto("/fisio"); await expect(p.getByRole("alert")).toContainText("Sem permissão", { timeout: 30_000 });
    await p.goto(`/apresentacao/avaliacao/${S.enr}`); await expect(p.getByRole("alert")).toContainText("Sem permissão", { timeout: 30_000 });
    await p.goto("/admin"); await expect(p.getByTestId("go-fisio")).toHaveCount(0); await c.close();
  });

  test("2. a gestão dá o papel de fisioterapeuta pela tela Equipe", async ({ browser }) => {
    const c = await browser.newContext(); await injetarSessao(c, await entrar()); const p = await c.newPage();
    await p.goto("/admin/equipe"); await expect(p.getByTestId("team-make-physio")).toBeVisible({ timeout: 30_000 });
    await p.locator("#fp").selectOption({ value: S.user }); await p.locator("#fu").selectOption({ value: S.unit });
    await p.getByTestId("team-make-physio-btn").click(); await p.getByRole("dialog").getByRole("button", { name: "Liberar" }).click();
    await expect(p.getByText(/agora também é fisioterapeuta/)).toBeVisible({ timeout: 30_000 });
    const n = await q1<{ papel: number; prof: number; un: number }>(`select (select count(*)::int from public.role_assignments where user_id = '${S.user}' and role = 'physio' and unit_id = '${S.unit}' and revoked_at is null) papel,
      (select count(*)::int from public.professionals where user_id = '${S.user}' and active) prof, (select count(*)::int from public.professional_units pu join public.professionals pr on pr.id = pu.professional_id where pr.user_id = '${S.user}' and pu.unit_id = '${S.unit}') un`);
    expect(n).toEqual({ papel: 1, prof: 1, un: 1 });
    expect((await q1<{ n: number }>(`select count(*)::int n from public.role_assignments where user_id = '${S.user}' and role = 'manager' and revoked_at is null`)).n, "continua gestor").toBe(1);
    await c.close();
  });

  test("3. alterna entre gestão e portal do fisioterapeuta", async ({ browser }) => {
    const c = await browser.newContext(); await injetarSessao(c, await entrar()); const p = await c.newPage();
    await p.goto("/admin"); await expect(p.getByTestId("go-fisio")).toBeVisible({ timeout: 30_000 });
    await p.getByTestId("go-fisio").click(); await expect(p).toHaveURL(/\/fisio/); await expect(p.getByRole("heading", { name: "Portal do fisioterapeuta" })).toBeVisible({ timeout: 30_000 });
    await expect(p.getByText(/Sem permissão ou falha ao carregar/)).toHaveCount(0, { timeout: 30_000 });   // o início do portal abre (exige o cadastro de profissional ligado à conta)
    await expect(p.getByTestId("go-gestao")).toContainText("Alterar para a gestão");   // atalho sempre visível na barra lateral do portal
    await p.getByTestId("go-gestao").click(); await expect(p).toHaveURL(/\/admin/);
    await expect(p.getByTestId("go-fisio")).toContainText("Alterar para a área de fisio"); await c.close();
  });

  test("4. com o papel, mas SEM vínculo com o paciente: o conteúdo clínico continua recusado", async () => {
    const s = await entrar();
    for (const [fn, body] of [["deck_get", { p_enrollment: S.enr }], ["deck_draft_generate", { p_enrollment: S.enr, p_product: null }], ["presentation_open", { p_enrollment: S.enr }]] as [string, unknown][])
      expect((await rpc(s, fn, body)).status, `${fn} sem vínculo`).toBeGreaterThanOrEqual(400);
  });

  test("5. com o vínculo assistencial: abre a avaliação, gera a apresentação e o acesso fica registrado", async ({ browser }) => {
    await devSql(`insert into public.care_relationships (org_id, unit_id, professional_user_id, person_id, enrollment_id, granted_by) values ('${S.org}', '${S.unit}', '${S.user}', '${S.person}', '${S.enr}', '${S.user}')`);
    const s = await entrar();
    expect((await rpc(s, "presentation_open", { p_enrollment: S.enr })).status).toBeLessThan(300);
    expect((await rpc(s, "deck_draft_generate", { p_enrollment: S.enr, p_product: null })).status).toBeLessThan(300);
    const c = await browser.newContext(); await injetarSessao(c, s); const p = await c.newPage();
    await p.goto(`/apresentacao/avaliacao/${S.enr}`); await expect(p.getByText("Avaliação e apresentação personalizada")).toBeVisible({ timeout: 45_000 }); await expect(p.getByRole("alert")).toHaveCount(0);
    const log = await q1<{ n: number }>(`select count(*)::int n from public.clinical_access_log where accessed_by = '${S.user}' and person_id = '${S.person}'`);
    expect(log.n, "o acesso clínico do gestor-fisioterapeuta fica registrado").toBeGreaterThan(0); await c.close();
  });

  test("6. sem o papel de fisioterapeuta de novo: o vínculo sozinho não basta", async ({ browser }) => {
    await devSql(`update public.role_assignments set revoked_at = now() where user_id = '${S.user}' and role = 'physio'`);
    const s = await entrar();
    expect((await rpc(s, "deck_get", { p_enrollment: S.enr })).status, "vínculo sem papel de fisioterapeuta").toBeGreaterThanOrEqual(400);
    const c = await browser.newContext(); await injetarSessao(c, s); const p = await c.newPage();
    await p.goto(`/apresentacao/avaliacao/${S.enr}`); await expect(p.getByRole("alert")).toContainText("Sem permissão", { timeout: 30_000 }); await c.close();
  });
});
