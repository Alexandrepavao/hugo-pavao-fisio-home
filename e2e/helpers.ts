import { readFileSync } from "node:fs";
import type { Page, BrowserContext } from "@playwright/test";

const env = Object.fromEntries(readFileSync(new URL("../.env.local", import.meta.url), "utf8").split(/\r?\n/).filter((l) => l && !l.startsWith("#")).map((l) => l.split("=")));
export const SUPABASE_URL = env.VITE_SUPABASE_URL as string;
export const ANON = env.VITE_SUPABASE_PUBLISHABLE_KEY as string;
export const PASSWORD = process.env.HP_QA_PASSWORD ?? "";
export const MANAGER = "qa.manager@hp-test.dev";
export const STUDENT = "qa.aluno@hp-test.dev";
export const runId = Date.now().toString(36);

export interface Session { access_token: string; user: { id: string } }
export async function signIn(email: string): Promise<Session> {
  if (!PASSWORD) throw new Error("Defina HP_QA_PASSWORD (senha das contas de QA do Dev).");
  const r = await fetch(`${SUPABASE_URL}/auth/v1/token?grant_type=password`, { method: "POST", headers: { apikey: ANON, "content-type": "application/json" }, body: JSON.stringify({ email, password: PASSWORD }) });
  const s = await r.json();
  if (!s.access_token) throw new Error(`login de QA falhou (${r.status})`);
  return s;
}
/** Cliente REST autenticado (acesso direto pela API, como um atacante ou integração faria). */
export function api(session: Session | null) {
  const headers = { apikey: ANON, authorization: `Bearer ${session?.access_token ?? ANON}`, "content-type": "application/json", prefer: "return=representation" };
  return {
    get: async (path: string) => { const r = await fetch(`${SUPABASE_URL}/rest/v1/${path}`, { headers }); return { status: r.status, body: await r.json().catch(() => null) }; },
    post: async (path: string, body: unknown) => { const r = await fetch(`${SUPABASE_URL}/rest/v1/${path}`, { method: "POST", headers, body: JSON.stringify(body) }); return { status: r.status, body: await r.json().catch(() => null) }; },
    rpc: async (fn: string, body: unknown = {}) => { const r = await fetch(`${SUPABASE_URL}/rest/v1/rpc/${fn}`, { method: "POST", headers, body: JSON.stringify(body) }); return { status: r.status, body: await r.json().catch(() => null) }; },
  };
}
/** Injeta a sessão no localStorage (mesmo formato do supabase-js) antes de qualquer script da página. */
export async function useSession(context: BrowserContext, s: Session) {
  const key = `sb-${new URL(SUPABASE_URL).hostname.split(".")[0]}-auth-token`;
  await context.addInitScript(([k, v]) => localStorage.setItem(k, v), [key, JSON.stringify(s)] as [string, string]);
}
export async function noConsoleErrors(page: Page, fn: () => Promise<void>) {
  const errors: string[] = []; page.on("pageerror", (e) => errors.push(e.message));
  page.on("console", (m) => { if (m.type() === "error" && !/favicon|ERR_BLOCKED|Failed to load resource/.test(m.text())) errors.push(m.text()); });
  await fn(); return errors;
}
