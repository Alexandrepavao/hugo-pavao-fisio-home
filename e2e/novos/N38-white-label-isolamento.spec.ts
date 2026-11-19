import { test, expect } from "@playwright/test";
import { execFileSync } from "node:child_process";
import { mkdirSync, writeFileSync } from "node:fs";
import { ANON, SUPABASE_URL, signIn, runId, MANAGER, type Session } from "../helpers";
import { adminSession, call, get, haveHarness, mkUser, PLATFORM, pool, provision, readZip, sha256, sqlDev, type Prov } from "./helpers-wl";

// @novo — WHITE LABEL: prova de isolamento entre organizações pela API real (como um atacante/integração faria), módulos aplicados no servidor,
// usuário em duas organizações, exportação por organização e fila sintética com concorrência controlada. Só Dev.
const ALFA = { name: "Clínica Alfa", sub: "clinica-alfa", email: "alfa.admin@example.test", primary: "#0f766e", accent: "#f59e0b", modules: [] as string[] };
const BETA = { name: "Clínica Beta", sub: "clinica-beta", email: "beta.admin@example.test", primary: "#7c3aed", accent: "#e11d48", modules: ["rota_domiciliar"], units: ["Unidade Centro", "Unidade Sul"] };
const PHONE = "11999990000"; const SHARED_EMAIL = "mesmo.contato@example.test";

