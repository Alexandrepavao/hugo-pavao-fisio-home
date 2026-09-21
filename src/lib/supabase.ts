import { createClient } from "@supabase/supabase-js";

const url = import.meta.env.VITE_SUPABASE_URL as string | undefined;
const key = import.meta.env.VITE_SUPABASE_PUBLISHABLE_KEY as string | undefined;

export const backendConfigured = Boolean(url && key);

// Somente chave pública (publishable). Chaves privilegiadas nunca entram no front-end.
export const supabase = createClient(url ?? "http://localhost", key ?? "missing", {
  auth: { persistSession: true, autoRefreshToken: true, detectSessionInUrl: true },
});
