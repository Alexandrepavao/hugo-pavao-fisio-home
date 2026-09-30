// @ts-ignore - resolvido pelo Supabase Edge Runtime no deploy
import "jsr:@supabase/functions-js/edge-runtime.d.ts";
// @ts-ignore - resolvido pelo Supabase Edge Runtime no deploy
import { createClient } from "jsr:@supabase/supabase-js@2";

/**
 * Assinatura de calendário (.ics) — SOMENTE LEITURA. Serve o Calendário da Apple/iPhone (webcal://) e o Google Agenda ("Adicionar por URL").
 * NÃO é sincronização bidirecional: alterações feitas no calendário do cliente NÃO voltam para o HP (o HP é a fonte).
 *
 * Autenticação: o endereço contém um token secreto (64 hex) por usuário, gerado por public.calendar_feed_create e mostrado ao usuário UMA vez; o banco guarda só o hash (sha256).
 * O usuário revoga/gera outro a qualquer momento (o link antigo passa a responder 404). Calendários de clientes não enviam JWT, então esta função é publicada SEM verify_jwt:
 *   supabase functions deploy calendar-feed --no-verify-jwt
 * e lê o feed pela função calendar_feed_events (concedida SÓ ao service_role). Token inválido/revogado = 404 (não revela se existiu).
 *
 * Conteúdo: por padrão "Atendimento HP" + unidade (sem nome de paciente); o usuário pode escolher incluir primeiro nome e serviço. Tarefas pessoais NUNCA entram.
 * Datas em UTC (sem VTIMEZONE): o cliente converte para o fuso do aparelho. UID estável por atendimento (nunca duplica); cancelado/remarcado sai com o MESMO UID e STATUS:CANCELLED;
 * SEQUENCE/LAST-MODIFIED acompanham a última alteração para o cliente aplicar a mudança de horário.
 * Secrets: nenhum extra (SUPABASE_URL e SUPABASE_SERVICE_ROLE_KEY são injetados pela plataforma).
 */

const esc = (t: string) => t.replace(/\\/g, "\\\\").replace(/;/g, "\\;").replace(/,/g, "\\,").replace(/\r?\n/g, "\\n");
const utc = (iso: string) => new Date(iso).toISOString().replace(/[-:]/g, "").replace(/\.\d{3}/, "");
// dobra linhas em 75 octetos (RFC 5545)
function fold(line: string): string {
  const enc = new TextEncoder(); if (enc.encode(line).length <= 75) return line;
  const out: string[] = []; let cur = ""; let bytes = 0;
  for (const ch of line) { const b = enc.encode(ch).length; if (bytes + b > (out.length === 0 ? 75 : 74)) { out.push(cur); cur = ch; bytes = b; } else { cur += ch; bytes += b; } }
  out.push(cur); return out.join("\r\n ");
}
const notFound = () => new Response("Not found", { status: 404, headers: { "Cache-Control": "no-store", "X-Robots-Tag": "noindex" } });

// @ts-ignore - Deno é global no Edge Runtime
Deno.serve(async (req: Request) => {
  if (req.method !== "GET" && req.method !== "HEAD") return new Response("Method not allowed", { status: 405 });
  const token = new URL(req.url).searchParams.get("t") ?? "";
  if (!/^[0-9a-f]{64}$/.test(token)) return notFound();
  const hash = Array.from(new Uint8Array(await crypto.subtle.digest("SHA-256", new TextEncoder().encode(token)))).map((b) => b.toString(16).padStart(2, "0")).join("");
  // @ts-ignore
  const supabase = createClient(Deno.env.get("SUPABASE_URL")!, Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!, { auth: { persistSession: false } });
  const { data, error } = await supabase.rpc("calendar_feed_events", { p_token_hash: hash });
  if (error || !data) return notFound();

  const now = utc(new Date().toISOString());
  const lines = ["BEGIN:VCALENDAR", "VERSION:2.0", "PRODID:-//HP Group Hub//Agenda//PT-BR", "CALSCALE:GREGORIAN", "METHOD:PUBLISH", `X-WR-CALNAME:${esc(data.calname ?? "HP Group Hub")}`,
    "REFRESH-INTERVAL;VALUE=DURATION:PT1H", "X-PUBLISHED-TTL:PT1H"];
  for (const e of data.events as { uid: string; starts_at: string; ends_at: string; updated_at: string; status: string; summary: string; location?: string; description?: string }[]) {
    lines.push("BEGIN:VEVENT", `UID:${e.uid}`, `DTSTAMP:${now}`, `DTSTART:${utc(e.starts_at)}`, `DTEND:${utc(e.ends_at)}`, `SUMMARY:${esc(e.summary)}`);
    if (e.location) lines.push(`LOCATION:${esc(e.location)}`);
    if (e.description) lines.push(`DESCRIPTION:${esc(e.description)}`);
    lines.push(`STATUS:${e.status === "CANCELLED" ? "CANCELLED" : "CONFIRMED"}`, `SEQUENCE:${Math.floor(new Date(e.updated_at).getTime() / 1000)}`, `LAST-MODIFIED:${utc(e.updated_at)}`, "TRANSP:OPAQUE", "END:VEVENT");
  }
  lines.push("END:VCALENDAR");
  return new Response(req.method === "HEAD" ? null : lines.map(fold).join("\r\n") + "\r\n", {
    status: 200, headers: { "Content-Type": "text/calendar; charset=utf-8", "Content-Disposition": 'inline; filename="hp-group-hub.ics"', "Cache-Control": "private, max-age=300", "X-Robots-Tag": "noindex", "Referrer-Policy": "no-referrer" },
  });
});
