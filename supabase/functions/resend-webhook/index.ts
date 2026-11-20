// Edge Function `resend-webhook` — recebe os eventos de ENTREGA do Resend (delivered, bounced, delivery_delayed, complained…) e grava no evento de e-mail pelo id do provedor.
// Sem JWT (quem chama é o Resend); autenticada pela ASSINATURA do webhook (Svix / Standard Webhooks: HMAC-SHA256 de "<id>.<timestamp>.<corpo>"), com tolerância de 5 minutos.
// Configuração (feita por quem opera, nunca pelo chat): no painel do Resend → Webhooks → adicionar https://<projeto>.supabase.co/functions/v1/resend-webhook com os eventos email.sent,
// email.delivered, email.delivery_delayed, email.bounced, email.complained; copiar o "Signing secret" (whsec_…) para o secret RESEND_WEBHOOK_SECRET do projeto Supabase.
// Só guarda o estado de entrega do e-mail (sem endereço, sem conteúdo). Evento desconhecido → 200 sem efeito.
import { createClient } from "npm:@supabase/supabase-js@2";

const TOLERANCE = 5 * 60;
const b64ToBytes = (b64: string) => { const bin = atob(b64); const out = new Uint8Array(bin.length); for (let i = 0; i < bin.length; i++) out[i] = bin.charCodeAt(i); return out; };
const bytesToB64 = (bytes: Uint8Array) => { let s = ""; for (const b of bytes) s += String.fromCharCode(b); return btoa(s); };
const safeEq = (a: string, b: string) => { if (a.length !== b.length) return false; let d = 0; for (let i = 0; i < a.length; i++) d |= a.charCodeAt(i) ^ b.charCodeAt(i); return d === 0; };
const json = (status: number, body: unknown) => new Response(JSON.stringify(body), { status, headers: { "content-type": "application/json" } });

async function verify(secret: string, payload: string, id: string, ts: string, sigHeader: string): Promise<boolean> {
  const now = Math.floor(Date.now() / 1000); const t = Number.parseInt(ts, 10);
  if (!Number.isFinite(t) || Math.abs(now - t) > TOLERANCE) return false;
  const s = secret.trim().replace(/^v1,/, "").replace(/^whsec_/, "");
  const key = await crypto.subtle.importKey("raw", b64ToBytes(s), { name: "HMAC", hash: "SHA-256" }, false, ["sign"]);
  const expected = bytesToB64(new Uint8Array(await crypto.subtle.sign("HMAC", key, new TextEncoder().encode(`${id}.${ts}.${payload}`))));
  return sigHeader.split(" ").some((p) => { const [v, sig] = p.split(","); return v === "v1" && !!sig && safeEq(sig, expected); });
}

const TYPES: Record<string, string> = { "email.sent": "sent", "email.delivered": "delivered", "email.delivery_delayed": "delivery_delayed", "email.bounced": "bounced", "email.complained": "complained", "email.failed": "failed", "email.opened": "opened", "email.clicked": "clicked" };

Deno.serve(async (req: Request) => {
  if (req.method !== "POST") return json(405, { error: "method_not_allowed" });
  const secret = Deno.env.get("RESEND_WEBHOOK_SECRET");
  if (!secret) return json(401, { error: "invalid_signature" });   // sem segredo configurado nada é aceito
  const id = req.headers.get("svix-id") ?? req.headers.get("webhook-id") ?? "", ts = req.headers.get("svix-timestamp") ?? req.headers.get("webhook-timestamp") ?? "", sig = req.headers.get("svix-signature") ?? req.headers.get("webhook-signature") ?? "";
  if (!id || !ts || !sig) return json(401, { error: "missing_signature_headers" });
  const raw = await req.text();
  if (!(await verify(secret, raw, id, ts, sig))) return json(401, { error: "invalid_signature" });
  let ev: { type?: string; created_at?: string; data?: { email_id?: string } };
  try { ev = JSON.parse(raw); } catch { return json(400, { error: "invalid_payload" }); }
  const delivery = ev.type ? TYPES[ev.type] : undefined; const emailId = ev.data?.email_id;
  if (!delivery || !emailId) return json(200, { ignored: true });
  const svc = createClient(Deno.env.get("SUPABASE_URL") ?? "", Deno.env.get("SUPABASE_SERVICE_ROLE_KEY") ?? "", { auth: { persistSession: false } });
  const r = await svc.rpc("email_event_delivery_by_provider", { p_provider_id: emailId, p_delivery: delivery, p_at: ev.created_at ?? null });
  if (r.error) { console.error("resend-webhook", r.error.code); return json(500, { error: "store_failed" }); }
  return json(200, { updated: r.data });
});
