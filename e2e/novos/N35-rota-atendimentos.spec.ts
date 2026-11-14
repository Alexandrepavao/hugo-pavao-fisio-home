// NOVO — N35: "Rota de atendimentos" (Meu dia → Rota). Somente Dev.
// IMPORTANTE — SIMULADO × REAL: estes testes usam a fixture "Rota Teste" com tempos de deslocamento SIMULADOS gravados no cache (provider='simulado'; a tela avisa
// "Dados de teste") e o teto diário esgotado para forçar "Estimativa indisponível" — não gastam cota. A chamada REAL ao provedor é provada à parte (ver docs/mapas-e-rotas.md §10). Eles provam permissões, regras, interface e fluxo de aplicação — NÃO provam a integração real com o provedor.
//  · lista numerada com deslocamento/folga estimados, indicadores com base de cálculo, "Tempo estimado sem trânsito em tempo real."
//  · rota sugerida (heurística) mostra antes/depois e NÃO altera a agenda; aplicar exige confirmação e revalida no servidor; agenda mudou → recusa sem alterar nada
//  · sem estimativa → "Estimativa indisponível", nunca zero, sem sugerir; remoto sem deslocamento; permissões; celular sem rolagem lateral; sem erros de console
import { expect, test, type Page } from "@playwright/test";
import { join } from "node:path";
import { ANON, SUPABASE_URL } from "../helpers";
import { collectErrors, loginAs, QA } from "./helpers-novos";
import { devSql } from "../release/helpers-release";

test.use({ timezoneId: "America/Sao_Paulo", locale: "pt-BR", viewport: { width: 1440, height: 900 } });
const shot = async (p: Page, name: string, full = false) => { if (process.env.MKT_SHOTS) await p.screenshot({ path: join(process.env.MKT_SHOTS, `${name}.png`), fullPage: full }); };
const noOverflow = (p: Page) => p.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth + 1);

const ORG = "268b67d7-faa3-43c2-bb91-0616c78e10d0", UNIT = "9ace3ebd-352c-4832-b488-904f6a708e22", PROF = "3b6e077e-bee8-437b-b4fe-e3c413cdd457", SVC = "3c2ac8b8-8322-4e04-85a2-c832c38d475c";
const D1 = "2026-11-23", D2 = "2026-11-30";
const FIX = [["Rota Teste Carla", -23.5005, -46.6256, "exact", "09:00"], ["Rota Teste Bruno", -23.6021, -46.6659, "exact", "10:30"], ["Rota Teste Davi", -23.5402, -46.5767, "cep", "12:00"], ["Rota Teste Ana", -23.5667, -46.6917, "exact", "14:00"]] as const;

/** Recria a fixture de forma determinística (mesmos pacientes/locais; atendimentos do dia 23/11 e do dia 30/11). Dados de TESTE no Dev. */
async function reseed() {
  await devSql(`
    delete from public.appointments where professional_id = '${PROF}' and person_id in (select id from public.people where full_name like 'Rota Teste %');
    delete from public.route_apply_log where professional_id = '${PROF}';
    insert into public.route_places (org_id, owner_kind, owner_id, lat, lng, precision, source) values ('${ORG}', 'unit', '${UNIT}', -23.5614, -46.6559, 'exact', 'manual_pin') on conflict (owner_kind, owner_id) do nothing;
    do $$ declare r record; v_p uuid; begin
      for r in select * from (values ${FIX.map((f) => `('${f[0]}', ${f[1]}::float8, ${f[2]}::float8, '${f[3]}', '${f[4]}')`).join(",")}, ('Rota Teste Eva', -22.9056::float8, -47.0608::float8, 'exact', '15:00')) t(n, lat, lng, prec, hhmm) loop
        select id into v_p from public.people where org_id = '${ORG}' and full_name = r.n;
        if v_p is null then insert into public.people (org_id, unit_id, full_name) values ('${ORG}', '${UNIT}', r.n) returning id into v_p; end if;
        insert into public.route_places (org_id, owner_kind, owner_id, lat, lng, precision, source) values ('${ORG}', 'person', v_p, r.lat, r.lng, r.prec, case when r.prec = 'cep' then 'cep_approx' else 'manual_pin' end)
          on conflict (owner_kind, owner_id) do update set lat = excluded.lat, lng = excluded.lng, precision = excluded.precision, source = excluded.source;
        if r.n <> 'Rota Teste Eva' then
          insert into public.appointments (org_id, unit_id, professional_id, person_id, service_id, period, status, service_mode, visit_lat, visit_lng, visit_precision)
            values ('${ORG}', '${UNIT}', '${PROF}', v_p, '${SVC}', tstzrange(('${D1} ' || r.hhmm || '-03')::timestamptz, ('${D1} ' || r.hhmm || '-03')::timestamptz + interval '30 minutes'), 'scheduled', 'home_visit', r.lat, r.lng, r.prec);
        end if;
        if r.n in ('Rota Teste Eva', 'Rota Teste Carla') then   -- dia 30/11: Eva (Campinas) + Carla: pares SEM estimativa no cache (sem chave do provedor) + um remoto
          insert into public.appointments (org_id, unit_id, professional_id, person_id, service_id, period, status, service_mode, visit_lat, visit_lng, visit_precision)
            values ('${ORG}', '${UNIT}', '${PROF}', v_p, '${SVC}', tstzrange(('${D2} ' || case when r.n = 'Rota Teste Eva' then '11:00' else '09:00' end || '-03')::timestamptz, ('${D2} ' || case when r.n = 'Rota Teste Eva' then '11:00' else '09:00' end || '-03')::timestamptz + interval '30 minutes'), 'scheduled', 'home_visit', r.lat, r.lng, 'exact');
        end if;
      end loop;
      select id into v_p from public.people where org_id = '${ORG}' and full_name = 'Rota Teste Davi';
      insert into public.appointments (org_id, unit_id, professional_id, person_id, service_id, period, status, service_mode)
        values ('${ORG}', '${UNIT}', '${PROF}', v_p, '${SVC}', tstzrange('${D2} 10:00-03'::timestamptz, '${D2} 10:30-03'::timestamptz), 'scheduled', 'remote');
    end $$;`);

  await seedSimulatedLegs();
}

