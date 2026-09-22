import { expect, test } from "@playwright/test";
import { MANAGER, api, runId, signIn } from "./helpers";

// Concorrência REAL: requisições HTTP simultâneas chegam ao Postgres por conexões distintas do PostgREST.
// Setup em paralelo (menos round-trips sequenciais) para não estourar o timeout quando a suíte inteira já aqueceu o projeto Dev.
test.setTimeout(90_000);
test("N requisições simultâneas pelo mesmo horário: exatamente uma persiste, as demais recebem erro tratado", async () => {
  const s = await signIn(MANAGER); const g = api(s);
  const org = (await g.get("organizations?select=id")).body[0].id;
  const unit = (await g.get("units?select=id&slug=eq.sao-paulo")).body[0].id;
  const [svcRes, profRes] = await Promise.all([
    g.post("services", { org_id: org, name: `E2E Serviço ${runId}`, duration_min: 60 }),
    g.post("professionals", { org_id: org, display_name: `E2E Fisio ${runId}` }),
  ]);
  const svc = svcRes.body[0].id; const prof = profRes.body[0].id;
  await Promise.all([
    g.post("professional_units", { professional_id: prof, unit_id: unit }),
    g.post("availability_rules", Array.from({ length: 7 }, (_, w) => ({ org_id: org, professional_id: prof, unit_id: unit, weekday: w, start_time: "08:00", end_time: "18:00" }))),
  ]);
  const people = (await Promise.all(Array.from({ length: 6 }, (_, i) =>
    g.rpc("create_person", { p_full_name: `E2E Paciente ${runId} ${i}`, p_unit_id: unit, p_kinds: ["patient"], p_email: `e2e.${runId}.${i}@example.com`, p_phone: null, p_notes: null, p_force: true })
  ))).map((r) => r.body.id as string);
  const slot = new Date(Date.now() + 9 * 864e5); slot.setUTCHours(13, 0, 0, 0);                          // 10:00 em São Paulo
  const fire = (p: string) => g.rpc("book_appointment", { p_person: p, p_unit: unit, p_professional: prof, p_service: svc, p_start: slot.toISOString() });
  const res = await Promise.all(people.map(fire));
  const ok = res.filter((r) => r.status === 200); const fail = res.filter((r) => r.status !== 200);
  expect(ok, JSON.stringify(res)).toHaveLength(1);
  expect(fail).toHaveLength(people.length - 1);
  for (const f of fail) expect(f.body.code).toBe("P0409");                                              // erro tratado, sem 500 genérico
  const persisted = await g.get(`appointments?select=id,status&professional_id=eq.${prof}`);
  expect(persisted.body).toHaveLength(1);
  // sobreposição parcial também é recusada
  const late = new Date(slot.getTime() + 30 * 60_000);
  const overlap = await g.rpc("book_appointment", { p_person: people[5], p_unit: unit, p_professional: prof, p_service: svc, p_start: late.toISOString() });
  expect(overlap.body.code).toBe("P0409");
});
