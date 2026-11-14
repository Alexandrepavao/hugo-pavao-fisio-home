// @ts-ignore - resolvido pelo Supabase Edge Runtime no deploy
import "jsr:@supabase/functions-js/edge-runtime.d.ts";
// @ts-ignore - resolvido pelo Supabase Edge Runtime no deploy
import { createClient } from "jsr:@supabase/supabase-js@2";
// `route-core.ts` é copiado de supabase/functions/_shared/ no momento da publicação (supabase/tools/rota-publicar-funcao.mjs); não é versionado aqui.
// @ts-ignore
import { legsFromMatrix, planDay, ptKey, type Appt, type Pt } from "./route-core.ts";
import { cacheKey, orsProvider, ProviderError, roundLL, userMessage, type LL, type Profile, type RouteProvider } from "./providers.ts";

/**
 * Rota de atendimentos — backend. Publicada COM verify_jwt (o navegador sempre envia o JWT do usuário).
 * Ações (POST, corpo JSON): `day` · `geometry` · `apply` · `status`.
 *
 *  · Permissão: o dia só é lido pela RPC `route_day` com o JWT do usuário (can_view_prof_agenda). A função NÃO aceita coordenadas do cliente
 *    (não vira proxy aberto para gastar a cota): os pontos vêm do banco.
 *  · Só COORDENADAS (arredondadas a 3 casas) saem para o provedor. Nunca nome, telefone, diagnóstico, prontuário ou orientações.
 *  · Cache de trechos (7 dias) + contador por organização/dia com teto PRÓPRIO abaixo da cota gratuita. Sem fallback pago, sem trajeto inventado.
 *  · Sem chave ORS_API_KEY → "Estimativa indisponível" (não existe modo "fingir").
 *  · Nada de endereço/coordenada em log (só códigos).
 * Secrets: ORS_API_KEY (obrigatório para estimar) · ORS_MATRIX_DAILY_CAP (padrão 400) · ORS_DIRECTIONS_DAILY_CAP (padrão 1600).
 */
const CORS = { "Access-Control-Allow-Origin": "*", "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type", "Access-Control-Allow-Methods": "POST, OPTIONS" };
const json = (b: unknown, status = 200) => new Response(JSON.stringify(b), { status, headers: { ...CORS, "Content-Type": "application/json" } });
// @ts-ignore
const env = (k: string) => Deno.env.get(k) ?? "";
const MAX_POINTS = 25; const CACHE_DAYS = 7;
const DATE_RE = /^\d{4}-\d{2}-\d{2}$/; const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

const service = () => createClient(env("SUPABASE_URL"), env("SUPABASE_SERVICE_ROLE_KEY"), { auth: { persistSession: false } });
const asUser = (auth: string) => createClient(env("SUPABASE_URL"), env("SUPABASE_ANON_KEY"), { global: { headers: { Authorization: auth } }, auth: { persistSession: false } });
const provider = (): RouteProvider | null => { const k = env("ORS_API_KEY"); return k ? orsProvider(k, { fetch: (...a) => fetch(...a), sleep: (ms) => new Promise((r) => setTimeout(r, ms)) }) : null; };
const cap = (name: string, dflt: number) => { const n = Number(env(name)); return Number.isFinite(n) && n > 0 ? Math.floor(n) : dflt; };

interface DayAppt { id: string; starts_at: string; ends_at: string; status: string; person: string; service: string; unit: string; mode: Appt["mode"]; fixed: boolean; lat: number | null; lng: number | null; precision: Pt["precision"]; person_id: string }
interface Day { is_self: boolean; timezone: string; date: string; prefs: { profile: Profile; buffer_min: number; start_mode: string }; start: (Pt & { kind: string; label: string }) | null; appointments: DayAppt[] }

