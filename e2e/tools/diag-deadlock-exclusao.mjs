// Diagnóstico do 57014 do 04-agenda-concurrency — prova no PRÓPRIO banco (sem PostgREST, sem navegador, sem book_appointment):
// várias sessões inserem em public.appointments o MESMO profissional e o MESMO período (pessoas diferentes), em laços curtos, e contam quantas vezes o Postgres
// devolve 40P01 (deadlock_detected) e 23P01 (exclusion_violation). Duas variantes: "livre" (como book_appointment hoje) e "serial" (com pg_advisory_xact_lock por profissional).
// Cada tentativa é desfeita (subtransação com raise), nada fica gravado nas tabelas de agenda. Só Dev. Usa a Management API (um processo de banco por requisição).
// Uso: SUPABASE_ACCESS_TOKEN=... HP_QA_PASSWORD=... node e2e/tools/diag-deadlock-exclusao.mjs <arquivoSaida.json> [sessões=6] [segundos=20]
import { readFileSync, writeFileSync } from "node:fs";

const OUT = process.argv[2] ?? "diag-deadlock.json"; const SESS = Number(process.argv[3] ?? 6); const SECS = Number(process.argv[4] ?? 20);
const env = Object.fromEntries(readFileSync(new URL("../../.env.local", import.meta.url), "utf8").split(/\r?\n/).filter((l) => l && !l.startsWith("#")).map((l) => { const i = l.indexOf("="); return [l.slice(0, i), l.slice(i + 1).replace(/^"|"$/g, "")]; }));
const REF = new URL(env.VITE_SUPABASE_URL).hostname.split(".")[0];
if (REF !== "fsvtzowcwhvwtluwrhnb") throw new Error(`recusado: ${REF} não é o Dev`);
const sql = async (query) => { const r = await fetch(`https://api.supabase.com/v1/projects/${REF}/database/query`, { method: "POST", headers: { authorization: `Bearer ${process.env.SUPABASE_ACCESS_TOKEN}`, "content-type": "application/json" }, body: JSON.stringify({ query }) }); const t = await r.text(); let b; try { b = JSON.parse(t); } catch { b = t; } if (!r.ok) throw new Error(`${r.status} ${t.slice(0, 300)}`); return b; };
const TAG = `diag-dl-${Date.now().toString(36)}`;

// setup mínimo (committed, removido ao final): serviço, profissional, unidade existente, N pessoas
const [{ org, unit }] = await sql(`select (select id from public.organizations where slug = 'hp-group') org, (select id from public.units where slug = 'sao-paulo') unit`);
const [{ svc }] = await sql(`insert into public.services (org_id, name, duration_min) values ('${org}', '${TAG} serviço', 60) returning id svc`);
const [{ prof }] = await sql(`insert into public.professionals (org_id, display_name) values ('${org}', '${TAG} fisio') returning id prof`);
await sql(`insert into public.professional_units (professional_id, unit_id) values ('${prof}', '${unit}')`);
const persons = [];
for (let i = 0; i < SESS; i++) { const [{ id }] = await sql(`insert into public.people (org_id, full_name) values ('${org}', '${TAG} paciente ${i}') returning id`); persons.push(id); }

const body = (person, serial) => `
do $$
declare t_end timestamptz := clock_timestamp() + interval '${SECS} seconds'; slot tstzrange := tstzrange(now() + interval '20 days', now() + interval '20 days 1 hour');
  n_try int := 0; n_dead int := 0; n_excl int := 0; n_other int := 0; max_ms numeric := 0; t0 timestamptz; ms numeric; first_dead text;
begin
  while clock_timestamp() < t_end loop
    n_try := n_try + 1; t0 := clock_timestamp();
    begin
      ${serial ? `perform pg_advisory_xact_lock(hashtextextended('${prof}', 0));` : ""}
      insert into public.appointments (org_id, unit_id, professional_id, person_id, service_id, period) values ('${org}', '${unit}', '${prof}', '${person}', '${svc}', slot);
      perform pg_sleep(0.02);
      raise exception 'desfazer' using errcode = 'P0001';
    exception
      when deadlock_detected then n_dead := n_dead + 1; first_dead := coalesce(first_dead, left(sqlerrm, 200));
      when exclusion_violation then n_excl := n_excl + 1;
      when others then if sqlerrm <> 'desfazer' then n_other := n_other + 1; end if;
    end;
    ms := extract(epoch from clock_timestamp() - t0) * 1000; if ms > max_ms then max_ms := ms; end if;
  end loop;
  raise exception 'RES %', json_build_object('tentativas', n_try, 'deadlock_40P01', n_dead, 'exclusion_23P01', n_excl, 'outros', n_other, 'maior_tentativa_ms', round(max_ms), 'primeiro_deadlock', first_dead);
end $$;`;

const run = async (serial) => {
  const [{ d0 }] = await sql(`select deadlocks::bigint d0 from pg_stat_database where datname = current_database()`);
  const t0 = Date.now();
  const res = await Promise.all(persons.map((p) => sql(body(p, serial)).then(() => ({ erro: "sem RES" }), (e) => { const m = String(e.message).replace(/\\"/g, '"').replace(/\\n/g, " ").match(/RES (\{.*?\})\s*CONTEXT/); return m ? JSON.parse(m[1]) : { erro: String(e.message).slice(0, 300) }; })));
  const [{ d1 }] = await sql(`select deadlocks::bigint d1 from pg_stat_database where datname = current_database()`);
  return { variante: serial ? "serial (advisory lock por profissional)" : "livre (como book_appointment hoje)", sessoes: SESS, segundos: SECS, duracaoRealMs: Date.now() - t0, deadlocksNoBanco: Number(d1) - Number(d0), porSessao: res };
};

const out = [];
try { out.push(await run(false)); out.push(await run(true)); }
finally {
  await sql(`delete from public.appointments where professional_id = '${prof}'`);
  await sql(`delete from public.professional_units where professional_id = '${prof}'`);
  await sql(`delete from public.professionals where id = '${prof}'`);
  await sql(`delete from public.services where id = '${svc}'`);
  await sql(`delete from public.people where full_name like '${TAG}%'`).catch((e) => console.log("pessoas não removidas (vínculos de auditoria):", String(e.message).slice(0, 120)));
  writeFileSync(OUT, JSON.stringify(out, null, 1)); console.log(JSON.stringify(out.map((o) => ({ variante: o.variante, deadlocksNoBanco: o.deadlocksNoBanco, totais: o.porSessao.reduce((a, s) => ({ tentativas: a.tentativas + (s.tentativas ?? 0), d40P01: a.d40P01 + (s.deadlock_40P01 ?? 0), x23P01: a.x23P01 + (s.exclusion_23P01 ?? 0), outros: a.outros + (s.outros ?? 0), maxMs: Math.max(a.maxMs, s.maior_tentativa_ms ?? 0) }), { tentativas: 0, d40P01: 0, x23P01: 0, outros: 0, maxMs: 0 }), erros: o.porSessao.filter((s) => s.erro).map((s) => s.erro) })), null, 1));
}
