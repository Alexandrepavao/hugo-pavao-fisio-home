// Edge Function `provisioning-invite` — convite do ADMINISTRADOR de uma organização recém-provisionada. Somente administradores da plataforma (verify_jwt + checagem no banco).
// A chamada externa fica FORA da transação SQL: o provisionamento já terminou; falha aqui não desfaz nada e pode ser repetida (reenviar renova a validade do convite).
//  · action "send" (padrão):
//      e-mail novo          → Auth `inviteUserByEmail` → Send Email Hook → Resend (template com a marca da organização; a pessoa define a própria senha em link temporário);
//      cadastro NÃO confirmado e sem vínculos (convite anterior vencido) → é recriado com segurança e o convite é reenviado;
//      quem já tem conta    → o vínculo fica pendente e a pessoa o aceita ao entrar (sem duplicar conta, sem redefinir senha); aqui só enviamos um aviso simples pelo Resend.
//  · action "check_delivery": consulta no Resend o estado de entrega dos e-mails ACEITOS (id do provedor) e grava; devolve a evidência em níveis.
//  · action "revoke": revoga o convite (nada de acesso por convite antigo); "send" reabre.
// Política de destinatários: se EMAIL_ALLOWED_RECIPIENTS existir (Dev), só esses endereços recebem e-mail real; os demais ficam registrados como "suppressed" e nada é enviado.
// O e-mail completo nunca volta ao navegador; só códigos de erro vão para o log.
import { createClient } from "npm:@supabase/supabase-js@2";