/** Mesmo com a chave real do provedor configurada no Dev, estes testes NÃO gastam cota nem dependem da rede: o cache recebe tempos SIMULADOS (provider='simulado')
 *  para os pontos da fixture e o teto diário é marcado como esgotado, o que força o caminho "Estimativa indisponível" nos pares sem cache (ex.: Campinas). */
const SIM_PTS: Record<string, [number, number]> = { sede: [-23.5614, -46.6559], carla: [-23.5005, -46.6256], bruno: [-23.6021, -46.6659], davi: [-23.5402, -46.5767], ana: [-23.5667, -46.6917] };
const hav = (a: number[], b: number[]) => { const r = (x: number) => (x * Math.PI) / 180, dl = r(b[0] - a[0]), dn = r(b[1] - a[1]); return 2 * 6371 * Math.asin(Math.sqrt(Math.sin(dl / 2) ** 2 + Math.cos(r(a[0])) * Math.cos(r(b[0])) * Math.sin(dn / 2) ** 2)); };
async function seedSimulatedLegs() {
  const key = (p: number[], q: number[]) => `driving-car|${p[0].toFixed(3)}|${p[1].toFixed(3)}|${q[0].toFixed(3)}|${q[1].toFixed(3)}`;
  const rows: string[] = [];
  for (const [an, a] of Object.entries(SIM_PTS)) for (const [bn, b] of Object.entries(SIM_PTS)) if (an !== bn) rows.push(`('${key(a, b)}','${ORG}','driving-car',${Math.round(((hav(a, b) * 1.35) / 24) * 3600 + 180)},null,'simulado',now(),now() + interval '30 days')`);
  await devSql(`delete from public.route_leg_cache where org_id = '${ORG}';
    insert into public.route_leg_cache (cache_key, org_id, profile, duration_s, distance_m, provider, fetched_at, expires_at) values ${rows.join(",")};
    insert into public.route_usage (org_id, day, kind, calls) values ('${ORG}', (now() at time zone 'America/Sao_Paulo')::date, 'matrix', 100000)
      on conflict (org_id, day, kind) do update set calls = 100000;`);
}
async function cleanSimulated() {
  await devSql(`delete from public.route_leg_cache where org_id = '${ORG}' and provider = 'simulado';
    delete from public.route_usage where org_id = '${ORG}' and kind = 'matrix' and calls >= 100000;`);
}
const state = async () => (await devSql(`select a.id, a.status, to_char(lower(a.period) at time zone 'America/Sao_Paulo', 'HH24:MI') hhmm, p.full_name n, a.service_mode m, (upper(a.period) - lower(a.period))::text dur from public.appointments a join public.people p on p.id = a.person_id
  where a.professional_id = '${PROF}' and p.full_name like 'Rota Teste %' and (lower(a.period) at time zone 'America/Sao_Paulo')::date = '${D1}' order by lower(a.period), a.status`)) as { id: string; status: string; hhmm: string; n: string; m: string; dur: string }[];

