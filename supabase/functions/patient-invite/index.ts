// Edge Function `patient-invite` — convite de primeiro acesso do PACIENTE (pendente ou ativo). Autenticada (verify_jwt) e autorizada pelo banco.
//  1) autoriza pelo próprio banco (`portal_access_state`: fisioterapeuta com vínculo assistencial, gestão ou administrador operacional);
//  2) `portal_invite_run` (service_role) escolhe o e-mail JÁ cadastrado da pessoa, aplica a regra (conta existente é reutilizada, vínculo encerrado não convida, reenvio limitado) e registra;
//  3) se for convite novo, o Auth envia o e-mail pelo Send Email Hook → Resend (template "invite": link temporário para a página /confirmar → definir senha). Senha NUNCA vai por e-mail.
// O e-mail completo nunca volta ao navegador (só mascarado). Nada de dado clínico no e-mail nem nos logs. Sem envio em massa: uma pessoa por chamada.
// Estados devolvidos: sent (aceito pelo serviço de e-mail) · linked (conta existente reutilizada, nenhum e-mail) · no_email · no_enrollment · throttled · failed.
// Entrega confirmada NÃO é rastreada (exigiria o webhook do Resend); "primeiro acesso concluído" aparece em portal_access_state quando o convite é aceito.
import { createClient } from "npm:@supabase/supabase-js@2";

const CORS = { "Access-Control-Allow-Origin": "*", "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type", "Access-Control-Allow-Methods": "POST, OPTIONS" };
const json = (b: unknown, status = 200) => new Response(JSON.stringify(b), { status, headers: { ...CORS, "Content-Type": "application/json" } });
const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const env = (k: string) => Deno.env.get(k) ?? "";

Deno.serve(async (req: Request) => {
  if (req.method === "OPTIONS") return new Response("ok", { headers: CORS });
  if (req.method !== "POST") return json({ error: "método não permitido" }, 405);
  const auth = req.headers.get("Authorization") ?? ""; if (!auth.startsWith("Bearer ")) return json({ error: "não autenticado" }, 401);
  const body = await req.json().catch(() => null) as { person_id?: string } | null; const person = body?.person_id ?? "";
  if (!UUID.test(person)) return json({ error: "pessoa inválida" }, 400);

  const url = env("SUPABASE_URL");
  const asUser = createClient(url, env("SUPABASE_ANON_KEY"), { global: { headers: { Authorization: auth } }, auth: { persistSession: false, autoRefreshToken: false } });
  const { data: who } = await asUser.auth.getUser(); if (!who?.user) return json({ error: "não autenticado" }, 401);
  const state = await asUser.rpc("portal_access_state", { p_person: person });          // autoriza (42501 = sem vínculo/papel)
  if (state.error) return json({ error: state.error.code === "42501" ? "sem permissão" : "não foi possível consultar o acesso" }, state.error.code === "42501" ? 403 : 400);

  const svc = createClient(url, env("SUPABASE_SERVICE_ROLE_KEY"), { auth: { persistSession: false, autoRefreshToken: false } });
  const run = await svc.rpc("portal_invite_run", { p_person: person, p_actor: who.user.id });
  if (run.error) { console.error("patient-invite:run", run.error.code); return json({ status: "failed", code: "run_failed", message: "Não foi possível preparar o convite agora." }, 400); }
  const r = run.data as { status: string; email?: string; invite_id?: string };
  if (r.status !== "invited") return json({ status: r.status, masked: (state.data as { email_masked?: string })?.email_masked ?? null });   // linked · no_email · no_enrollment · throttled

  const settle = (outcome: "accepted" | "failed", code: string | null) => svc.rpc("portal_invite_result", { p_invite: r.invite_id, p_outcome: outcome, p_error: code });
  const siteUrl = env("PUBLIC_SITE_URL");
  if (!siteUrl) { await settle("failed", "site_url_not_configured"); return json({ status: "failed", code: "site_url_not_configured", message: "O envio de e-mail ainda não está configurado neste ambiente (falta PUBLIC_SITE_URL). O convite ficou registrado." }, 503); }
  const sent = await svc.auth.admin.inviteUserByEmail(r.email!, { redirectTo: `${siteUrl}/confirmar` });
  if (sent.error) {
    const code = (sent.error as { code?: string }).code ?? "invite_error"; console.error("patient-invite:send", code, (sent.error as { status?: number }).status);   // só códigos
    await settle("failed", code);
    if (code === "email_exists" || /already|registered/i.test(sent.error.message)) return json({ status: "failed", code: "email_exists", message: "Já existe um cadastro iniciado com este e-mail. Peça ao paciente para usar “Primeiro acesso” ou “Esqueci minha senha”." }, 409);
    return json({ status: "failed", code, message: "O serviço de e-mail não aceitou o envio. O convite ficou registrado; tente de novo em instantes." }, 502);
  }
  await settle("accepted", null);
  return json({ status: "sent", masked: (state.data as { email_masked?: string })?.email_masked ?? null });
});
