// ACEITE da release v1 — "Meu dia" (Dia/Semana/Mês) e Google Calendar como ÚNICA integração de calendário: conectar a própria conta (autorização individual no Google),
// status da conexão e desconectar. A assinatura .ics/Apple/iPhone foi aposentada (interface e endpoint). Não faz a autorização real no Google (isso exige escolher a conta): a navegação
// para o Google é interceptada e inspecionada (client, callback, escopos, state). A conexão exibida no teste de status é uma linha de teste com token inválido, removida ao final.
import { expect, test } from "@playwright/test";
import { ANON, SUPABASE_URL } from "../helpers";
import { collectErrors, devSql, expectNoFatal, loginAs, QA } from "./helpers-release";

test.use({ timezoneId: "America/Sao_Paulo", locale: "pt-BR" });

test.describe.serial("@release Calendários (Meu dia e Google Calendar)", () => {
  test.setTimeout(150_000);

  test("Meu dia: visões Dia, Semana e Mês e navegação", async ({ page, context }) => {
    await loginAs(context, QA.fisio); const errors = collectErrors(page);
    await page.goto("/admin/meu-dia");
    const views = page.getByRole("group", { name: "Visualização" });
    await expect(views.getByRole("button", { name: "Dia" })).toHaveAttribute("aria-pressed", "true", { timeout: 30_000 });
    await views.getByRole("button", { name: "Semana" }).click();
    await expect(views.getByRole("button", { name: "Semana" })).toHaveAttribute("aria-pressed", "true");
    const week = page.getByRole("grid", { name: "Semana" }); await expect(week).toBeVisible({ timeout: 30_000 });
    await expect(week.getByRole("region")).toHaveCount(7);
    const title1 = (await page.locator("[aria-live=polite]").filter({ hasText: /\d/ }).first().textContent())!;
    await page.getByRole("button", { name: "Próximo" }).click();
    await expect(page.locator("[aria-live=polite]").filter({ hasText: /\d/ }).first()).not.toHaveText(title1);
    await page.getByRole("button", { name: "Anterior" }).click();
    await expect(page.locator("[aria-live=polite]").filter({ hasText: /\d/ }).first()).toHaveText(title1);
    await views.getByRole("button", { name: "Mês" }).click();
    const month = page.getByRole("grid", { name: "Mês" }); await expect(month).toBeVisible({ timeout: 30_000 });
    expect(await month.getByRole("button").count()).toBeGreaterThanOrEqual(28);
    await month.getByRole("button").nth(10).click();
    await expect(views.getByRole("button", { name: "Dia" })).toHaveAttribute("aria-pressed", "true");
    await expectNoFatal(page);
    expect(errors, errors.join("\n")).toEqual([]);
  });

  test("a interface oferece só o Google Calendar: nada de iPhone/Apple/assinatura .ics, e a agenda interna continua", async ({ page, context }) => {
    await loginAs(context, QA.fisio);
    await page.goto("/admin/meu-dia");
    const box = page.getByRole("region", { name: "Google Calendar" });
    await expect(box.getByRole("heading", { name: "Google Calendar" })).toBeVisible({ timeout: 30_000 });
    await expect(box.getByRole("button", { name: "Conectar Google Calendar" })).toBeVisible();
    await expect(page.getByText(/iPhone|Apple|webcal|\.ics|assinatura de calend|Gerar link/i)).toHaveCount(0);
    await expect(page.getByRole("region", { name: "Conectar calendários" })).toHaveCount(0);
    await expect(page.getByRole("group", { name: "Visualização" })).toBeVisible();                     // agenda interna preservada
    await expect(box.getByText(/Criação, remarcação e cancelamento são enviados automaticamente/)).toBeVisible();
    await expect(box.getByText(/nunca no seu calendário principal/)).toBeVisible();
  });

  test("Conectar Google Calendar leva ao Google com o cliente, o callback, os escopos e um state corretos (sem autorizar)", async ({ page, context }) => {
    await loginAs(context, QA.fisio);
    await page.route("https://accounts.google.com/**", (r) => r.fulfill({ status: 200, contentType: "text/html", body: "<html><body>google interceptado pelo teste</body></html>" }));
    await page.goto("/admin/meu-dia");
    const box = page.getByRole("region", { name: "Google Calendar" });
    const [req] = await Promise.all([page.waitForRequest((r) => r.url().startsWith("https://accounts.google.com/o/oauth2/v2/auth")), box.getByRole("button", { name: "Conectar Google Calendar" }).click()]);
    const q = new URL(req.url()).searchParams;
    expect(q.get("redirect_uri")).toBe(`${SUPABASE_URL}/functions/v1/google-calendar/callback`);
    expect(q.get("client_id") ?? "").toMatch(/^\d+-[a-z0-9]+\.apps\.googleusercontent\.com$/);
    expect((q.get("scope") ?? "").split(" ").sort()).toEqual(["email", "https://www.googleapis.com/auth/calendar.app.created", "https://www.googleapis.com/auth/calendar.events.readonly", "openid"]);
    expect(q.get("access_type")).toBe("offline"); expect(q.get("response_type")).toBe("code"); expect(q.get("prompt")).toBe("consent");
    expect(q.get("state") ?? "").toMatch(/^[\w-]+\.[\w-]+$/);
    expect(req.url()).not.toMatch(/client_secret|refresh_token|access_token|service_role/);            // nenhum segredo/token na URL
  });

  test("retorno do Google: mensagens claras (conectado, permissão, pedido vencido/usado) e o parâmetro sai da URL", async ({ page, context }) => {
    await loginAs(context, QA.fisio);
    for (const [k, txt] of [["estado", /venceu ou já foi usado/], ["permissao", /Autorize todas/], ["erro", /Não foi possível concluir a conexão/], ["conectado", /Google Calendar conectado/]] as const) {
      await page.goto(`/admin/meu-dia?google=${k}`);
      await expect(page.getByText(txt).first()).toBeVisible({ timeout: 30_000 });
      await expect(page).not.toHaveURL(/google=/);
    }
  });

  test("o endereço de assinatura .ics foi aposentado: a função não está mais publicada", async () => {
    const r = await fetch(`${SUPABASE_URL}/functions/v1/calendar-feed?t=${"0".repeat(64)}`); expect(r.status).toBe(404);
  });

  test("status da conexão e desconexão: conta e última sincronização aparecem, erro de sincronização é mostrado, desconectar remove tudo", async ({ page, context }) => {
    test.skip(!process.env.SUPABASE_ACCESS_TOKEN, "precisa de SUPABASE_ACCESS_TOKEN para preparar a linha de teste");
    const fis = await loginAs(context, QA.fisio);
    const org = ((await devSql(`select org_id from public.user_accounts where user_id = '${fis.user.id}'`)) as { org_id: string }[])[0].org_id;
    const clean = () => devSql(`delete from public.google_calendar_connections where user_id = '${fis.user.id}'`);
    await clean();
    await devSql(`insert into public.google_calendar_connections (user_id, org_id, google_email, refresh_token_enc, status) values ('${fis.user.id}', '${org}', 'conta.teste@example.com', 'aW52YWxpZG8=.aW52YWxpZG8=', 'active')`);
    try {
      await page.goto("/admin/meu-dia");
      const box = page.getByRole("region", { name: "Google Calendar" });
      await expect(box.getByText("Conectado", { exact: true })).toBeVisible({ timeout: 30_000 });
      await expect(box.getByText(/Conta: conta\.teste@example\.com/)).toBeVisible(); await expect(box.getByText(/ainda não sincronizado/)).toBeVisible();
      await expect(box.getByRole("button", { name: "Sincronizar agora" })).toBeVisible(); await expect(box.getByRole("button", { name: "Desconectar" })).toBeVisible();
      await expect(box.getByRole("button", { name: "Conectar Google Calendar" })).toHaveCount(0);
      // tokens protegidos: o navegador só vê o status
      const st = await (await fetch(`${SUPABASE_URL}/rest/v1/rpc/google_connection_status`, { method: "POST", headers: { apikey: ANON, authorization: `Bearer ${fis.access_token}`, "content-type": "application/json" }, body: "{}" })).text();
      expect(st).not.toMatch(/refresh|token|aW52YWxpZG8/i);
      const direct = await fetch(`${SUPABASE_URL}/rest/v1/google_calendar_connections?select=*`, { headers: { apikey: ANON, authorization: `Bearer ${fis.access_token}` } });
      expect(direct.status).toBeGreaterThanOrEqual(400);
      // sincronizar com token inválido: o erro aparece (nada de falha silenciosa) e o status passa a "com erro"
      await box.getByRole("button", { name: "Sincronizar agora" }).click();
      await expect(page.getByText(/Não foi possível concluir agora/)).toBeVisible({ timeout: 30_000 });
      await page.reload(); await expect(box.getByText(/Conectado com erro/)).toBeVisible({ timeout: 30_000 });
      // desconectar
      await box.getByRole("button", { name: "Desconectar" }).click(); await page.getByRole("dialog").getByRole("button", { name: "Desconectar" }).click();
      await expect(page.getByText("Google Calendar desconectado.")).toBeVisible({ timeout: 30_000 });
      await expect(box.getByRole("button", { name: "Conectar Google Calendar" })).toBeVisible();
      expect(Number(((await devSql(`select count(*) n from public.google_calendar_connections where user_id = '${fis.user.id}'`)) as { n: number }[])[0].n)).toBe(0);
    } finally { await clean(); }
  });
});
