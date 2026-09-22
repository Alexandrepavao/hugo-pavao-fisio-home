import { describe, expect, it } from "vitest";
import { parseCsv, validateImport } from "./csv";

describe("parseCsv", () => {
  it("lê separador ; com aspas e quebras de linha", () => {
    expect(parseCsv('nome;email\r\n"Silva; Ana";ana@x.com\n"Com ""aspas""";b@x.com')).toEqual([["nome", "email"], ["Silva; Ana", "ana@x.com"], ['Com "aspas"', "b@x.com"]]);
  });
  it("ignora BOM e linhas vazias", () => { expect(parseCsv("﻿nome,email\n\nA,a@x.com\n")).toEqual([["nome", "email"], ["A", "a@x.com"]]); });
});

describe("validateImport", () => {
  const csv = (s: string) => validateImport(parseCsv(s));
  it("valida e separa erros por linha sem descartar em silêncio", () => {
    const r = csv("nome,email,telefone,tipo\nAna Lima,ana@x.com,,paciente\nB,x,,\nCarlos Souza,,12,\nDora Reis,,(11) 98888-7777,aluno\nEva Costa,eva@x.com,,inexistente");
    expect(r.rows.map((x) => [x.name, x.kind])).toEqual([["Ana Lima", "patient"], ["Dora Reis", "student"]]);
    expect(r.issues.map((i) => i.line)).toEqual([3, 4, 6]);
  });
  it("exige a coluna nome e respeita o limite", () => {
    expect(csv("email\na@x.com").fatal).toMatch(/nome/);
    expect(validateImport([["nome", "email"], ...Array.from({ length: 501 }, (_, i) => [`P${i}`, `p${i}@x.com`])]).fatal).toMatch(/500/);
  });
});
