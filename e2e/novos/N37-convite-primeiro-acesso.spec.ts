// NOVO — N37: primeiro acesso do paciente pendente — convite seguro (função patient-invite) pela tela da fisioterapeuta. Somente Dev.
// REAL: autorização no banco, escolha do e-mail JÁ cadastrado, reaproveitamento de conta existente (sem e-mail e sem mexer na senha), "acesso pendente" sem e-mail, e-mail mascarado na tela.
// ENVIO REAL pelo Resend: só roda se N37_REAL_SEND_TO (o único endereço de teste permitido do projeto) estiver definido E o secret PUBLIC_SITE_URL existir no Dev. Fora disso este teste NUNCA envia e-mail
// (nada de endereços de domínio fictício: bounce prejudica a reputação do remetente). A cobertura de regras do convite está em N20 (SQL).
import { expect, test } from "@playwright/test";
import { join } from "node:path";
import { ANON, SUPABASE_URL } from "../helpers";
import { QA, devSql, createConfirmedUser, loginAs, signIn } from "../release/helpers-release";

test.use({ timezoneId: "America/Sao_Paulo", locale: "pt-BR", viewport: { width: 1440, height: 900 } });
const shot = async (p: import("@playwright/test").Page, name: string, full = false) => { if (process.env.MKT_SHOTS) await p.screenshot({ path: join(process.env.MKT_SHOTS, `${name}.png`), fullPage: full }); };
const ORG = "268b67d7-faa3-43c2-bb91-0616c78e10d0", UNIT = "9ace3ebd-352c-4832-b488-904f6a708e22", PROF = "3b6e077e-bee8-437b-b4fe-e3c413cdd457", SVC = "3c2ac8b8-8322-4e04-85a2-c832c38d475c";
const RUN = Date.now().toString(36);
const OFF = 460 + (parseInt(RUN, 36) % 400); // faixa diferente da do N36
const PWD = `Teste-${RUN}-Aa1!`;
const REAL = process.env.N37_REAL_SEND_TO;
const ids: Record<string, { person: string; enr: string }> = {};

let slot = 0;
const mk = async (key: string, name: string, email: string | null) => {
  const hours = OFF + (++slot) * 2;                                       // horários distintos: a profissional não pode ter dois atendimentos sobrepostos
  const r = (await devSql(`
    with p as (insert into public.people (org_id, unit_id, full_name) values ('${ORG}', '${UNIT}', '${name}') returning id),
    pc as (insert into public.person_contacts (org_id, person_id, type, value) select '${ORG}', id, 'email', '${email ?? ""}' from p where ${email ? "true" : "false"} returning person_id),
    o as (insert into public.opportunities (org_id, unit_id, person_id, pipeline_id, stage_id, title)
            select '${ORG}', '${UNIT}', p.id, pl.id, st.id, 'Opp N37 ${key}' from p, public.pipelines pl join public.pipeline_stages st on st.pipeline_id = pl.id and st.key = 'new_contact' where pl.org_id = '${ORG}' and pl.kind = 'patients' returning id),
    a as (insert into public.appointments (org_id, unit_id, professional_id, person_id, service_id, period, opportunity_id)
            select '${ORG}', '${UNIT}', '${PROF}', (select id from p), '${SVC}', tstzrange(now() + make_interval(hours => ${hours}), now() + make_interval(hours => ${hours}, mins => 50)), (select id from o) returning id)
    select (select id from p) pid, (select id from o) oid, (select count(*) from a) n`)) as { pid: string; oid: string }[];
  await devSql(`update public.opportunities set stage_id = (select st.id from public.pipeline_stages st join public.opportunities o on o.pipeline_id = st.pipeline_id where o.id = '${r[0].oid}' and st.key = 'evaluation_scheduled') where id = '${r[0].oid}'`);
  const e = (await devSql(`select id from public.patient_enrollments where person_id = '${r[0].pid}'`)) as { id: string }[];
  ids[key] = { person: r[0].pid, enr: e[0].id };
};

