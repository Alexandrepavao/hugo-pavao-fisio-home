/** Importação CSV de pessoas jurídicas (ADM): mapeamento de colunas e modelo. A validação e a decisão final
 *  (duplicidade por CNPJ, sobrescrita) são SEMPRE do servidor (legal_entity_import_check/commit) — aqui só se
 *  prepara o arquivo. */
export interface PjField { key: string; label: string; required?: boolean; synonyms: string[] }

export const PJ_FIELDS: PjField[] = [
  { key: "cnpj", label: "CNPJ", required: true, synonyms: ["cnpj", "cnpj cpf", "documento", "cadastro nacional"] },
  { key: "legal_name", label: "Razão social", required: true, synonyms: ["razao social", "razao", "empresa", "nome empresarial", "nome da empresa", "nome"] },
  { key: "trade_name", label: "Nome fantasia", synonyms: ["nome fantasia", "fantasia", "nome comercial"] },
  { key: "email_general", label: "E-mail", synonyms: ["email", "e mail", "email geral", "correio eletronico"] },
  { key: "phone", label: "Telefone", synonyms: ["telefone", "fone", "celular", "whatsapp", "contato telefonico"] },
  { key: "city", label: "Cidade", synonyms: ["cidade", "municipio"] },
  { key: "state_uf", label: "UF", synonyms: ["uf", "estado"] },
  { key: "cep", label: "CEP", synonyms: ["cep", "codigo postal"] },
  { key: "tax_regime", label: "Regime tributário", synonyms: ["regime tributario", "regime", "tributacao"] },
  { key: "state_registration", label: "Inscrição estadual", synonyms: ["inscricao estadual", "ie", "insc estadual"] },
  { key: "municipal_registration", label: "Inscrição municipal", synonyms: ["inscricao municipal", "im", "insc municipal"] },
  { key: "cnae_main", label: "CNAE principal", synonyms: ["cnae", "cnae principal", "atividade principal"] },
];

export type PjMapping = Record<string, number | null>;   // campo → índice da coluna no arquivo (null = não importar)

export const normHeader = (h: string) =>
  h.normalize("NFD").replace(/[̀-ͯ]/g, "").toLowerCase().replace(/[^a-z0-9]+/g, " ").trim();

/** Sugere o mapeamento pelo cabeçalho. Cada coluna do arquivo é usada no máximo uma vez; "nome" genérico só
 *  vale para razão social se não houver coluna melhor. */
export function autoMap(headers: string[]): PjMapping {
  const norm = headers.map(normHeader); const used = new Set<number>(); const out: PjMapping = {};
  for (const f of PJ_FIELDS) out[f.key] = null;
  // 1ª passada: correspondência exata; 2ª: sinônimo em ordem de prioridade (o último sinônimo é o mais genérico)
  for (const f of PJ_FIELDS) {
    for (const syn of f.synonyms) {
      const i = norm.findIndex((h, ix) => h === syn && !used.has(ix));
      if (i >= 0) { out[f.key] = i; used.add(i); break; }
    }
  }
  return out;
}

export interface PjRowInput { line: number; [k: string]: string | number }

/** Aplica o mapeamento às linhas do CSV (a primeira é o cabeçalho). `line` é a linha física do arquivo. Linhas
 *  totalmente vazias são descartadas. */
export function applyMapping(records: { cells: string[]; line: number }[], mapping: PjMapping): PjRowInput[] {
  const rows: PjRowInput[] = [];
  records.slice(1).forEach(({ cells, line }) => {
    const r: PjRowInput = { line };
    for (const f of PJ_FIELDS) { const ci = mapping[f.key]; r[f.key] = ci == null ? "" : (cells[ci] ?? "").trim(); }
    if (PJ_FIELDS.some((f) => r[f.key] !== "")) rows.push(r);
  });
  return rows;
}

export const missingRequired = (mapping: PjMapping): string[] =>
  PJ_FIELDS.filter((f) => f.required && mapping[f.key] == null).map((f) => f.label);

/** Um mesmo índice de coluna mapeado para dois campos confunde o usuário: devolve os rótulos em conflito. */
export function duplicateMapped(mapping: PjMapping): string[] {
  const seen = new Map<number, string>(); const dup: string[] = [];
  for (const f of PJ_FIELDS) { const ci = mapping[f.key]; if (ci == null) continue; if (seen.has(ci)) dup.push(`${seen.get(ci)} e ${f.label}`); else seen.set(ci, f.label); }
  return dup;
}

/** Modelo para download. A linha de exemplo usa um CNPJ propositalmente inválido: se alguém esquecer de apagá-la,
 *  ela cai no relatório de erros em vez de virar cadastro. */
export function templateCsv(): string {
  const head = PJ_FIELDS.map((f) => f.label);
  const example = ["00.000.000/0000-00", "Empresa Exemplo Ltda (APAGUE ESTA LINHA)", "Exemplo", "contato@exemplo.com.br", "(11) 3000-0000", "São Paulo", "SP", "01000-000", "Simples Nacional", "", "", "8650001"];
  return [head.join(";"), example.join(";")].join("\n");
}

export type PjOutcome = "created" | "updated" | "unchanged" | "skipped" | "invalid";
export const OUTCOME_LABEL: Record<PjOutcome, string> = { created: "Criada", updated: "Atualizada", unchanged: "Sem alteração", skipped: "Ignorada", invalid: "Erro" };
