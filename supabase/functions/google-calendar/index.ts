// @ts-ignore - resolvido pelo Supabase Edge Runtime no deploy
import "jsr:@supabase/functions-js/edge-runtime.d.ts";
// @ts-ignore - resolvido pelo Supabase Edge Runtime no deploy
import { createClient } from "jsr:@supabase/supabase-js@2";
// @ts-ignore - resolvido pelo Supabase Edge Runtime no deploy
import { planAppointments, type Appt, type Detail } from "./sync-plan.ts";

/**
 * Google Calendar por usuário: conectar (OAuth), sincronizar e desconectar. Publicar SEM verify_jwt (o retorno do Google não traz JWT; as ações do usuário
 * são autenticadas aqui dentro pelo JWT do Supabase):  supabase functions deploy google-calendar --no-verify-jwt
 *
 * O QUE A "SINCRONIZAÇÃO BIDIRECIONAL" SIGNIFICA AQUI (alcance informado ao usuário):
 *   HP → Google: os atendimentos da agenda do próprio profissional são publicados num calendário secundário "HP Group Hub", CRIADO pelo app (escopo
 *     calendar.app.created — o app só escreve nesse calendário, nunca no principal). Criação, remarcação e cancelamento são refletidos (id de evento
 *     determinístico por atendimento = impossível duplicar). O HP é a fonte: editar esses eventos no Google NÃO altera o atendimento.
 *   Google → HP: eventos do calendário principal são LIDOS (escopo calendar.events.readonly) e guardados só como "compromissos externos" do próprio usuário,
 *     exibidos no Meu dia. Um compromisso externo NUNCA vira atendimento, cobrança, venda ou consumo de sessão (vai para external_calendar_events, e só).
 *   Tarefas pessoais NUNCA são enviadas ao Google. Por padrão o evento publicado é "Atendimento HP" + unidade, sem nome de paciente (o usuário pode optar por incluir).
 *
 * Rotas (path após o nome da função):  POST /start · GET /callback · POST /disconnect · POST /sync   (+ /sync com x-cron-secret para rodar de forma automática, para todos ou para {user_id})
 * Autenticação: /start, /disconnect e /sync exigem o JWT do usuário (validado aqui com auth.getUser); /callback é autenticado pelo "state" assinado de USO ÚNICO (migration 061).
 * Secrets (Supabase → Edge Functions → Secrets; nunca no navegador/repositório):
 *   GOOGLE_CLIENT_ID, GOOGLE_CLIENT_SECRET   — cliente OAuth "Aplicativo da Web" do Google Cloud; redirect URI autorizado:
 *                                              https://<ref-do-projeto>.supabase.co/functions/v1/google-calendar/callback
 *   GOOGLE_TOKEN_ENC_KEY                     — 32 bytes em base64 (ex.: openssl rand -base64 32): criptografa o refresh token em repouso e assina o "state" do OAuth.
 *   GOOGLE_RETURN_URL                        — origem do app para onde o usuário volta depois do Google (ex.: https://release-v1--hp-group-hub.netlify.app). É SÓ do calendário:
 *                                              sem ela vale PUBLIC_SITE_URL, mas os e-mails (auth-email-hook) usam PUBLIC_SITE_URL e não devem ser afetados por esta configuração.
 *   CALENDAR_SYNC_SECRET                     — habilita a sincronização automática por chamada servidor-a-servidor (pg_cron/pg_net): x-cron-secret.
 * SUPABASE_URL, SUPABASE_ANON_KEY e SUPABASE_SERVICE_ROLE_KEY são injetados pela plataforma.
 */

