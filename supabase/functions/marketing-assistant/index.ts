// @ts-ignore - resolvido pelo Supabase Edge Runtime no deploy
import "jsr:@supabase/functions-js/edge-runtime.d.ts";
// @ts-ignore - resolvido pelo Supabase Edge Runtime no deploy
import { createClient } from "jsr:@supabase/supabase-js@2";
import { MAX_QUESTION, SYSTEM, buildContext, buildPrompt } from "./context.ts";

/**
 * Assistente de IA do Marketing: responde perguntas sobre os números do módulo. SOMENTE LEITURA e SEM dado de pessoa:
 *  1) autentica o usuário (JWT) e exige acesso ao Marketing (mkt_whoami);
 *  2) monta o contexto chamando as MESMAS funções do painel com o JWT do usuário (escopo de unidade/permissão do banco) — só agregados e nomes de campanha/anúncio;
 *  3) envia ao provedor de IA (Anthropic Messages API) e devolve o texto. Nada é executado nas campanhas; o texto da pergunta/resposta não é guardado (só quem perguntou e quando, para o limite de uso).
 * Secrets: ANTHROPIC_API_KEY (obrigatório; sem ela responde 503 “indisponível”), MKT_AI_MODEL (padrão claude-sonnet-5-5), MKT_RETURN_URL / MKT_ALLOWED_ORIGINS (CORS).
 */
// @ts-ignore
const env = (k: string) => (Deno.env.get(k) ?? "").trim();
const origins = () => [env("MKT_RETURN_URL").replace(/\/+$/, ""), ...env("MKT_ALLOWED_ORIGINS").split(",").map((s) => s.trim().replace(/\/+$/, ""))].filter(Boolean);
const cors = (req: Request) => { const o = req.headers.get("origin") ?? ""; return { "Access-Control-Allow-Origin": origins().includes(o) ? o : "null", Vary: "Origin", "Access-Control-Allow-Headers": "authorization, apikey, content-type, x-client-info", "Access-Control-Allow-Methods": "POST, OPTIONS" }; };
const json = (req: Request, status: number, body: unknown) => new Response(JSON.stringify(body), { status, headers: { ...cors(req), "Content-Type": "application/json", "Cache-Control": "no-store" } });
const isDate = (s: unknown) => typeof s === "string" && /^\d{4}-\d{2}-\d{2}$/.test(s);
const FILTER_KEYS = ["unit", "platform", "account", "campaign", "front", "purpose", "product", "pipeline", "owner", "scope", "state"];

// @ts-ignore - Deno é global no Edge Runtime
Deno.serve(async (req: Request) => {
  if (req.method === "OPTIONS") return new Response(null, { status: 204, headers: cors(req) });
  if (req.method !== "POST") return json(req, 405, { error: "method_not_allowed" });
  try {
    const auth = req.headers.get("Authorization"); if (!auth) return json(req, 401, { error: "unauthenticated" });
    // @ts-ignore
    const user = createClient(env("SUPABASE_URL"), env("SUPABASE_ANON_KEY"), { global: { headers: { Authorization: auth } }, auth: { persistSession: false } });
    // @ts-ignore
    const svc = createClient(env("SUPABASE_URL"), env("SUPABASE_SERVICE_ROLE_KEY"), { auth: { persistSession: false } });
    const who = (await user.rpc("mkt_whoami")).data; if (!who?.user_id || !who?.is_reader) return json(req, 403, { error: "forbidden", message: "Sem acesso ao Marketing." });
    const key = env("ANTHROPIC_API_KEY");
    if (!key) return json(req, 503, { error: "ai_not_configured", message: "Assistente indisponível: a chave do provedor de IA (ANTHROPIC_API_KEY) ainda não foi cadastrada no servidor. Nada é simulado." });
    let b: any = {}; try { b = await req.json(); } catch { /* corpo vazio */ }
    const question = typeof b.question === "string" ? b.question.trim() : ""; if (question.length < 3) return json(req, 400, { error: "invalid_question", message: "Escreva a pergunta." });
    if (question.length > MAX_QUESTION) return json(req, 400, { error: "too_long", message: `A pergunta pode ter até ${MAX_QUESTION} caracteres.` });
    if (!isDate(b.from) || !isDate(b.to)) return json(req, 400, { error: "invalid_period" });
    const filters: Record<string, string> = {}; for (const k of FILTER_KEYS) if (typeof b.filters?.[k] === "string" && /^[0-9a-zA-Z_-]{1,40}$/.test(b.filters[k])) filters[k] = b.filters[k];
    const view = b.view === "cohort" ? "cohort" : "event";
    const logId = (await svc.rpc("mkt_ai_register", { p_org: who.org_id, p_user: who.user_id, p_chars: question.length })).data;
    if (!logId) return json(req, 429, { error: "rate_limited", message: "Limite de perguntas atingido (6 por minuto, 120 por dia). Tente de novo em instantes." });
    const args = { p_from: b.from, p_to: b.to, p_filters: filters };
    const [kpis, campaigns, manager, quality, scores] = await Promise.all([
      user.rpc("mkt_kpis", { ...args, p_view: view }), user.rpc("mkt_campaign_table", { ...args, p_view: view }), user.rpc("mkt_manager", { ...args, p_view: view }), user.rpc("mkt_quality", args), user.rpc("mkt_lead_scores", { ...args, p_limit: 1 }),
    ]);
    if (kpis.error) { await svc.rpc("mkt_ai_finish", { p_id: logId, p_status: "error" }); return json(req, 400, { error: "context_failed", message: "Não foi possível ler os indicadores com esses filtros." }); }
    let funnel: any = null; if (typeof b.funnel_id === "string" && /^[0-9a-f-]{36}$/.test(b.funnel_id)) funnel = (await user.rpc("mkt_funnel_run", { p_funnel: b.funnel_id, ...args, p_view: view })).data;
    const scoresAgg = scores.data ? { total: scores.data.total, avg_score: scores.data.avg_score, bands: scores.data.bands } : null;     // sem a lista de leads (nomes)
    const prompt = buildPrompt(buildContext({ kpis: kpis.data, campaigns: campaigns.data, manager: manager.data, funnel, quality: quality.data, scores: scoresAgg }), question);
    const model = env("MKT_AI_MODEL") || "claude-sonnet-5-5";
    const r = await fetch("https://api.anthropic.com/v1/messages", { method: "POST", headers: { "content-type": "application/json", "x-api-key": key, "anthropic-version": "2023-06-01" }, body: JSON.stringify({ model, max_tokens: 900, system: SYSTEM, messages: [{ role: "user", content: prompt }] }) });
    const j = await r.json().catch(() => ({}));
    if (!r.ok) { await svc.rpc("mkt_ai_finish", { p_id: logId, p_status: "error" }); return json(req, 502, { error: "provider_error", message: "O provedor de IA recusou ou falhou ao responder. Tente novamente." }); }
    const answer = (j.content ?? []).filter((c: any) => c.type === "text").map((c: any) => c.text).join("\n").trim();
    await svc.rpc("mkt_ai_finish", { p_id: logId, p_status: "answered" });
    return json(req, 200, { answer, model, basis: "Somente números agregados do Marketing no período e filtros selecionados; nenhum dado de pessoa é enviado." });
  } catch (e) { return json(req, 500, { error: "internal", message: String((e as Error).message).slice(0, 160) }); }
});