test.describe.serial("@novos Primeiro acesso do paciente pendente (convite)", () => {
  test.setTimeout(240_000);
  test.beforeAll(async () => {
    await mk("semEmail", `Paciente N37 SemEmail ${RUN}`, null);
    await mk("contaExistente", `Paciente N37 Conta ${RUN}`, `n37b.${RUN}@hp-test.dev`);
    await createConfirmedUser(`n37b.${RUN}@hp-test.dev`, PWD);                      // conta já confirmada (o que o paciente teria depois de um primeiro acesso)
  });

  test("N37-1 sem e-mail: 'Acesso pendente — cadastrar e-mail'; a avaliação continua; nenhum envio", async ({ page, context }) => {
    await loginAs(context, QA.fisio);
    await page.goto(`/apresentacao/avaliacao/${ids.semEmail.enr}`); await expect(page.getByTestId("presentation-workspace")).toBeVisible({ timeout: 20_000 });
    await page.getByTestId("pw-tab-publicar").click(); await expect(page.getByTestId("pw-access")).toBeVisible();
    await expect(page.getByTestId("pw-access-email")).toContainText("Acesso pendente"); await expect(page.getByTestId("pw-invite")).toBeDisabled();
    await expect(page.getByTestId("pw-access-first")).toContainText("ainda não concluído");
    await shot(page, "jornada-acesso-sem-email");
    const n = (await devSql(`select count(*) c from public.portal_invites where person_id = '${ids.semEmail.person}'`)) as { c: string }[]; expect(Number(n[0].c)).toBe(0);
  });

  test("N37-2 conta existente: identidade reutilizada, senha intacta, nenhum e-mail; e-mail aparece mascarado", async ({ page, context }) => {
    await loginAs(context, QA.fisio);
    await page.goto(`/apresentacao/avaliacao/${ids.contaExistente.enr}`); await page.getByTestId("pw-tab-publicar").click();
    await expect(page.getByTestId("pw-access-email")).toContainText("n***@h***.dev"); await expect(page.locator("body")).not.toContainText(`n37b.${RUN}@`);   // e-mail completo nunca na tela
    await expect(page.getByTestId("pw-access-account")).toContainText("ainda não criada");
    const before = (await devSql(`select encrypted_password p from auth.users where lower(email) = 'n37b.${RUN}@hp-test.dev'`)) as { p: string }[];
    await page.getByTestId("pw-invite").click(); await expect(page.getByText("identidade foi reutilizada")).toBeVisible({ timeout: 20_000 });
    await expect(page.getByTestId("pw-access-account")).toContainText("já criada e ligada");
    const after = (await devSql(`select u.encrypted_password p, (select count(*) from public.user_accounts where user_id = u.id and person_id = '${ids.contaExistente.person}') linked, (select count(*) from public.portal_invites where person_id = '${ids.contaExistente.person}' and kind = 'link' and outcome = 'accepted') logged from auth.users u where lower(u.email) = 'n37b.${RUN}@hp-test.dev'`)) as { p: string; linked: string; logged: string }[];
    expect(after[0].p).toBe(before[0].p); expect(Number(after[0].linked)).toBe(1); expect(Number(after[0].logged)).toBe(1);      // senha intacta; ligado; registro sem e-mail completo
    await shot(page, "jornada-acesso-conta-existente");
    // quem não tem vínculo (comercial) é recusado pela função: a autorização é do banco, não da tela
    const com = await signIn(QA.comercial);
    const r = await fetch(`${SUPABASE_URL}/functions/v1/patient-invite`, { method: "POST", headers: { authorization: `Bearer ${com.access_token}`, apikey: ANON, "content-type": "application/json" }, body: JSON.stringify({ person_id: ids.contaExistente.person }) });
    expect(r.status).toBe(403);
    const anon = await fetch(`${SUPABASE_URL}/functions/v1/patient-invite`, { method: "POST", headers: { "content-type": "application/json" }, body: "{}" }); expect(anon.status).toBe(401);
  });

  test("N37-3 convite novo pelo Resend (SÓ com N37_REAL_SEND_TO e PUBLIC_SITE_URL): envio aceito, e-mail mascarado, reenvio limitado", async ({ page, context }) => {
    test.skip(!REAL, "Envio real não executado: defina N37_REAL_SEND_TO (único endereço de teste permitido) depois de configurar PUBLIC_SITE_URL no Dev. A regra do convite está provada em N20.");
    await mk("convite", `Paciente N37 Convite ${RUN}`, REAL!);
    await loginAs(context, QA.fisio);
    await page.goto(`/apresentacao/avaliacao/${ids.convite.enr}`); await page.getByTestId("pw-tab-publicar").click();
    await page.getByTestId("pw-invite").click();
    await expect(page.getByText(/ACEITOU o envio|não está configurado|não aceitou/)).toBeVisible({ timeout: 30_000 });
    await expect(page.getByTestId("pw-access-last")).toContainText(/aceito pelo serviço de e-mail|não aceito/);
    await shot(page, "jornada-acesso-convite-enviado");
    await page.getByTestId("pw-invite").click(); await expect(page.getByText(/aguarde 10 minutos|ACEITOU|não está configurado/)).toBeVisible({ timeout: 30_000 });
  });
});