const SCOPES = "https://www.googleapis.com/auth/calendar.app.created https://www.googleapis.com/auth/calendar.events.readonly openid email";
const cors = { "Access-Control-Allow-Origin": "*", "Access-Control-Allow-Headers": "authorization, apikey, content-type, x-client-info, x-cron-secret", "Access-Control-Allow-Methods": "GET, POST, OPTIONS" };
const json = (status: number, body: unknown) => new Response(JSON.stringify(body), { status, headers: { ...cors, "Content-Type": "application/json", "Cache-Control": "no-store" } });
// @ts-ignore
const env = (k: string) => Deno.env.get(k) ?? "";
// Client ID/Secret não têm espaço nem quebra de linha; colados em painel às vezes chegam com um deles no meio. Removemos antes de usar (o segredo guardado não muda).
const cred = (k: string) => env(k).replace(/\s+/g, "");
const b64 = (u: Uint8Array) => btoa(String.fromCharCode(...u));
const unb64 = (s: string) => Uint8Array.from(atob(s), (c) => c.charCodeAt(0));
const b64url = (s: string) => btoa(s).replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/, "");
const unb64url = (s: string) => atob(s.replace(/-/g, "+").replace(/_/g, "/"));
const returnUrl = () => (env("GOOGLE_RETURN_URL") || env("PUBLIC_SITE_URL")).replace(/\/+$/, "");
const configured = () => !!(cred("GOOGLE_CLIENT_ID") && cred("GOOGLE_CLIENT_SECRET") && env("GOOGLE_TOKEN_ENC_KEY") && returnUrl());
const sameSecret = (a: string, b: string) => { if (!a || !b || a.length !== b.length) return false; let d = 0; for (let i = 0; i < a.length; i++) d |= a.charCodeAt(i) ^ b.charCodeAt(i); return d === 0; };
const redirectUri = () => `${env("SUPABASE_URL")}/functions/v1/google-calendar/callback`;

async function aesKey() { const raw = unb64(env("GOOGLE_TOKEN_ENC_KEY")); if (raw.length !== 32) throw new Error("GOOGLE_TOKEN_ENC_KEY deve ter 32 bytes em base64"); return crypto.subtle.importKey("raw", raw, "AES-GCM", false, ["encrypt", "decrypt"]); }
async function encrypt(text: string) { const iv = crypto.getRandomValues(new Uint8Array(12)); const ct = new Uint8Array(await crypto.subtle.encrypt({ name: "AES-GCM", iv }, await aesKey(), new TextEncoder().encode(text))); return `${b64(iv)}.${b64(ct)}`; }
async function decrypt(s: string) { const [iv, ct] = s.split("."); return new TextDecoder().decode(await crypto.subtle.decrypt({ name: "AES-GCM", iv: unb64(iv) }, await aesKey(), unb64(ct))); }
async function hmacKey() { const d = await crypto.subtle.digest("SHA-256", new TextEncoder().encode("oauth-state:" + env("GOOGLE_TOKEN_ENC_KEY"))); return crypto.subtle.importKey("raw", d, { name: "HMAC", hash: "SHA-256" }, false, ["sign", "verify"]); }
async function signState(payload: object) { const body = b64url(JSON.stringify(payload)); const sig = new Uint8Array(await crypto.subtle.sign("HMAC", await hmacKey(), new TextEncoder().encode(body))); return `${body}.${b64url(String.fromCharCode(...sig))}`; }
async function verifyState(state: string): Promise<{ u: string; exp: number; n: string } | null> {
  const [body, sig] = state.split("."); if (!body || !sig) return null;
  const ok = await crypto.subtle.verify("HMAC", await hmacKey(), Uint8Array.from(unb64url(sig), (c) => c.charCodeAt(0)), new TextEncoder().encode(body)); if (!ok) return null;
  let p: { u?: unknown; exp?: unknown; n?: unknown }; try { p = JSON.parse(unb64url(body)); } catch { return null; }
  return typeof p.u === "string" && typeof p.n === "string" && typeof p.exp === "number" && p.exp > Date.now() ? { u: p.u, exp: p.exp, n: p.n } : null;
}

// @ts-ignore
const service = () => createClient(env("SUPABASE_URL"), env("SUPABASE_SERVICE_ROLE_KEY"), { auth: { persistSession: false } });
async function userFromRequest(req: Request) {
  const auth = req.headers.get("Authorization"); if (!auth) return null;
  // @ts-ignore
  const c = createClient(env("SUPABASE_URL"), env("SUPABASE_ANON_KEY"), { global: { headers: { Authorization: auth } }, auth: { persistSession: false } });
  const { data } = await c.auth.getUser(); return data.user ?? null;
}
async function orgOf(sb: any, userId: string): Promise<string | null> { const { data } = await sb.from("user_accounts").select("org_id").eq("user_id", userId).eq("status", "active").maybeSingle(); return data?.org_id ?? null; }

