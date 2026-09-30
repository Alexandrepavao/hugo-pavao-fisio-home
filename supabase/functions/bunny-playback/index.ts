// @ts-ignore - resolvido pelo Supabase Edge Runtime no deploy
import "jsr:@supabase/functions-js/edge-runtime.d.ts";
// @ts-ignore - resolvido pelo Supabase Edge Runtime no deploy
import { createClient } from "jsr:@supabase/supabase-js@2";

/**
 * Reprodução PRIVADA de vídeos do paciente (Bunny Stream).
 *
 * Fluxo: o navegador envia o JWT do usuário logado e o id do vídeo atribuído (patient_videos.id). Esta função NÃO confia no navegador:
 *   1. o gateway do Supabase valida o JWT (verify_jwt ligado — é o padrão; NÃO desligar esta função);
 *   2. a função chama public.video_playback_authorize com o JWT do próprio usuário — o banco só responde se o usuário é o paciente dono do vídeo ou o
 *      profissional com vínculo assistencial ativo, e se o vídeo não foi revogado nem venceu (e registra o acesso em video_access_log);
 *   3. só então a função assina um link de embed de curta duração com a chave de token do Bunny, que existe APENAS aqui (secret), nunca no navegador.
 * Sem a chave configurada a função responde 503 "bunny_not_configured" e a tela mostra "reprodução indisponível por configuração" — nunca cai para vídeo público.
 *
 * Secrets (Supabase → Project Settings → Edge Functions → Secrets, ou `supabase secrets set`; nunca em VITE_* nem no repositório):
 *   BUNNY_EMBED_TOKEN_KEY  — "Embed View Token Authentication Key" da biblioteca (Bunny → Stream → biblioteca → Security).
 *   BUNNY_TOKEN_TTL_SECONDS (opcional) — validade do link em segundos (padrão 3600; máx. 21600).
 * SUPABASE_URL e SUPABASE_ANON_KEY são injetados pela plataforma.
 * Assinatura (documentação do Bunny Stream, "Embed token authentication"): token = SHA256_HEX(chave + video_id + expires), link:
 *   https://iframe.mediadelivery.net/embed/{library_id}/{video_id}?token={token}&expires={expires}
 */

const cors = {
  "Access-Control-Allow-Origin": "*",          // a autorização é por JWT no cabeçalho (não por cookie), então não depende de origem
  "Access-Control-Allow-Headers": "authorization, apikey, content-type, x-client-info",
  "Access-Control-Allow-Methods": "POST, OPTIONS",
};
const json = (status: number, body: unknown) => new Response(JSON.stringify(body), { status, headers: { ...cors, "Content-Type": "application/json", "Cache-Control": "no-store" } });
const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

async function sha256Hex(text: string): Promise<string> {
  const buf = await crypto.subtle.digest("SHA-256", new TextEncoder().encode(text));
  return Array.from(new Uint8Array(buf)).map((b) => b.toString(16).padStart(2, "0")).join("");
}

// @ts-ignore - Deno é global no Edge Runtime
Deno.serve(async (req: Request) => {
  if (req.method === "OPTIONS") return new Response(null, { status: 204, headers: cors });
  if (req.method !== "POST") return json(405, { error: "method_not_allowed" });

  // @ts-ignore
  const key = Deno.env.get("BUNNY_EMBED_TOKEN_KEY");
  // @ts-ignore
  const ttl = Math.min(Math.max(Number(Deno.env.get("BUNNY_TOKEN_TTL_SECONDS") ?? "3600") || 3600, 60), 21600);
  if (!key) return json(503, { error: "bunny_not_configured", message: "Reprodução indisponível: a chave de token do Bunny ainda não foi cadastrada no servidor." });

  const auth = req.headers.get("Authorization");
  if (!auth) return json(401, { error: "unauthenticated" });
  let videoId = "";
  try { videoId = String((await req.json())?.video_id ?? ""); } catch { return json(400, { error: "invalid_body" }); }
  if (!UUID.test(videoId)) return json(400, { error: "invalid_video_id" });

  // @ts-ignore
  const supabase = createClient(Deno.env.get("SUPABASE_URL")!, Deno.env.get("SUPABASE_ANON_KEY")!, { global: { headers: { Authorization: auth } }, auth: { persistSession: false } });
  const { data, error } = await supabase.rpc("video_playback_authorize", { p_video: videoId });
  if (error || !Array.isArray(data) || data.length !== 1) return json(403, { error: "forbidden", message: "Você não tem acesso a este vídeo (ou ele foi revogado/venceu)." });
  const { library_id, bunny_video_id } = data[0] as { library_id: string; bunny_video_id: string };

  const expires = Math.floor(Date.now() / 1000) + ttl;
  const token = await sha256Hex(key + bunny_video_id + String(expires));
  const url = `https://iframe.mediadelivery.net/embed/${encodeURIComponent(library_id)}/${encodeURIComponent(bunny_video_id)}?token=${token}&expires=${expires}&autoplay=false&preload=false`;
  return json(200, { url, expires_at: new Date(expires * 1000).toISOString() });
});