test.describe.serial("@novo White label — isolamento e plataforma", () => {
  test.skip(!haveHarness, "precisa de SUPABASE_ACCESS_TOKEN e HP_QA_PASSWORD");
  let plat: Session, alfa: Session, beta: Session, hp: Session; let pa: Prov, pb: Prov; const medicoes: Record<string, unknown> = { run: runId };

  test("plataforma ≠ gestor de clínica; só admin da plataforma enxerga o painel", async () => {
    plat = await signIn(PLATFORM); hp = await signIn(MANAGER);
    // reexecutável: desfaz o vínculo da conta da Alfa com a Beta criado por uma execução anterior (o teste de "duas organizações" o recria)
    await sqlDev(`with b as (select id from public.organizations where slug = 'clinica-beta'), u as (select id from auth.users where email = '${ALFA.email}')
      delete from public.role_assignments ra using b, u where ra.org_id = b.id and ra.user_id = u.id;
      delete from public.org_memberships m using public.organizations o, auth.users u where o.slug = 'clinica-beta' and m.org_id = o.id and u.email = '${ALFA.email}' and m.user_id = u.id;
      delete from public.invitations i using public.organizations o where o.slug = 'clinica-beta' and i.org_id = o.id and lower(i.email::text) = '${ALFA.email}';`);
    expect((await call(plat, "platform_whoami")).body.platform_admin).toBe(true);
    expect((await call(hp, "platform_whoami")).body.platform_admin).toBe(false);
    for (const fn of ["platform_orgs_list", "platform_catalog", "provisioning_list", "platform_audit_list"]) expect((await call(hp, fn)).status, `${fn} pelo gestor HP`).toBeGreaterThanOrEqual(400);
    expect((await call(null, "platform_orgs_list")).status).toBeGreaterThanOrEqual(400);
    // o administrador da plataforma NÃO herda acesso a dados de organização
    for (const t of ["people", "sales", "role_assignments", "units"]) { const r = await get(plat, `${t}?select=*&limit=3`); expect(r.status === 200 ? r.body.length : 0, `plataforma lendo ${t}`).toBe(0); }
  });

  test("provisiona Alfa e Beta pelo motor; administradores entram só na própria organização", async () => {
    pa = await provision(plat, ALFA, "q-e2e-clinica-alfa"); pb = await provision(plat, BETA, "q-e2e-clinica-beta");
    expect(["available", "available_with_pending"]).toContain(pa.status); expect(["available", "available_with_pending"]).toContain(pb.status);
    await mkUser(ALFA.email); await mkUser(BETA.email);   // equivale ao primeiro acesso: a confirmação do e-mail vincula o administrador à organização do convite
    alfa = await adminSession(ALFA.email); beta = await adminSession(BETA.email);
    const ma = (await call(alfa, "my_memberships")).body, mb = (await call(beta, "my_memberships")).body;
    expect(ma.memberships.map((m: { org_id: string }) => m.org_id)).toEqual([pa.org_id]); expect(mb.memberships.map((m: { org_id: string }) => m.org_id)).toEqual([pb.org_id]);
    expect(ma.platform_admin).toBe(false);
    const ctxA = (await call(alfa, "org_context")).body, ctxB = (await call(beta, "org_context")).body;
    expect(ctxA.brand.name).toBe("Clínica Alfa"); expect(ctxB.brand.name).toBe("Clínica Beta"); expect(ctxA.brand.color_primary).toBe("#0f766e"); expect(ctxB.brand.color_primary).toBe("#7c3aed");
    expect(ctxA.modules).not.toContain("rota_domiciliar"); expect(ctxB.modules).toContain("rota_domiciliar");
    const ua = await get(alfa, "units?select=name"), ub = await get(beta, "units?select=name&order=name");
    expect(ua.body.map((u: { name: string }) => u.name)).toEqual(["Sede"]); expect(ub.body.map((u: { name: string }) => u.name)).toEqual(["Unidade Centro", "Unidade Sul"]);
    expect((await get(alfa, "role_assignments?select=role&org_id=neq." + pa.org_id)).body).toEqual([]);
  });

  test("dados separados: mesmo telefone/e-mail em duas empresas = duas pessoas, sem fusão; HP não enxerga", async () => {
    const mk = async (s: Session, nome: string) => {
      const unit = (await get(s, "units?select=id&limit=1")).body[0].id; const ex = await get(s, `people?select=id&full_name=eq.${encodeURIComponent(nome)}`);
      if (ex.body.length) return ex.body[0].id as string;
      const r = await call(s, "create_person", { p_full_name: nome, p_unit_id: unit, p_kinds: ["patient"], p_email: SHARED_EMAIL, p_phone: PHONE, p_notes: "teste de isolamento" }); expect(r.status, JSON.stringify(r.body)).toBeLessThan(300); return (r.body.id ?? r.body) as string;
    };
    const ida = await mk(alfa, "Paciente Alfa Isolamento"), idb = await mk(beta, "Paciente Beta Isolamento"); expect(ida).not.toBe(idb);
    const la = await get(alfa, "people?select=id,full_name&full_name=ilike.*Isolamento*"), lb = await get(beta, "people?select=id,full_name&full_name=ilike.*Isolamento*");
    expect(la.body.map((p: { full_name: string }) => p.full_name)).toEqual(["Paciente Alfa Isolamento"]); expect(lb.body.map((p: { full_name: string }) => p.full_name)).toEqual(["Paciente Beta Isolamento"]);
    expect((await get(alfa, `people?select=id&id=eq.${idb}`)).body).toEqual([]); expect((await get(beta, `people?select=id&id=eq.${ida}`)).body).toEqual([]);
    expect((await get(hp, "people?select=id&full_name=ilike.*Isolamento*")).body).toEqual([]);
    expect((await get(plat, "people?select=id&full_name=ilike.*Isolamento*")).body ?? []).toEqual([]);
    // escrita cruzada: usar a unidade de OUTRA organização é recusado no banco (guarda de chave estrangeira entre organizações)
    const unitBeta = (await get(beta, "units?select=id&limit=1")).body[0].id;
    const cross = await call(alfa, "create_person", { p_full_name: "Invasão Alfa→Beta", p_unit_id: unitBeta, p_kinds: ["patient"], p_email: null, p_phone: null, p_notes: null });
    expect(cross.status).toBeGreaterThanOrEqual(400);
    expect((await get(beta, "people?select=id&full_name=ilike.*Invas*")).body).toEqual([]);
    // cabeçalho de organização forjado não dá acesso: o banco revalida o vínculo
    const forged = await get(alfa, "people?select=id&limit=1", pb.org_id); expect(forged.status).toBeGreaterThanOrEqual(400);
    expect(JSON.stringify(forged.body)).toMatch(/organiza/i);
    expect((await get(alfa, "people?select=id&limit=1", "não-é-uuid")).status).toBeGreaterThanOrEqual(400);
  });

  test("módulo desabilitado é bloqueado NO SERVIDOR e os dados são preservados", async () => {
    const blocked = (r: { status: number; body: unknown }) => r.status === 403 && /módulo desabilitado/i.test(JSON.stringify(r.body));
    const off = await get(alfa, "route_usage?select=*&limit=1"), on = await get(beta, "route_usage?select=*&limit=1");
    expect(blocked(off), "Alfa (módulo desligado): " + off.status).toBe(true);
    expect(blocked(on), "Beta (módulo ligado): " + on.status).toBe(false);      // a tabela é fechada (só por função), mas NÃO por causa do módulo
    expect(blocked(await get(alfa, "mkt_campaigns?select=*&limit=1")), "marketing desligado").toBe(true);
    // plataforma desliga o módulo de Beta: acesso cai, nada é apagado
    const d = await call(plat, "platform_module_set", { p_org: pb.org_id, p_module: "rota_domiciliar", p_enabled: false, p_reason: "e2e" }); expect(d.status).toBe(200); expect(d.body.data_preserved).toBe(true);
    expect(blocked(await get(beta, "route_usage?select=*&limit=1")), "Beta depois de desligar").toBe(true);
    expect((await call(beta, "org_context")).body.modules).not.toContain("rota_domiciliar");
    const e = await call(plat, "platform_module_set", { p_org: pb.org_id, p_module: "rota_domiciliar", p_enabled: true, p_reason: "e2e" }); expect(e.status).toBe(200);
    expect(blocked(await get(beta, "route_usage?select=*&limit=1")), "Beta depois de religar").toBe(false);
    // dependências e incompatibilidades são validadas
    const dep = await call(plat, "platform_module_set", { p_org: pa.org_id, p_module: "apresentacao_evidencias", p_enabled: false, p_reason: "e2e" }); expect([200, 400]).toContain(dep.status);
    const planned = await call(plat, "platform_module_set", { p_org: pa.org_id, p_module: "odontograma", p_enabled: true }); expect(planned.status).toBeGreaterThanOrEqual(400);
  });

  test("usuário em duas organizações: convite aceito sem duplicar conta; papel e dados por organização ativa", async () => {
    await sqlDev(`insert into public.invitations (org_id, email, role, invited_by) select '${pb.org_id}', '${ALFA.email}', 'ops_admin', null where not exists (select 1 from public.invitations where org_id = '${pb.org_id}' and lower(email::text) = '${ALFA.email}' and accepted_at is null) and not exists (select 1 from public.org_memberships m join auth.users u on u.id = m.user_id where m.org_id = '${pb.org_id}' and u.email = '${ALFA.email}')`);
    const pend = (await call(alfa, "my_pending_invitations")).body as { id: string; org_name: string }[];
    if (pend.length) { expect(pend[0].org_name).toBe("Clínica Beta"); expect((await call(alfa, "invitation_accept", { p_id: pend[0].id })).status).toBe(200); }
    const mem = (await call(alfa, "my_memberships")).body.memberships as { org_id: string }[]; expect(mem.map((m) => m.org_id).sort()).toEqual([pa.org_id, pb.org_id].sort());
    // sem cabeçalho: organização padrão (a primeira); com cabeçalho, a escolhida (revalidada)
    const inA = await get(alfa, "people?select=full_name&full_name=ilike.*Isolamento*", pa.org_id), inB = await get(alfa, "people?select=full_name&full_name=ilike.*Isolamento*", pb.org_id);
    expect(inA.body.map((p: { full_name: string }) => p.full_name)).toEqual(["Paciente Alfa Isolamento"]); expect(inB.body.map((p: { full_name: string }) => p.full_name)).toEqual(["Paciente Beta Isolamento"]);
    const roleA = (await get(alfa, `role_assignments?select=role&org_id=eq.${pa.org_id}`)).body.map((r: { role: string }) => r.role), roleB = (await get(alfa, `role_assignments?select=role&org_id=eq.${pb.org_id}`)).body.map((r: { role: string }) => r.role);
    expect(roleA).toContain("manager"); expect(roleB).toEqual(["ops_admin"]);
    // papel de uma organização não vale na outra: em Beta ele NÃO é gestor
    expect((await call(alfa, "org_export_request", {}, pb.org_id)).status).toBeGreaterThanOrEqual(400);
    expect((await call(alfa, "org_context", {}, pb.org_id)).body.org.id).toBe(pb.org_id);
    const users = (await sqlDev<{ n: number }[]>(`select count(*)::int n from auth.users where email = '${ALFA.email}'`))[0].n; expect(users).toBe(1);
  });

  test("exportação por organização: pacote consistente, sem dados de outras empresas, só o gestor baixa", async () => {
    const fn = (s: Session, body: unknown, org?: string) => fetch(`${SUPABASE_URL}/functions/v1/org-export`, { method: "POST", headers: { apikey: ANON, authorization: `Bearer ${s.access_token}`, "content-type": "application/json", ...(org ? { "x-org": org } : {}) }, body: JSON.stringify(body) });
    expect((await fn({ access_token: ANON } as Session, {})).status).toBeGreaterThanOrEqual(400);
    expect((await fn(hp, {}, pa.org_id)).status, "gestor da HP exportando Alfa").toBeGreaterThanOrEqual(400);
    const r = await fn(alfa, {}); const j = await r.json(); expect(r.status, JSON.stringify(j)).toBe(200); expect(j.status).toBe("ready"); expect(j.url).toContain("/storage/v1/");
    const zip = Buffer.from(await (await fetch(j.url)).arrayBuffer()); expect(sha256(zip)).toBe(j.sha256);
    const files = readZip(zip); const manifest = JSON.parse(files["manifest.json"].toString("utf8"));
    expect(manifest.org_id).toBe(pa.org_id); expect(manifest.tables).toBeGreaterThan(5); expect(Object.keys(files)).toEqual(expect.arrayContaining(["manifest.json", "files.json", "LEIA-ME.txt", "data/people.ndjson"]));
    for (const [name, hash] of Object.entries(manifest.sha256 as Record<string, string>)) expect(sha256(files[name]), name).toBe(hash);       // integridade
    const people = files["data/people.ndjson"].toString("utf8"); expect(people).toContain("Paciente Alfa Isolamento"); expect(people).not.toContain("Paciente Beta Isolamento");
    const everything = Object.entries(files).filter(([n]) => n.startsWith("data/")).map(([, b]) => b.toString("utf8")).join("\n");
    expect(everything).not.toContain(pb.org_id); expect(everything).not.toMatch(/encrypted_password|refresh_token|service_role|access_token/i);
    expect(manifest.excluded.length).toBeGreaterThan(0);
    // o gestor de Beta não baixa o pacote de Alfa
    const other = await fn(beta, { action: "download", export_id: j.id }); expect(other.status).toBe(404);
    const again = await fn(alfa, { action: "download", export_id: j.id }); expect(again.status).toBe(200); expect((await again.json()).url).toContain("token=");
    const log = (await sqlDev<{ n: number }[]>(`select count(*)::int n from public.platform_audit where org_id = '${pa.org_id}' and action like 'export%'`))[0].n; expect(log).toBeGreaterThan(0);
    medicoes.export = { tables: manifest.tables, rows: manifest.rows_total, zip_bytes: zip.length };
  });

  test("fila sintética (12 pedidos, 4 simultâneos): idempotência, sem duplicar, tempos medidos", async () => {
    const N = 12, C = 4; const seeds = Array.from({ length: N }, (_, i) => ({ name: `Fila ${runId} ${i + 1}`, sub: `fila-${runId}-${String(i + 1).padStart(2, "0")}`, email: `fila.${runId}.${i + 1}@example.test` }));
    const res: Prov[] = []; const t0 = Date.now();
    await pool(seeds, C, async (x, i) => { res[i] = await provision(plat, { ...x, units: ["Sede"] }, `q-fila-${x.sub}`); });
    const wall = Date.now() - t0;
    for (const p of res) expect(["available", "available_with_pending"]).toContain(p.status);
    expect(new Set(res.map((p) => p.org_id)).size).toBe(N);
    const reseed = await Promise.all(seeds.map((x) => provision(plat, x, `q-fila-${x.sub}`))); for (const p of reseed) expect(p.reused).toBe(true);   // repetir NÃO recria
    const cnt = (await sqlDev<{ o: number; u: number; r: number }[]>(`select (select count(*) from organizations where slug like 'fila-${runId}-%')::int o, (select count(*) from units u join organizations o on o.id = u.org_id where o.slug like 'fila-${runId}-%')::int u, (select count(*) from provisioning_requests where idempotency_key like 'q-fila-fila-${runId}-%')::int r`))[0];
    expect(cnt).toEqual({ o: N, u: N, r: N });
    const lat = res.map((p) => p.ms).sort((a, b) => a - b);
    const internal = (await sqlDev<{ ms: number }[]>(`select coalesce(sum(extract(epoch from (s.finished_at - s.started_at)) * 1000), 0)::int ms from provisioning_steps s join provisioning_requests r on r.id = s.request_id where r.idempotency_key like 'q-fila-fila-${runId}-%' group by r.id`)).map((x) => x.ms).sort((a, b) => a - b);
    medicoes.fila = { pedidos: N, concorrencia: C, total_ms: wall, por_pedido_ms: { min: lat[0], mediana: lat[Math.floor(N / 2)], max: lat[N - 1] }, interno_ms: { min: internal[0], mediana: internal[Math.floor(internal.length / 2)], max: internal[internal.length - 1] } };
    console.log("FILA", JSON.stringify(medicoes.fila));
    mkdirSync("test-results", { recursive: true }); writeFileSync("test-results/wl-medicoes.json", JSON.stringify(medicoes, null, 2));
    execFileSync("node", ["supabase/tools/wl-limpar-orgs-teste.mjs", "fila-"], { stdio: "pipe" });      // limpeza: as organizações sintéticas saem do Dev
    expect((await sqlDev<{ n: number }[]>(`select count(*)::int n from organizations where slug like 'fila-%'`))[0].n).toBe(0);
  });
});
