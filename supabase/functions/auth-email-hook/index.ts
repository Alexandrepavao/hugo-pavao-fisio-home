// @ts-ignore - resolvido pelo Supabase Edge Runtime no deploy
import "jsr:@supabase/functions-js/edge-runtime.d.ts";
import { createClient } from "npm:@supabase/supabase-js@2";
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
 * confirmação aponta para {PUBLIC_SITE_URL}/confirmar?token_hash=...&type=... — uma página HP própria
 * (src/pages/auth/Confirmar.tsx) que valida o token com o `verifyOtp()` OFICIAL do Supabase Auth,
 * client-side. Nunca aponta para supabase.co nem para localhost em produção: validade, expiração e uso
 * único do token continuam sendo do Supabase, isto só troca QUEM mostra a página que recebe o link, não o
 * mecanismo de validação. `verify_jwt` é desligado no deploy desta função de propósito: quem chama é o
 * Supabase Auth (não um usuário logado), autenticado pela assinatura do webhook abaixo, não por um JWT de
 * sessão.
 *
 * Configuração (painel do projeto, Authentication → Hooks → Send Email hook):
 *   Tipo: Supabase Edge Functions → selecionar esta função (auth-email-hook).
 *   O Supabase gera um segredo (formato "v1,whsec_...") — copiar para o secret SEND_EMAIL_HOOK_SECRET
 *   deste projeto (Project Settings → Edge Functions → Secrets, ou `supabase secrets set`).
 * Secrets necessários neste projeto Supabase (nunca em VITE_*, nunca no front-end):
 *   RESEND_API_KEY, SEND_EMAIL_HOOK_SECRET, EMAIL_FROM ("HP Group <contato@hpfisioterapia.com.br>"),
 *   PUBLIC_SITE_URL (a origem pública do site — produção: "https://hpfisioterapia.com.br"; Dev: a URL do
 *   site Netlify de preview). SUPABASE_URL já é injetado automaticamente pela plataforma (só usado aqui
 *   indiretamente, via PUBLIC_SITE_URL para o link do e-mail).
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
  // URL pública da HP (não supabase.co, não localhost) — página /confirmar valida o token pelo verifyOtp()
  // oficial do Supabase Auth client-side. Nunca cai no remetente/domínio padrão do Supabase.
  const siteUrl = Deno.env.get("PUBLIC_SITE_URL");
  if (!resendKey || !from) return hookError(500, "email_not_configured: RESEND_API_KEY/EMAIL_FROM ausentes");
  if (!siteUrl) return hookError(500, "site_url_not_configured: PUBLIC_SITE_URL ausente");

  let payload: HookPayload;
  try {
    payload = JSON.parse(rawBody);
  } catch {
    return hookError(400, "invalid_payload");
  }

  const email = payload.user?.email;
  const tokenHash = payload.email_data?.token_hash;
  const actionType = payload.email_data?.email_action_type as AuthEmailType | undefined;
  if (!email || !tokenHash || !actionType) return hookError(400, "invalid_payload");

  // Organização pedida pela interface (login/primeiro acesso de /empresa/<slug>): vem em redirect_to, mas SÓ vale se a ORIGEM for a do site configurado (nunca URL arbitrária)
  // e o caminho tiver o formato /empresa/<slug>. Mesmo assim o banco só aceita o slug se este e-mail tiver ligação real com a organização (email_brand_for_address).
  let requestedSlug: string | null = null;
  try {
    const rt = payload.email_data?.redirect_to;
    if (rt) {
      const u = new URL(rt);
      if (u.origin === new URL(siteUrl).origin) requestedSlug = /^\/empresa\/([a-z0-9-]{1,60})(?:\/|$)/.exec(u.pathname)?.[1] ?? null;
    }
  } catch { /* redirect_to ausente/inválido: ignora */ }

  const sb = createClient(Deno.env.get("SUPABASE_URL") ?? "", Deno.env.get("SUPABASE_SERVICE_ROLE_KEY") ?? "", { auth: { persistSession: false } });
  // marca da organização do destinatário (só identifica o e-mail: nome/cor/logo públicos). HP ou nada encontrado → e-mail HP como antes.
  let brand: { name: string; logoUrl: string | null; color: string | null } | null = null;
  let orgSlug: string | null = null; let orgId: string | null = null;
  try {
    const { data: b } = await sb.rpc("email_brand_for_address", { p_email: email, p_org_slug: requestedSlug }) as { data: { found?: boolean; org_id?: string; slug?: string; name?: string; logo_path?: string | null; color_primary?: string | null; is_default_brand?: boolean } | null };
    if (b?.found) { orgId = b.org_id ?? null; }
    if (b?.found && !b.is_default_brand && b.name) { orgSlug = b.slug ?? null; brand = { name: b.name, logoUrl: b.logo_path ? `${Deno.env.get("SUPABASE_URL")}/storage/v1/object/public/org-brand/${b.logo_path}` : null, color: b.color_primary ?? null }; }
  } catch { /* sem marca: segue com o e-mail HP */ }
  const log = async (state: "accepted" | "failed" | "suppressed", providerId: string | null, err: string | null) => {
    try { await sb.rpc("email_event_log", { p_org: orgId, p_request: null, p_purpose: `auth:${actionType}`, p_email: email, p_state: state, p_provider_id: providerId, p_error: err }); } catch { /* o log nunca derruba o envio */ }
  };

  // Política de destinatários (Dev): se EMAIL_ALLOWED_RECIPIENTS existir, só estes endereços (ou *@dominio) recebem e-mail real; os demais ficam REGISTRADOS como "suppressed", sem envio.
  // Produção não define este secret. Protege contra e-mail em massa/para pessoas reais durante testes.
  const allow = (Deno.env.get("EMAIL_ALLOWED_RECIPIENTS") ?? "").split(",").map((x) => x.trim().toLowerCase()).filter(Boolean);
  if (allow.length) {
    const e = email.toLowerCase();
    const ok = allow.some((a) => (a.startsWith("*@") ? e.endsWith(a.slice(1)) : a === e));
    if (!ok) { await log("suppressed", null, "recipient_not_allowed"); return json(200, {}); }
  }

  // token_hash/type na querystring de uma página nossa — nunca um link supabase.co, nunca localhost.
  // A página /confirmar exige um clique explícito antes de chamar verifyOtp() (evita que pré-visualizadores
  // automáticos de e-mail queimem o token de uso único) e nunca expõe o token em log nem em analytics.
  // Organização com marca própria: o link abre /empresa/<slug>/confirmar (marca certa desde o primeiro quadro); HP continua em /confirmar.
  const base = orgSlug ? `${siteUrl.replace(/\/+$/, "")}/empresa/${orgSlug}` : siteUrl.replace(/\/+$/, "");
  const confirmUrl = `${base}/confirmar?token_hash=${encodeURIComponent(tokenHash)}&type=${encodeURIComponent(actionType)}`;
  const { subject, html, text } = renderAuthEmail(actionType, confirmUrl, brand);
  // remetente: endereço verificado da plataforma; o NOME identifica a organização ("Clínica X via HP Group Hub")
  const sender = brand ? `${brand.name.replace(/[<>"]/g, "")} via HP Group Hub <${(from.match(/<([^>]+)>/)?.[1] ?? from).trim()}>` : from;

  const res = await fetch("https://api.resend.com/emails", {
    method: "POST",
    headers: { authorization: `Bearer ${resendKey}`, "content-type": "application/json" },
    body: JSON.stringify({ from: sender, to: [email], subject, html, text }),
  });

  if (!res.ok) {
    const detail = await res.text().catch(() => "");
    await log("failed", null, `resend_${res.status}`);
    return hookError(502, `resend_error: ${res.status} ${detail}`.slice(0, 300));
  }
  const sent = await res.json().catch(() => null) as { id?: string } | null;
  await log("accepted", sent?.id ?? null, null);   // "aceito pelo Resend" — NÃO é entrega; a entrega é conferida depois pelo id (provisioning-invite → check_delivery)

  return json(200, {});
});
