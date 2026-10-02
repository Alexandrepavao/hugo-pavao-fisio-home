// Diagnóstico do teste e2e/04-agenda-concurrency.spec.ts (às vezes as requisições perdedoras recebem 57014 — statement timeout — em vez de P0409).
// Repete o MESMO cenário do teste (6 pessoas disputando o mesmo horário do mesmo profissional) N vezes, registra o resultado e a latência de cada requisição e,
// em paralelo, amostra o pg_stat_activity do Dev (consultas ativas, esperas e travas). Só Dev; os dados criados são removidos ao final.
// Uso: HP_QA_PASSWORD=... SUPABASE_ACCESS_TOKEN=... node e2e/tools/diag-concorrencia-agenda.mjs <iterações> <arquivoSaida.json> [concorrência=6]
import { readFileSync, writeFileSync } from "node:fs";

const N = Number(process.argv[2] ?? 20); const OUT = process.argv[3] ?? "diag-04.json"; const CONC = Number(process.argv[4] ?? 6);
const env = Object.fromEntries(readFileSync(new URL("../../.env.local", import.meta.url), "utf8").split(/\r?\n/).filter((l) => l && !l.startsWith("#")).map((l) => { const i = l.indexOf("="); return [l.slice(0, i), l.slice(i + 1).replace(/^"|"$/g, "")]; }));
const URL_ = env.VITE_SUPABASE_URL; const KEY = env.VITE_SUPABASE_PUBLISHABLE_KEY; const REF = new globalThis.URL(URL_).hostname.split(".")[0];
if (REF !== "fsvtzowcwhvwtluwrhnb") throw new Error(`recusado: ${REF} não é o Dev`);
const TAG = `diag04-${Date.now().toString(36)}`;
const sql = async (query) => { const r = await fetch(`https://api.supabase.com/v1/projects/${REF}/database/query`, { method: "POST", headers: { authorization: `Bearer ${process.env.SUPABASE_ACCESS_TOKEN}`, "content-type": "application/json" }, body: JSON.stringify({ query }) }); const t = await r.json(); if (!r.ok) throw new Error(JSON.stringify(t)); return t; };
const login = async () => { const r = await fetch(`${URL_}/auth/v1/token?grant_type=password`, { method: "POST", headers: { apikey: KEY, "content-type": "application/json" }, body: JSON.stringify({ email: "qa.manager@hp-test.dev", password: process.env.HP_QA_PASSWORD }) }); const s = await r.json(); if (!s.access_token) throw new Error("login falhou"); return s; };
const s = await login();
const H = { apikey: KEY, authorization: `Bearer ${s.access_token}`, "content-type": "application/json", prefer: "return=representation" };
const timed = async (fn) => { const t0 = performance.now(); const r = await fn(); return { ms: Math.round(performance.now() - t0), ...r }; };
const rpc = (name, body) => timed(async () => { const r = await fetch(`${URL_}/rest/v1/rpc/${name}`, { method: "POST", headers: H, body: JSON.stringify(body) }); const t = await r.text(); let b; try { b = JSON.parse(t); } catch { b = t; } return { status: r.status, body: b }; });
const post = (path, body) => timed(async () => { const r = await fetch(`${URL_}/rest/v1/${path}`, { method: "POST", headers: H, body: JSON.stringify(body) }); const t = await r.text(); let b; try { b = JSON.parse(t); } catch { b = t; } return { status: r.status, body: b }; });

const org = (await (await fetch(`${URL_}/rest/v1/organizations?select=id`, { headers: H })).json())[0].id;
const unit = (await (await fetch(`${URL_}/rest/v1/units?select=id&slug=eq.sao-paulo`, { headers: H })).json())[0].id;

// amostrador de atividade do banco (consultas ativas, esperas, travas) — guarda só o que está esperando há mais de 1 s ou travado
const samples = []; let sampling = true; let iterNow = -1;
const sampler = (async () => {
  while (sampling) {
    try {
      const rows = await sql(`select pid, state, wait_event_type, wait_event, pg_blocking_pids(pid) blocked_by, backend_xid::text xid, round(extract(epoch from now() - query_start)::numeric, 2) age_s, round(extract(epoch from now() - xact_start)::numeric, 2) xact_s, left(regexp_replace(query, '\\s+', ' ', 'g'), 140) q
        from pg_stat_activity where datname = current_database() and pid <> pg_backend_pid() and state <> 'idle' and (wait_event_type = 'Lock' or now() - query_start > interval '1 second' or now() - xact_start > interval '1 second')`);
      if (rows.length) samples.push({ iter: iterNow, at: new Date().toISOString(), rows });
    } catch (e) { samples.push({ iter: iterNow, at: new Date().toISOString(), error: String(e).slice(0, 200) }); }
    await new Promise((r) => setTimeout(r, 300));
  }
})();

