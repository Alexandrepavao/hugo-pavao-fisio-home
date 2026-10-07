// Capturas das jornadas Fisioterapeuta, Paciente e CRM + Hub sem o bloco “Seus aplicativos” — desktop (1440 px) e celular (390 px).
// Cria dados de DEMONSTRAÇÃO no Dev (profissional, paciente com pacote/plano, arquivo CSV) e os REMOVE ao final (inclusive se a captura falhar). Confere rolagem lateral e erros de console.
// Uso: HP_QA_PASSWORD=... SUPABASE_ACCESS_TOKEN=... node e2e/tools/shots-jornadas.mjs <baseUrl> <pastaSaida>
import { chromium } from "@playwright/test";
import { mkdirSync, readFileSync } from "node:fs";

const [base, outDir] = process.argv.slice(2);
if (!base || !outDir) throw new Error("uso: shots-jornadas.mjs <baseUrl> <pastaSaida>");
mkdirSync(outDir, { recursive: true });
const env = Object.fromEntries(readFileSync(new URL("../../.env.local", import.meta.url), "utf8").split(/\r?\n/).filter((l) => l && !l.startsWith("#")).map((l) => { const i = l.indexOf("="); return [l.slice(0, i), l.slice(i + 1).replace(/^"|"$/g, "")]; }));
const URL_ = env.VITE_SUPABASE_URL; const KEY = env.VITE_SUPABASE_PUBLISHABLE_KEY; const REF = new globalThis.URL(URL_).hostname.split(".")[0];
if (REF !== "fsvtzowcwhvwtluwrhnb") throw new Error(`recusado: o projeto ${REF} não é o Dev`);
const storageKey = `sb-${REF}-auth-token`; const TAG = "Demonstração jornadas"; const PASS = `Demo-${Date.now().toString(36)}-Aa1!`;
const login = async (email, password = process.env.HP_QA_PASSWORD) => { const r = await fetch(`${URL_}/auth/v1/token?grant_type=password`, { method: "POST", headers: { apikey: KEY, "content-type": "application/json" }, body: JSON.stringify({ email, password }) }); const j = await r.json(); if (!j.access_token) throw new Error(`login falhou: ${email}`); return j; };
const sql = async (query, tries = 4) => { for (let i = 1; ; i++) { try { const r = await fetch(`https://api.supabase.com/v1/projects/${REF}/database/query`, { method: "POST", headers: { authorization: `Bearer ${process.env.SUPABASE_ACCESS_TOKEN}`, "content-type": "application/json" }, body: JSON.stringify({ query }) }); const t = await r.json(); if (!r.ok) throw new Error(JSON.stringify(t)); return t; } catch (e) { if (i >= tries || /ERROR/.test(String(e))) throw e; await new Promise((res) => setTimeout(res, 1500 * i)); } } };
const rpc = async (s, fn, body) => { const r = await fetch(`${URL_}/rest/v1/rpc/${fn}`, { method: "POST", headers: { apikey: KEY, authorization: `Bearer ${s.access_token}`, "content-type": "application/json" }, body: JSON.stringify(body) }); const t = await r.text(); if (!r.ok) throw new Error(`${fn}: ${t}`); return t ? JSON.parse(t) : null; };
const pEmail = "paciente.demonstracao@hp-test.dev"; const fEmail = "fisio.demonstracao@hp-test.dev";
const cleanup = async () => {
  const people = `select id from public.people where full_name like '%${TAG}%'`;
  await sql(`delete from public.crm_tasks where person_id in (${people})`);
  await sql(`delete from public.renewal_requests where person_id in (${people})`);
  await sql(`delete from public.opportunities where person_id in (${people})`);
  await sql(`delete from public.appointments where person_id in (${people}) or professional_id in (select id from public.professionals where display_name like '%${TAG}%')`);
  await sql(`delete from public.client_packages where person_id in (${people})`);
  await sql(`delete from public.care_relationships where person_id in (${people})`);
  await sql(`delete from public.availability_rules where professional_id in (select id from public.professionals where display_name like '%${TAG}%')`);
  await sql(`delete from public.crm_lead_lists where name like '%${TAG}%'`);
  await sql(`delete from auth.users where email in ('${pEmail}', '${fEmail}')`);
  await sql(`delete from public.professionals where display_name like '%${TAG}%'`);
  await sql(`delete from public.products where name like '%${TAG}%'`);
  await sql(`delete from public.services where name like '%${TAG}%'`);
  await sql(`delete from public.person_contacts where person_id in (${people})`).catch(() => null);
  await sql(`delete from public.person_kinds where person_id in (${people})`).catch(() => null);
  await sql(`delete from public.people where full_name like '%${TAG}%'`).catch(() => null);
};
const mkUser = (email) => sql(`with u as (insert into auth.users (instance_id, id, aud, role, email, encrypted_password, email_confirmed_at, raw_app_meta_data, raw_user_meta_data, created_at, updated_at, confirmation_token, recovery_token, email_change_token_new, email_change)
  values ('00000000-0000-0000-0000-000000000000', gen_random_uuid(), 'authenticated', 'authenticated', '${email}', extensions.crypt('${PASS}', extensions.gen_salt('bf')), now(), '{"provider":"email","providers":["email"]}', '{}', now(), now(), '', '', '', '') returning id, email)
  insert into auth.identities (id, user_id, identity_data, provider, provider_id, last_sign_in_at, created_at, updated_at) select gen_random_uuid(), u.id, jsonb_build_object('sub', u.id::text, 'email', u.email, 'email_verified', true), 'email', u.id::text, now(), now(), now() from u returning user_id`).then((r) => r[0].user_id);
