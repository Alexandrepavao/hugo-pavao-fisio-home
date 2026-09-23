/** Parser CSV simples (aspas, separador , ou ;, quebras CRLF). Sem dependências. */
export function parseCsv(text: string): string[][] {
  const src = text.charCodeAt(0) === 0xfeff ? text.slice(1) : text;
  const firstLine = src.split(/\r?\n/, 1)[0] ?? "";
  const delim = (firstLine.match(/;/g)?.length ?? 0) > (firstLine.match(/,/g)?.length ?? 0) ? ";" : ",";
  const rows: string[][] = []; let row: string[] = []; let cell = ""; let quoted = false;
  for (let i = 0; i < src.length; i++) {
    const c = src[i];
    if (quoted) {
      if (c === '"') { if (src[i + 1] === '"') { cell += '"'; i++; } else quoted = false; } else cell += c;
    } else if (c === '"') quoted = true;
    else if (c === delim) { row.push(cell); cell = ""; }
    else if (c === "\n" || c === "\r") { if (c === "\r" && src[i + 1] === "\n") i++; row.push(cell); cell = ""; if (row.some((x) => x.trim() !== "")) rows.push(row); row = []; }
    else cell += c;
  }
  row.push(cell); if (row.some((x) => x.trim() !== "")) rows.push(row);
  return rows;
}

export interface ImportRow { name: string; email: string; phone: string; kind: string; line: number }
export interface ImportIssue { line: number; message: string }

const HEADERS: Record<string, keyof Omit<ImportRow, "line">> = {
  nome: "name", name: "name", "nome completo": "name", email: "email", "e-mail": "email", telefone: "phone", celular: "phone", whatsapp: "phone", phone: "phone", tipo: "kind", kind: "kind",
};
const KIND: Record<string, string> = { lead: "lead", paciente: "patient", patient: "patient", aluno: "student", student: "student", parceiro: "partner", partner: "partner", contato: "contact", contact: "contact", "": "lead" };

/** Converte a matriz do CSV em linhas validadas. Erros nunca são ocultados: viram itens do relatório. */
export function validateImport(matrix: string[][], max = 500): { rows: ImportRow[]; issues: ImportIssue[]; fatal?: string } {
  if (matrix.length < 2) return { rows: [], issues: [], fatal: "O arquivo precisa ter um cabeçalho e ao menos uma linha." };
  const map = matrix[0].map((h) => HEADERS[h.trim().toLowerCase()]);
  if (!map.includes("name")) return { rows: [], issues: [], fatal: "Coluna obrigatória ausente: nome. Colunas aceitas: nome, email, telefone, tipo." };
  if (matrix.length - 1 > max) return { rows: [], issues: [], fatal: `Limite de ${max} linhas por importação. Divida o arquivo.` };
  const rows: ImportRow[] = []; const issues: ImportIssue[] = [];
  matrix.slice(1).forEach((cells, i) => {
    const line = i + 2; const r: ImportRow = { name: "", email: "", phone: "", kind: "lead", line };
    map.forEach((k, ci) => { if (k) r[k] = (cells[ci] ?? "").trim(); });
    const kind = KIND[r.kind.toLowerCase()];
    if (r.name.length < 2) return void issues.push({ line, message: "Nome ausente ou muito curto." });
    if (r.email && !/^[^@\s]+@[^@\s]+\.[^@\s]+$/.test(r.email)) return void issues.push({ line, message: `E-mail inválido: ${r.email}` });
    if (r.phone && !/^\d{10,13}$/.test(r.phone.replace(/\D/g, ""))) return void issues.push({ line, message: `Telefone inválido: ${r.phone}` });
    if (!r.email && !r.phone) return void issues.push({ line, message: "Informe e-mail ou telefone." });
    if (!kind) return void issues.push({ line, message: `Tipo inválido: ${r.kind}` });
    rows.push({ ...r, kind });
  });
  return { rows, issues };
}
