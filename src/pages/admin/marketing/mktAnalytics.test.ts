import { describe, expect, it } from "vitest";
import { MIN_VOLUME, bandGrid, bandLabel, bestSlot, biggestLoss, dropSteps, fmtDays, fmtMinutes, fmtRate, median, monthLabel, paybackOf, qualityCalc, rate, regionCalc, type QualityRow } from "./mktAnalytics";

const q = (o: Partial<QualityRow> & { campaign_id: string }): QualityRow => ({ name: o.campaign_id, platform: "meta", leads: 20, spend: 1000, attended: 5, sold: 2, revenue: 2000, ...o });

describe("tempo legível", () => {
  it("minutos, horas, dia e dias", () => {
    expect(fmtDays(0.002)).toBe("3 min"); expect(fmtDays(0.5)).toBe("12 h"); expect(fmtDays(1)).toBe("1 dia"); expect(fmtDays(3)).toBe("3 dias"); expect(fmtDays(2.5)).toBe("2,5 dias");
  });
  it("sem dado → “Sem base”, nunca zero", () => { expect(fmtDays(null)).toBe("Sem base"); expect(fmtMinutes(null)).toBe("Sem base"); expect(fmtMinutes(2880)).toBe("2 dias"); expect(fmtRate(null)).toBe("Sem base"); });
  it("taxa só com denominador positivo", () => { expect(rate(1, 4)).toBe(25); expect(rate(0, 5)).toBe(0); expect(rate(3, 0)).toBeNull(); });
  it("mediana de lista par, ímpar e vazia", () => { expect(median([3, 1, 2])).toBe(2); expect(median([1, 3, 3, 1])).toBe(2); expect(median([])).toBeNull(); });
});

describe("onde os leads se perdem", () => {
  const c = { leads: 100, contacted: 80, scheduled: 40, attended: 30, sold: 10 };
  it("cada etapa divide pela anterior e informa quantos ficaram pelo caminho", () => {
    const s = dropSteps(c); expect(s.map((x) => x.count)).toEqual([100, 80, 40, 30, 10]);
    expect(s[1]).toMatchObject({ fromPrev: 80, lost: 20, lostPct: 20 }); expect(s[2]).toMatchObject({ fromPrev: 50, lost: 40, lostPct: 50 }); expect(s[0].fromPrev).toBeNull();
  });
  it("maior perda = menor conversão etapa a etapa (aqui comparecimento → venda, 66,7%)", () => {
    const b = biggestLoss(dropSteps(c)); expect(b?.step.key).toBe("sold"); expect(b?.prevLabel).toBe("Comparecimento"); expect(Math.round(b?.step.lostPct ?? 0)).toBe(67);
  });
  it("volume pequeno não aponta gargalo", () => { expect(biggestLoss(dropSteps({ leads: 6, contacted: 4, scheduled: 3, attended: 1, sold: 1 }))).toBeNull(); });
  it("etapa maior que a anterior (dados fora de ordem) não gera perda negativa", () => { const s = dropSteps({ leads: 10, contacted: 4, scheduled: 5, attended: 2, sold: 1 }); expect(s[2].lost).toBe(0); expect(s[2].lostPct).toBe(0); });
  it("grupo vazio: sem taxas", () => { const s = dropSteps({ leads: 0, contacted: 0, scheduled: 0, attended: 0, sold: 0 }); expect(s.every((x) => x.fromPrev == null)).toBe(true); expect(biggestLoss(s)).toBeNull(); });
});

