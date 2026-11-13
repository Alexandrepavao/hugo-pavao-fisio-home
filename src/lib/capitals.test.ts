import { describe, expect, it } from "vitest";
import { CAPITALS, ZONE_LABEL, capitalOf, cityKey, loadCityGeo, zoneLabel, zoneWithCity } from "./capitals";

describe("capitais com zonas liberadas", () => {
  it("a chave da cidade ignora acento, caixa e espaços (igual ao banco)", () => {
    expect(cityKey("São Paulo")).toBe("saopaulo"); expect(cityKey("  RIO  de Janeiro ")).toBe("riodejaneiro"); expect(cityKey("rio-de-janeiro")).toBe("riodejaneiro");
  });
  it("reconhece só capital liberada, com a UF certa", () => {
    expect(capitalOf("Rio de Janeiro", "RJ")?.name).toBe("Rio de Janeiro"); expect(capitalOf("sao paulo", "sp")?.key).toBe("saopaulo");
    expect(capitalOf("Niterói", "RJ")).toBeNull(); expect(capitalOf("Santo André", "SP")).toBeNull(); expect(capitalOf("Salvador", "BA")).toBeNull();
    expect(capitalOf("Rio de Janeiro", "SP")).toBeNull(); expect(capitalOf(null, "RJ")).toBeNull(); expect(capitalOf("Rio de Janeiro", "")).toBeNull();
  });
  it("ids de zona únicos entre as capitais (São Paulo mantém os antigos; as demais com prefixo)", () => {
    const ids = CAPITALS.flatMap((c) => c.zones.map((z) => z.id)); expect(new Set(ids).size).toBe(ids.length);
    expect(ids).toContain("sul"); expect(ids).toContain("rj-sul"); expect(zoneLabel("rj-oeste")).toBe("Zona Oeste"); expect(zoneLabel(null)).toBeNull(); expect(zoneLabel("zz")).toBe("zz");
  });
  it("lista que mistura cidades mostra o nome da zona com a cidade", () => { expect(zoneWithCity("rj-sul")).toBe("Zona Sul (Rio de Janeiro)"); expect(zoneWithCity("sul")).toBe("Zona Sul (São Paulo)"); expect(ZONE_LABEL.centro).toBe("Centro"); });
});

describe("dados do Rio de Janeiro (bairros e mapa)", () => {
  it("164 bairros, sem repetição, cada um numa zona do Rio; casos conhecidos", async () => {
    const rio = CAPITALS.find((c) => c.key === "riodejaneiro")!; const g = await loadCityGeo(rio); const ids = new Set(rio.zones.map((z) => z.id));
    expect(g.neighborhoods.length).toBe(164); expect(new Set(g.neighborhoods.map(([n]) => n.toLowerCase())).size).toBe(164); expect(g.neighborhoods.every(([, z]) => ids.has(z))).toBe(true);
    const zoneOf = (n: string) => g.neighborhoods.find(([x]) => x === n)?.[1];
    expect(zoneOf("Copacabana")).toBe("rj-sul"); expect(zoneOf("Ipanema")).toBe("rj-sul"); expect(zoneOf("Centro")).toBe("rj-centro"); expect(zoneOf("Tijuca")).toBe("rj-norte"); expect(zoneOf("Madureira")).toBe("rj-norte");
    expect(zoneOf("Barra da Tijuca")).toBe("rj-oeste"); expect(zoneOf("Santa Cruz")).toBe("rj-oeste"); expect(zoneOf("Campo Grande")).toBe("rj-oeste");
  });
  it("o mapa tem o desenho e o rótulo de cada zona, dentro da área de desenho", async () => {
    const rio = CAPITALS.find((c) => c.key === "riodejaneiro")!; const g = await loadCityGeo(rio);
    for (const z of rio.zones) { expect(g.map.paths[z.id]?.length).toBeGreaterThan(200); const [x, y] = g.map.labels[z.id]; expect(x).toBeGreaterThan(0); expect(x).toBeLessThan(g.map.w); expect(y).toBeGreaterThan(0); expect(y).toBeLessThan(g.map.h); }
    expect(g.credit).toContain("Data.Rio");
  });
  it("São Paulo segue sem lista de bairros (digitado) e com o mapa das 5 zonas", async () => {
    const sp = CAPITALS.find((c) => c.key === "saopaulo")!; const g = await loadCityGeo(sp);
    expect(sp.hasBairroList).toBe(false); expect(g.neighborhoods).toEqual([]); for (const z of sp.zones) expect(g.map.paths[z.id]).toBeTruthy();
  });
});

describe("Belo Horizonte (9 regionais, bairro digitado)", () => {
  const bh = CAPITALS.find((c) => c.key === "belohorizonte")!;
  it("reconhece BH (qualquer grafia, com a UF MG) e não reconhece Contagem nem UF trocada", () => {
    expect(capitalOf("belo  horizonte", "mg")?.name).toBe("Belo Horizonte"); expect(capitalOf("Contagem", "MG")).toBeNull(); expect(capitalOf("Belo Horizonte", "SP")).toBeNull(); expect(cityKey("Belo Horizonte")).toBe("belohorizonte");
  });
  it("9 regionais com ids prefixados, únicos entre as capitais, e nomes “Regional …”", () => {
    expect(bh.zones.map((z) => z.id)).toEqual(["bh-barreiro", "bh-centrosul", "bh-leste", "bh-nordeste", "bh-noroeste", "bh-norte", "bh-oeste", "bh-pampulha", "bh-vendanova"]);
    const ids = CAPITALS.flatMap((c) => c.zones.map((z) => z.id)); expect(new Set(ids).size).toBe(ids.length);
    expect(zoneLabel("bh-vendanova")).toBe("Regional Venda Nova"); expect(zoneWithCity("bh-norte")).toBe("Regional Norte (Belo Horizonte)");
  });
  it("sem lista de bairros (a base oficial não traz Savassi, Funcionários, Centro…): bairro digitado e regional escolhida", async () => {
    const g = await loadCityGeo(bh); expect(bh.hasBairroList).toBe(false); expect(g.neighborhoods).toEqual([]);
  });
  it("o mapa tem o desenho e o rótulo de cada regional, dentro da área de desenho", async () => {
    const g = await loadCityGeo(bh);
    for (const z of bh.zones) { expect(g.map.paths[z.id]?.length, z.id).toBeGreaterThan(300); const [x, y] = g.map.labels[z.id]; expect(x).toBeGreaterThan(0); expect(x).toBeLessThan(g.map.w); expect(y).toBeGreaterThan(0); expect(y).toBeLessThan(g.map.h); }
    expect(Object.keys(g.map.paths).sort()).toEqual(bh.zones.map((z) => z.id).sort()); expect(g.credit).toContain("Belo Horizonte");
  });
});
