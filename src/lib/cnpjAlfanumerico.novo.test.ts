// NOVO — Prospecção B2B, Fase 0.5: CNPJ ALFANUMÉRICO (Receita, desde jul/2026). O mesmo algoritmo está em private.is_valid_cnpj (migration 150) e é conferido no SQL N26.
import { describe, expect, it } from "vitest";
import { fmtCnpj, isValidCnpj, onlyCnpj } from "./doc";

// dígitos verificadores calculados com o algoritmo oficial (valor = ASCII − 48; pesos 2..9 da direita; módulo 11), de forma independente do código sob teste
const dvOf = (base: string) => {
  const calc = (s: string) => { let sum = 0, w = 2; for (let i = s.length - 1; i >= 0; i--) { sum += (s.charCodeAt(i) - 48) * w; w = w === 9 ? 2 : w + 1; } const r = sum % 11; return r < 2 ? 0 : 11 - r; };
  const d1 = calc(base); return `${base}${d1}${calc(base + d1)}`;
};

describe("CNPJ alfanumérico", () => {
  it("exemplo publicado pela Receita (12.ABC.345/01DE-35) é válido, com ou sem máscara e em minúsculas", () => {
    expect(isValidCnpj("12ABC34501DE35")).toBe(true);
    expect(isValidCnpj("12.ABC.345/01DE-35")).toBe(true);
    expect(isValidCnpj("12.abc.345/01de-35")).toBe(true);
  });
  it("dígito verificador errado, tamanho errado e letra nos 2 últimos caracteres são recusados", () => {
    expect(isValidCnpj("12ABC34501DE36")).toBe(false);
    expect(isValidCnpj("12ABC34501DE3")).toBe(false);
    expect(isValidCnpj("12ABC34501DE355")).toBe(false);
    expect(isValidCnpj("12ABC34501DEA5")).toBe(false);
    expect(isValidCnpj("")).toBe(false);
  });
  it("CNPJ numérico antigo continua válido; repetidos e inválidos continuam recusados", () => {
    expect(isValidCnpj("11.222.333/0001-81")).toBe(true);
    expect(isValidCnpj("11222333000182")).toBe(false);
    expect(isValidCnpj("00000000000000")).toBe(false);
    expect(isValidCnpj("AAAAAAAAAAAA00")).toBe(false);
  });
  it("vários CNPJs alfanuméricos gerados pelo algoritmo oficial validam; trocar 1 caractere invalida", () => {
    for (const base of ["AB1CD2EF3GH4", "ZZ9YY8XX7WW6", "0A0B0C0D0E0F", "9Z8Y7X6W5V4U", "A1B2C3D4E5F6"]) {
      const ok = dvOf(base);
      expect(isValidCnpj(ok), ok).toBe(true);
      const bad = (ok[0] === "A" ? "B" : "A") + ok.slice(1);
      expect(isValidCnpj(bad), bad).toBe(false);
    }
  });
  it("normalização e máscara", () => {
    expect(onlyCnpj("12.abc.345/01de-35")).toBe("12ABC34501DE35");
    expect(fmtCnpj("12abc34501de35")).toBe("12.ABC.345/01DE-35");
    expect(fmtCnpj("11222333000181")).toBe("11.222.333/0001-81");
    expect(fmtCnpj("12ab")).toBe("12.AB");
  });
});
