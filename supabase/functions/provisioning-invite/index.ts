// Edge Function `provisioning-invite` — convite do ADMINISTRADOR de uma organização recém-provisionada. Somente administradores da plataforma (verify_jwt + checagem no banco).
// A chamada externa fica FORA da transação SQL: o provisionamento já terminou; falha aqui não desfaz nada e pode ser repetida.
//  · e-mail novo → Auth `inviteUserByEmail` → Send Email Hook → Resend (template com a marca da organização; senha definida pelo próprio usuário em link temporário);
//  · quem já tem conta → o vínculo fica pendente e a pessoa o aceita ao entrar (sem duplicar conta, sem redefinir senha); aqui só enviamos um aviso simples pelo Resend.
// O e-mail completo nunca volta ao navegador; só códigos de erro vão para o log.
import { createClient } from "npm:@supabase/supabase-js@2";

const CORS = { "Access-Control-Allow-Origin": "*", "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type", "Access-Control-Allow-Methods": "POST, OPTIONS" };
const json = (b: unknown, status = 200) => new Response(JSON.stringify(b), { status, headers: { ...CORS, "Content-Type": "application/json" } });
const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const env = (k: string) => Deno.env.get(k) ?? "";
const esc = (s: string) => s.replace(/[&<>"']/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[c] as string));

Deno.serve(async (req: Request) => {
  if (req.method === "OPTIONS") return new Response("ok", { headers: CORS });
  if (req.method !== "POST") return json({ error: "método não permitido" }, 405);
  const auth = req.headers.get("Authorization") ?? ""; if (!auth.startsWith("Bearer ")) return json({ error: "não autenticado" }, 401);
  const body = await req.json().catch(() => null) as { request_id?: string } | null; const id = body?.request_id ?? "";
  if (!UUID.test(id)) return json({ error: "solicitação inválida" }, 400);
  const url = env("SUPABASE_URL");
  const asUser = createClient(url, env("SUPABASE_ANON_KEY"), { global: { headers: { Authorization: auth } }, auth: { persistSession: false, autoRefreshToken: false } });
  const who = await asUser.rpc("platform_whoami"); if (who.error || !(who.data as { platform_admin?: boolean })?.platform_admin) return json({ error: "sem permissão" }, 403);

  const svc = createClient(url, env("SUPABASE_SERVICE_ROLE_KEY"), { auth: { persistSession: false, autoRefreshToken: false } });
  const prep = await svc.rpc("provisioning_invite_prepare", { p_id: id });
  if (prep.error) { console.error("provisioning-invite:prepare", prep.error.code); return json({ status: "failed", code: "prepare_failed" }, 400); }
  const p = prep.data as { status: string; email?: string; brand?: string; existing_user?: boolean };
  if (p.status !== "ready") return json({ status: p.status });
  const settle = (state: "sent" | "failed" | "notified", code: string | null) => svc.rpc("provisioning_invite_result", { p_id: id, p_state: state, p_error: code });
  const siteUrl = env("PUBLIC_SITE_URL");
  if (!siteUrl) { await settle("failed", "site_url_not_configured"); return json({ status: "failed", code: "site_url_not_configured", message: "O envio de e-mail ainda não está configurado neste ambiente (falta PUBLIC_SITE_URL). O ambiente foi criado; o convite pode ser reenviado depois." }, 503); }

  if (p.existing_user) {
    const key = env("RESEND_API_KEY"), from = env("EMAIL_FROM");
    if (!key || !from) { await settle("failed", "email_not_configured"); return json({ status: "failed", code: "email_not_configured", message: "Resend não configurado neste ambiente." }, 503); }
    const sender = `${(p.brand ?? "Plataforma").replace(/[<>"]/g, "")} via HP Group Hub <${(from.match(/<([^>]+)>/)?.[1] ?? from).trim()}>`;
    const r = await fetch("https://api.resend.com/emails", {
      method: "POST", headers: { authorization: `Bearer ${key}`, "content-type": "application/json" },
      body: JSON.stringify({
        from: sender, to: [p.email], subject: `Você foi convidado para ${p.brand}`,
        text: `Você foi convidado(a) para administrar ${p.brand}. Entre com a sua conta e aceite o convite: ${siteUrl}/login`,
        html: `<p>Você foi convidado(a) para administrar <b>${esc(p.brand ?? "")}</b>.</p><p>Entre com a sua conta e aceite o convite em <a href="${esc(siteUrl)}/login">${esc(siteUrl)}/login</a>. Sua senha não será alterada.</p>`,
      }),
    });
    if (!r.ok) { await settle("failed", `resend_${r.status}`); console.error("provisioning-invite:notify", r.status); return json({ status: "failed", code: "resend_error" }, 502); }
    await settle("notified", null); return json({ status: "notified" });
  }
  const sent = await svc.auth.admin.inviteUserByEmail(p.email!, { redirectTo: `${siteUrl}/confirmar` });
  if (sent.error) {
    const code = (sent.error as { code?: string }).code ?? "invite_error"; console.error("provisioning-invite:send", code);
    await settle("failed", code);
    return json({ status: "failed", code, message: code === "email_exists" ? "Já existe um cadastro iniciado com este e-mail (ainda não confirmado)." : "O serviço de e-mail não aceitou o envio. Tente de novo em instantes." }, code === "email_exists" ? 409 : 502);
  }
  await settle("sent", null);
  return json({ status: "sent" });
});