const openRota = async (p: Page, date: string) => {
  await p.goto("/fisio/dia"); await p.getByRole("tab", { name: "Rota" }).click(); await p.locator("#pd-date").fill(date);
  await expect(p.getByTestId("route-tab")).toBeVisible(); await expect(p.getByTestId("route-stop").first()).toBeVisible({ timeout: 20_000 });
};

test.describe.serial("@novos Rota de atendimentos", () => {
  test.setTimeout(240_000);
  test.beforeAll(async () => { await reseed(); });
  test.afterAll(async () => { await reseed(); await cleanSimulated(); });

  test("N35-1 lista numerada, deslocamento e folga estimados, indicadores com base, aviso de teste e de trânsito (desktop)", async ({ page, context }) => {
    await loginAs(context, "qa.fisio@hp-test.dev"); const errors = collectErrors(page);
    await openRota(page, D1);
    await expect(page.getByTestId("route-stop")).toHaveCount(4);
    await expect(page.getByTestId("route-simulated")).toContainText("SIMULADOS");
    await expect(page.getByTestId("kpi-travel")).toContainText("Tempo estimado sem trânsito em tempo real.");
    await expect(page.getByTestId("kpi-appts")).toContainText("4"); await expect(page.getByTestId("kpi-appts")).toContainText("4 domiciliar");
    await expect(page.getByTestId("kpi-unknown")).toContainText("0");
    await expect(page.getByTestId("route-leg").first()).toContainText("de deslocamento");
    await expect(page.getByTestId("route-stop").nth(2)).toContainText("Local aproximado (CEP)");
    await expect(page.locator(".rt-leg", { hasText: "estimativa aproximada" }).first()).toBeVisible();     // CEP = aproximado, nunca certeza
    await expect(page.getByTestId("route-nav").first()).toHaveAttribute("href", /google\.com\/maps\/dir\/\?api=1&destination=-?\d+\.\d+,-?\d+\.\d+&travelmode=driving/);
    expect(await page.getByTestId("route-nav").evaluateAll((els) => els.every((e) => !/waypoints|\|/.test((e as HTMLAnchorElement).href)))).toBe(true);   // link só de UM destino
    await expect(page.getByText(/rota ótima|melhor rota/i)).toHaveCount(0);
    await shot(page, "rota-desktop-dia", true);
    expect(errors.filter((e) => !/maplibre|tiles|openfreemap|CORS|net::/i.test(e))).toEqual([]);
  });

  test("N35-2 celular: sem rolagem lateral e alternância Lista/Mapa", async ({ page, context }) => {
    await page.setViewportSize({ width: 390, height: 844 });
    await loginAs(context, "qa.fisio@hp-test.dev"); await openRota(page, D1);
    expect(await noOverflow(page)).toBe(true);
    await expect(page.getByTestId("route-stop").first()).toBeVisible();
    await page.getByRole("button", { name: "Mapa", exact: true }).click(); await expect(page.getByTestId("route-map")).toBeVisible(); expect(await noOverflow(page)).toBe(true);
    await shot(page, "rota-celular-mapa");
    await page.getByRole("button", { name: "Lista", exact: true }).click(); await expect(page.getByTestId("route-stop").first()).toBeVisible();
    await shot(page, "rota-celular-lista");
  });

  test("N35-2b mapa (MapLibre + OpenFreeMap) carrega com pontos numerados e atribuição — desktop e celular", async ({ page, context }) => {
    await loginAs(context, "qa.fisio@hp-test.dev"); await openRota(page, D1);
    const map = page.getByTestId("route-map");
    await expect(map).toBeVisible({ timeout: 20_000 });
    await expect(map).toHaveAttribute("data-state", "ready", { timeout: 30_000 });                       // biblioteca carregada e mapa criado
    await expect(map.getByRole("img", { name: /^1\. / })).toBeVisible(); await expect(map.getByRole("img", { name: /^4\. / })).toBeVisible();   // pontos numerados na ordem do dia
    await expect(map.locator(".rt-attrib")).toContainText("OpenFreeMap");
    await page.waitForTimeout(4000);                                                                       // tiles chegam
    await shot(page, "rota-desktop-mapa", true);
    await page.setViewportSize({ width: 390, height: 844 }); await openRota(page, D1);
    await page.getByRole("button", { name: "Mapa", exact: true }).click();
    await expect(page.getByTestId("route-map")).toHaveAttribute("data-state", "ready", { timeout: 30_000 });
    expect(await noOverflow(page)).toBe(true); await page.waitForTimeout(4000);
    await shot(page, "rota-celular-mapa-real");
  });

  test("N35-3 simular mostra antes/depois e NÃO altera a agenda", async ({ page, context }) => {
    const before = JSON.stringify(await state());
    await loginAs(context, "qa.fisio@hp-test.dev"); await openRota(page, D1);
    await page.getByTestId("route-suggest").click();
    await expect(page.getByTestId("route-suggestion")).toBeVisible(); await expect(page.getByTestId("route-suggestion")).toContainText("heurística");
    await expect(page.getByTestId("route-suggestion-msg")).toContainText(/rota sugerida/i);
    await expect(page.getByTestId("route-diff")).toBeVisible(); await expect(page.getByTestId("route-diff").locator("tbody tr").first()).toBeVisible();
    await shot(page, "rota-desktop-sugestao");
    expect(JSON.stringify(await state())).toBe(before);                                       // simular nunca grava
    await page.reload(); await openRota(page, D1);
    expect(JSON.stringify(await state())).toBe(before);
  });

  test("N35-4 agenda mudou depois da simulação → aplicar recusa e NADA muda", async ({ page, context }) => {
    await loginAs(context, "qa.fisio@hp-test.dev"); await openRota(page, D1);
    await page.getByTestId("route-suggest").click(); await expect(page.getByTestId("route-apply")).toBeVisible();
    await devSql(`update public.appointments set period = tstzrange('${D1} 09:05-03'::timestamptz, '${D1} 09:35-03'::timestamptz) where professional_id = '${PROF}' and person_id = (select id from public.people where full_name = 'Rota Teste Carla') and status = 'scheduled' and lower(period) < '${D2} 00:00-03'::timestamptz`);
    const before = JSON.stringify(await state());
    await page.getByTestId("route-apply").click(); await page.getByRole("button", { name: "Aplicar na agenda", exact: true }).click();
    await expect(page.getByText(/A agenda mudou depois da simulação/)).toBeVisible({ timeout: 20_000 });
    expect(JSON.stringify(await state())).toBe(before);
    await reseed();
  });

  test("N35-5 aplicar: confirmação, MESMO atendimento muda de horário (mesmos ids), duração preservada, formato/local mantidos, registro", async ({ page, context }) => {
    await loginAs(context, "qa.fisio@hp-test.dev"); await openRota(page, D1);
    const idsBefore = (await state()).map((r) => r.id).sort();
    await page.getByTestId("route-suggest").click(); await expect(page.getByTestId("route-apply")).toBeVisible();
    await page.getByTestId("route-apply").click();
    await expect(page.getByRole("button", { name: "Aplicar na agenda", exact: true })).toBeVisible();      // diálogo de confirmação
    await page.getByRole("button", { name: "Cancelar" }).click();
    expect((await state()).every((r) => r.status === "scheduled")).toBe(true);                                    // cancelar = nada muda
    await page.getByTestId("route-apply").click(); await page.getByRole("button", { name: "Aplicar na agenda", exact: true }).click();
    await expect(page.getByText(/Rota aplicada: \d+ atendimento/)).toBeVisible({ timeout: 30_000 });
    const rows = await state();
    const active = rows.filter((r) => r.status === "scheduled");
    expect(active).toHaveLength(4); expect(rows.filter((r) => r.status === "rescheduled")).toHaveLength(0);       // move o próprio atendimento: nada de "remarcado" nem atendimento novo
    expect(rows.map((r) => r.id).sort()).toEqual(idsBefore);                                                       // os MESMOS atendimentos (mesmos ids)
    expect(active.every((r) => r.dur === "00:30:00" && r.m === "home_visit")).toBe(true);                       // nada encurtado; formato mantido
    expect(active.map((r) => r.hhmm).sort()).toEqual(["09:00", "10:30", "12:00", "14:00"]);                      // os horários do dia não mudam: só quem os ocupa
    const log = (await devSql(`select count(*)::int c from public.route_apply_log where professional_id = '${PROF}'`)) as { c: number }[]; expect(log[0].c).toBe(1);
    const inh = (await devSql(`select count(*)::int c from public.appointments a join public.people p on p.id = a.person_id where a.professional_id = '${PROF}' and p.full_name like 'Rota Teste %' and a.status = 'scheduled' and a.visit_lat is not null`)) as { c: number }[]; expect(inh[0].c).toBeGreaterThanOrEqual(4);     // o local de cada atendimento segue com ele
    await shot(page, "rota-desktop-apos-aplicar");
    await reseed();
  });

  test("N35-6 sem estimativa: 'Estimativa indisponível', nunca zero, sem sugerir; remoto sem deslocamento", async ({ page, context }) => {
    await loginAs(context, "qa.fisio@hp-test.dev"); await openRota(page, D2);
    await expect(page.getByTestId("route-unavailable")).toContainText("Estimativa indisponível");
    await expect(page.getByTestId("route-suggest")).toBeDisabled();                                       // limite diário esgotado: não oferece sugerir (e nada é sugerido sem estimativa)
    await expect(page.getByTestId("route-suggestion-msg")).toHaveCount(0);
    await expect(page.getByTestId("route-apply")).toHaveCount(0);
    await expect(page.locator(".rt-leg", { hasText: "Estimativa indisponível" }).first()).toBeVisible();
    await expect(page.locator(".rt-leg", { hasText: "Sem deslocamento (atendimento remoto)" })).toHaveCount(1);
    await expect(page.getByTestId("kpi-travel")).toContainText(/Estimativa indisponível|PARCIAL/);
    await expect(page.getByTestId("kpi-unknown")).not.toContainText(/^0$/);
    await shot(page, "rota-desktop-indisponivel", true);
  });

  test("N35-7 preferências e ponto de partida opcional (sem exigir endereço residencial)", async ({ page, context }) => {
    await loginAs(context, "qa.fisio@hp-test.dev"); await openRota(page, D1);
    await page.getByTestId("route-prefs").locator("summary").click();
    await expect(page.getByText(/Não é preciso informar endereço residencial/)).toBeVisible();
    await page.locator("#rp-start").selectOption("own_point"); await page.getByRole("button", { name: "Salvar preferências" }).click(); await expect(page.getByText("Preferências salvas.")).toBeVisible();
    const pe = page.getByTestId("place-professional"); await expect(pe).toBeVisible(); await expect(pe.getByTestId("place-status")).toContainText("Localização não definida");
    await pe.getByLabel(/Coordenadas/).fill("-23.5700, -46.6500"); await pe.getByRole("button", { name: "Salvar local" }).click();
    await expect(pe.getByTestId("place-status")).toContainText("Exata", { timeout: 15_000 });
    await shot(page, "rota-desktop-preferencias");
    await pe.getByRole("button", { name: "Remover local" }).click(); await expect(pe.getByTestId("place-status")).toContainText("Localização não definida");
    await page.locator("#rp-start").selectOption("unit"); await page.getByRole("button", { name: "Salvar preferências" }).click(); await expect(page.getByText("Preferências salvas.")).toBeVisible();
    await expect(pe).toHaveCount(0);
  });

  test("N35-8 permissões: só quem pode ver a agenda recebe a rota; anônimo e sem relação não", async ({ context }) => {
    const call = async (email: string | null, body: object) => {
      const tok = email ? (await (async () => { const { signIn } = await import("../helpers"); return signIn(email); })()).access_token : ANON;
      const r = await fetch(`${SUPABASE_URL}/functions/v1/route-planner`, { method: "POST", headers: { apikey: ANON, authorization: `Bearer ${tok}`, "content-type": "application/json" }, body: JSON.stringify(body) });
      return { status: r.status, text: await r.text() };
    };
    const body = { action: "day", professional: PROF, date: D1 };
    expect((await call("qa.fisio@hp-test.dev", body)).status).toBe(200);
    expect((await call(QA.manager, body)).status).toBe(200);
    for (const who of [QA.comercial, QA.aluno, QA.financeiro]) { const r = await call(who, body); expect([401, 403], `${who}: ${r.text.slice(0, 120)}`).toContain(r.status); expect(r.text).not.toMatch(/Rota Teste|lat|lng/); }
    expect([401, 403]).toContain((await call(null, body)).status);
    expect((await call("qa.fisio@hp-test.dev", { action: "day", professional: PROF, date: "2026-13-99" })).status).toBe(400);
    expect((await call("qa.fisio@hp-test.dev", { action: "apply", professional: PROF, date: D1, changes: [] })).status).toBe(400);
    void context;
  });

  const pickAna = async (page: Page) => {
    await page.goto("/admin/agenda"); await page.locator('input[type="date"]:visible').first().fill(D1);
    await page.locator("#ap").selectOption({ label: "Fisio E2E munf2sq5" }); await page.locator("#as").selectOption({ index: 1 });
    await page.locator("#apn").fill("Rota Teste Ana"); await page.getByRole("button", { name: "Rota Teste Ana" }).first().click(); await page.locator("#amode").selectOption("home_visit");
  };

  test("N35-9 Agenda: melhor encaixe ordena por acréscimo de deslocamento, explica a razão e NÃO agenda nem move nada", async ({ page, context }) => {
    await loginAs(context, QA.manager); const before = JSON.stringify(await state());
    await pickAna(page);
    await page.getByTestId("bestfit-run").click(); await expect(page.getByTestId("bestfit-list")).toBeVisible({ timeout: 40_000 });
    const rows = page.getByTestId("bestfit-row"); expect(await rows.count()).toBeGreaterThan(0);
    await expect(rows.first()).toContainText(/deslocamento/); await expect(rows.first()).toContainText("tempo simulado");
    const extras = (await rows.allInnerTexts()).map((t) => /\+(\d+) min/.exec(t)?.[1] ?? (/Sem acréscimo/.test(t) ? "0" : "9999")).map(Number);
    expect([...extras].sort((a, b) => a - b)).toEqual(extras);
    await shot(page, "rota-agenda-melhor-encaixe", true);
    await page.getByTestId("bestfit-pick").first().click(); await expect(page.locator("#ash")).not.toHaveValue("");
    expect(JSON.stringify(await state())).toBe(before);
  });

  test("N35-10 Agenda: agendar como domiciliar grava o formato e COPIA o local atual do paciente (snapshot)", async ({ page, context }) => {
    await loginAs(context, QA.manager); await pickAna(page);
    await page.getByTestId("bestfit-run").click(); await expect(page.getByTestId("bestfit-list")).toBeVisible({ timeout: 40_000 });
    await page.getByTestId("bestfit-pick").first().click(); await page.getByRole("button", { name: "Agendar", exact: true }).click();
    await expect(page.getByText(/Agendamento criado\./)).toBeVisible({ timeout: 20_000 });
    const r = (await devSql(`select a.service_mode m, a.visit_lat::text lat, a.id from public.appointments a join public.people p on p.id = a.person_id where a.professional_id = '${PROF}' and p.full_name = 'Rota Teste Ana' and a.status = 'scheduled' order by a.created_at desc limit 1`)) as { m: string; lat: string; id: string }[];
    expect(r[0].m).toBe("home_visit"); expect(r[0].lat).toBe("-23.5667");
    await devSql(`delete from public.appointments where id = '${r[0].id}'`);
  });

  test("N35-11 cadastro: gestão marca o local do paciente; atendimentos já marcados MANTÊM o local de quando foram marcados", async ({ page, context }) => {
    await loginAs(context, QA.manager);
    await page.goto("/admin/adm/diretorio"); await page.locator("#dir-q").fill("Rota Teste Ana"); await page.getByRole("button", { name: "Rota Teste Ana" }).first().click();
    const pe = page.getByTestId("place-person"); await expect(pe).toBeVisible({ timeout: 15_000 }); await expect(pe.getByTestId("place-status")).toContainText("Exata");
    await expect(pe).toContainText("O endereço acima NÃO é enviado a nenhum serviço de mapas");
    await pe.getByLabel(/Coordenadas/).fill("-23.6100, -46.7000"); await pe.getByRole("button", { name: "Salvar local" }).click();
    await expect(pe.getByText(/Atendimentos já marcados mantêm o local/)).toBeVisible({ timeout: 15_000 });
    await shot(page, "rota-cadastro-local-paciente");
    const r = (await devSql(`select (select lat::text from public.route_places where owner_kind = 'person' and owner_id = p.id) place_lat, (select a.visit_lat::text from public.appointments a where a.person_id = p.id and a.status = 'scheduled' and a.professional_id = '${PROF}' order by lower(a.period) limit 1) appt_lat from public.people p where p.full_name = 'Rota Teste Ana'`)) as { place_lat: string; appt_lat: string }[];
    expect(r[0].place_lat).toBe("-23.61"); expect(r[0].appt_lat).toBe("-23.5667");            // o cadastro mudou; o atendimento marcado NÃO
    await reseed();
  });
});
