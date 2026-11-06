import { createClient } from "@supabase/supabase-js";

const url = import.meta.env.VITE_SUPABASE_URL as string | undefined;
const key = import.meta.env.VITE_SUPABASE_PUBLISHABLE_KEY as string | undefined;

export const backendConfigured = Boolean(url && key);

/** “Agir em nome de” (responsável legal, cuidador, delegado): a pessoa escolhida vai no cabeçalho x-acting-as das chamadas ao banco.
 *  O BANCO é quem valida: sem vínculo verificado e ativo a chamada falha com 42501 — o cabeçalho sozinho não dá acesso a nada. */
let actingAs: string | null = null;
export const setActingAs = (personId: string | null) => { actingAs = personId; };
export const getActingAs = () => actingAs;
const fetchWithActing: typeof fetch = (input, init) => {
  const target = typeof input === "string" ? input : input instanceof URL ? input.href : input.url;
  if (!actingAs || !target.includes("/rest/v1/")) return fetch(input, init);
  const headers = new Headers(init?.headers); headers.set("x-acting-as", actingAs);
  return fetch(input, { ...init, headers });
};

// Somente chave pública (publishable). Chaves privilegiadas nunca entram no front-end.
export const supabase = createClient(url ?? "http://localhost", key ?? "missing", {
  auth: { persistSession: true, autoRefreshToken: true, detectSessionInUrl: true },
  global: { fetch: fetchWithActing },
});