describe("qualidade por campanha", () => {
  it("custo por lead, custo por venda, conversão e retorno pelos totais da campanha", () => {
    const [r] = qualityCalc([q({ campaign_id: "a", leads: 20, spend: 1000, sold: 4, revenue: 4000 })]);
    expect(r.cpl).toBe(50); expect(r.cps).toBe(250); expect(r.conv).toBe(20); expect(r.roas).toBe(4);
  });
  it("sem gasto ou sem venda → nulo (sem base), não zero", () => {
    const [a, b] = qualityCalc([q({ campaign_id: "a", spend: null }), q({ campaign_id: "b", sold: 0, revenue: 0 })]);
    expect(a.cpl).toBeNull(); expect(a.roas).toBeNull(); expect(a.cps).toBeNull(); expect(b.cps).toBeNull(); expect(b.conv).toBe(0);
  });
  it("leitura compara com a mediana das campanhas: barata+converte, barata+fraca, cara+converte, cara+fraca", () => {
    const rows = qualityCalc([
      q({ campaign_id: "1", leads: 20, spend: 400, sold: 4 }),   // cpl 20, conv 20
      q({ campaign_id: "2", leads: 20, spend: 400, sold: 1 }),   // cpl 20, conv 5
      q({ campaign_id: "3", leads: 20, spend: 1600, sold: 4 }),  // cpl 80, conv 20
      q({ campaign_id: "4", leads: 20, spend: 1600, sold: 1 }),  // cpl 80, conv 5
    ]);
    expect(rows.map((r) => r.reading)).toEqual(["good", "cheap_weak", "costly_good", "costly_weak"]);
  });
  it("menos de 10 leads: “volume baixo”, e não entra na mediana", () => {
    const rows = qualityCalc([q({ campaign_id: "1", leads: MIN_VOLUME - 1 }), q({ campaign_id: "2" }), q({ campaign_id: "3", spend: 3000 })]);
    expect(rows[0].reading).toBe("low_volume"); expect(["good", "cheap_weak", "costly_good", "costly_weak"]).toContain(rows[1].reading);
  });
  it("uma campanha só (ou nenhuma comparável): sem leitura", () => { expect(qualityCalc([q({ campaign_id: "1" })])[0].reading).toBe("none"); expect(qualityCalc([q({ campaign_id: "1", spend: null }), q({ campaign_id: "2" })])[1].reading).toBe("none"); });
});

describe("dia da semana e horário", () => {
  const heat = [{ dow: 1, band: 2, n: 8 }, { dow: 1, band: 3, n: 3 }, { dow: 5, band: 5, n: 2 }];
  it("faixas de 4 horas, em ordem", () => { expect(bandLabel(0)).toBe("00–04h"); expect(bandLabel(2)).toBe("08–12h"); expect(bandLabel(5)).toBe("20–24h"); });
  it("matriz 7 × 6 com total e máximo", () => { const g = bandGrid(heat); expect(g.grid[1][2]).toBe(8); expect(g.grid[5][5]).toBe(2); expect(g.max).toBe(8); expect(g.total).toBe(13); expect(g.grid.length).toBe(7); });
  it("melhor faixa só com volume suficiente", () => {
    expect(bestSlot(heat)).toMatchObject({ dow: 1, band: 2, n: 8 }); expect(Math.round(bestSlot(heat)?.share ?? 0)).toBe(62);
    expect(bestSlot([{ dow: 1, band: 2, n: 4 }])).toBeNull(); expect(bestSlot([])).toBeNull();
  });
  it("dados fora da grade são ignorados", () => { expect(bandGrid([{ dow: 9, band: 1, n: 5 }, { dow: 1, band: 7, n: 5 }]).total).toBe(0); });
});

describe("retorno por mês de captação", () => {
  it("pago quando o recebido alcança o investido; aberto se não; sem base sem gasto", () => {
    expect(paybackOf(1000, 1000)).toBe("paid"); expect(paybackOf(1000, 999.99)).toBe("open"); expect(paybackOf(null, 500)).toBe("nobase"); expect(paybackOf(0, 500)).toBe("nobase"); expect(paybackOf(1000, undefined)).toBe("open");
  });
  it("rótulo do mês em português", () => { expect(monthLabel("2026-10-01")).toBe("Out/26"); expect(monthLabel("2026-01-01")).toBe("Jan/26"); });
});

describe("região", () => {
  it("conversão e agendamento sobre os leads da própria região", () => {
    const [r] = regionCalc([{ key: "zone:sul", kind: "zone", label: "Zona Sul", leads: 20, scheduled: 10, attended: 6, sold: 3, revenue: 3000 }]);
    expect(r.conv).toBe(15); expect(r.schedRate).toBe(50);
  });
});