const toAppts = (d: Day): Appt[] => d.appointments.map((a) => ({ id: a.id, start: Date.parse(a.starts_at), end: Date.parse(a.ends_at), status: a.status, mode: a.mode, fixed: a.fixed,
  pt: a.lat !== null && a.lng !== null ? { lat: a.lat, lng: a.lng, precision: a.precision } : null, label: (a.person ?? "").split(" ")[0] }));

interface MatrixOut { keys: string[]; durations: (number | null)[][]; status: "ok" | "partial" | "unavailable" | "cap"; message: string | null; source: "cache" | "provider" | "mixed" | "none"; profile: Profile; provider: string; attribution: string | null; simulated: boolean }

/** Matriz de durações entre os pontos únicos, com cache → contador → provedor. Nunca devolve 0 para o que é desconhecido. */
async function getMatrix(svc: any, org: string, profile: Profile, pts: Pt[]): Promise<MatrixOut> {
  const uniq = new Map<string, LL>(); for (const p of pts) uniq.set(ptKey(p), roundLL(p));
  const keys = [...uniq.keys()]; const ll = keys.map((k) => uniq.get(k)!);
  const n = keys.length; const dur: (number | null)[][] = keys.map((_, i) => keys.map((__, j) => (i === j ? 0 : null)));
  const prov = provider();
  const base = { keys, profile, provider: prov?.name ?? "none", attribution: prov?.attribution ?? null, simulated: false };
  if (n < 2) return { ...base, durations: dur, status: "ok", message: null, source: "none" };
  if (n > MAX_POINTS) return { ...base, durations: dur, status: "unavailable", message: userMessage("too_many_points"), source: "none" };
  // 1) cache
  const wanted: string[] = []; for (let i = 0; i < n; i++) for (let j = 0; j < n; j++) if (i !== j) wanted.push(cacheKey(profile, ll[i], ll[j]));
  const { data: hit } = await svc.from("route_leg_cache").select("cache_key,duration_s,provider").in("cache_key", wanted).eq("org_id", org).gt("expires_at", new Date().toISOString());
  const got = new Map<string, number>((hit ?? []).map((r: any) => [r.cache_key, r.duration_s]));
  base.simulated = (hit ?? []).some((r: any) => r.provider === "simulado");   // só existe em fixture de teste no Dev; a tela avisa que NÃO é estimativa real
  for (let i = 0; i < n; i++) for (let j = 0; j < n; j++) if (i !== j && got.has(cacheKey(profile, ll[i], ll[j]))) dur[i][j] = got.get(cacheKey(profile, ll[i], ll[j]))!;
  const missing = () => dur.some((row, i) => row.some((v, j) => i !== j && v === null));
  if (!missing()) return { ...base, durations: dur, status: "ok", message: null, source: "cache" };
  const partial = (status: MatrixOut["status"], code: Parameters<typeof userMessage>[0]): MatrixOut => ({ ...base, durations: dur, status: got.size ? (status === "cap" ? "cap" : "partial") : status, message: userMessage(code), source: got.size ? "cache" : "none" });
  if (!prov) return partial("unavailable", "no_key");
  // 2) teto diário (atômico)
  const { data: allowed } = await svc.rpc("route_usage_hit", { p_org: org, p_kind: "matrix", p_n: 1, p_cap: cap("ORS_MATRIX_DAILY_CAP", 400) });
  if (!allowed) return partial("cap", "cap");
  // 3) provedor
  try {
    const m = await prov.matrix(profile, ll);
    const rows: any[] = []; const exp = new Date(Date.now() + CACHE_DAYS * 86400000).toISOString();
    for (let i = 0; i < n; i++) for (let j = 0; j < n; j++) if (i !== j) { const v = m[i]?.[j] ?? null; dur[i][j] = v; if (v !== null) rows.push({ cache_key: cacheKey(profile, ll[i], ll[j]), org_id: org, profile, duration_s: v, provider: prov.name, fetched_at: new Date().toISOString(), expires_at: exp }); }
    if (rows.length) await svc.from("route_leg_cache").upsert(rows, { onConflict: "cache_key" });
    return { ...base, durations: dur, status: missing() ? "partial" : "ok", message: missing() ? "Estimativa indisponível para alguns trechos (sem rota entre os pontos)." : null, source: got.size ? "mixed" : "provider" };
  } catch (e) {
    const code = e instanceof ProviderError ? e.code : "unavailable"; console.error("route-planner:matrix", code);   // só o código
    return partial("unavailable", code as any);
  }
}

