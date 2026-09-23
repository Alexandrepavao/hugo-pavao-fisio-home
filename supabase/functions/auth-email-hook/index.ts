// @ts-ignore - resolvido pelo Supabase Edge Runtime no deploy
import "jsr:@supabase/functions-js/edge-runtime.d.ts";
import { renderAuthEmail, type AuthEmailType } from "./email-templates.ts";

/**
 * Supabase Auth "Send Email" Hook, hospedado como Edge Function (não Netlify) — decisão de 2026-09-23:
 * a proteção de login de equipe da Netlify bloqueia TODAS as rotas do site `hp-group-hub`, inclusive
 * Functions, para chamadas sem sessão de navegador (confirmado com curl: qualquer POST a
 * hp-group-hub.netlify.app/api/* devolve a página de login da Netlify, nunca chega ao código). Como o
 * Supabase chama este hook servidor-a-servidor (sem navegador, sem cookie de equipe), ele nunca passaria
 * por essa proteção. Hospedar no Supabase remove esse obstáculo sem tocar na proteção da Netlify.
 *
 * O Supabase continua dono de usuários/senhas/sessões/tokens — este hook só entrega o e-mail. O link de
 * confirmação aponta para o /auth/v1/verify do próprio Supabase (token_hash, tipo e redirect_to que o
 * Supabase gerou); validade, expiração e uso único do token continuam sendo do Supabase, sem mecanismo
 * paralelo. `verify_jwt` é desligado no deploy desta função de propósito: quem chama é o Supabase Auth
 * (não um usuário logado), autenticado pela assinatura do webhook abaixo, não por um JWT de sessão.
 *
 * Configuração (painel do projeto, Authentication → Hooks → Send Email hook):
 *   Tipo: Supabase Edge Functions → selecionar esta função (auth-email-hook).
 *   O Supabase gera um segredo (formato "v1,whsec_...") — copiar para o secret SEND_EMAIL_HOOK_SECRET
 *   deste projeto (Project Settings → Edge Functions → Secrets, ou `supabase secrets set`).
 * Secrets necessários neste projeto Supabase (nunca em VITE_*, nunca no front-end):
 *   RESEND_API_KEY, SEND_EMAIL_HOOK_SECRET, EMAIL_FROM ("HP Group <contato@hpfisioterapia.com.br>").
 *   SUPABASE_URL já é injetado automaticamente pela plataforma.
 */

const WEBHOOK_TOLERANCE_SECONDS = 5 * 60;

function base64ToBytes(b64: string): Uint8Array {
  const bin = atob(b64);
  const bytes = new Uint8Array(bin.length);
  for (let i = 0; i < bin.length; i++) bytes[i] = bin.charCodeAt(i);
  return bytes;
}

function bytesToBase64(bytes: Uint8Array): string {
  let bin = "";
  for (const b of bytes) bin += String.fromCharCode(b);
  return btoa(bin);
}

function timingSafeEqual(a: string, b: string): boolean {
  if (a.length !== b.length) return false;
  let diff = 0;
  for (let i = 0; i < a.length; i++) diff |= a.charCodeAt(i) ^ b.charCodeAt(i);
  return diff === 0;
}

/** Verificação do Standard Webhooks (mesmo esquema usado pelo Supabase Auth para todos os hooks HTTPS/Edge Function). */
async function verifyWebhookSignature(secret: string, payload: string, id: string, timestamp: string, signatureHeader: string): Promise<boolean> {
  const now = Math.floor(Date.now() / 1000);
  const ts = Number.parseInt(timestamp, 10);
  if (!Number.isFinite(ts) || Math.abs(now - ts) > WEBHOOK_TOLERANCE_SECONDS) return false;

  let s = secret.trim();
  if (s.startsWith("v1,")) s = s.slice(3);
  if (s.startsWith("whsec_")) s = s.slice(6);
  const keyBytes = base64ToBytes(s);

  const key = await crypto.subtle.importKey("raw", keyBytes, { name: "HMAC", hash: "SHA-256" }, false, ["sign"]);
  const signedContent = `${id}.${timestamp}.${payload}`;
  const sigBuf = await crypto.subtle.sign("HMAC", key, new TextEncoder().encode(signedContent));
  const expected = bytesToBase64(new Uint8Array(sigBuf));

  for (const versioned of signatureHeader.split(" ")) {
    const [version, sig] = versioned.split(",");
    if (version === "v1" && sig && timingSafeEqual(sig, expected)) return true;
  }
  return false;
}

const json = (status: number, body: unknown) => new Response(JSON.stringify(body), { status, headers: { "content-type": "application/json" } });
// Formato de erro que o Supabase Auth reconhece e propaga como falha real ao cliente (sem falso sucesso).
const hookError = (httpCode: number, message: string) => json(httpCode, { error: { http_code: httpCode, message } });

interface HookPayload {
  user?: { email?: string };
  email_data?: { token_hash?: string; redirect_to?: string; email_action_type?: string };
}

Deno.serve(async (req: Request) => {
  if (req.method !== "POST") return hookError(405, "method_not_allowed");

  // A assinatura é verificada ANTES de revelar qualquer detalhe de configuração — um chamador sem
  // assinatura válida não deve aprender quais secrets estão ausentes só por bater neste endpoint.
  const hookSecret = Deno.env.get("SEND_EMAIL_HOOK_SECRET");
  if (!hookSecret) return hookError(401, "invalid_signature");

  const id = req.headers.get("webhook-id") ?? "";
  const timestamp = req.headers.get("webhook-timestamp") ?? "";
  const signature = req.headers.get("webhook-signature") ?? "";
  if (!id || !timestamp || !signature) return hookError(401, "missing_signature_headers");

  const rawBody = await req.text();
  const valid = await verifyWebhookSignature(hookSecret, rawBody, id, timestamp, signature);
  if (!valid) return hookError(401, "invalid_signature");

  // Só a partir daqui o chamador provou ser o Supabase Auth — agora sim checamos a config de envio.
  const resendKey = Deno.env.get("RESEND_API_KEY");
  const from = Deno.env.get("EMAIL_FROM");
  const supabaseUrl = Deno.env.get("SUPABASE_URL");
  if (!resendKey || !from) return hookError(500, "email_not_configured: RESEND_API_KEY/EMAIL_FROM ausentes");
  if (!supabaseUrl) return hookError(500, "supabase_url_not_configured");

  let payload: HookPayload;
  try {
    payload = JSON.parse(rawBody);
  } catch {
    return hookError(400, "invalid_payload");
  }

  const email = payload.user?.email;
  const tokenHash = payload.email_data?.token_hash;
  const actionType = payload.email_data?.email_action_type as AuthEmailType | undefined;
  const redirectTo = payload.email_data?.redirect_to ?? "";
  if (!email || !tokenHash || !actionType) return hookError(400, "invalid_payload");

  const confirmUrl = `${supabaseUrl}/auth/v1/verify?token=${encodeURIComponent(tokenHash)}&type=${encodeURIComponent(actionType)}&redirect_to=${encodeURIComponent(redirectTo)}`;
  const { subject, html, text } = renderAuthEmail(actionType, confirmUrl);

  const res = await fetch("https://api.resend.com/emails", {
    method: "POST",
    headers: { authorization: `Bearer ${resendKey}`, "content-type": "application/json" },
    body: JSON.stringify({ from, to: [email], subject, html, text }),
  });

  if (!res.ok) {
    const detail = await res.text().catch(() => "");
    return hookError(502, `resend_error: ${res.status} ${detail}`.slice(0, 300));
  }

  return json(200, {});
});
