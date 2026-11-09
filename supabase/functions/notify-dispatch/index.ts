// HP Group Hub — Edge Function notify-dispatch (F8). NÃO PUBLICADA E NÃO PROVADA neste ambiente.
// Papel: gerar os lembretes devidos (notifications_enqueue_due), buscar os pendentes (notifications_pending) e ENVIAR: e-mail pela Resend e push pelo padrão Web Push (chaves VAPID).
// WhatsApp: canal reservado — nenhum item dele é enviado. Chamada por um agendador (por exemplo, a cada 15 minutos) com o cabeçalho x-notify-secret.
// Segredos (somente no painel/CLI do Supabase, nunca no repositório): NOTIFY_SECRET, RESEND_API_KEY, NOTIFY_FROM (ex.: "HP Fisioterapia <avisos@hpfisioterapia.com.br>"), VAPID_PUBLIC_KEY, VAPID_PRIVATE_KEY, VAPID_SUBJECT (mailto:...).
// O SUPABASE_URL e o SUPABASE_SERVICE_ROLE_KEY são injetados pelo próprio Supabase. A service role fica só aqui, no servidor.
import { createClient } from "https://esm.sh/@supabase/supabase-js@2.116.0";
import webpush from "npm:web-push@3.6.7";

declare const Deno: { env: { get(k: string): string | undefined }; serve(h: (r: Request) => Response | Promise<Response>): void };

interface Device { endpoint: string; p256dh: string; auth: string }
interface Item { id: string; channel: "email" | "push"; kind: string; title: string; body: string; url: string; email: string | null; devices: Device[] }

const json = (b: unknown, status = 200) => new Response(JSON.stringify(b), { status, headers: { "content-type": "application/json" } });

Deno.serve(async (req) => {
  const secret = Deno.env.get("NOTIFY_SECRET");
  if (!secret || req.headers.get("x-notify-secret") !== secret) return json({ error: "não autorizado" }, 401);
  const db = createClient(Deno.env.get("SUPABASE_URL") ?? "", Deno.env.get("SUPABASE_SERVICE_ROLE_KEY") ?? "");
  const resendKey = Deno.env.get("RESEND_API_KEY"); const from = Deno.env.get("NOTIFY_FROM");
  const vapidPub = Deno.env.get("VAPID_PUBLIC_KEY"); const vapidPriv = Deno.env.get("VAPID_PRIVATE_KEY"); const subject = Deno.env.get("VAPID_SUBJECT");
  if (vapidPub && vapidPriv && subject) webpush.setVapidDetails(subject, vapidPub, vapidPriv);

  const enq = await db.rpc("notifications_enqueue_due");
  if (enq.error) return json({ error: enq.error.message }, 500);
  const pend = await db.rpc("notifications_pending", { p_limit: 50 });
  if (pend.error) return json({ error: pend.error.message }, 500);
  const items = (pend.data ?? []) as Item[]; const out = { enqueued: enq.data as number, sent: 0, failed: 0, skipped: 0 };

  for (const it of items) {
    try {
      if (it.channel === "email") {
        if (!resendKey || !from) { await db.rpc("notification_mark", { p_id: it.id, p_status: "skipped", p_error: "e-mail não configurado (RESEND_API_KEY/NOTIFY_FROM)" }); out.skipped++; continue; }
        if (!it.email) { await db.rpc("notification_mark", { p_id: it.id, p_status: "skipped", p_error: "destinatário sem e-mail cadastrado" }); out.skipped++; continue; }
        const r = await fetch("https://api.resend.com/emails", { method: "POST", headers: { authorization: `Bearer ${resendKey}`, "content-type": "application/json" },
          body: JSON.stringify({ from, to: [it.email], subject: it.title, text: `${it.body}\n\nAbrir: ${Deno.env.get("PUBLIC_APP_URL") ?? "https://hpfisioterapia.com.br"}${it.url}` }) });
        if (!r.ok) throw new Error(`Resend ${r.status}`);
      } else {
        if (!vapidPub || !vapidPriv || !subject) { await db.rpc("notification_mark", { p_id: it.id, p_status: "skipped", p_error: "push não configurado (VAPID)" }); out.skipped++; continue; }
        if (it.devices.length === 0) { await db.rpc("notification_mark", { p_id: it.id, p_status: "skipped", p_error: "nenhum aparelho ativado" }); out.skipped++; continue; }
        for (const d of it.devices) await webpush.sendNotification({ endpoint: d.endpoint, keys: { p256dh: d.p256dh, auth: d.auth } }, JSON.stringify({ title: it.title, body: it.body, url: it.url, tag: it.id }));
      }
      await db.rpc("notification_mark", { p_id: it.id, p_status: "sent" }); out.sent++;
    } catch (e) {
      await db.rpc("notification_mark", { p_id: it.id, p_status: "failed", p_error: e instanceof Error ? e.message : "erro desconhecido" }); out.failed++;
    }
  }
  return json(out);
});