async function loadDay(db: any, professional: string, date: string): Promise<{ day?: Day; err?: Response }> {
  if (!UUID_RE.test(professional ?? "") || !DATE_RE.test(date ?? "")) return { err: json({ error: "parâmetros inválidos" }, 400) };
  const { data, error } = await db.rpc("route_day", { p_professional: professional, p_date: date });
  if (error) return { err: json({ error: error.code === "42501" ? "sem permissão" : "não foi possível carregar o dia" }, error.code === "42501" ? 403 : 400) };
  return { day: data as Day };
}
const pointsOf = (day: Day, extra?: Pt | null): Pt[] => { const out: Pt[] = []; if (day.start) out.push(day.start); for (const a of day.appointments) if (a.mode !== "remote" && a.lat !== null && a.lng !== null) out.push({ lat: a.lat, lng: a.lng, precision: a.precision }); if (extra) out.push(extra); return out; };

// @ts-ignore
Deno.serve(async (req: Request) => {
  if (req.method === "OPTIONS") return new Response("ok", { headers: CORS });
  if (req.method !== "POST") return json({ error: "método não permitido" }, 405);
  const auth = req.headers.get("Authorization") ?? ""; if (!auth.startsWith("Bearer ")) return json({ error: "não autenticado" }, 401);
  const db = asUser(auth); const { data: u } = await db.auth.getUser(); if (!u?.user) return json({ error: "não autenticado" }, 401);
  let body: any; try { body = await req.json(); } catch { return json({ error: "corpo inválido" }, 400); }
  const svc = service();
  try {
    if (body.action === "status") {
      return json({ configured: !!env("ORS_API_KEY"), provider: "ors", matrix_cap: cap("ORS_MATRIX_DAILY_CAP", 400), directions_cap: cap("ORS_DIRECTIONS_DAILY_CAP", 1600), message: env("ORS_API_KEY") ? null : userMessage("no_key") });
    }
    const { day, err } = await loadDay(db, body.professional, body.date); if (err) return err;
    const { data: me } = await svc.from("professionals").select("org_id").eq("id", body.professional).single(); const org = me?.org_id as string;

    if (body.action === "day") {
      let extra: Pt | null = null; let extraPlace: any = null;
      if (body.extra_person) {
        if (!UUID_RE.test(body.extra_person)) return json({ error: "parâmetros inválidos" }, 400);
        const { data: pl, error: pe } = await db.rpc("route_place_get", { p_kind: "person", p_id: body.extra_person });
        if (pe) return json({ error: "sem permissão" }, 403);
        if (pl) { extra = { lat: pl.lat, lng: pl.lng, precision: pl.precision }; extraPlace = { lat: pl.lat, lng: pl.lng, precision: pl.precision }; }
      }
      const matrix = await getMatrix(svc, org, day!.prefs.profile, pointsOf(day!, extra));
      return json({ day, matrix, extra_place: extraPlace, note: "Tempo estimado sem trânsito em tempo real." });
    }

    if (body.action === "geometry") {
      const prov = provider(); if (!prov) return json({ status: "unavailable", message: userMessage("no_key") });
      const byId = new Map(day!.appointments.map((a) => [a.id, a]));
      const ids: string[] = Array.isArray(body.order) ? body.order : day!.appointments.map((a) => a.id);
      const seq: Pt[] = []; if (day!.start) seq.push(day!.start);
      for (const id of ids) { const a = byId.get(id); if (!a) return json({ error: "atendimento fora do dia" }, 400); if (a.mode !== "remote" && a.lat !== null && a.lng !== null) seq.push({ lat: a.lat, lng: a.lng }); }
      const dedup = seq.filter((p, i) => i === 0 || ptKey(p) !== ptKey(seq[i - 1]));
      if (dedup.length < 2) return json({ status: "ok", line: [], distance_m: 0, duration_s: 0 });
      if (dedup.length > MAX_POINTS) return json({ status: "unavailable", message: userMessage("too_many_points") });
      const { data: allowed } = await svc.rpc("route_usage_hit", { p_org: org, p_kind: "directions", p_n: 1, p_cap: cap("ORS_DIRECTIONS_DAILY_CAP", 1600) });
      if (!allowed) return json({ status: "cap", message: userMessage("cap") });
      try { const r = await prov.directions(day!.prefs.profile, dedup.map(roundLL)); return json({ status: "ok", line: r.line, distance_m: r.distanceM, duration_s: r.durationS, attribution: prov.attribution }); }
      catch (e) { const code = e instanceof ProviderError ? e.code : "unavailable"; console.error("route-planner:directions", code); return json({ status: "unavailable", message: userMessage(code as any) }); }
    }

    if (body.action === "apply") {
      const changes: { id: string; expected_start: string; new_start: string }[] = Array.isArray(body.changes) ? body.changes : [];
      if (!changes.length || changes.length > 30 || !changes.every((c) => UUID_RE.test(c?.id ?? "") && !Number.isNaN(Date.parse(c.expected_start)) && !Number.isNaN(Date.parse(c.new_start)))) return json({ error: "mudanças inválidas" }, 400);
      // Revalidação no servidor com o MESMO código da tela: o dia como ficaria precisa ter deslocamentos estimados e nenhum trecho NOVO inviável.
      const appts = toAppts(day!); const m = await getMatrix(svc, org, day!.prefs.profile, pointsOf(day!));
      const legs = legsFromMatrix(m.keys, m.durations);
      const beforePlan = planDay(appts, day!.start, legs, day!.prefs.buffer_min);
      const moved = appts.map((a) => { const c = changes.find((x) => x.id === a.id); return c ? { ...a, start: Date.parse(c.new_start), end: Date.parse(c.new_start) + (a.end - a.start) } : a; });
      const afterPlan = planDay(moved, day!.start, legs, day!.prefs.buffer_min);
      if (!afterPlan.totals.complete) return json({ error: "unverifiable", message: `${m.message ?? "Estimativa indisponível."} Não aplicamos uma mudança cujos deslocamentos não conseguimos validar. Nada foi alterado.` }, 409);
      const badBefore = new Set(beforePlan.stops.filter((s) => s.verdict === "infeasible").map((s) => s.appt.id));
      const newBad = afterPlan.stops.filter((s) => s.verdict === "infeasible" && !badBefore.has(s.appt.id));
      if (newBad.length) return json({ error: "infeasible", message: "A mudança deixaria um deslocamento inviável. Nada foi alterado.", count: newBad.length }, 409);
      const { data, error } = await db.rpc("route_apply", { p_professional: body.professional, p_date: body.date, p_changes: changes, p_note: typeof body.note === "string" ? body.note.slice(0, 300) : null });
      if (error) { const t = String(error.message ?? ""); const code = /ROTA_[A-Z]+/.exec(t)?.[0] ?? "erro"; return json({ error: code, message: t.replace(/^.*?ROTA_[A-Z]+:\s*/, "") }, error.code === "42501" ? 403 : 409); }
      return json({ ok: true, ...data });
    }
    return json({ error: "ação desconhecida" }, 400);
  } catch (e) {
    console.error("route-planner:erro", (e as Error)?.name ?? "erro");     // nunca a mensagem completa (poderia conter dados)
    return json({ error: "erro interno" }, 500);
  }
});
