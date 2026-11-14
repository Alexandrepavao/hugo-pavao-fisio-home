import { createClient } from "@supabase/supabase-js";

const url = import.meta.env.VITE_SUPABASE_URL as string | undefined;
const key = import.meta.env.VITE_SUPABASE_PUBLISHABLE_KEY as string | undefined;

import { getViewAsSession, setViewAsSession } from "@/lib/viewAs";

export const backendConfigured = Boolean(url && key);

/** “Agir em nome de” (responsável legal, cuidador, delegado): a pessoa escolhida vai no cabeçalho x-acting-as das chamadas ao banco.
 *  O BANCO é quem valida: sem vínculo verificado e ativo a chamada falha com 42501 — o cabeçalho sozinho não dá acesso a nada. */
let actingAs: string | null = null;
export const setActingAs = (personId: string | null) => { actingAs = personId; };
export const getActingAs = () => actingAs;
const fetchWithActing: typeof fetch = async (input, init) => {
  const target = typeof input === "string" ? input : input instanceof URL ? input.href : input.url;
  const viewing = getViewAsSession();
  if ((!actingAs && !viewing) || !target.includes("/rest/v1/")) return fetch(input, init);
  const headers = new Headers(init?.headers);
  // “Ver como” (gestor, somente leitura) tem prioridade e nunca se mistura com “agir em nome de”
  if (viewing) headers.set("x-view-as", viewing); else if (actingAs) headers.set("x-acting-as", actingAs);
  const res = await fetch(input, { ...init, headers });
  if (viewing && res.status === 403) {   // sessão de “ver como” vencida ou encerrada em outro lugar: volta ao painel do gestor
    try { const txt = await res.clone().text(); if (/ver como inv/i.test(txt)) { setViewAsSession(null); window.location.assign("/admin/ver-como?sessao=expirada"); } } catch { /* segue o erro normal */ }
  }
  return res;
};

// Somente chave pública (publishable). Chaves privilegiadas nunca entram no front-end.
export const supabase = createClient(url ?? "http://localhost", key ?? "missing", {
  auth: { persistSession: true, autoRefreshToken: true, detectSessionInUrl: true },
  global: { fetch: fetchWithActing },
});
