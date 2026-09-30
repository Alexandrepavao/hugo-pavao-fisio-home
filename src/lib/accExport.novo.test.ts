// NOVO (etapa ADM+Contábil, 2026-09-29) — testes unitários do pacote do contador. Não fazem parte da regressão anterior.
import { describe, expect, it } from "vitest";
import { docFileName, entriesCsv, manifestCsv, money, pendenciesCsv, readme, sha256Hex, summaryCsv, type ExportData, type ExportEntry } from "./accExport";

const entry = (o: Partial<ExportEntry>): ExportEntry => ({ basis: "competencia", date: "2026-05-10", competence_month: "2026-05-01", kind: "expense", description: "Aluguel", counterparty: "Imobiliária", amount_cents: -10000, status: "paid", category: "Aluguel", account_code: "D02", account_name: "Aluguel e ocupação", documents: 1, source_type: "payable", source_id: "x", ...o });
const data = (o: Partial<ExportData> = {}): ExportData => ({
  generated_at: "2026-09-29T12:00:00Z", provisional: false, period_status: "closed", organization: "HP Group", unit: { id: "u", name: "São Paulo", legal_name: "HP Fisio Ltda", cnpj: "11222333000181" },
  month: "2026-05-01", closed_at: "2026-06-05", closed_by: "Ana", close_note: null, close_seq: 2, names_visible: false,
  metrics: { entries_comp: 2, income_comp_cents: 30000, expense_comp_cents: 10000, entries_cash: 1, cash_in_cents: 30000, cash_out_cents: 0, unclassified: 0, missing_receipt: 0, documents: 1, changes_after_close: 0 },
  entries: [entry({}), entry({ basis: "caixa", description: "Recebimento", kind: "income", amount_cents: 30000, source_type: "payment", category: null, counterparty: "Paciente A1B2C3", account_code: null, account_name: null })], pendencies: [], documents: [], ...o,
});

describe("entriesCsv", () => {
  it("separa as bases: competência e caixa nunca no mesmo arquivo quando filtradas", () => {
    expect(entriesCsv(data(), "competencia").split("\n")).toHaveLength(2);
    expect(entriesCsv(data(), "caixa")).toContain("Recebimento");
    expect(entriesCsv(data(), "caixa")).not.toContain("Imobiliária");
    expect(entriesCsv(data(), null).split("\n")).toHaveLength(3);
  });
  it("valores em reais com vírgula, despesas negativas e sem neutralizar o sinal", () => {
    expect(money(-10000)).toBe("-100,00"); expect(money(5)).toBe("0,05");
    expect(entriesCsv(data(), "competencia")).toContain(";-100,00;");
  });
  it("neutraliza fórmulas em texto (=, +, -, @) mas não em números", () => {
    const csv = entriesCsv(data({ entries: [entry({ description: "=HYPERLINK(\"x\")", counterparty: "@fulano", amount_cents: -1 })] }), null);
    expect(csv).toContain("'=HYPERLINK"); expect(csv).toContain("'@fulano"); expect(csv).toContain(";-0,01;");
  });
  it("escapa aspas, ponto e vírgula e quebras de linha", () => {
    expect(entriesCsv(data({ entries: [entry({ description: 'Nota "A"; parte 1\nfim' })] }), null)).toContain('"Nota ""A""; parte 1\nfim"');
  });
});

describe("readme e resumo", () => {
  it("competência aberta é marcada como PROVISÓRIA em destaque", () => {
    expect(readme(data({ provisional: true, period_status: "open" }))).toMatch(/NÃO FECHADA — DADOS PROVISÓRIOS/);
    expect(summaryCsv(data({ provisional: true, period_status: "open" }))).toMatch(/PROVISÓRIOS/);
  });
  it("competência fechada informa quem fechou e a versão; sempre declara que não é escrituração oficial", () => {
    const r = readme(data()); expect(r).toMatch(/fechada por Ana/); expect(r).toMatch(/versão 2/);
    expect(r).toMatch(/Não é escrituração contábil ou fiscal oficial/); expect(r).toMatch(/não contém apuração de tributos/);
  });
  it("avisa da pseudonimização e lista documentos que falharam (nada some em silêncio)", () => {
    const r = readme(data(), [{ title: "Recibo.pdf", reason: "HTTP 404" }]);
    expect(r).toMatch(/pseudônimos/); expect(r).toMatch(/Recibo\.pdf: HTTP 404/);
    expect(readme(data({ names_visible: true }))).not.toMatch(/pseudônimos/);
  });
  it("resumo traz empresa/CNPJ da unidade e totais das duas bases", () => {
    const s = summaryCsv(data()); expect(s).toMatch(/HP Fisio Ltda — 11222333000181/); expect(s).toMatch(/Receitas por competência \(R\$\);300,00/); expect(s).toMatch(/Pago no mês — caixa \(R\$\);0,00/);
  });
});

describe("pendências, documentos e manifesto", () => {
  it("pendências exportam tipo legível e valor", () => {
    expect(pendenciesCsv(data({ pendencies: [{ type: "missing_receipt", description: "Aluguel", counterparty: "X", basis: "caixa", signed_cents: -10000, detail: "d" }] }))).toContain("Sem comprovante;Aluguel;X;Caixa;-100,00;d");
  });
  it("nome de arquivo do documento é seguro e ordenado", () => {
    expect(docFileName({ id: "1", kind: "comprovante", title: "Recibo do aluguel (maio)/../x.pdf", source_type: "payable", source_id: "a", mime: "application/pdf", uploaded_at: "" }, 0)).toBe("documentos/001-Recibo_do_aluguel_maio_.._x.pdf");
    expect(docFileName({ id: "2", kind: "outro", title: "Extrato", source_type: "period", source_id: null, mime: "application/pdf", uploaded_at: "" }, 11)).toBe("documentos/012-Extrato.pdf");
  });
  it("manifesto lista SHA-256 de cada arquivo e o hash é o SHA-256 real", async () => {
    expect(manifestCsv([{ name: "documentos/001-a.pdf", title: "A", kind: "comprovante", size: 3, sha256: "abc" }])).toContain("documentos/001-a.pdf;A;comprovante;3;abc");
    expect(await sha256Hex("abc")).toBe("ba7816bf8f01cfea414140de5dae2223b00361a396177a9cb410ff61f20015ad");
  });
});
