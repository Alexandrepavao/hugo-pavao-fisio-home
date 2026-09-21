import type { Config, Context } from "@netlify/functions";

/**
 * E-mails TRANSACIONAIS da aplicação (convites, confirmações), enviados pelo backend via Resend.
 * Não confundir com o SMTP do Supabase Auth (confirmação de conta, convite de autenticação e recuperação de senha),
 * que é configurado no painel do Supabase Auth — ver docs/integrations.md.
 *
 * Estado: PREPARADO, NÃO VALIDADO. Sem RESEND_API_KEY e EMAIL_FROM a função responde 501 e nada é enviado.
 */
const TEMPLATES = ["invite", "appointment_confirmation", "generic"] as const;
type Template = (typeof TEMPLATES)[number];

const esc = (s: string) => s.replace(/[&<>"']/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" })[c]!);
const json = (status: number, body: unknown) => new Response(JSON.stringify(body), { status, headers: { "content-type": "application/json" } });

function render(t: Template, name: string, data: Record<string, string>): { subject: string; text: string } {
  const n = name || "olá";
  if (t === "invite") return { subject: "Seu convite para o HP Group", text: `Olá, ${n}.\n\nVocê foi convidado(a) para acessar o HP Group. Para criar sua senha, acesse ${data.link ?? ""} e use este mesmo e-mail em “Primeiro acesso”.\n\nSe você não esperava este convite, ignore esta mensagem.` };
  if (t === "appointment_confirmation") return { subject: "Confirmação de atendimento — HP Fisioterapia", text: `Olá, ${n}.\n\nSeu atendimento está agendado para ${data.when ?? ""}${data.unit ? ` (${data.unit})` : ""}.\n\nPara remarcar, responda esta mensagem ou fale com nossa equipe.` };
  return { subject: (data.subject ?? "Mensagem do HP Group").slice(0, 120), text: (data.body ?? "").slice(0, 4000) };
}

export default async (req: Request, _context: Context) => {
  if (req.method !== "POST") return json(405, { error: "method_not_allowed" });

  const supabaseUrl = Netlify.env.get("SUPABASE_URL") ?? Netlify.env.get("VITE_SUPABASE_URL");
  const publishable = Netlify.env.get("VITE_SUPABASE_PUBLISHABLE_KEY");
  const resendKey = Netlify.env.get("RESEND_API_KEY");
  const from = Netlify.env.get("EMAIL_FROM");

  // 1) Quem chama precisa ser da equipe — checado no banco com o JWT do próprio usuário.
  const auth = req.headers.get("authorization") ?? "";
  if (!supabaseUrl || !publishable || !auth.startsWith("Bearer ")) return json(401, { error: "unauthorized" });
  const check = await fetch(`${supabaseUrl}/rest/v1/rpc/can_send_transactional`, { method: "POST", headers: { apikey: publishable, authorization: auth, "content-type": "application/json" }, body: "{}" });
  if (!check.ok || (await check.json()) !== true) return json(403, { error: "forbidden" });

  // 2) Integração precisa estar configurada de verdade.
  if (!resendKey || !from) return json(501, { status: "not_configured", detail: "Defina RESEND_API_KEY e EMAIL_FROM (domínio próprio verificado no Resend)." });

  // 3) Validação da entrada (sem HTML livre).
  let body: { template?: string; to?: string; name?: string; data?: Record<string, string> };
  try { body = await req.json(); } catch { return json(400, { error: "invalid_json" }); }
  if (!TEMPLATES.includes(body.template as Template)) return json(400, { error: "invalid_template" });
  if (!body.to || !/^[^@\s]+@[^@\s]+\.[^@\s]+$/.test(body.to) || body.to.length > 200) return json(400, { error: "invalid_recipient" });
  const data = Object.fromEntries(Object.entries(body.data ?? {}).slice(0, 10).map(([k, v]) => [k, String(v).slice(0, 2000)]));
  if (data.link && !/^https:\/\//.test(data.link)) return json(400, { error: "invalid_link" });

  const { subject, text } = render(body.template as Template, (body.name ?? "").slice(0, 100), data);
  const html = `<div style="font-family:Inter,Arial,sans-serif;color:#14283d;line-height:1.6">${esc(text).replace(/\n/g, "<br>")}</div>`;

  const res = await fetch("https://api.resend.com/emails", { method: "POST", headers: { authorization: `Bearer ${resendKey}`, "content-type": "application/json" }, body: JSON.stringify({ from, to: [body.to], subject, text, html }) });
  if (!res.ok) return json(502, { status: "provider_error", http: res.status });
  const out = (await res.json()) as { id?: string };
  return json(200, { status: "sent", id: out.id });
};

export const config: Config = { path: "/api/send-email" };
