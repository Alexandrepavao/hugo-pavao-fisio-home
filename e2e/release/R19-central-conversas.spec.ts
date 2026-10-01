// ACEITE da release v1 — Central de Conversas (CRM): 3 colunas (lista · mensagens · ficha do lead por nicho), registro honesto de envio (WhatsApp aberto, sem confirmação),
// resposta recebida e nota interna, multiatendimento (adicionar, não lida por usuário, transferir), mensagens agendadas (lembrete + registro manual; nada é enviado sozinho),
// integração com oportunidade/histórico/tarefas, permissões no SERVIDOR e celular. wa.me é interceptado: NENHUMA mensagem real sai. Dados próprios (runId), removidos no fim.
import { expect, test, type Page } from "@playwright/test";
import { mkdirSync } from "node:fs";
import { api, collectErrors, devSql, expectNoFatal, loginAs, QA, rest, runId, signIn } from "./helpers-release";

test.use({ timezoneId: "America/Sao_Paulo", locale: "pt-BR", viewport: { width: 1440, height: 900 } });
const SHOTS = "docs/screenshots/conversas";

test.describe.serial("@release Central de Conversas", () => {
  test.setTimeout(240_000);
  const person = `Lead R19 ${runId}`; const aluna = `Aluna R19 ${runId}`; const title = `Fisioterapia R19 ${runId}`; const titleEdu = `Mentoria R19 ${runId}`;
  const phone = `(11) 9${String(Math.floor(Math.random() * 9e7) + 1e7)}`.replace(/(\d{5})(\d{4})$/, "$1-$2");
  const digits = phone.replace(/\D/g, "");
  let unitId = ""; let personId = ""; let oppId = ""; let eduPersonId = ""; let eduOppId = ""; let comId = ""; let gestorId = ""; let convId = ""; const waUrls: string[] = [];
  const ids = () => `select id from public.people where full_name in ('${person}', '${aluna}')`;
  const clean = async () => {
    await devSql(`delete from public.crm_scheduled_messages where person_id in (${ids()})`);
    await devSql(`delete from public.crm_tasks where person_id in (${ids()})`);
    await devSql(`delete from public.crm_conversations where person_id in (${ids()})`);
    await devSql(`delete from public.interactions where person_id in (${ids()})`);
    await devSql(`delete from public.opportunities where person_id in (${ids()})`);
    await devSql(`delete from public.person_contacts where person_id in (${ids()})`).catch(() => null);
    await devSql(`delete from public.person_kinds where person_id in (${ids()})`).catch(() => null);
    await devSql(`delete from public.people where full_name in ('${person}', '${aluna}')`).catch(() => null);
  };
  const interceptWa = async (page: Page) => { await page.context().route("https://wa.me/**", (r) => { waUrls.push(decodeURIComponent(r.request().url())); return r.fulfill({ status: 200, contentType: "text/html", body: "<html><body>wa.me interceptado pelo teste</body></html>" }); }); };
  const sql1 = async <T,>(q: string) => ((await devSql(q)) as T[])[0];

  test.afterAll(async () => { if (process.env.SUPABASE_ACCESS_TOKEN) await clean(); });

  test("fixtures: lead de Fisioterapia (com telefone) e lead da Academy, ambos do comercial QA", async () => {
    test.skip(!process.env.SUPABASE_ACCESS_TOKEN, "precisa de SUPABASE_ACCESS_TOKEN para preparar fixtures");
    await clean();
    const mgr = await signIn(QA.manager); const g = api(mgr); comId = (await signIn(QA.comercial)).user.id; gestorId = (await signIn(QA.gestorUnidade)).user.id;
    unitId = (await g.get("units?select=id&slug=eq.sao-paulo")).body[0].id;
    const pat = (await g.get("pipelines?select=id&kind=eq.patients&active=eq.true&limit=1")).body[0].id; const edu = (await g.get("pipelines?select=id&kind=eq.education&active=eq.true&limit=1")).body[0].id;
    const p = await g.rpc("create_person", { p_full_name: person, p_unit_id: unitId, p_kinds: ["lead"], p_email: `lead.r19.${runId.toLowerCase()}@example.com`, p_phone: phone, p_notes: null, p_force: true }); expect(p.status, JSON.stringify(p.body)).toBe(200); personId = p.body.id;
    const o = await g.rpc("crm_create_opportunity", { p_person_id: personId, p_pipeline_id: pat, p_unit_id: unitId, p_title: title, p_value_cents: 180_000, p_owner: comId, p_source: "Instagram", p_campaign: "R19" }); expect(o.status, JSON.stringify(o.body)).toBe(200); oppId = o.body;
    const p2 = await g.rpc("create_person", { p_full_name: aluna, p_unit_id: unitId, p_kinds: ["lead"], p_email: `aluna.r19.${runId.toLowerCase()}@example.com`, p_phone: null, p_notes: null, p_force: true }); expect(p2.status, JSON.stringify(p2.body)).toBe(200); eduPersonId = p2.body.id;
    const o2 = await g.rpc("crm_create_opportunity", { p_person_id: eduPersonId, p_pipeline_id: edu, p_unit_id: unitId, p_title: titleEdu, p_value_cents: 0, p_owner: comId, p_source: "Quiz", p_campaign: null }); expect(o2.status, JSON.stringify(o2.body)).toBe(200); eduOppId = o2.body;
  });

  test("Abrir a conversa pela oportunidade: 3 colunas (lista, mensagens, ficha) e ficha do nicho Fisioterapia", async ({ page, context }) => {
    await loginAs(context, QA.comercial); const errors = collectErrors(page); mkdirSync(SHOTS, { recursive: true });
    await page.goto("/admin/crm/oportunidades"); await page.getByRole("region", { name: "Quadro do funil" }).waitFor({ timeout: 40_000 });
    await page.getByPlaceholder("Pessoa ou título").fill(title);
    const card = page.getByRole("button", { name: new RegExp(`^${person}, `) }); await expect(card).toHaveCount(1, { timeout: 30_000 }); await card.click();
    await page.getByTestId("opp-open-conversation").click();
    await expect(page).toHaveURL(/\/admin\/crm\/conversas\?c=/, { timeout: 30_000 });
    convId = new URL(page.url()).searchParams.get("c")!; expect(convId).toMatch(/^[0-9a-f-]{36}$/);
    await expect(page.getByTestId("conv-title")).toHaveText(person, { timeout: 30_000 });
    const item = page.getByTestId("conv-item").filter({ hasText: person }); await expect(item).toHaveCount(1);
    const panel = page.getByTestId("lead-panel"); await expect(panel).toBeVisible();
    await expect(page.getByTestId("lead-niche")).toContainText("Ficha · Fisioterapia"); await expect(page.getByTestId("lead-opp")).toContainText(title); await expect(page.getByTestId("lead-opp")).toContainText("Instagram");
    await expect(page.getByTestId("lead-niche")).toContainText("Não registre dados clínicos");
    const a = await item.boundingBox(); const b = await page.getByTestId("conv-title").boundingBox(); const c = await panel.boundingBox();
    expect(a!.x).toBeLessThan(b!.x); expect(b!.x).toBeLessThan(c!.x);                                              // lista · mensagens · ficha, da esquerda para a direita
    expect(await page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth)).toBe(true);
    // recolher e reabrir a ficha
    await page.getByTestId("conv-panel-toggle").click(); await expect(panel).toHaveCount(0); await page.getByTestId("conv-panel-toggle").click(); await expect(page.getByTestId("lead-panel")).toBeVisible();
    // uma conversa só por pessoa e canal: abrir de novo pelo link devolve a mesma
    await page.goto(`/admin/crm/conversas?pessoa=${personId}&oportunidade=${oppId}`); await expect(page).toHaveURL(new RegExp(`c=${convId}`), { timeout: 30_000 });
    expect((await sql1<{ n: number }>(`select count(*)::int n from public.crm_conversations where person_id = '${personId}'`)).n).toBe(1);
    await expectNoFatal(page); expect(errors, errors.join("\n")).toEqual([]);
  });

  test("Mensagens: enviada abre o WhatsApp e registra SEM prometer entrega; resposta recebida e nota interna; histórico do lead", async ({ page, context }) => {
    await loginAs(context, QA.comercial); await interceptWa(page); const errors = collectErrors(page);
    await page.goto(`/admin/crm/conversas?c=${convId}`); await expect(page.getByTestId("conv-title")).toHaveText(person, { timeout: 30_000 });
    const text = `Olá, tudo bem? Posso ajudar com a avaliação. ${runId}`;
    await page.getByTestId("conv-text").fill(text);
    const popup = page.waitForEvent("popup"); await page.getByTestId("conv-send").click(); await popup;
    const out = page.getByTestId("msg-outbound").filter({ hasText: text }); await expect(out).toBeVisible({ timeout: 20_000 });
    await expect(out).toContainText("WhatsApp aberto · sem confirmação de entrega"); await expect(out).not.toContainText(/entregue|lida|visualizada/i);
    expect(waUrls.some((u) => u.includes(`wa.me/55${digits}`) && u.includes(text))).toBe(true);                    // número e texto certos no link
    await page.getByTestId("mode-inbound").click(); await page.getByTestId("conv-text").fill(`Oi! Pode ser amanhã? ${runId}`); await page.getByTestId("conv-send").click();
    await expect(page.getByTestId("msg-inbound").filter({ hasText: "Pode ser amanhã?" })).toContainText("Resposta registrada manualmente", { timeout: 20_000 });
    await page.getByTestId("mode-note").click(); await page.getByTestId("conv-text").fill(`Prefere manhã (nota) ${runId}`); await page.getByTestId("conv-send").click();
    await expect(page.getByTestId("msg-note").filter({ hasText: "Prefere manhã (nota)" })).toContainText("Nota interna", { timeout: 20_000 });
    // banco: só a enviada entrou no histórico do lead; a oportunidade ganhou primeira resposta
    const it = await sql1<{ n: number; notas: number }>(`select count(*)::int n, count(*) filter (where summary like '%Prefere manhã%' or summary like '%Pode ser amanhã%')::int notas from public.interactions where opportunity_id = '${oppId}' and channel = 'whatsapp'`);
    expect(it).toEqual({ n: 1, notas: 0 });
    expect((await sql1<{ ok: boolean }>(`select first_response_at is not null as ok from public.opportunities where id = '${oppId}'`)).ok).toBe(true);
    // o mesmo registro aparece no histórico da oportunidade (integração com o Pipeline)
    await page.goto("/admin/crm/oportunidades"); await page.getByRole("region", { name: "Quadro do funil" }).waitFor({ timeout: 40_000 });
    await page.getByPlaceholder("Pessoa ou título").fill(title); await page.getByRole("button", { name: new RegExp(`^${person}, `) }).click();
    await page.getByRole("dialog").getByRole("tab", { name: "Histórico" }).click(); await expect(page.getByRole("dialog").getByText(/WhatsApp aberto com a mensagem \(sem confirmação de envio\)/)).toBeVisible({ timeout: 20_000 });
    await expect(page.getByRole("dialog").getByText(/Prefere manhã/)).toHaveCount(0);
    expect(errors, errors.join("\n")).toEqual([]);
  });

  test("Ficha por nicho: Fisioterapia e Academy têm campos diferentes; salvar persiste; etapa muda pela ficha", async ({ page, context }) => {
    await loginAs(context, QA.comercial); const errors = collectErrors(page);
    await page.goto(`/admin/crm/conversas?c=${convId}`); await expect(page.getByTestId("lead-niche")).toBeVisible({ timeout: 30_000 });
    await page.locator("#pf-contact_reason").fill("Quer conhecer valores e horários"); await page.locator("#pf-preferred_period").selectOption("manha"); await page.locator("#pf-payment_pref").selectOption("particular"); await page.locator("#pf-referred_by").fill("Dra. Paula");
    await page.getByTestId("lead-save").click(); await expect(page.getByText("Ficha salva.")).toBeVisible({ timeout: 20_000 });
    const prof = (await sql1<{ profile: Record<string, string> }>(`select profile from public.opportunities where id = '${oppId}'`)).profile;
    expect(prof).toEqual({ contact_reason: "Quer conhecer valores e horários", preferred_period: "manha", payment_pref: "particular", referred_by: "Dra. Paula" });
    await page.reload(); await expect(page.locator("#pf-referred_by")).toHaveValue("Dra. Paula", { timeout: 30_000 }); await expect(page.locator("#pf-preferred_period")).toHaveValue("manha");
    // etapa
    const stages = (await devSql(`select s.id, s.name from public.pipeline_stages s join public.opportunities o on o.pipeline_id = s.pipeline_id where o.id = '${oppId}' and s.kind = 'open' order by s.position`)) as { id: string; name: string }[];
    await page.locator("#ld-stage").selectOption(stages[1].id); await expect(page.getByText("Etapa atualizada.")).toBeVisible({ timeout: 20_000 });
    expect((await sql1<{ stage_id: string }>(`select stage_id from public.opportunities where id = '${oppId}'`)).stage_id).toBe(stages[1].id);
    await expect(page.getByTestId("conv-item").filter({ hasText: person }).getByText(stages[1].name)).toBeVisible({ timeout: 20_000 });   // a lista mostra a etapa nova
    // o servidor recusa campo de outro nicho (mesmo chamando a API direto)
    const s = await signIn(QA.comercial); const bad = await api(s).rpc("crm_lead_profile_save", { p_opportunity: oppId, p_profile: { course_interest: "Mentoria" } }); expect(bad.status).toBe(400); expect(JSON.stringify(bad.body)).toContain("não pertence ao nicho");
    // Academy: outros campos
    await page.goto(`/admin/crm/conversas?pessoa=${eduPersonId}&oportunidade=${eduOppId}`); await expect(page).toHaveURL(/c=/, { timeout: 30_000 });
    await expect(page.getByTestId("lead-niche")).toContainText("Ficha · Academy", { timeout: 30_000 });
    await expect(page.locator("#pf-course_interest")).toBeVisible(); await expect(page.locator("#pf-professional_profile")).toBeVisible(); await expect(page.locator("#pf-preferred_period")).toHaveCount(0);
    await expect(page.getByTestId("lead-niche")).not.toContainText("Não registre dados clínicos");
    await page.locator("#pf-course_interest").fill("Mentoria em dor crônica"); await page.locator("#pf-professional_profile").selectOption("fisioterapeuta"); await page.getByTestId("lead-save").click();
    await expect(page.getByText("Ficha salva.")).toBeVisible({ timeout: 20_000 });
    expect((await sql1<{ profile: Record<string, string> }>(`select profile from public.opportunities where id = '${eduOppId}'`)).profile).toEqual({ course_interest: "Mentoria em dor crônica", professional_profile: "fisioterapeuta" });
    expect(errors, errors.join("\n")).toEqual([]);
  });

  test("Multiatendimento: adicionar atendente, não lida por usuário e respostas de dois atendentes", async ({ page, context, browser }) => {
    await loginAs(context, QA.comercial); await interceptWa(page); const errors = collectErrors(page);
    await page.goto(`/admin/crm/conversas?c=${convId}`); await expect(page.getByTestId("conv-title")).toHaveText(person, { timeout: 30_000 });
    await page.getByTestId("conv-team").click(); const dlg = page.getByRole("dialog");
    await expect(dlg.getByTestId("team-list")).toContainText("Responsável");
    await dlg.locator("#tm-add").selectOption(gestorId); await dlg.getByRole("button", { name: "Adicionar" }).click(); await expect(dlg.getByTestId("team-list").locator("li")).toHaveCount(2, { timeout: 20_000 });
    await page.keyboard.press("Escape");
    expect((await sql1<{ n: number }>(`select count(*)::int n from public.crm_conversation_participants where conversation_id = '${convId}'`)).n).toBe(2);
    // o gestor da unidade (outro navegador) vê a conversa, responde e registra uma resposta do contato
    const ctx2 = await browser.newContext({ timezoneId: "America/Sao_Paulo", locale: "pt-BR", viewport: { width: 1440, height: 900 } }); await loginAs(ctx2, QA.gestorUnidade); const p2 = await ctx2.newPage(); const err2 = collectErrors(p2);
    await ctx2.route("https://wa.me/**", (r) => r.fulfill({ status: 200, contentType: "text/html", body: "ok" }));
    await p2.goto("/admin/crm/conversas"); await p2.getByTestId("conv-scope-all").click();
    const it2 = p2.getByTestId("conv-item").filter({ hasText: person }); await expect(it2).toContainText("2 atendentes", { timeout: 30_000 }); await it2.click();
    await expect(p2.getByTestId("conv-title")).toHaveText(person); await expect(p2.getByTestId("msg-outbound").first()).toBeVisible();
    await p2.getByTestId("mode-inbound").click(); await p2.getByTestId("conv-text").fill(`Contato confirmou por telefone ${runId}`); await p2.getByTestId("conv-send").click();
    await expect(p2.getByTestId("msg-inbound").filter({ hasText: "Contato confirmou" })).toBeVisible({ timeout: 20_000 });
    // a leitura é por usuário: para o comercial (fora da conversa aberta) ela aparece como não lida; para quem a registrou, não
    await page.goto("/admin/crm/conversas"); const mine = page.getByTestId("conv-item").filter({ hasText: person }); await expect(mine).toHaveAttribute("data-unread", "1", { timeout: 30_000 });
    await expect(page.getByTestId("conv-scope-mine")).toContainText("1");
    await mine.click(); await expect(page.getByTestId("msg-inbound").filter({ hasText: "Contato confirmou" })).toBeVisible(); await expect(mine).toHaveAttribute("data-unread", "0", { timeout: 30_000 });  // abrir marca como lida
    await expect(p2.getByTestId("conv-item").filter({ hasText: person })).toHaveAttribute("data-unread", "0");
    await ctx2.close(); expect(errors, errors.join("\n")).toEqual([]); expect(err2, err2.join("\n")).toEqual([]);
  });

  test("Mensagens agendadas: vira lembrete (nada é enviado), remarcar/cancelar, e na hora fica pronta para enviar; envio registrado na conversa e no histórico", async ({ page, context }) => {
    await loginAs(context, QA.comercial); await interceptWa(page); const errors = collectErrors(page);
    await page.goto(`/admin/crm/conversas?c=${convId}`); await expect(page.getByTestId("conv-title")).toHaveText(person, { timeout: 30_000 });
    const body1 = `Lembrete: sua avaliação é amanhã às 9h. ${runId}`; const body2 = `Segunda mensagem para cancelar ${runId}`;
    const before = waUrls.length;
    for (const b of [body1, body2]) {
      await page.getByTestId("conv-text").fill(b); await page.getByTestId("conv-schedule").click();
      await expect(page.getByRole("dialog").getByText(/O HP não envia sozinho/)).toBeVisible(); await page.getByRole("dialog").getByRole("button", { name: "Agendar", exact: true }).click();
      await expect(page.getByText(/Mensagem agendada\. No horário/)).toBeVisible({ timeout: 20_000 });
    }
    const bar = page.getByTestId("conv-scheduled"); await expect(bar.getByTestId("conv-sched-item")).toHaveCount(2, { timeout: 20_000 });
    expect(waUrls.length).toBe(before);                                                                              // agendar NÃO abre WhatsApp nem envia
    expect((await sql1<{ n: number }>(`select count(*)::int n from public.crm_messages where conversation_id = '${convId}' and body in ('${body1}', '${body2}')`)).n).toBe(0);
    const tasks = await sql1<{ n: number }>(`select count(*)::int n from public.crm_tasks where kind = 'reminder' and person_id = '${personId}' and assignee_user_id = '${comId}' and done_at is null and opportunity_id = '${oppId}'`); expect(tasks.n).toBe(2);
    await expect(page.getByTestId("conv-item").filter({ hasText: person })).toContainText("2 agendadas", { timeout: 20_000 });
    // cancelar a segunda
    await bar.getByTestId("conv-sched-item").filter({ hasText: body2 }).getByTestId("sched-cancel").click(); await expect(bar.getByTestId("conv-sched-item")).toHaveCount(1, { timeout: 20_000 });
    expect(await sql1<{ s: string; t: number }>(`select (select status from public.crm_scheduled_messages where body = '${body2}') s, (select count(*)::int from public.crm_tasks where kind = 'reminder' and person_id = '${personId}' and done_at is null) t`)).toEqual({ s: "cancelled", t: 1 });
    // remarcar a primeira (+2 dias): o lembrete acompanha
    await bar.getByRole("button", { name: "Remarcar" }).click(); const d = new Date(Date.now() + 2 * 864e5); const pad = (n: number) => String(n).padStart(2, "0");
    await bar.locator('input[type="datetime-local"]').fill(`${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}T10:00`); await bar.getByRole("button", { name: "Salvar" }).click();
    await expect(page.getByText("Mensagem remarcada.")).toBeVisible({ timeout: 20_000 });
    expect((await sql1<{ ok: boolean }>(`select (s.scheduled_for = t.due_at and s.scheduled_for > now() + interval '1 day 12 hours') ok from public.crm_scheduled_messages s join public.crm_tasks t on t.id = s.task_id where s.body = '${body1}'`)).ok).toBe(true);
    // a lista "Mensagens agendadas" (rota do CRM, ligada na v1) mostra em "Agendadas"
    await page.goto("/admin/crm/mensagens-agendadas"); await page.getByRole("tab", { name: /^Agendadas/ }).click(); await expect(page.getByTestId("sched-row").filter({ hasText: body1 })).toContainText("Agendada", { timeout: 20_000 });
    // chega a hora (desloca o horário no Dev): a mensagem passa a "pronta para enviar" e NADA foi enviado sozinho
    await devSql(`update public.crm_scheduled_messages set scheduled_for = now() - interval '5 minutes' where body = '${body1}'; update public.crm_tasks set due_at = now() - interval '5 minutes' where id = (select task_id from public.crm_scheduled_messages where body = '${body1}')`);
    expect((await sql1<{ n: number }>(`select count(*)::int n from public.crm_messages where scheduled_message_id is not null and conversation_id = '${convId}'`)).n).toBe(0);
    await page.goto("/admin/crm/mensagens-agendadas"); await expect(page.getByRole("tab", { name: /^Prontas para enviar \(1\)/ })).toBeVisible({ timeout: 30_000 });
    const row = page.getByTestId("sched-row").filter({ hasText: body1 }); await expect(row).toContainText("Pronta para enviar");
    await page.screenshot({ path: `${SHOTS}/mensagens-agendadas-desktop.png`, fullPage: true });
    // o lembrete aparece nas tarefas do CRM (integração)
    await page.goto("/admin/crm/tarefas"); await expect(page.getByText(`Enviar mensagem agendada para ${person}`)).toBeVisible({ timeout: 30_000 });
    // transferir a conversa para o gestor leva a mensagem pendente e o lembrete; ele registra o envio
    await page.goto(`/admin/crm/conversas?c=${convId}`); await expect(page.getByTestId("conv-title")).toHaveText(person, { timeout: 30_000 });
    await expect(page.getByTestId("conv-scheduled")).toContainText("Pronta", { timeout: 20_000 });
    await page.screenshot({ path: `${SHOTS}/conversas-desktop.png`, fullPage: false });
    await page.getByTestId("conv-team").click(); const dlg = page.getByRole("dialog"); await dlg.locator("#tm-to").selectOption(gestorId); await dlg.getByText("Continuar como colaborador").click(); await dlg.getByTestId("team-transfer").click();
    await expect(page.getByText("Conversa transferida.")).toBeVisible({ timeout: 20_000 });
    const tr = await sql1<{ owner: string; opp: string; sched: string; task: string; stay: number }>(`select (select user_id::text from public.crm_conversation_participants where conversation_id = '${convId}' and role = 'owner') owner, (select owner_user_id::text from public.opportunities where id = '${oppId}') opp, (select assignee_user_id::text from public.crm_scheduled_messages where body = '${body1}') sched, (select assignee_user_id::text from public.crm_tasks where id = (select task_id from public.crm_scheduled_messages where body = '${body1}')) task, (select count(*)::int from public.crm_conversation_participants where conversation_id = '${convId}' and user_id = '${comId}') stay`);
    expect(tr).toEqual({ owner: gestorId, opp: gestorId, sched: gestorId, task: gestorId, stay: 0 });
    await expect(page.getByTestId("conv-join")).toBeVisible({ timeout: 20_000 });                                    // quem saiu só lê até entrar de novo
    await expect(page.getByText("Você pode ler esta conversa. Entre nela para responder")).toBeVisible();
    const ctx2 = await page.context().browser()!.newContext({ timezoneId: "America/Sao_Paulo", locale: "pt-BR", viewport: { width: 1440, height: 900 } }); await loginAs(ctx2, QA.gestorUnidade); const p2 = await ctx2.newPage(); const err2 = collectErrors(p2);
    const wa2: string[] = []; await ctx2.route("https://wa.me/**", (r) => { wa2.push(decodeURIComponent(r.request().url())); return r.fulfill({ status: 200, contentType: "text/html", body: "ok" }); });
    await p2.goto("/admin/crm/mensagens-agendadas"); const row2 = p2.getByTestId("sched-row").filter({ hasText: body1 }); await expect(row2).toContainText("Pronta para enviar", { timeout: 30_000 });
    const pop = p2.waitForEvent("popup"); await row2.getByTestId("sched-send").click(); await pop;
    await expect(p2.getByText(/WhatsApp aberto e envio registrado/)).toBeVisible({ timeout: 20_000 });
    expect(wa2.some((u) => u.includes(`wa.me/55${digits}`) && u.includes(body1))).toBe(true);
    await p2.getByRole("tab", { name: /^Enviadas/ }).click(); await expect(p2.getByTestId("sched-row").filter({ hasText: body1 })).toContainText("Enviada", { timeout: 20_000 });
    const sent = await sql1<{ st: string; dir: string; del: string; done: boolean; it: number }>(`select s.status st, m.direction dir, m.delivery del, (t.done_at is not null) done, (select count(*)::int from public.interactions i where i.opportunity_id = '${oppId}' and i.summary like '%${body1}%') it from public.crm_scheduled_messages s join public.crm_messages m on m.id = s.message_id join public.crm_tasks t on t.id = s.task_id where s.body = '${body1}'`);
    expect(sent).toEqual({ st: "sent", dir: "outbound", del: "whatsapp_opened", done: true, it: 1 });
    await p2.goto(`/admin/crm/conversas?c=${convId}`); await expect(p2.getByTestId("msg-outbound").filter({ hasText: body1 })).toContainText("sem confirmação de entrega", { timeout: 30_000 });
    await ctx2.close(); expect(errors, errors.join("\n")).toEqual([]); expect(err2, err2.join("\n")).toEqual([]);
  });

  test("Permissões no servidor: paciente, fisioterapeuta e outro papel não leem nem escrevem conversas; mensagem não é editável", async () => {
    for (const email of [QA.paciente, QA.fisio]) {
      const s = await signIn(email); const g = api(s);
      for (const t of ["crm_conversations", "crm_messages", "crm_scheduled_messages", "crm_conversation_participants"]) { const r = await g.get(`${t}?select=*&limit=5`); expect(r.status, `${email} ${t}`).toBe(200); expect(r.body, `${email} ${t}`).toEqual([]); }
      expect((await g.rpc("crm_conversations_inbox", { p_scope: "all" })).body).toEqual([]);
      expect((await g.rpc("crm_conversation_open", { p_person: personId })).status).toBeGreaterThanOrEqual(400);
      expect((await g.rpc("crm_conversation_post", { p_conversation: convId, p_direction: "note", p_body: "intruso" })).status).toBeGreaterThanOrEqual(400);
    }
    const com = await signIn(QA.comercial);
    const ins = await rest(com, "POST", "crm_messages", { org_id: "00000000-0000-0000-0000-000000000000", unit_id: unitId, conversation_id: convId, direction: "outbound", body: "direto" }); expect([401, 403]).toContain(ins.status);
    const msgId = (await sql1<{ id: string }>(`select id from public.crm_messages where conversation_id = '${convId}' and direction = 'inbound' limit 1`)).id;
    const upd = await rest(com, "PATCH", `crm_messages?id=eq.${msgId}`, { body: "adulterada" }); expect([401, 403]).toContain(upd.status);
    expect((await sql1<{ body: string }>(`select body from public.crm_messages where id = '${msgId}'`)).body).not.toBe("adulterada");
    const del = await rest(com, "DELETE", `crm_messages?id=eq.${msgId}`); expect([401, 403]).toContain(del.status);
  });

  test("Paciente não vê o CRM pela tela", async ({ page, context }) => {
    await loginAs(context, QA.paciente); await page.goto("/admin/crm/conversas"); await page.waitForTimeout(1500);
    await expect(page.getByTestId("conversas")).toHaveCount(0); await expect(page.getByTestId("conv-list")).toHaveCount(0);
  });

  test("Celular: uma tela por vez (lista → conversa), ficha em gaveta, sem rolagem lateral", async ({ browser }) => {
    const ctx = await browser.newContext({ timezoneId: "America/Sao_Paulo", locale: "pt-BR", viewport: { width: 390, height: 844 }, deviceScaleFactor: 2, isMobile: true, hasTouch: true });
    await loginAs(ctx, QA.gestorUnidade); const page = await ctx.newPage(); const errors = collectErrors(page);
    await page.goto("/admin/crm/conversas"); await page.getByTestId("conv-scope-all").click();
    const item = page.getByTestId("conv-item").filter({ hasText: person }); await expect(item).toBeVisible({ timeout: 30_000 });
    await expect(page.getByTestId("conv-title")).toHaveCount(0);                                                    // só a lista
    expect(await page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth)).toBe(true);
    await page.screenshot({ path: `${SHOTS}/lista-celular.png` });
    await item.click(); await expect(page.getByTestId("conv-title")).toHaveText(person); await expect(page.getByTestId("conv-list")).toBeHidden();
    expect(await page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth)).toBe(true);
    await page.screenshot({ path: `${SHOTS}/conversa-celular.png` });
    await page.getByTestId("conv-panel-toggle").click(); const sheet = page.getByRole("dialog", { name: "Ficha do lead" }); await expect(sheet.getByTestId("lead-niche")).toContainText("Ficha · Fisioterapia", { timeout: 20_000 });
    await expect(sheet.locator("#pf-referred_by")).toHaveValue("Dra. Paula"); await page.waitForTimeout(700);               // fim da animação da gaveta antes da captura
    await page.screenshot({ path: `${SHOTS}/ficha-celular.png` });
    await page.keyboard.press("Escape"); await page.getByRole("button", { name: "Voltar para a lista" }).click(); await expect(page.getByTestId("conv-list")).toBeVisible();
    expect(errors, errors.join("\n")).toEqual([]); await ctx.close();
  });
});