let bad = 0;
try {
  await cleanup();
  const mgr = await login("qa.manager@hp-test.dev");
  const [u] = await sql(`select id, name, org_id from public.units where slug = 'sao-paulo'`);
  const [svc] = await sql(`insert into public.services (org_id, name, duration_min) values ('${u.org_id}', 'Fisioterapia — ${TAG}', 30) returning id`);
  const [prod] = await sql(`insert into public.products (org_id, kind, name, price_cents, sessions_count, service_id) values ('${u.org_id}', 'package', 'Pacote 8 sessões — ${TAG}', 0, 8, '${svc.id}') returning id`);
  // profissional (pela função do sistema) + acesso
  const prof = await rpc(mgr, "professional_save", { p_id: null, p_person: null, p_name: `Ana Ribeiro — ${TAG}`, p_registration: "CREFITO-3 123456-F", p_units: [u.id], p_active: true });
  for (const [wd, a, b] of [[1, "08:00", "12:00"], [1, "14:00", "18:00"], [3, "08:00", "12:00"], [5, "08:00", "13:00"]]) await rpc(mgr, "professional_availability_save", { p_id: null, p_professional: prof, p_unit: u.id, p_weekday: wd, p_start: a, p_end: b, p_valid_from: null, p_valid_until: null });
  const fUser = await mkUser(fEmail); await rpc(mgr, "professional_grant_access", { p_professional: prof, p_email: fEmail });
  const [pp] = await sql(`insert into public.people (org_id, unit_id, full_name) values ('${u.org_id}', '${u.id}', 'Carla Mendes — ${TAG}') returning id`);
  await sql(`insert into public.person_kinds (person_id, kind) values ('${pp.id}', 'patient')`); await sql(`insert into public.person_contacts (org_id, person_id, type, value, is_primary) values ('${u.org_id}', '${pp.id}', 'email', '${pEmail}', true)`);
  const pUser = await mkUser(pEmail); await rpc(mgr, "person_portal_access", { p_person: pp.id, p_email: pEmail });
  const [pk] = await sql(`insert into public.client_packages (org_id, unit_id, person_id, product_id, total_sessions) values ('${u.org_id}', '${u.id}', '${pp.id}', '${prod.id}', 8) returning id`);
  await sql(`insert into public.session_ledger (org_id, client_package_id, delta, reason, note) values ('${u.org_id}', '${pk.id}', 8, 'grant', 'compra')`);
  const slot = async (d, h, st, withPkg = true) => (await sql(`insert into public.appointments (org_id, unit_id, professional_id, person_id, service_id, client_package_id, period, status) values ('${u.org_id}', '${u.id}', '${prof}', '${pp.id}', '${svc.id}', ${withPkg ? `'${pk.id}'` : "null"},
      tstzrange(((current_date + (${d})) + time '${h}') at time zone 'America/Sao_Paulo', ((current_date + (${d})) + time '${h}' + interval '30 minutes') at time zone 'America/Sao_Paulo', '[)'), '${st}') returning id`))[0].id;
  for (const [d, st] of [[-2, "attended"], [-3, "attended"], [-5, "no_show"], [-6, "cancelled_by_patient"]]) { const id = await slot(d, "09:00", st); if (["attended", "no_show", "cancelled_by_patient"].includes(st)) await sql(`insert into public.session_ledger (org_id, client_package_id, appointment_id, delta, reason) values ('${u.org_id}', '${pk.id}', '${id}', -1, 'consume')`); }
  await slot(-1, "09:00", "professional_no_show", false); await slot(-4, "09:00", "cancelled_by_clinic", false); await slot(2, "09:00", "scheduled"); await slot(4, "09:00", "confirmed");
  await sql(`insert into public.care_relationships (org_id, unit_id, professional_user_id, person_id, granted_by) values ('${u.org_id}', '${u.id}', '${fUser}', '${pp.id}', '${mgr.user.id}')`);
  const fis = await login(fEmail, PASS);
  await rpc(fis, "patient_plan_save", { p_person: pp.id, p_planned_sessions: 6, p_client_package: null, p_notes: "Plano definido na avaliação" });
  await rpc(fis, "patient_goal_save", { p_person: pp.id, p_id: null, p_title: "Voltar a caminhar 5 km sem dor", p_details: null, p_target_date: null, p_status: "active" });
  await rpc(fis, "professional_assessment_add", { p_person: pp.id, p_kind: "dor", p_score: 7, p_note: "Avaliação inicial", p_assessed_at: null });
  await rpc(fis, "patient_reassess", { p_person: pp.id, p_decision: "continuidade", p_extra_sessions: 4, p_patient_message: "Vamos manter o foco na força", p_clinical_note: null });
  const [lst] = await sql(`insert into public.crm_lead_lists (org_id, name) values ('${u.org_id}', 'Feira de saúde — ${TAG}') returning id`);
  const csv = `Nome Completo;E-mail;Celular;Canal;Campanha\nJoana Silva — ${TAG};joana.demo@example.com;(11) 97777-2222;Instagram;Feira 2026\nMarcos Lima — ${TAG};marcos.demo@example.com;(11) 96666-1111;Indicação;Feira 2026\nSem contato — ${TAG};;;;\n`;
  const pSess = await login(pEmail, PASS);

  const browser = await chromium.launch({ channel: "msedge" });
  for (const [sn, w, h] of [["1440", 1440, 900], ["390", 390, 844]]) {
    const errors = [];
    const mk = async (session) => { const ctx = await browser.newContext({ viewport: { width: w, height: h }, locale: "pt-BR", timezoneId: "America/Sao_Paulo", hasTouch: sn === "390", isMobile: sn === "390", acceptDownloads: true }); await ctx.addInitScript(([k, v]) => localStorage.setItem(k, v), [storageKey, JSON.stringify(session)]);
      const page = await ctx.newPage(); page.on("pageerror", (e) => errors.push(e.message)); page.on("console", (m) => { if (m.type() === "error" && !/favicon|ERR_BLOCKED|Failed to load resource/.test(m.text())) errors.push(m.text()); }); return { ctx, page }; };
    const check = async (page, name) => { const o = await page.evaluate(() => document.documentElement.scrollWidth - document.documentElement.clientWidth); if (o > 1) { console.log(`OVERFLOW ${name} @${sn}: ${o}px`); bad++; } };
    const shot = async (page, name, full = true) => { await page.evaluate(() => window.scrollTo(0, 0)); await page.waitForTimeout(900); await check(page, name); await page.screenshot({ path: `${outDir}/${name}-${sn}.png`, fullPage: full }); };
    // gestor: Hub, profissionais, importação CSV
    let { ctx, page } = await mk(mgr);
    await page.goto(`${base}/admin`, { waitUntil: "networkidle" }); await shot(page, "hub-sem-lancador");
    await page.goto(`${base}/admin/agenda`, { waitUntil: "networkidle" }); await page.getByRole("tab", { name: "Profissionais e disponibilidade" }).click(); await page.waitForTimeout(800); await shot(page, "profissionais");
    await page.locator("#rp").selectOption(prof); await page.waitForTimeout(600); await shot(page, "profissionais-disponibilidade");
    await page.goto(`${base}/admin/crm/leads`, { waitUntil: "networkidle" }); await page.getByRole("button", { name: "Importar CSV" }).click(); await page.waitForTimeout(600); await page.screenshot({ path: `${outDir}/csv-1-arquivo-${sn}.png` });
    const dlg = page.getByRole("dialog"); await dlg.locator("#crmi-file").setInputFiles({ name: "leads-evento.csv", mimeType: "text/csv", buffer: Buffer.from("﻿" + csv, "utf8") });
    await dlg.locator("#crmi-unit").selectOption(u.id); const pipe = (await sql(`select id from public.pipelines where active and kind = 'patients' order by created_at limit 1`))[0].id; await dlg.locator("#crmi-pipe").selectOption(pipe); await dlg.locator("#crmi-list").selectOption(lst.id);
    await page.waitForTimeout(400); await page.screenshot({ path: `${outDir}/csv-1b-padroes-${sn}.png` });
    await dlg.getByRole("button", { name: "Continuar" }).click(); await page.waitForTimeout(700); await page.screenshot({ path: `${outDir}/csv-2-mapeamento-${sn}.png` });
    await dlg.getByRole("button", { name: "Verificar (prévia)" }).click(); await dlg.getByText("Passo 3 de 4").waitFor(); await page.waitForTimeout(500); await page.screenshot({ path: `${outDir}/csv-3-previa-${sn}.png` });
    await dlg.getByRole("button", { name: /^Importar \d+ linha/ }).click(); await dlg.getByText("Passo 4 de 4").waitFor(); await page.waitForTimeout(500); await page.screenshot({ path: `${outDir}/csv-4-resultado-${sn}.png` });
    await ctx.close();
    // fisioterapeuta: Meu resumo
    ({ ctx, page } = await mk(fis)); await page.goto(`${base}/admin/meu-resumo?periodo=7dias`, { waitUntil: "networkidle" }); await page.getByRole("heading", { name: "Meu resumo" }).first().waitFor(); await shot(page, "meu-resumo"); await ctx.close();
    // paciente: portal
    ({ ctx, page } = await mk(pSess)); await page.goto(`${base}/paciente`, { waitUntil: "networkidle" }); await page.getByRole("heading", { name: "Meus atendimentos" }).waitFor(); await shot(page, "portal-paciente"); await ctx.close();
    if (errors.length) { console.log(`ERROS DE CONSOLE @${sn}:`, [...new Set(errors)].slice(0, 5)); bad++; }
    // a importação é repetida em cada tamanho: limpa o que ela criou para a próxima rodada
    await sql(`delete from public.opportunities where person_id in (select id from public.people where full_name like 'Joana Silva — ${TAG}' or full_name like 'Marcos Lima — ${TAG}')`);
    await sql(`delete from public.crm_lead_list_members where list_id = '${lst.id}'`); await sql(`delete from public.crm_imports where filename = 'leads-evento.csv'`);
    await sql(`delete from public.person_contacts where person_id in (select id from public.people where full_name like 'Joana Silva — ${TAG}' or full_name like 'Marcos Lima — ${TAG}')`); await sql(`delete from public.person_kinds where person_id in (select id from public.people where full_name like 'Joana Silva — ${TAG}' or full_name like 'Marcos Lima — ${TAG}')`);
    await sql(`delete from public.people where full_name like 'Joana Silva — ${TAG}' or full_name like 'Marcos Lima — ${TAG}'`).catch(() => null);
  }
  await browser.close();
} finally { await cleanup(); console.log("dados de demonstração removidos"); }
if (bad) { console.log(`PROBLEMAS: ${bad}`); process.exit(1); }
console.log("sem rolagem horizontal da página e sem erros de console nas telas capturadas");
