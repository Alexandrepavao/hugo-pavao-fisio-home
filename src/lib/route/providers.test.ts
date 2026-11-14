import { describe, expect, it, vi } from "vitest";
import { cacheKey, orsProvider, ProviderError, roundLL, userMessage } from "../../../supabase/functions/route-planner/providers";

// SIMULADO: nenhuma requisição real ao OpenRouteService. O `fetch` é um dublê; isto prova o contrato do adaptador, não a integração real.
const pts = [{ lat: -23.55612, lng: -46.65591 }, { lat: -23.6021, lng: -46.6659 }];
const res = (status: number, body: unknown = {}, headers: Record<string, string> = {}) => new Response(JSON.stringify(body), { status, headers });
const deps = (impl: (url: string, init: RequestInit) => Response | Promise<Response>) => ({ fetch: vi.fn(async (u: any, i: any) => impl(String(u), i)) as unknown as typeof fetch, sleep: vi.fn(async () => {}) });

describe("adaptador ORS (respostas simuladas)", () => {
  it("envia só coordenadas (lng,lat) e o perfil — nenhum identificador — e converte durações; nulo continua nulo", async () => {
    const d = deps((_u, init) => { const b = JSON.parse(String(init.body)); expect(Object.keys(b).sort()).toEqual(["locations", "metrics"]); expect(b.locations[0]).toEqual([-46.65591, -23.55612]); return res(200, { durations: [[0, 600.4], [null, 0]] }); });
    const m = await orsProvider("k", d).matrix("driving-car", pts);
    expect(m).toEqual([[0, 600], [null, 0]]);
    const init = (d.fetch as any).mock.calls[0][1]; expect(init.headers.Authorization).toBe("k");
    expect((d.fetch as any).mock.calls[0][0]).toBe("https://api.openrouteservice.org/v2/matrix/driving-car");
  });
  it("429: espera e tenta UMA vez; persistindo, vira rate_limited", async () => {
    const d = deps(() => res(429, {}, { "retry-after": "1" }));
    await expect(orsProvider("k", d).matrix("driving-car", pts)).rejects.toMatchObject({ code: "rate_limited" });
    expect(d.fetch).toHaveBeenCalledTimes(2); expect(d.sleep).toHaveBeenCalledTimes(1);
  });
  it("429 e depois sucesso: recupera", async () => {
    let n = 0; const d = deps(() => (n++ === 0 ? res(429) : res(200, { durations: [[0, 60], [60, 0]] })));
    expect(await orsProvider("k", d).matrix("foot-walking", pts)).toEqual([[0, 60], [60, 0]]);
  });
  it("401/403 não repete e vira unauthorized (sem vazar a chave)", async () => {
    const d = deps(() => res(403));
    const e = await orsProvider("SEGREDO-123", d).matrix("driving-car", pts).catch((x) => x) as ProviderError;
    expect(e).toBeInstanceOf(ProviderError); expect(e.code).toBe("unauthorized"); expect(d.fetch).toHaveBeenCalledTimes(1);
    expect(e.message).not.toContain("SEGREDO-123"); expect(e.message).not.toMatch(/-23\.5|-46\.6/);
  });
  it("5xx tenta de novo; falha de rede vira unavailable; formato inesperado vira unavailable", async () => {
    await expect(orsProvider("k", deps(() => res(503))).matrix("driving-car", pts)).rejects.toMatchObject({ code: "unavailable" });
    await expect(orsProvider("k", deps(() => { throw new Error("boom"); })).matrix("driving-car", pts)).rejects.toMatchObject({ code: "unavailable" });
    await expect(orsProvider("k", deps(() => res(200, { nada: 1 }))).matrix("driving-car", pts)).rejects.toMatchObject({ code: "unavailable" });
  });
  it("recusa perfil inválido e número de pontos fora do limite antes de gastar cota", async () => {
    const d = deps(() => res(200, {}));
    await expect(orsProvider("k", d).matrix("driving-hgv" as any, pts)).rejects.toMatchObject({ code: "bad_request" });
    await expect(orsProvider("k", d).matrix("driving-car", Array.from({ length: 26 }, () => pts[0]))).rejects.toMatchObject({ code: "bad_request" });
    await expect(orsProvider("k", d).matrix("driving-car", [pts[0]])).rejects.toMatchObject({ code: "bad_request" });
    expect(d.fetch).not.toHaveBeenCalled();
  });
  it("directions devolve a geometria do provedor (nunca uma linha reta inventada)", async () => {
    const d = deps(() => res(200, { features: [{ geometry: { coordinates: [[-46.65, -23.55], [-46.66, -23.6]] }, properties: { summary: { distance: 7123.6, duration: 910.2 } } }] }));
    expect(await orsProvider("k", d).directions("driving-car", pts)).toEqual({ line: [[-46.65, -23.55], [-46.66, -23.6]], distanceM: 7124, durationS: 910 });
  });
});

describe("privacidade e cache", () => {
  it("coordenadas são arredondadas a 3 casas (~110 m) no que é enviado e na chave de cache", () => {
    expect(roundLL({ lat: -23.55612, lng: -46.65591 })).toEqual({ lat: -23.556, lng: -46.656 });
    expect(cacheKey("driving-car", pts[0], pts[1])).toBe("driving-car|-23.556|-46.656|-23.602|-46.666");
    expect(cacheKey("foot-walking", pts[0], pts[1])).not.toBe(cacheKey("driving-car", pts[0], pts[1]));   // perfil faz parte da chave
  });
  it("mensagens ao usuário não expõem detalhe técnico e dizem 'Estimativa indisponível'", () => {
    for (const c of ["no_key", "cap", "rate_limited", "unauthorized", "timeout", "unavailable", "too_many_points"] as const) expect(userMessage(c)).toMatch(/^Estimativa indisponível/);
  });
});
