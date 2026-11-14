// NOVO — N33: “Ver como” (gestor vê o app do fisioterapeuta e do paciente, SOMENTE LEITURA; migration 128 + gancho do PostgREST).
//  · pela API de verdade: cabeçalho x-view-as troca a identidade, grava nada, recusa sessão inventada/de outro/encerrada
//  · pela tela: Gestão › Ver como → /fisio e /paciente com a faixa de aviso, todas as telas das duas áreas abrem sem erro de servidor, sair volta ao painel
import { expect, test, type Page } from "@playwright/test";
import { join } from "node:path";
import { ANON, SUPABASE_URL, signIn } from "../helpers";
import { collectErrors, loginAs, QA } from "../release/helpers-release";

test.use({ timezoneId: "America/Sao_Paulo", locale: "pt-BR", viewport: { width: 1440, height: 900 } });
const shot = async (p: Page, name: string) => { if (process.env.MKT_SHOTS) await p.screenshot({ path: join(process.env.MKT_SHOTS, `${name}.png`) }); };

// chamada à API com a sessão do gestor e, opcionalmente, o cabeçalho x-view-as (como o site faz)
const call = async (token: string, path: string, opts: { method?: string; body?: unknown; viewAs?: string } = {}) => {
  const headers: Record<string, string> = { apikey: ANON, authorization: `Bearer ${token}`, "content-type": "application/json" };
  if (opts.viewAs) headers["x-view-as"] = opts.viewAs;
  const r = await fetch(`${SUPABASE_URL}/rest/v1/${path}`, { method: opts.method ?? "GET", headers, body: opts.body === undefined ? undefined : JSON.stringify(opts.body) });
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  return { status: r.status, body: await r.json().catch(() => null) as any };
};
const rpc = (token: string, fn: string, body: unknown = {}, viewAs?: string) => call(token, `rpc/${fn}`, { method: "POST", body, viewAs });

