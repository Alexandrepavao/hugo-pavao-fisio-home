import type { Config, Context } from "@netlify/functions";
import { Webhook, WebhookVerificationError } from "standardwebhooks";
import { renderAuthEmail, type AuthEmailType } from "./lib/email-templates.mts";

/**
 * Supabase Auth "Send Email" Hook (tipo HTTPS). Substitui o remetente padrão do Supabase para TODOS os
 * e-mails de autenticação (signup, convite, recuperação, troca de e-mail) — enviados pela API do Resend
 * com a identidade HP. O Supabase continua sendo dono de usuários/senhas/sessões/tokens; este hook só
 * entrega o e-mail. A validade/expiração/uso único do token são do próprio Supabase (link aponta para o
 * endpoint /auth/v1/verify dele, nunca um mecanismo paralelo).
 *
 * Configuração (painel do Supabase, Authentication → Hooks → Send Email hook, tipo HTTPS):
 *   URL: https://hp-group-hub.netlify.app/api/auth-email-hook
 *   O Supabase gera um segredo (formato "v1,whsec_...") — copiar para a env var SEND_EMAIL_HOOK_SECRET.
 */

const json = (status: number, body: unknown) => new Response(JSON.stringify(body), { status, headers: { "content-type": "application/json" } });

// Formato de erro que o Supabase Auth reconhece e propaga como falha real ao cliente (sem falso sucesso).
const hookError = (httpCode: number, message: string) => json(httpCode, { error: { http_code: httpCode, message } });

interface HookPayload {
  user: { email: string };
  email_data: {
    token_hash: string;
    redirect_to: string;
    email_action_type: AuthEmailType;
  };
}

export default async (req: Request, _context: Context) => {
  if (req.method !== "POST") return hookError(405, "method_not_allowed");

  const hookSecret = Netlify.env.get("SEND_EMAIL_HOOK_SECRET");
  const resendKey = Netlify.env.get("RESEND_API_KEY");
  const from = Netlify.env.get("EMAIL_FROM");
  const supabaseUrl = Netlify.env.get("SUPABASE_URL") ?? Netlify.env.get("VITE_SUPABASE_URL");

  if (!hookSecret) return hookError(500, "hook_not_configured: SEND_EMAIL_HOOK_SECRET ausente");
  if (!resendKey || !from) return hookError(500, "email_not_configured: RESEND_API_KEY/EMAIL_FROM ausentes");
  if (!supabaseUrl) return hookError(500, "supabase_url_not_configured");

  const rawBody = await req.text();
  const headers: Record<string, string> = {
    "webhook-id": req.headers.get("webhook-id") ?? "",
    "webhook-timestamp": req.headers.get("webhook-timestamp") ?? "",
    "webhook-signature": req.headers.get("webhook-signature") ?? "",
  };

  let payload: HookPayload;
  try {
    const normalizedSecret = hookSecret.startsWith("v1,") ? hookSecret.slice(3) : hookSecret;
    payload = new Webhook(normalizedSecret).verify(rawBody, headers) as HookPayload;
  } catch (e) {
    if (e instanceof WebhookVerificationError) return hookError(401, "invalid_signature");
    return hookError(400, "invalid_payload");
  }

  const { user, email_data } = payload;
  if (!user?.email || !email_data?.token_hash || !email_data?.email_action_type) return hookError(400, "invalid_payload");

  const confirmUrl = `${supabaseUrl}/auth/v1/verify?token=${encodeURIComponent(email_data.token_hash)}&type=${encodeURIComponent(email_data.email_action_type)}&redirect_to=${encodeURIComponent(email_data.redirect_to ?? "")}`;
  const { subject, html, text } = renderAuthEmail(email_data.email_action_type, confirmUrl);

  const res = await fetch("https://api.resend.com/emails", {
    method: "POST",
    headers: { authorization: `Bearer ${resendKey}`, "content-type": "application/json" },
    body: JSON.stringify({ from, to: [user.email], subject, html, text }),
  });

  if (!res.ok) {
    const detail = await res.text().catch(() => "");
    return hookError(502, `resend_error: ${res.status} ${detail}`.slice(0, 300));
  }

  return json(200, {});
};

export const config: Config = { path: "/api/auth-email-hook" };
