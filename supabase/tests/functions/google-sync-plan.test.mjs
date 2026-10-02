// Teste do planejamento HP → Google (supabase/functions/google-calendar/sync-plan.ts): criação, remarcação, cancelamento, sem duplicar, sem dado clínico.
// Roda sem rede e sem banco:  node supabase/tests/functions/google-sync-plan.test.mjs
import { build } from "esbuild";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { pathToFileURL } from "node:url";

const dir = mkdtempSync(join(tmpdir(), "hp-sync-")); const out = join(dir, "plan.mjs");
await build({ entryPoints: ["supabase/functions/google-calendar/sync-plan.ts"], bundle: true, format: "esm", platform: "neutral", outfile: out, logLevel: "silent" });
const P = await import(pathToFileURL(out).href); rmSync(dir, { recursive: true, force: true });

const rep = []; const chk = (ok, msg) => rep.push(`[${ok ? "OK" : "FALHA"}] ${msg}`);
const A = "11111111-2222-3333-4444-555555555555", B = "aaaaaaaa-bbbb-cccc-dddd-eeeeeeeeeeee", C = "99999999-8888-7777-6666-555555555555";
const base = (id, over = {}) => ({ id, period: "[2026-10-05 13:00:00+00,2026-10-05 13:50:00+00)", status: "scheduled", updated_at: "2026-10-01T10:00:00Z",
  person: { full_name: "Maria Aparecida da Silva" }, service: { name: "Fisioterapia ortopédica" }, unit: { name: "Unidade Centro" }, notes: "NOTA-CLINICA-SIGILOSA", cancel_reason: "MOTIVO-SIGILOSO", ...over });

// ---- criação
let plan = P.planAppointments([base(A)], [], "minimal");
chk(plan.length === 1 && plan[0].type === "upsert" && plan[0].create === true, "atendimento novo sem vínculo → criar evento (POST)");
chk(plan[0].eventId === "hp" + A.replace(/-/g, "") && plan[0].body.id === plan[0].eventId, "id do evento é determinístico por atendimento (não dá para criar dois)");
chk(P.eventIdFor(A) === P.eventIdFor(A) && P.eventIdFor(A) !== P.eventIdFor(B), "mesmo atendimento → mesmo id; atendimentos diferentes → ids diferentes");
chk(plan[0].body.start.dateTime === "2026-10-05T13:00:00.000Z" && plan[0].body.end.dateTime === "2026-10-05T13:50:00.000Z" && plan[0].body.start.timeZone === "UTC", "horário enviado em UTC (o Google mostra no fuso de cada usuário)");
// ---- privacidade
const txt = JSON.stringify(plan[0].body);
chk(plan[0].body.summary === "Atendimento HP" && plan[0].body.location === "Unidade Centro", "conteúdo mínimo: “Atendimento HP” + unidade");
chk(!/Maria|Silva|Aparecida|ortop|NOTA-CLINICA|MOTIVO-SIGILOSO/i.test(txt), "no modo mínimo nada de paciente, serviço, nota ou motivo vai para o Google");
const nm = P.planAppointments([base(A)], [], "names")[0].body;
chk(nm.summary === "Atendimento: Maria — Fisioterapia ortopédica" && !/Silva|Aparecida|NOTA-CLINICA|MOTIVO-SIGILOSO/.test(JSON.stringify(nm)), "só com a escolha do usuário (“names”): primeiro nome + serviço; nunca sobrenome, nota ou motivo");
chk(!("notes" in plan[0].body) && !("attendees" in plan[0].body) && plan[0].body.extendedProperties.private.hp_id === A, "sem participantes nem notas; só a marca interna hp_id para reconhecer o evento do HP");
// ---- nada mudou
plan = P.planAppointments([base(A)], [{ local_id: A, google_event_id: P.eventIdFor(A), local_version: P.versionOf("2026-10-01T10:00:00Z") }], "minimal");
chk(plan.length === 0, "nada mudou desde o último envio → nenhuma chamada ao Google (sem duplicar, sem custo)");
// ---- remarcação do mesmo atendimento (horário muda, updated_at muda)
plan = P.planAppointments([base(A, { period: "[2026-10-06 15:00:00+00,2026-10-06 15:50:00+00)", updated_at: "2026-10-02T09:30:00Z" })], [{ local_id: A, google_event_id: P.eventIdFor(A), local_version: P.versionOf("2026-10-01T10:00:00Z") }], "minimal");
chk(plan.length === 1 && plan[0].type === "upsert" && plan[0].create === false && plan[0].body.start.dateTime === "2026-10-06T15:00:00.000Z", "remarcação: atualiza o MESMO evento (PUT), com o novo horário");
// ---- remarcação que cria outro atendimento: o antigo sai (status 'rescheduled') e o novo entra, sem duplicar
plan = P.planAppointments([base(A, { status: "rescheduled" }), base(B, { period: "[2026-10-07 14:00:00+00,2026-10-07 14:50:00+00)" })], [{ local_id: A, google_event_id: P.eventIdFor(A), local_version: 1 }], "minimal");
chk(plan.length === 2 && plan.some((x) => x.type === "delete" && x.localId === A) && plan.some((x) => x.type === "upsert" && x.localId === B && x.create), "atendimento remarcado para outro horário: o antigo é removido e o novo criado — um evento só por atendimento ativo");
// ---- cancelamentos e ausências removem; sem vínculo não há o que remover
for (const st of ["cancelled_by_patient", "cancelled_by_clinic", "rescheduled", "professional_no_show", "no_show"]) {
  const r = P.planAppointments([base(A, { status: st })], [{ local_id: A, google_event_id: P.eventIdFor(A), local_version: 1 }], "minimal");
  chk(r.length === 1 && r[0].type === "delete", `status ${st} com evento no Google → remover`);
}
chk(P.planAppointments([base(A, { status: "cancelled_by_patient" })], [], "minimal").length === 0, "cancelado que nunca foi enviado → nada a fazer");
chk(P.planAppointments([base(A, { status: "attended" })], [], "minimal").length === 1 && P.planAppointments([base(A, { status: "confirmed" })], [], "minimal").length === 1, "agendado, confirmado e realizado aparecem no calendário");
// ---- duplicidade na lista
plan = P.planAppointments([base(A), base(A), base(B)], [], "minimal");
chk(plan.length === 2, "o mesmo atendimento repetido na lista gera uma ação só");
// ---- formatos de período do Postgres
for (const [p, s, e] of [["[2026-10-05 13:00:00+00,2026-10-05 13:50:00+00)", "2026-10-05T13:00:00.000Z", "2026-10-05T13:50:00.000Z"], ['["2026-10-05 10:00:00-03","2026-10-05 10:50:00-03")', "2026-10-05T13:00:00.000Z", "2026-10-05T13:50:00.000Z"], ["[2026-10-05 13:00:00.5+00,2026-10-05 13:50:00+00)", "2026-10-05T13:00:00.500Z", "2026-10-05T13:50:00.000Z"]]) {
  const [x, y] = P.parsePeriod(p); chk(x === s && y === e, `período “${p.slice(0, 32)}…” lido corretamente (fuso e fração de segundo)`);
}
console.log(rep.join("\n")); process.exit(rep.some((l) => l.startsWith("[FALHA]")) ? 1 : 0);