const counters = async () => (await sql(`select deadlocks, xact_commit, xact_rollback, conflicts from pg_stat_database where datname = current_database()`))[0];
const before = await counters();
const results = [];
try {
  for (let i = 0; i < N; i++) {
    iterNow = i; const t0 = performance.now();
    const [svcRes, profRes] = await Promise.all([post("services", { org_id: org, name: `${TAG} serviço ${i}`, duration_min: 60 }), post("professionals", { org_id: org, display_name: `${TAG} fisio ${i}` })]);
    const svc = svcRes.body[0].id; const prof = profRes.body[0].id;
    await Promise.all([post("professional_units", { professional_id: prof, unit_id: unit }), post("availability_rules", Array.from({ length: 7 }, (_, w) => ({ org_id: org, professional_id: prof, unit_id: unit, weekday: w, start_time: "08:00", end_time: "18:00" })))]);
    const people = (await Promise.all(Array.from({ length: CONC }, (_, k) => rpc("create_person", { p_full_name: `${TAG} paciente ${i}-${k}`, p_unit_id: unit, p_kinds: ["patient"], p_email: `${TAG}.${i}.${k}@example.com`, p_phone: null, p_notes: null, p_force: true })))).map((r) => r.body.id);
    const setupMs = Math.round(performance.now() - t0);
    const slot = new Date(Date.now() + 9 * 864e5); slot.setUTCHours(13, 0, 0, 0);
    const tFire = performance.now();
    const res = await Promise.all(people.map((p) => rpc("book_appointment", { p_person: p, p_unit: unit, p_professional: prof, p_service: svc, p_start: slot.toISOString() })));
    const fireMs = Math.round(performance.now() - tFire);
    results.push({ iter: i, setupMs, fireMs, winners: res.filter((r) => r.status === 200).length, requests: res.map((r) => ({ status: r.status, ms: r.ms, code: r.status === 200 ? null : r.body?.code ?? null, message: r.status === 200 ? null : String(r.body?.message ?? "").slice(0, 90) })) });
  }
} finally {
  sampling = false; await sampler; const after = await counters();
  const bad = results.filter((r) => r.requests.some((q) => q.status !== 200 && q.code !== "P0409") || r.winners !== 1);
  const all = results.flatMap((r) => r.requests); const lat = all.map((q) => q.ms).sort((a, b) => a - b);
  const summary = { tag: TAG, startedWith: { iterations: N, concurrency: CONC }, iterationsWithUnexpected: bad.map((b) => b.iter), unexpectedCodes: [...new Set(all.filter((q) => q.status !== 200 && q.code !== "P0409").map((q) => q.code))], fireMs: { p50: results.map((r) => r.fireMs).sort((a, b) => a - b)[Math.floor(results.length / 2)], max: Math.max(...results.map((r) => r.fireMs)) }, requestMs: { p50: lat[Math.floor(lat.length / 2)], p95: lat[Math.floor(lat.length * 0.95)], max: lat[lat.length - 1] }, lockSamples: samples.filter((x) => x.rows).length, deadlocksDelta: Number(after.deadlocks) - Number(before.deadlocks), rollbackDelta: Number(after.xact_rollback) - Number(before.xact_rollback), commitDelta: Number(after.xact_commit) - Number(before.xact_commit) };
  writeFileSync(OUT, JSON.stringify({ summary, results, samples }, null, 1));
  console.log(JSON.stringify(summary, null, 1));
  // limpeza dos dados do diagnóstico (Dev)
  await sql(`delete from public.appointments where professional_id in (select id from public.professionals where display_name like '${TAG}%')`);
  await sql(`delete from public.availability_rules where professional_id in (select id from public.professionals where display_name like '${TAG}%')`);
  await sql(`delete from public.professional_units where professional_id in (select id from public.professionals where display_name like '${TAG}%')`);
  await sql(`delete from public.professionals where display_name like '${TAG}%'`);
  await sql(`delete from public.services where name like '${TAG}%'`);
  console.log("dados do diagnóstico removidos (pessoas ficam: têm vínculos de auditoria)");
}
