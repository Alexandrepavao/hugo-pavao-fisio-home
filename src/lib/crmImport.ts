import { parseCsvWithLines } from "@/lib/csv";

/** Campos que a importação do CRM entende. `name` e (e-mail ou telefone) são obrigatórios; o resto tem padrão no lote ou é opcional. */
export const CRM_FIELDS = [
  { key: "name", label: "Nome", required: true, aliases: ["nome", "nome completo", "name", "cliente", "lead", "contato"] },
  { key: "email", label: "E-mail", aliases: ["email", "e-mail", "e mail", "mail"] },
  { key: "phone", label: "Telefone / WhatsApp", aliases: ["telefone", "celular", "whatsapp", "fone", "phone", "tel", "contato telefonico"] },
  { key: "source", label: "Origem", aliases: ["origem", "source", "canal", "fonte"] },
  { key: "campaign", label: "Campanha", aliases: ["campanha", "campaign", "utm campaign", "utm_campaign"] },
  { key: "unit", label: "Unidade", aliases: ["unidade", "unit", "clinica", "filial"] },
  { key: "owner", label: "Responsável (e-mail)", aliases: ["responsavel", "responsavel email", "email responsavel", "owner", "vendedor", "atendente"] },
  { key: "list", label: "Lista", aliases: ["lista", "list", "segmento"] },
  { key: "stage", label: "Etapa inicial", aliases: ["etapa", "etapa inicial", "stage", "fase", "status"] },
  { key: "value", label: "Valor (R$)", aliases: ["valor", "value", "ticket", "valor estimado"] },
  { key: "title", label: "Título da oportunidade", aliases: ["titulo", "título", "title", "oportunidade", "interesse", "produto"] },
] as const;
export type CrmFieldKey = (typeof CRM_FIELDS)[number]["key"];
export type CrmMapping = Partial<Record<CrmFieldKey, number>>;   // campo → índice da coluna do arquivo

export const norm = (s: string) => s.normalize("NFD").replace(/[̀-ͯ]/g, "").replace(/[_-]+/g, " ").toLowerCase().trim();

/** Sugere o mapeamento pelo nome do cabeçalho (o usuário confere e ajusta na tela). Cada coluna do arquivo é usada no máximo uma vez. */
export const autoMap = (headers: string[]): CrmMapping => {
  const used = new Set<number>(); const map: CrmMapping = {};
  for (const f of CRM_FIELDS) {
    const i = headers.findIndex((h, ix) => !used.has(ix) && (f.aliases as readonly string[]).includes(norm(h)));
    if (i >= 0) { map[f.key] = i; used.add(i); }
  }
  return map;
};

export interface ParsedCsv { headers: string[]; lines: number[]; cells: string[][] }
/** Lê o arquivo: 1ª linha = cabeçalho. Mantém a linha física de cada registro para o relatório de erros apontar a linha real. */
export const readCsv = (text: string, max = 500): { data?: ParsedCsv; fatal?: string } => {
  const recs = parseCsvWithLines(text);
  if (recs.length < 2) return { fatal: "O arquivo precisa ter um cabeçalho e ao menos uma linha de dados." };
  if (recs.length - 1 > max) return { fatal: `Limite de ${max} linhas por importação (o arquivo tem ${recs.length - 1}). Divida o arquivo.` };
  return { data: { headers: recs[0].cells.map((h) => h.trim()), lines: recs.slice(1).map((r) => r.line), cells: recs.slice(1).map((r) => r.cells) } };
};

/** Aplica o mapeamento e devolve as linhas no formato que o servidor valida (cada valor como texto, sem interpretar nada aqui). */
export const buildRows = (d: ParsedCsv, map: CrmMapping): Record<string, string>[] =>
  d.cells.map((cells) => { const r: Record<string, string> = {}; for (const f of CRM_FIELDS) { const ix = map[f.key]; if (ix !== undefined) r[f.key] = (cells[ix] ?? "").trim(); } return r; });

/** Modelo para baixar: só o cabeçalho (nenhuma linha de exemplo que pudesse ser importada sem querer). */
export const TEMPLATE_CSV = CRM_FIELDS.map((f) => (f.key === "name" ? "nome" : f.key === "email" ? "email" : f.key === "phone" ? "telefone" : f.key === "source" ? "origem" : f.key === "campaign" ? "campanha"
  : f.key === "unit" ? "unidade" : f.key === "owner" ? "responsavel" : f.key === "list" ? "lista" : f.key === "stage" ? "etapa" : f.key === "value" ? "valor" : "titulo")).join(",") + "\n";