const CORS = { "Access-Control-Allow-Origin": "*", "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type", "Access-Control-Allow-Methods": "POST, OPTIONS" };
const json = (b: unknown, status = 200) => new Response(JSON.stringify(b), { status, headers: { ...CORS, "Content-Type": "application/json" } });
const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const env = (k: string) => Deno.env.get(k) ?? "";
const esc = (s: string) => s.replace(/[&<>"']/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[c] as string));
const allowed = (email: string) => {
  const list = env("EMAIL_ALLOWED_RECIPIENTS").split(",").map((x) => x.trim().toLowerCase()).filter(Boolean);
  if (!list.length) return true;
  const e = email.toLowerCase(); return list.some((a) => (a.startsWith("*@") ? e.endsWith(a.slice(1)) : a === e));
};

Deno.serve(async (req: Request) => {
  if (req.method === "OPTIONS") return new Response("ok", { headers: CORS });
  if (req.method !== "POST") return json({ error: "método não permitido" }, 405);
  const auth = req.headers.get("Authorization") ?? ""; if (!auth.startsWith("Bearer ")) return json({ error: "não autenticado" }, 401);
  const body = await req.json().catch(() => null) as { request_id?: string; action?: string } | null; const id = body?.request_id ?? "";
  const action = body?.action ?? "send";
  if (!UUID.test(id)) return json({ error: "solicitação inválida" }, 400);
  if (!["send", "check_delivery", "revoke"].includes(action)) return json({ error: "ação inválida" }, 400);
  const url = env("SUPABASE_URL");
  const asUser = createClient(url, env("SUPABASE_ANON_KEY"), { global: { headers: { Authorization: auth } }, auth: { persistSession: false, autoRefreshToken: false } });
  const who = await asUser.rpc("platform_whoami"); if (who.error || !(who.data as { platform_admin?: boolean })?.platform_admin) return json({ error: "sem permissão" }, 403);

  const svc = createClient(url, env("SUPABASE_SERVICE_ROLE_KEY"), { auth: { persistSession: false, autoRefreshToken: false } });

  if (action === "revoke") {
    const r = await asUser.rpc("provisioning_invite_revoke", { p_id: id });
    if (r.error) return json({ status: "failed", code: r.error.code === "P0013" ? "already_accepted" : "revoke_failed" }, r.error.code === "P0013" ? 409 : 400);
    return json({ status: "revoked" });
  }

  if (action === "check_delivery") {
    const key = env("RESEND_READ_API_KEY") || env("RESEND_API_KEY");   // a chave de ENVIO costuma não consultar entrega (401): use RESEND_READ_API_KEY ou o webhook resend-webhook
    const evs = await svc.rpc("email_events_for_request", { p_request: id });
    if (!key) return json({ status: "failed", code: "email_not_configured" }, 503);
    const out: { purpose: string; delivery: string | null; checked: boolean; error?: string }[] = [];
    for (const e of (evs.data ?? []) as { id: string; purpose: string; state: string; provider_id: string | null; delivery: string | null }[]) {
      if (e.state !== "accepted" || !e.provider_id) continue;
      const r = await fetch(`https://api.resend.com/emails/${encodeURIComponent(e.provider_id)}`, { headers: { authorization: `Bearer ${key}` } });
      if (!r.ok) { out.push({ purpose: e.purpose, delivery: e.delivery, checked: false, error: r.status === 401 || r.status === 403 ? "key_cannot_read" : `resend_${r.status}` }); continue; }
      const j = await r.json().catch(() => null) as { last_event?: string; created_at?: string } | null;
      await svc.rpc("email_event_delivery", { p_id: e.id, p_delivery: j?.last_event ?? "unknown", p_at: null });
      out.push({ purpose: e.purpose, delivery: j?.last_event ?? "unknown", checked: true });
    }
    const blocked = out.length > 0 && out.every((o) => o.error === "key_cannot_read");
    return json({ status: "checked", events: out, ...(blocked ? { code: "key_cannot_read", message: "A chave de envio do Resend não permite consultar a entrega. A entrega é registrada pelo webhook (resend-webhook): configure-o no painel do Resend, ou defina RESEND_READ_API_KEY." } : {}) });
  }

  const prep = await svc.rpc("provisioning_invite_prepare", { p_id: id });
  if (prep.error) { console.error("provisioning-invite:prepare", prep.error.code); return json({ status: "failed", code: "prepare_failed" }, 400); }
  const p = prep.data as { status: string; email?: string; brand?: string; org_id?: string; slug?: string; existing_user?: boolean; stale_user_id?: string | null };
  if (p.status !== "ready") return json({ status: p.status });
  const settle = (state: "sent" | "failed" | "notified", code: string | null) => svc.rpc("provisioning_invite_result", { p_id: id, p_state: state, p_error: code });
  const ev = (purpose: string, state: "requested" | "accepted" | "failed" | "suppressed", providerId: string | null, err: string | null) =>
    svc.rpc("email_event_log", { p_org: p.org_id, p_request: id, p_purpose: purpose, p_email: p.email, p_state: state, p_provider_id: providerId, p_error: err });
  await ev("admin_invite", "requested", null, null);   // nível 1: pedido registrado
  const siteUrl = env("PUBLIC_SITE_URL").replace(/\/+$/, "");
  if (!siteUrl) { await settle("failed", "site_url_not_configured"); await ev("admin_invite", "failed", null, "site_url_not_configured"); return json({ status: "failed", code: "site_url_not_configured", message: "O envio de e-mail ainda não está configurado neste ambiente (falta PUBLIC_SITE_URL). O ambiente foi criado; o convite pode ser reenviado depois." }, 503); }
  if (!allowed(p.email!)) { await settle("failed", "recipient_not_allowed"); await ev("admin_invite", "suppressed", null, "recipient_not_allowed"); return json({ status: "failed", code: "recipient_not_allowed", message: "Este ambiente só envia e-mails de teste para endereços autorizados (EMAIL_ALLOWED_RECIPIENTS). Nada foi enviado." }, 403); }

  const orgBase = `${siteUrl}/empresa/${p.slug}`;
  if (p.existing_user) {
    const key = env("RESEND_API_KEY"), from = env("EMAIL_FROM");
    if (!key || !from) { await settle("failed", "email_not_configured"); await ev("admin_invite_notice", "failed", null, "email_not_configured"); return json({ status: "failed", code: "email_not_configured", message: "Resend não configurado neste ambiente." }, 503); }
    const sender = `${(p.brand ?? "Plataforma").replace(/[<>"]/g, "")} via HP Group Hub <${(from.match(/<([^>]+)>/)?.[1] ?? from).trim()}>`;
    const r = await fetch("https://api.resend.com/emails", {
      method: "POST", headers: { authorization: `Bearer ${key}`, "content-type": "application/json" },
      body: JSON.stringify({
        from: sender, to: [p.email], subject: `Você foi convidado para ${p.brand}`,
        text: `Você foi convidado(a) para administrar ${p.brand}. Entre com a sua conta e aceite o convite: ${orgBase}/login`,
        html: `<p>Você foi convidado(a) para administrar <b>${esc(p.brand ?? "")}</b>.</p><p>Entre com a sua conta e aceite o convite em <a href="${esc(orgBase)}/login">${esc(orgBase)}/login</a>. Sua senha não será alterada.</p>`,
      }),
    });
    if (!r.ok) { await settle("failed", `resend_${r.status}`); await ev("admin_invite_notice", "failed", null, `resend_${r.status}`); console.error("provisioning-invite:notify", r.status); return json({ status: "failed", code: "resend_error" }, 502); }
    const j = await r.json().catch(() => null) as { id?: string } | null;
    await ev("admin_invite_notice", "accepted", j?.id ?? null, null);   // nível 2: aceito pelo Resend (NÃO é entrega)
    await settle("notified", null); return json({ status: "notified" });
  }
  let sent = await svc.auth.admin.inviteUserByEmail(p.email!, { redirectTo: `${orgBase}/confirmar` });
  if (sent.error && (sent.error as { code?: string }).code === "email_exists" && p.stale_user_id) {
    // convite anterior nunca usado (cadastro NÃO confirmado, sem vínculos): recria com segurança para gerar link novo
    const del = await svc.auth.admin.deleteUser(p.stale_user_id);
    if (!del.error) sent = await svc.auth.admin.inviteUserByEmail(p.email!, { redirectTo: `${orgBase}/confirmar` });
  }
  if (sent.error) {
    const code = (sent.error as { code?: string }).code ?? "invite_error"; console.error("provisioning-invite:send", code);
    await settle("failed", code); await ev("admin_invite", "failed", null, code);
    return json({ status: "failed", code, message: code === "email_exists" ? "Já existe um cadastro com este e-mail que não pôde ser recriado automaticamente (tem vínculos)." : "O serviço de e-mail não aceitou o envio. Tente de novo em instantes." }, code === "email_exists" ? 409 : 502);
  }
  await settle("sent", null);   // o Auth aceitou o pedido; o hook registra o aceite do Resend (nível 2) com o id do provedor
  return json({ status: "sent" });
});
