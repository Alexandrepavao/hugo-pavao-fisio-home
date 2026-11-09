import { describe, expect, it } from "vitest";
import { delta, fmtKpi, money, num, type Kpi } from "./mktApi";

const k = (o: Partial<Kpi>): Kpi => ({ key: "x", label: "X", value: 1, unit: "n", available: true, formula: "f", source: "s", granularity: "g", ...o });
describe("formatação dos indicadores", () => {
  it("indisponível mostra “Não disponível”, nunca zero", () => {
    expect(fmtKpi(k({ available: false, value: null, reason: "sem denominador" }))).toBe("Não disponível");
    expect(fmtKpi(k({ available: true, value: 0 }))).toBe("0");                       // zero real é zero; ausência é outra coisa
  });
  it("formata moeda, percentual, razão e minutos", () => {
    expect(fmtKpi(k({ key: "spend", unit: "BRL", value: 1234.5 }))).toMatch(/R\$\s?1\.235/);
    expect(fmtKpi(k({ unit: "%", value: 12.345 }))).toBe("12,35%"); expect(fmtKpi(k({ unit: "x", value: 2 }))).toBe("2x"); expect(fmtKpi(k({ unit: "min", value: 20 }))).toBe("20 min");
    expect(money(null)).toBe("—"); expect(num(undefined)).toBe("—");
  });
  it("comparação com o período anterior só existe com os dois valores e denominador não nulo", () => {
    expect(delta(k({ value: 150 }), k({ value: 100 }))).toMatchObject({ dir: "up", text: expect.stringContaining("+50") });
    expect(delta(k({ value: 50 }), k({ value: 100 }))?.dir).toBe("down");
    expect(delta(k({ value: 5 }), k({ value: 0 }))).toBeNull(); expect(delta(k({ available: false, value: null }), k({ value: 10 }))).toBeNull(); expect(delta(undefined, undefined)).toBeNull();
  });
});
