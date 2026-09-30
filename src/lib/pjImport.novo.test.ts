// NOVO (etapa ADM+Contábil, 2026-09-29) — testes unitários da importação de PJ. Não fazem parte da regressão anterior.
import { describe, expect, it } from "vitest";
import { parseCsv, parseCsvWithLines } from "./csv";
import { applyMapping, autoMap, duplicateMapped, missingRequired, normHeader, PJ_FIELDS, templateCsv } from "./pjImport";

describe("autoMap", () => {
  it("mapeia cabeçalhos com acento, caixa e pontuação", () => {
    const m = autoMap(["CNPJ", "Razão Social", "Nome Fantasia", "E-mail", "Telefone", "Município", "Estado", "CEP", "Regime Tributário"]);
    expect(m).toMatchObject({ cnpj: 0, legal_name: 1, trade_name: 2, email_general: 3, phone: 4, city: 5, state_uf: 6, cep: 7, tax_regime: 8 });
  });
  it("usa 'nome' genérico como razão social só se não houver coluna melhor, sem reusar coluna", () => {
    expect(autoMap(["cnpj", "nome"]).legal_name).toBe(1);
    const m = autoMap(["cnpj", "razao social", "nome"]);
    expect(m.legal_name).toBe(1); expect(m.trade_name).toBeNull();
  });
  it("deixa como não mapeado o que não reconhece e aponta obrigatórios ausentes", () => {
    const m = autoMap(["coluna estranha", "outra"]);
    expect(missingRequired(m)).toEqual(["CNPJ", "Razão social"]);
    expect(Object.values(m).every((v) => v === null)).toBe(true);
  });
});

describe("applyMapping", () => {
  const matrix = parseCsvWithLines("Razão social;CNPJ;Cidade\nAlfa Ltda;11.222.333/0001-81;Santos\n;;\nBeta SA;45.723.174/0001-10;");
  it("aplica o mapeamento manual, preserva o número da linha do arquivo e descarta linhas vazias", () => {
    const rows = applyMapping(matrix, { ...autoMap(matrix[0].cells) });
    expect(rows).toHaveLength(2);
    expect(rows[0]).toMatchObject({ line: 2, cnpj: "11.222.333/0001-81", legal_name: "Alfa Ltda", city: "Santos", phone: "" });
    expect(rows[1]).toMatchObject({ line: 4, legal_name: "Beta SA", city: "" });
  });
  it("respeita remapeamento (trocar quais colunas alimentam cada campo)", () => {
    const rows = applyMapping(matrix, { ...autoMap(matrix[0].cells), cnpj: 0, legal_name: 1 });
    expect(rows[0]).toMatchObject({ cnpj: "Alfa Ltda", legal_name: "11.222.333/0001-81" });
  });
  it("campo não mapeado vai vazio (nunca apaga dado existente: o servidor ignora vazios)", () => {
    const rows = applyMapping(matrix, { ...autoMap(matrix[0].cells), city: null });
    expect(rows[0].city).toBe("");
  });
});

describe("mapeamento duplicado e modelo", () => {
  it("detecta a mesma coluna usada por dois campos", () => {
    expect(duplicateMapped({ ...autoMap(["cnpj", "razao social"]), trade_name: 1 })).toEqual(["Razão social e Nome fantasia"]);
  });
  it("o modelo reconhece a si mesmo (todas as colunas mapeiam sozinhas) e tem exemplo com CNPJ inválido", () => {
    const [head, example] = parseCsv(templateCsv());
    const m = autoMap(head);
    expect(PJ_FIELDS.every((f) => m[f.key] !== null)).toBe(true);
    expect(example[0]).toBe("00.000.000/0000-00");
  });
  it("normHeader remove acentos e símbolos", () => { expect(normHeader("  Inscrição  Estadual (IE) ")).toBe("inscricao estadual ie"); });
});
