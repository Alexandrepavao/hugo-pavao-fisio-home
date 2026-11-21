// Helpers das specs do WHITE LABEL (Dev). Criam organizações pelo MOTOR de provisionamento (as mesmas funções que o questionário usa) e contas de teste @example.test.
// Usuários de teste são criados por SQL no Dev (equivale à confirmação do e-mail do administrador); exigem SUPABASE_ACCESS_TOKEN no ambiente (nunca é impresso). Senha = HP_QA_PASSWORD.
import { inflateRawSync } from "node:zlib";
import { createHash } from "node:crypto";
import { ANON, PASSWORD, SUPABASE_URL, signIn, type Session } from "../helpers";

export const PLATFORM = "qa.plataforma@hp-test.dev";
const TOKEN = process.env.SUPABASE_ACCESS_TOKEN;
export const haveHarness = Boolean(TOKEN && PASSWORD);

export async function sqlDev<T = unknown>(query: string): Promise<T> {
  if (!TOKEN) throw new Error("Defina SUPABASE_ACCESS_TOKEN para criar contas de teste no Dev.");
  const r = await fetch("https://api.supabase.com/v1/projects/fsvtzowcwhvwtluwrhnb/database/query", { method: "POST", headers: { authorization: `Bearer ${TOKEN}`, "content-type": "application/json" }, body: JSON.stringify({ query }) });
  const t = await r.text(); if (!r.ok) throw new Error(`sql ${r.status}: ${t.slice(0, 300)}`); return JSON.parse(t) as T;
}
/** Conta confirmada (como se o administrador já tivesse confirmado o e-mail do convite). Se já existir, não faz nada. */
export async function mkUser(email: string) {
  await sqlDev(`do $$ declare v uuid; begin select id into v from auth.users where email = '${email}'; if v is null then v := gen_random_uuid();
    insert into auth.users (instance_id, id, aud, role, email, encrypted_password, email_confirmed_at, raw_app_meta_data, raw_user_meta_data, created_at, updated_at, confirmation_token, recovery_token, email_change, email_change_token_new)
    values ('00000000-0000-0000-0000-000000000000', v, 'authenticated', 'authenticated', '${email}', crypt('${PASSWORD.replace(/'/g, "''")}', gen_salt('bf')), now(), '{"provider":"email","providers":["email"]}', '{}', now(), now(), '', '', '', '');
    insert into auth.identities (id, user_id, provider_id, identity_data, provider, last_sign_in_at, created_at, updated_at) values (gen_random_uuid(), v, v::text, jsonb_build_object('sub', v::text, 'email', '${email}', 'email_verified', true), 'email', now(), now(), now()); end if; end $$;`);
}

export const call = async (s: Session | null, fn: string, body: unknown = {}, org?: string) => {
  const r = await fetch(`${SUPABASE_URL}/rest/v1/rpc/${fn}`, { method: "POST", headers: { apikey: ANON, authorization: `Bearer ${s?.access_token ?? ANON}`, "content-type": "application/json", ...(org ? { "x-org": org } : {}) }, body: JSON.stringify(body) });
  return { status: r.status, body: (await r.json().catch(() => null)) as any }; // eslint-disable-line @typescript-eslint/no-explicit-any
};
export const get = async (s: Session | null, path: string, org?: string) => {
  const r = await fetch(`${SUPABASE_URL}/rest/v1/${path}`, { headers: { apikey: ANON, authorization: `Bearer ${s?.access_token ?? ANON}`, ...(org ? { "x-org": org } : {}) } });
  return { status: r.status, body: (await r.json().catch(() => null)) as any }; // eslint-disable-line @typescript-eslint/no-explicit-any
};

export interface Seed { name: string; sub: string; email: string; primary?: string; accent?: string; modules?: string[]; integrations?: string[]; units?: string[]; training?: boolean }
export const answersOf = (x: Seed) => ({
  company: { name: x.name, segment: "fisioterapia", responsible: { name: `Admin ${x.name}`, email: x.email }, city: "São Paulo", state: "SP", units: (x.units ?? ["Sede"]).map((n) => ({ name: n })) },
  operation: { services: ["Fisioterapia ortopédica", "Pilates clínico"], modes: ["in_clinic"], sales_models: ["single", "package"] }, team: { users_count: 4, roles: [{ role: "physio", count: 2 }, { role: "ops_admin", count: 1 }] },
  customers: { crm: true, capture: false, forms: true, proposals: false, portal: true, import: { needed: false } }, modules: x.modules ?? [],
  brand: { app_name: x.name, color_primary: x.primary ?? "#0f766e", color_accent: x.accent ?? "#f59e0b", subdomain: x.sub }, integrations: x.integrations ?? [], plan: { plan_key: "essencial", implementation: "standard", ...(x.training ? { training: true } : {}) },
});
export interface Prov { id: string; org_id: string; status: string; ms: number; reused: boolean }
export async function provision(plat: Session, x: Seed, key = `q-e2e-${x.sub}`): Promise<Prov> {
  const d = await call(plat, "provisioning_draft_save", { p_key: key, p_answers: answersOf(x) }); if (d.status >= 300) throw new Error(`rascunho: ${JSON.stringify(d.body)}`);
  const t0 = Date.now(); const s = await call(plat, "provisioning_submit", { p_key: key }); const ms = Date.now() - t0; if (s.status >= 300) throw new Error(`submit: ${JSON.stringify(s.body)}`);
  return { id: s.body.id, org_id: s.body.org_id, status: s.body.status, ms, reused: s.body.reused };
}
export const adminSession = async (email: string) => signIn(email);
/** Mesma regra do servidor: um e-mail de teste por organização. */
export const emailFor = (tag: string, run: string) => `${tag}.${run}@example.test`;

/** Leitor mínimo de .zip (método deflate/stored) — o pacote de exportação é verificado sem dependências externas. */
export function readZip(buf: Buffer): Record<string, Buffer> {
  let eocd = buf.length - 22; while (eocd >= 0 && buf.readUInt32LE(eocd) !== 0x06054b50) eocd--; if (eocd < 0) throw new Error("zip inválido");
  const n = buf.readUInt16LE(eocd + 10); let p = buf.readUInt32LE(eocd + 16); const out: Record<string, Buffer> = {};
  for (let i = 0; i < n; i++) {
    const method = buf.readUInt16LE(p + 10), csize = buf.readUInt32LE(p + 20), nlen = buf.readUInt16LE(p + 28), xlen = buf.readUInt16LE(p + 30), clen = buf.readUInt16LE(p + 32), off = buf.readUInt32LE(p + 42);
    const name = buf.subarray(p + 46, p + 46 + nlen).toString("utf8"); const lnlen = buf.readUInt16LE(off + 26), lxlen = buf.readUInt16LE(off + 28); const start = off + 30 + lnlen + lxlen; const raw = buf.subarray(start, start + csize);
    out[name] = method === 8 ? inflateRawSync(raw) : Buffer.from(raw); p += 46 + nlen + xlen + clen;
  }
  return out;
}
export const sha256 = (b: Buffer) => createHash("sha256").update(b).digest("hex");
export const pool = async <T,>(items: T[], size: number, fn: (x: T, i: number) => Promise<void>) => { let i = 0; await Promise.all(Array.from({ length: size }, async () => { while (i < items.length) { const k = i++; await fn(items[k], k); } })); };
