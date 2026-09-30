// Helpers das specs NOVAS (etapa ADM+Contábil). Reaproveitam os helpers da regressão sem alterá-los.
import type { Page } from "@playwright/test";
import { api, signIn, useSession as injectSession, type Session } from "../helpers";

export { api, signIn };
export const QA = {
  manager: "qa.manager@hp-test.dev", contador: "qa.contador@hp-test.dev", financeiro: "qa.financeiro@hp-test.dev", comercial: "qa.comercial@hp-test.dev", aluno: "qa.aluno@hp-test.dev",
};

/** CNPJ válido aleatório (dígitos verificadores corretos) — cada execução usa CNPJs novos para nunca colidir com dados anteriores. */
export function randomCnpj(): string {
  const d = Array.from({ length: 12 }, () => Math.floor(Math.random() * 10)); if (d.every((x) => x === d[0])) d[11] = (d[11] + 1) % 10;
  const dv = (base: number[], w: number[]) => { const s = base.reduce((a, x, i) => a + x * w[i], 0) % 11; return s < 2 ? 0 : 11 - s; };
  const d1 = dv(d, [5, 4, 3, 2, 9, 8, 7, 6, 5, 4, 3, 2]); const d2 = dv([...d, d1], [6, 5, 4, 3, 2, 9, 8, 7, 6, 5, 4, 3, 2]);
  return [...d, d1, d2].join("");
}
export const maskCnpj = (c: string) => c.replace(/^(\d{2})(\d{3})(\d{3})(\d{4})(\d{2})$/, "$1.$2.$3/$4-$5");

export const shiftMonth = (m: string, delta: number) => new Date(Date.UTC(Number(m.slice(0, 4)), Number(m.slice(5, 7)) - 1 + delta, 1)).toISOString().slice(0, 10);
export const currentMonth = () => { const d = new Date(); return new Date(Date.UTC(d.getFullYear(), d.getMonth(), 1)).toISOString().slice(0, 10); };

export async function loginAs(context: import("@playwright/test").BrowserContext, email: string): Promise<Session> {
  const s = await signIn(email); await injectSession(context, s); return s;
}
export async function unitId(s: Session): Promise<string> {
  const r = await api(s).get("units?select=id,slug&slug=eq.sao-paulo"); return r.body[0].id as string;
}
/** Nenhum erro de console/página (exceto ruído conhecido). */
export function collectErrors(page: Page): string[] {
  const errors: string[] = [];
  page.on("pageerror", (e) => errors.push(e.message));
  page.on("console", (m) => { if (m.type() === "error" && !/favicon|ERR_BLOCKED|Failed to load resource/.test(m.text())) errors.push(m.text()); });
  return errors;
}
export const TINY_PDF = Buffer.from("%PDF-1.1\n1 0 obj<</Type/Catalog/Pages 2 0 R>>endobj\n2 0 obj<</Type/Pages/Kids[3 0 R]/Count 1>>endobj\n3 0 obj<</Type/Page/Parent 2 0 R/MediaBox[0 0 200 200]>>endobj\ntrailer<</Root 1 0 R>>\n%%EOF");

import { ANON, SUPABASE_URL } from "../helpers";
/** PATCH direto na API REST com o token do usuário (usado só em limpeza de dados de teste). */
export async function patch(s: Session, path: string, body: unknown) {
  const r = await fetch(`${SUPABASE_URL}/rest/v1/${path}`, { method: "PATCH", headers: { apikey: ANON, authorization: `Bearer ${s.access_token}`, "content-type": "application/json", prefer: "return=representation" }, body: JSON.stringify(body) });
  return { status: r.status, body: await r.json().catch(() => null) };
}

import { mkdirSync } from "node:fs";
/** Evidência visual: só grava quando EVIDENCE_DIR está definido (não interfere nas execuções normais). */
export async function shot(page: Page, name: string) {
  const dir = process.env.EVIDENCE_DIR; if (!dir) return;
  mkdirSync(dir, { recursive: true }); await page.waitForTimeout(250); await page.screenshot({ path: `${dir}/${name}.png`, fullPage: true });
}
