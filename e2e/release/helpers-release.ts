// Helpers das specs de ACEITE da release v1 (jornada operacional e permissões). Não alteram os helpers da regressão.
import { expect, type BrowserContext, type Page } from "@playwright/test";
import { ANON, SUPABASE_URL, api, runId, signIn, useSession as injectSession, type Session } from "../helpers";

export { api, runId, signIn };
export const QA = {
  manager: "qa.manager@hp-test.dev", gestorUnidade: "qa.gestorunidade@hp-test.dev", comercial: "qa.comercial@hp-test.dev", financeiro: "qa.financeiro@hp-test.dev",
  fisio: "qa.fisio@hp-test.dev", paciente: "qa.paciente@hp-test.dev", parceiro: "qa.parceiro@hp-test.dev", aluno: "qa.aluno@hp-test.dev",
};
export async function loginAs(context: BrowserContext, email: string): Promise<Session> { const s = await signIn(email); await injectSession(context, s); return s; }
export const brlFmt = (cents: number) => new Intl.NumberFormat("pt-BR", { style: "currency", currency: "BRL" }).format(cents / 100).replace(/\s/g, " ");

export async function rest(s: Session | null, method: "POST" | "PATCH" | "DELETE", path: string, body?: unknown) {
  const r = await fetch(`${SUPABASE_URL}/rest/v1/${path}`, { method, headers: { apikey: ANON, authorization: `Bearer ${s?.access_token ?? ANON}`, "content-type": "application/json", prefer: "return=representation" }, body: body === undefined ? undefined : JSON.stringify(body) });
  return { status: r.status, body: await r.json().catch(() => null) };
}

export function collectErrors(page: Page): string[] {
  const errors: string[] = [];
  page.on("pageerror", (e) => errors.push(e.message));
  page.on("console", (m) => { if (m.type() === "error" && !/favicon|ERR_BLOCKED|Failed to load resource/.test(m.text())) errors.push(m.text()); });
  return errors;
}

/** Data (AAAA-MM-DD) daqui a `days` dias no fuso de São Paulo. */
export const spDate = (days: number) => new Date(Date.now() + days * 864e5).toLocaleDateString("sv-SE", { timeZone: "America/Sao_Paulo" });
export const spTime = (iso: string) => new Date(iso).toLocaleTimeString("pt-BR", { timeZone: "America/Sao_Paulo", hour: "2-digit", minute: "2-digit" });

/** "Viagem no tempo" de teste: executa SQL no projeto DEV (nunca produção) para deslocar um atendimento agendado ao passado,
 *  já que o sistema (corretamente) não deixa marcar comparecimento/falta antes do horário. Exige SUPABASE_ACCESS_TOKEN. */
const DEV_REF = "fsvtzowcwhvwtluwrhnb";
export const canTimeTravel = () => !!process.env.SUPABASE_ACCESS_TOKEN;
export async function devSql(query: string): Promise<unknown> {
  const token = process.env.SUPABASE_ACCESS_TOKEN; if (!token) throw new Error("Defina SUPABASE_ACCESS_TOKEN (conta dona do projeto Dev) para os passos que deslocam horários.");
  if (!SUPABASE_URL.includes(DEV_REF)) throw new Error("Recusado: devSql só roda contra o projeto Dev.");
  const r = await fetch(`https://api.supabase.com/v1/projects/${DEV_REF}/database/query`, { method: "POST", headers: { authorization: `Bearer ${token}`, "content-type": "application/json" }, body: JSON.stringify({ query }) });
  const body = await r.json().catch(() => null); if (!r.ok) throw new Error(`devSql falhou: ${JSON.stringify(body)}`); return body;
}
/** Desloca o período de um atendimento (mesma duração) para começar `iso`. */
export const moveAppointment = (id: string, startIso: string) =>
  devSql(`update public.appointments set period = tstzrange('${startIso}'::timestamptz, '${startIso}'::timestamptz + (upper(period) - lower(period))) where id = '${id.replace(/[^0-9a-f-]/gi, "")}'`);

export async function expectNoFatal(page: Page) { await expect(page.getByText(/Sem permissão ou falha/)).toHaveCount(0); }

/** Cria no Dev (só Dev, via devSql) uma conta de teste JÁ com e-mail confirmado e senha, como ela ficaria depois de “Primeiro acesso” + clique no link do e-mail.
 *  Dispara o mesmo gatilho do Supabase Auth (convites → conta, papéis e vínculos). NÃO envia e-mail (a entrega do e-mail é dependência externa e não é exercitada aqui). */
export async function createConfirmedUser(email: string, password: string): Promise<string> {
  const e = email.replace(/'/g, ""); const p = password.replace(/'/g, "");
  const r = (await devSql(`with u as (
      insert into auth.users (instance_id, id, aud, role, email, encrypted_password, email_confirmed_at, raw_app_meta_data, raw_user_meta_data, created_at, updated_at, confirmation_token, recovery_token, email_change_token_new, email_change)
      values ('00000000-0000-0000-0000-000000000000', gen_random_uuid(), 'authenticated', 'authenticated', '${e}', extensions.crypt('${p}', extensions.gen_salt('bf')), now(), '{"provider":"email","providers":["email"]}', '{}', now(), now(), '', '', '', '')
      returning id, email)
    insert into auth.identities (id, user_id, identity_data, provider, provider_id, last_sign_in_at, created_at, updated_at)
      select gen_random_uuid(), u.id, jsonb_build_object('sub', u.id::text, 'email', u.email, 'email_verified', true), 'email', u.id::text, now(), now(), now() from u returning user_id`)) as { user_id: string }[];
  return r[0].user_id;
}
export const deleteAuthUser = (id: string) => devSql(`delete from auth.users where id = '${id.replace(/[^0-9a-f-]/gi, "")}'`);

/** Login pela TELA (como o usuário faz): e-mail + senha → “Entrar”. */
export async function uiLogin(page: Page, email: string, password: string) {
  await page.goto("/login");
  await page.getByLabel("E-mail").fill(email); await page.getByLabel("Senha").fill(password);
  await page.getByRole("button", { name: "Entrar" }).click();
}

/** Token de uma conta criada pelo teste (senha própria, diferente da das contas de QA). */
export async function signInWith(email: string, password: string): Promise<Session> {
  const r = await fetch(`${SUPABASE_URL}/auth/v1/token?grant_type=password`, { method: "POST", headers: { apikey: ANON, "content-type": "application/json" }, body: JSON.stringify({ email, password }) });
  const s = await r.json(); if (!s.access_token) throw new Error(`login falhou (${r.status})`); return s;
}