test.describe.serial("@novos Ver como (gestor)", () => {
  test.setTimeout(240_000);

  test("API: sessão do gestor troca a identidade, é somente leitura e recusa sessão inventada, de outro usuário e encerrada", async () => {
    const mgr = await signIn(QA.manager); const t = mgr.access_token;
    const physios = await rpc(t, "view_as_targets", { p_kind: "physio", p_q: "qa" }); expect(physios.status, JSON.stringify(physios.body)).toBe(200);
    const fisio = (physios.body as { user_id: string; email: string }[]).find((x) => x.email === QA.fisio); expect(fisio, "fisioterapeuta de QA aparece na lista").toBeTruthy();
    const patients = await rpc(t, "view_as_targets", { p_kind: "patient", p_q: "qa" }); const pac = (patients.body as { user_id: string; email: string }[]).find((x) => x.email === QA.paciente); expect(pac, "paciente de QA aparece na lista").toBeTruthy();
    // só o gestor abre sessão
    const com = await signIn(QA.comercial); expect((await rpc(com.access_token, "view_as_start", { p_target: fisio!.user_id })).status, "comercial não abre sessão").toBe(403);
    expect((await rpc((await signIn(QA.fisio)).access_token, "view_as_targets", { p_kind: "physio" })).status, "fisioterapeuta não lista").toBe(403);
    // sessão de fisioterapeuta
    const s = await rpc(t, "view_as_start", { p_target: fisio!.user_id }); expect(s.status, JSON.stringify(s.body)).toBe(200); const sid = s.body.session_id as string;
    expect(s.body.kind).toBe("physio");
    const cur = await rpc(t, "view_as_current", {}, sid); expect(cur.status).toBe(200); expect(cur.body).toMatchObject({ kind: "physio", email: QA.fisio });
    expect((await rpc(t, "view_as_current")).body, "sem cabeçalho não há sessão em uso").toBeNull();
    const home = await rpc(t, "prof_home", {}, sid); expect(home.status, "prof_home responde como o fisioterapeuta: " + JSON.stringify(home.body)).toBe(200);
    expect((await rpc(t, "prof_home")).status, "o gestor, sem o cabeçalho, não é fisioterapeuta").toBe(403);
    const ins = await call(t, "people", { method: "POST", body: { org_id: "00000000-0000-0000-0000-000000000000", full_name: "Nao Deve Gravar" }, viewAs: sid }); expect(ins.status, "gravar falha").toBeGreaterThanOrEqual(400);
    expect(JSON.stringify(ins.body)).toMatch(/read-only|somente leitura|25006|permission|violates/i);
    const upd = await call(t, "people?full_name=eq.zzz-ninguem", { method: "PATCH", body: { full_name: "x" }, viewAs: sid }); expect(upd.status === 200 || upd.status >= 400, "update não chega a gravar").toBe(true);
    // recusas
    expect((await rpc(t, "view_as_current", {}, "00000000-0000-4000-8000-000000000000")).status, "sessão inventada").toBe(403);
    expect((await rpc(t, "view_as_current", {}, "nao-e-uuid")).status, "cabeçalho que não é uma sessão").toBe(403);
    expect((await rpc(com.access_token, "view_as_current", {}, sid)).status, "sessão do gestor usada por outro usuário").toBe(403);
    expect((await rpc(t, "view_as_start", { p_target: pac!.user_id }, sid)).status, "dentro do ver como não abre outra sessão").toBe(403);
    expect((await rpc(t, "view_as_end", { p_session: sid }, sid)).status, "encerrar com o cabeçalho é recusado").toBe(403);
    // encerrar (como o gestor, sem o cabeçalho)
    expect((await rpc(t, "view_as_end", { p_session: sid })).status).toBe(204);
    expect((await rpc(t, "view_as_current", {}, sid)).status, "depois de encerrada a sessão é recusada").toBe(403);
    // paciente
    const sp = await rpc(t, "view_as_start", { p_target: pac!.user_id }); expect(sp.status, JSON.stringify(sp.body)).toBe(200); const pid = sp.body.session_id as string;
    expect(sp.body.kind).toBe("patient"); expect((await rpc(t, "my_home", {}, pid)).status, "my_home responde como o paciente").toBe(200);
    expect((await rpc(t, "prof_home", {}, pid)).status, "o paciente visto não é fisioterapeuta").toBe(403);
    const recent = await rpc(t, "view_as_sessions_recent", { p_limit: 5 }); expect(recent.status).toBe(200); expect(recent.body.length).toBeGreaterThanOrEqual(2); expect(recent.body[0]).toMatchObject({ kind: "patient" });
    expect((await rpc(t, "view_as_end", { p_session: pid })).status).toBe(204);
    // chamadas comuns (sem o cabeçalho) seguem normais, inclusive anônimas
    expect((await call(ANON, "geo_zones?select=zone_id&limit=1")).status, "API anônima continua normal com o gancho ligado").toBe(200);
    expect((await call(t, "geo_zones?select=zone_id&limit=1")).status).toBe(200);
  });

  // Todas as chamadas à API durante as telas: nenhuma pode falhar (um “somente leitura” em tela de leitura é defeito a corrigir na tela)
  const watch = (page: Page) => { const bad: string[] = []; page.on("response", (r) => { if (r.url().includes("/rest/v1/") && r.status() >= 400) bad.push(`${r.status()} ${r.request().method()} ${r.url().replace(SUPABASE_URL, "")}`); }); return bad; };

  test("tela: Gestão › Ver como abre o app do fisioterapeuta com a faixa de aviso, todas as telas abrem sem erro e sair volta ao painel", async ({ page, context }) => {
    await loginAs(context, QA.manager); const errors = collectErrors(page); const bad = watch(page);
    await page.goto("/admin/ver-como"); await expect(page.getByTestId("view-as-regras")).toBeVisible({ timeout: 40_000 });
    await page.getByLabel("Buscar por nome ou e-mail").fill("qa.fisio"); const alvo = page.getByTestId("view-as-alvo").filter({ hasText: QA.fisio }); await expect(alvo).toHaveCount(1, { timeout: 20_000 }); await shot(page, "ver-como-lista");
    await alvo.getByRole("button", { name: /Ver como/ }).click();
    await expect(page).toHaveURL(/\/fisio$/, { timeout: 30_000 }); const faixa = page.getByTestId("view-as-banner"); await expect(faixa).toBeVisible({ timeout: 30_000 });
    await expect(faixa).toContainText("Ver como Fisioterapeuta"); await expect(faixa).toContainText("somente leitura"); await shot(page, "ver-como-fisio-inicio");
    // todas as telas do fisioterapeuta
    for (const rota of ["/fisio", "/fisio/pacientes", "/fisio/agenda", "/fisio/dia", "/fisio/desempenho", "/fisio/treinos", "/fisio/chamados"]) {
      await page.goto(rota); await expect(faixa, `faixa em ${rota}`).toBeVisible({ timeout: 30_000 }); await page.waitForLoadState("networkidle");
      await expect(page.getByText(/Modo “ver como”|Sem permissão ou falha/), `sem erro em ${rota}`).toHaveCount(0); expect(new URL(page.url()).pathname, `continua em ${rota}`).toBe(rota);
    }
    // o gestor não passeia pelo painel enquanto vê como o fisioterapeuta (a rota é do gestor)
    await page.goto("/admin/ver-como"); await expect(page).not.toHaveURL(/\/admin\/ver-como/, { timeout: 20_000 });
    await page.goto("/fisio"); await expect(faixa).toBeVisible({ timeout: 30_000 });
    await page.getByTestId("view-as-exit").click(); await expect(page).toHaveURL(/\/admin\/ver-como/, { timeout: 30_000 }); await expect(page.getByTestId("view-as-banner")).toHaveCount(0);
    const rec = page.getByTestId("view-as-sessao").first(); await expect(rec).toContainText("Fisioterapeuta"); await expect(rec).toContainText("encerrada");
    expect(bad, "nenhuma chamada à API falhou nas telas do fisioterapeuta:\n" + bad.join("\n")).toEqual([]); expect(errors, errors.join("\n")).toEqual([]);
  });

  test("tela: ver como paciente abre o app do paciente (todas as telas sem erro) e o gestor continua gestor em outra aba", async ({ page, context, browser }) => {
    await loginAs(context, QA.manager); const errors = collectErrors(page); const bad = watch(page);
    await page.goto("/admin/ver-como"); await page.getByRole("tab", { name: "Pacientes" }).click(); await page.getByLabel("Buscar por nome ou e-mail").fill("qa.paciente");
    const alvo = page.getByTestId("view-as-alvo").filter({ hasText: QA.paciente }); await expect(alvo).toHaveCount(1, { timeout: 20_000 }); await alvo.getByRole("button", { name: /Ver como/ }).click();
    await expect(page).toHaveURL(/\/paciente$/, { timeout: 30_000 }); const faixa = page.getByTestId("view-as-banner"); await expect(faixa).toContainText("Ver como Paciente", { timeout: 30_000 }); await page.waitForLoadState("networkidle"); await shot(page, "ver-como-paciente-inicio");
    for (const rota of ["/paciente", "/paciente/evolucao", "/paciente/treinos", "/paciente/agenda", "/paciente/mais", "/paciente/chamados"]) {
      await page.goto(rota); await expect(faixa, `faixa em ${rota}`).toBeVisible({ timeout: 30_000 }); await page.waitForLoadState("networkidle");
      await expect(page.getByText(/Modo “ver como”|Sem permissão ou falha/), `sem erro em ${rota}`).toHaveCount(0); expect(new URL(page.url()).pathname, `continua em ${rota}`).toBe(rota);
    }
    // outra aba do mesmo navegador segue sendo o gestor (a sessão de “ver como” é só desta aba)
    const aba2 = await context.newPage(); await aba2.goto("/admin/ver-como"); await expect(aba2.getByTestId("view-as-regras")).toBeVisible({ timeout: 40_000 }); await expect(aba2.getByTestId("view-as-banner")).toHaveCount(0); await aba2.close();
    // sair
    await page.goto("/paciente"); await page.getByTestId("view-as-exit").click(); await expect(page).toHaveURL(/\/admin\/ver-como/, { timeout: 30_000 });
    expect(bad, "nenhuma chamada à API falhou nas telas do paciente:\n" + bad.join("\n")).toEqual([]); expect(errors, errors.join("\n")).toEqual([]); void browser;
  });

  test("tela: sessão encerrada em outro lugar derruba a aba em “ver como” de volta ao painel, com aviso", async ({ page, context }) => {
    const mgr = await loginAs(context, QA.manager);
    await page.goto("/admin/ver-como"); await page.getByLabel("Buscar por nome ou e-mail").fill("qa.fisio"); await page.getByTestId("view-as-alvo").filter({ hasText: QA.fisio }).getByRole("button", { name: /Ver como/ }).click();
    await expect(page.getByTestId("view-as-banner")).toBeVisible({ timeout: 40_000 });
    const sid = await page.evaluate(() => sessionStorage.getItem("hp.viewAs")); expect(sid).toBeTruthy();
    expect((await rpc(mgr.access_token, "view_as_end", { p_session: sid })).status).toBe(204);   // encerrada por fora (ex.: outro dispositivo)
    await page.goto("/fisio/agenda"); await expect(page).toHaveURL(/\/admin\/ver-como\?sessao=expirada/, { timeout: 40_000 }); await expect(page.getByTestId("view-as-expirou")).toBeVisible(); await expect(page.getByTestId("view-as-banner")).toHaveCount(0);
  });

  test("390 px: faixa e lista cabem na tela de celular", async ({ browser }) => {
    const ctx = await browser.newContext({ timezoneId: "America/Sao_Paulo", viewport: { width: 390, height: 800 }, isMobile: true, hasTouch: true }); await loginAs(ctx, QA.manager); const p = await ctx.newPage();
    await p.goto("/admin/ver-como"); await p.getByLabel("Buscar por nome ou e-mail").fill("qa.fisio"); await expect(p.getByTestId("view-as-alvo")).toHaveCount(1, { timeout: 30_000 });
    expect(await p.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth + 1), "lista sem rolagem lateral").toBe(true); await shot(p, "ver-como-mobile-lista");
    await p.getByTestId("view-as-alvo").getByRole("button", { name: /Ver como/ }).click(); await expect(p.getByTestId("view-as-banner")).toBeVisible({ timeout: 40_000 }); await p.waitForLoadState("networkidle");
    expect(await p.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth + 1), "área do fisio com a faixa sem rolagem lateral").toBe(true); await shot(p, "ver-como-mobile-fisio");
    await p.getByTestId("view-as-exit").click(); await expect(p).toHaveURL(/\/admin\/ver-como/, { timeout: 30_000 }); await ctx.close();
  });
});