async function refreshAccess(sb: any, conn: any): Promise<string> {
  const r = await fetch("https://oauth2.googleapis.com/token", { method: "POST", headers: { "Content-Type": "application/x-www-form-urlencoded" },
    body: new URLSearchParams({ client_id: cred("GOOGLE_CLIENT_ID"), client_secret: cred("GOOGLE_CLIENT_SECRET"), refresh_token: await decrypt(conn.refresh_token_enc), grant_type: "refresh_token" }) });
  const j = await r.json();
  if (!r.ok || !j.access_token) {
    if (j.error === "invalid_grant") await sb.from("google_calendar_connections").update({ status: "revoked", last_error: "O acesso ao Google foi revogado ou expirou. Conecte novamente." }).eq("user_id", conn.user_id);
    throw new Error(j.error_description ?? j.error ?? "falha ao renovar o acesso ao Google");
  }
  return j.access_token as string;
}
const gcal = (token: string, path: string, init: RequestInit = {}) => fetch(`https://www.googleapis.com/calendar/v3/${path}`, { ...init, headers: { Authorization: `Bearer ${token}`, "Content-Type": "application/json", ...(init.headers ?? {}) } });

async function syncUser(sb: any, userId: string) {
  const { data: conn } = await sb.from("google_calendar_connections").select("*").eq("user_id", userId).maybeSingle();
  if (!conn || conn.status === "revoked") throw new Error("Google Calendar não está conectado.");
  const token = await refreshAccess(sb, conn); const now = Date.now(); const from = new Date(now - 30 * 864e5).toISOString(); const to = new Date(now + 180 * 864e5).toISOString();
  let calId: string = conn.hp_calendar_id;
  if (!calId) {
    const r = await gcal(token, "calendars", { method: "POST", body: JSON.stringify({ summary: "HP Group Hub", description: "Criado pelo HP Group Hub. Só leitura: alterações aqui não voltam para o HP.", timeZone: "America/Sao_Paulo" }) });
    const j = await r.json(); if (!r.ok) throw new Error(j.error?.message ?? "não foi possível criar o calendário HP Group Hub"); calId = j.id;
    await sb.from("google_calendar_connections").update({ hp_calendar_id: calId }).eq("user_id", userId);
  }
  const cid = encodeURIComponent(calId);
  // ---------------- HP → Google (atendimentos do próprio profissional)
  let pushed = 0, removed = 0;
  const { data: prof } = await sb.from("professionals").select("id").eq("user_id", userId).eq("org_id", conn.org_id).maybeSingle();
  if (prof) {
    const { data: appts } = await sb.from("appointments").select("id, period, status, updated_at, person:people(full_name), service:services(name), unit:units(name)")
      .eq("professional_id", prof.id).overlaps("period", `[${from},${to})`).limit(1000);
    const { data: links } = await sb.from("calendar_event_links").select("local_id, google_event_id, local_version").eq("user_id", userId).eq("local_type", "appointment");
    for (const act of planAppointments((appts ?? []) as Appt[], (links ?? []) as any[], (conn.detail === "names" ? "names" : "minimal") as Detail)) {
      if (act.type === "upsert") {
        let r = act.create ? await gcal(token, `calendars/${cid}/events`, { method: "POST", body: JSON.stringify(act.body) }) : await gcal(token, `calendars/${cid}/events/${act.eventId}`, { method: "PUT", body: JSON.stringify(act.body) });
        if (act.create && r.status === 409) r = await gcal(token, `calendars/${cid}/events/${act.eventId}`, { method: "PUT", body: JSON.stringify(act.body) });   // id já existiu: ressuscita em vez de duplicar
        if (!r.ok) throw new Error(`Google recusou o evento (${r.status})`);
        await sb.from("calendar_event_links").upsert({ org_id: conn.org_id, user_id: userId, local_type: "appointment", local_id: act.localId, google_event_id: act.eventId, local_version: act.version }, { onConflict: "user_id,local_type,local_id" });
        pushed++;
      } else {
        const r = await gcal(token, `calendars/${cid}/events/${act.eventId}`, { method: "DELETE" });
        if (!r.ok && r.status !== 404 && r.status !== 410) throw new Error(`Google recusou a remoção (${r.status})`);
        await sb.from("calendar_event_links").delete().eq("user_id", userId).eq("local_type", "appointment").eq("local_id", act.localId); removed++;
      }
    }
  }
  // ---------------- Google → HP (compromissos externos, só leitura; nunca viram atendimento/cobrança/sessão)
  let imported = 0; let syncToken: string | null = conn.sync_token; let restarted = false; let pageToken: string | undefined; let next: string | undefined;
  for (let guard = 0; guard < 40; guard++) {
    const qs = new URLSearchParams({ maxResults: "250", singleEvents: "true", showDeleted: "true" });
    if (syncToken) qs.set("syncToken", syncToken); else { qs.set("timeMin", from); qs.set("timeMax", to); }
    if (pageToken) qs.set("pageToken", pageToken);
    const r = await gcal(token, `calendars/primary/events?${qs}`);
    if (r.status === 410 && syncToken && !restarted) { syncToken = null; restarted = true; pageToken = undefined; continue; }   // token de sincronização expirou: recomeça
    const j = await r.json(); if (!r.ok) throw new Error(j.error?.message ?? `falha ao ler o Google (${r.status})`);
    const up: any[] = []; const del: string[] = [];
    for (const it of j.items ?? []) {
      if (it.extendedProperties?.private?.hp_kind) continue;                                    // evento nosso, não é compromisso externo
      if (it.status === "cancelled") { del.push(it.id); continue; }
      const allDay = !!it.start?.date; const s = it.start?.dateTime ?? (it.start?.date ? `${it.start.date}T00:00:00Z` : null); const e = it.end?.dateTime ?? (it.end?.date ? `${it.end.date}T00:00:00Z` : null); if (!s || !e) continue;
      up.push({ user_id: userId, org_id: conn.org_id, google_event_id: it.id, summary: it.summary ?? "(sem título)", starts_at: new Date(s).toISOString(), ends_at: new Date(e).toISOString(), all_day: allDay, status: it.status === "tentative" ? "tentative" : "confirmed", updated_at: new Date().toISOString() });
    }
    if (up.length) { const { error } = await sb.from("external_calendar_events").upsert(up, { onConflict: "user_id,google_event_id" }); if (error) throw new Error(error.message); imported += up.length; }
    if (del.length) await sb.from("external_calendar_events").delete().eq("user_id", userId).in("google_event_id", del);
    if (j.nextPageToken) { pageToken = j.nextPageToken; continue; }
    next = j.nextSyncToken; break;
  }
  await sb.from("google_calendar_connections").update({ sync_token: next ?? null, status: "active", last_error: null, last_sync_at: new Date().toISOString() }).eq("user_id", userId);
  return { pushed, removed, imported };
}

// @ts-ignore - Deno é global no Edge Runtime
Deno.serve(async (req: Request) => {
  if (req.method === "OPTIONS") return new Response(null, { status: 204, headers: cors });
  const route = new URL(req.url).pathname.split("/").pop() ?? "";
  try {
    if (!configured()) return route === "callback" ? Response.redirect(`${returnUrl() || ""}/admin/meu-dia?google=indisponivel`, 302)
      : json(503, { error: "google_not_configured", message: "Conexão com o Google indisponível: as credenciais OAuth ainda não foram cadastradas no servidor." });
    const sb = service();

    if (route === "start" && req.method === "POST") {
      const user = await userFromRequest(req); if (!user) return json(401, { error: "unauthenticated" });
      if (!(await orgOf(sb, user.id))) return json(403, { error: "forbidden" });
      // o nonce é guardado no servidor e só vale uma vez (consumido no callback); estados vencidos são limpos aqui
      const nonce = crypto.randomUUID(); const exp = Date.now() + 10 * 60_000;
      await sb.from("google_oauth_states").delete().lt("expires_at", new Date().toISOString());
      const ins = await sb.from("google_oauth_states").insert({ nonce, user_id: user.id, expires_at: new Date(exp).toISOString() });
      if (ins.error) return json(500, { error: "state_unavailable", message: "Não foi possível iniciar a conexão. Tente novamente." });
      const state = await signState({ u: user.id, exp, n: nonce });
      const qs = new URLSearchParams({ client_id: cred("GOOGLE_CLIENT_ID"), redirect_uri: redirectUri(), response_type: "code", scope: SCOPES, access_type: "offline", prompt: "consent", include_granted_scopes: "true", state });
      return json(200, { url: `https://accounts.google.com/o/oauth2/v2/auth?${qs}` });
    }

    if (route === "callback" && req.method === "GET") {
      const back = (r: string) => Response.redirect(`${returnUrl()}/admin/meu-dia?google=${r}`, 302);
      const q = new URL(req.url).searchParams; const st = await verifyState(q.get("state") ?? ""); if (!st) return back("estado");
      // uso único: apaga o nonce e só segue se ele existia, era deste usuário e não tinha vencido — repetir o mesmo state cai aqui
      const used = await sb.from("google_oauth_states").delete().eq("nonce", st.n).eq("user_id", st.u).gt("expires_at", new Date().toISOString()).select("nonce");
      if (used.error || !used.data || used.data.length !== 1) return back("estado");
      if (q.get("error") || !q.get("code")) return back("erro");
      const org = await orgOf(sb, st.u); if (!org) return back("erro");
      const tr = await fetch("https://oauth2.googleapis.com/token", { method: "POST", headers: { "Content-Type": "application/x-www-form-urlencoded" },
        body: new URLSearchParams({ code: q.get("code")!, client_id: cred("GOOGLE_CLIENT_ID"), client_secret: cred("GOOGLE_CLIENT_SECRET"), redirect_uri: redirectUri(), grant_type: "authorization_code" }) });
      const tj = await tr.json();
      if (!tr.ok || !tj.refresh_token || !String(tj.scope ?? "").includes("calendar.app.created")) return back("permissao");        // sem refresh token ou sem o escopo mínimo: não conecta
      const ui = await (await fetch("https://openidconnect.googleapis.com/v1/userinfo", { headers: { Authorization: `Bearer ${tj.access_token}` } })).json().catch(() => ({}));
      const { error } = await sb.from("google_calendar_connections").upsert({ user_id: st.u, org_id: org, google_email: ui.email ?? null, refresh_token_enc: await encrypt(tj.refresh_token), scope: tj.scope, hp_calendar_id: null, sync_token: null, status: "active", last_error: null }, { onConflict: "user_id" });
      if (!error) { try { await syncUser(sb, st.u); } catch (e) { await sb.from("google_calendar_connections").update({ status: "error", last_error: String((e as Error).message).slice(0, 300) }).eq("user_id", st.u); } }   // já aparece no Google sem precisar clicar
      return back(error ? "erro" : "conectado");
    }

    if (route === "disconnect" && req.method === "POST") {
      const user = await userFromRequest(req); if (!user) return json(401, { error: "unauthenticated" });
      const { data: conn } = await sb.from("google_calendar_connections").select("*").eq("user_id", user.id).maybeSingle();
      if (conn) {
        try { const t = await refreshAccess(sb, conn); if (conn.hp_calendar_id) await gcal(t, `calendars/${encodeURIComponent(conn.hp_calendar_id)}`, { method: "DELETE" });           // remove o calendário "HP Group Hub" criado pelo app
          await fetch(`https://oauth2.googleapis.com/revoke?token=${encodeURIComponent(await decrypt(conn.refresh_token_enc))}`, { method: "POST" }); } catch { /* já revogado: segue limpando localmente */ }
        await sb.from("calendar_event_links").delete().eq("user_id", user.id); await sb.from("external_calendar_events").delete().eq("user_id", user.id); await sb.from("google_calendar_connections").delete().eq("user_id", user.id);
      }
      return json(200, { ok: true });
    }

    if (route === "sync" && req.method === "POST") {
      const cron = req.headers.get("x-cron-secret");
      if (cron && sameSecret(cron, env("CALENDAR_SYNC_SECRET"))) {
        let only: string | null = null; try { const b = await req.json(); if (b && typeof b.user_id === "string" && /^[0-9a-f-]{36}$/i.test(b.user_id)) only = b.user_id; } catch { /* sem corpo: todos */ }
        let q = sb.from("google_calendar_connections").select("user_id").in("status", ["active", "error"]); if (only) q = q.eq("user_id", only);
        const { data } = await q; const out: Record<string, unknown> = {};
        for (const c of data ?? []) { try { out[c.user_id] = await syncUser(sb, c.user_id); } catch (e) { out[c.user_id] = { error: String((e as Error).message) }; await sb.from("google_calendar_connections").update({ status: "error", last_error: String((e as Error).message).slice(0, 300) }).eq("user_id", c.user_id); } }
        return json(200, { ok: true, users: out });
      }
      const user = await userFromRequest(req); if (!user) return json(401, { error: "unauthenticated" });
      try { return json(200, { ok: true, ...(await syncUser(sb, user.id)) }); }
      catch (e) { await sb.from("google_calendar_connections").update({ status: "error", last_error: String((e as Error).message).slice(0, 300) }).eq("user_id", user.id).neq("status", "revoked"); return json(502, { error: "sync_failed", message: String((e as Error).message) }); }
    }
    return json(404, { error: "not_found" });
  } catch (e) { return json(500, { error: "internal", message: String((e as Error).message).slice(0, 200) }); }
});
