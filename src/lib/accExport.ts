/** Pacote do contador (app Contábil): montagem dos arquivos a partir do que o servidor autorizou (acc_export_data).
 *  Funções puras, sem rede — o que cada perfil pode ver já foi decidido no banco (pseudônimos, unidade, competência). */
export interface ExportEntry {
  basis: "competencia" | "caixa"; date: string | null; competence_month: string | null; kind: "income" | "expense"; description: string; counterparty: string;
  amount_cents: number; status: string; category: string | null; account_code: string | null; account_name: string | null; documents: number; source_type: string; source_id: string;
}
export interface ExportPendency { type: string; description: string; counterparty: string; basis: string; signed_cents: number; detail: string }
export interface ExportDoc { id: string; kind: string; title: string; source_type: string; source_id: string | null; mime: string | null; uploaded_at: string }
export interface ExportMetrics { entries_comp: number; income_comp_cents: number; expense_comp_cents: number; entries_cash: number; cash_in_cents: number; cash_out_cents: number; unclassified: number; missing_receipt: number; documents: number; changes_after_close: number }
export interface ExportData {
  generated_at: string; provisional: boolean; period_status: "open" | "in_review" | "closed"; organization: string;
  unit: { id: string; name: string; legal_name: string | null; cnpj: string | null }; month: string; closed_at: string | null; closed_by: string | null; close_note: string | null; close_seq: number;
  names_visible: boolean; metrics: ExportMetrics; entries: ExportEntry[]; pendencies: ExportPendency[]; documents: ExportDoc[];
}

export const money = (cents: number) => (cents / 100).toFixed(2).replace(".", ",");
const BASIS = { competencia: "Competência", caixa: "Caixa" } as const;
const KIND = { income: "Receita", expense: "Despesa" } as const;
const PEND = { unclassified: "Sem classificação", missing_receipt: "Sem comprovante", changed_after_close: "Alteração após o fechamento" } as Record<string, string>;
const STATUS = { open: "Em aberto", partial: "Parcial", paid: "Pago", refunded: "Estornado", payment: "Recebimento", refund: "Estorno", cancelled: "Cancelado" } as Record<string, string>;
const day = (d: string | null) => (d ? `${d.slice(8, 10)}/${d.slice(5, 7)}/${d.slice(0, 4)}` : "");
const mon = (d: string | null) => (d ? `${d.slice(5, 7)}/${d.slice(0, 4)}` : "");
export const STATUS_PT = { open: "Aberta", in_review: "Em revisão", closed: "Fechada" } as const;

/** Célula CSV: aspas quando preciso e neutralização de fórmulas (=, +, -, @) SÓ em texto — valores numéricos ficam intactos. */
const cell = (v: unknown, numeric = false): string => {
  let s = v == null ? "" : String(v);
  if (!numeric && /^[=+\-@\t\r]/.test(s)) s = "'" + s;
  return /[";\n\r]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s;
};
const line = (cells: [unknown, boolean?][]) => cells.map(([v, n]) => cell(v, n)).join(";");

export function entriesCsv(data: ExportData, basis: "competencia" | "caixa" | null): string {
  const head = ["Base", "Data", "Competência", "Natureza", "Descrição", "Contraparte", "Categoria no Financeiro", "Classificação (código)", "Classificação (nome)", "Valor (R$; despesas e estornos negativos)", "Situação", "Documentos anexos"];
  const rows = data.entries.filter((e) => !basis || e.basis === basis).map((e) => line([
    [BASIS[e.basis]], [day(e.date)], [mon(e.competence_month)], [KIND[e.kind]], [e.description], [e.counterparty], [e.category], [e.account_code], [e.account_name],
    [money(e.amount_cents), true], [STATUS[e.status] ?? e.status], [e.documents, true]]));
  return [head.join(";"), ...rows].join("\n");
}
export function pendenciesCsv(data: ExportData): string {
  const head = ["Tipo", "Lançamento", "Contraparte", "Base", "Valor (R$)", "Detalhe"];
  return [head.join(";"), ...data.pendencies.map((p) => line([[PEND[p.type] ?? p.type], [p.description], [p.counterparty], [p.basis === "caixa" ? "Caixa" : "Competência"], [money(p.signed_cents), true], [p.detail]]))].join("\n");
}
export function summaryCsv(data: ExportData): string {
  const m = data.metrics;
  const rows: [string, string | number][] = [
    ["Organização", data.organization], ["Unidade", data.unit.name], ["Empresa (CNPJ)", data.unit.legal_name ? `${data.unit.legal_name}${data.unit.cnpj ? ` — ${data.unit.cnpj}` : ""}` : "não vinculada"],
    ["Competência", mon(data.month)], ["Situação da competência", STATUS_PT[data.period_status]], ["Dados", data.provisional ? "PROVISÓRIOS (competência não fechada)" : `Definitivos — fechamento v${data.close_seq}`],
    ["Receitas por competência (R$)", money(m.income_comp_cents)], ["Despesas por competência (R$)", money(m.expense_comp_cents)],
    ["Recebido no mês — caixa (R$)", money(m.cash_in_cents)], ["Pago no mês — caixa (R$)", money(m.cash_out_cents)],
    ["Lançamentos sem classificação", m.unclassified], ["Despesas pagas sem comprovante", m.missing_receipt], ["Alterações após o fechamento pendentes", m.changes_after_close],
  ];
  return ["Item;Valor", ...rows.map(([k, v]) => line([[k], [v]]))].join("\n");
}

export const docFileName = (d: ExportDoc, index: number): string => {
  const ext = /\.[A-Za-z0-9]{2,5}$/.exec(d.title)?.[0] ?? ({ "application/pdf": ".pdf", "image/png": ".png", "image/jpeg": ".jpg", "image/webp": ".webp", "text/xml": ".xml", "application/xml": ".xml" } as Record<string, string>)[d.mime ?? ""] ?? "";
  const base = d.title.replace(/\.[A-Za-z0-9]{2,5}$/, "").normalize("NFD").replace(/[̀-ͯ]/g, "").replace(/[^A-Za-z0-9._-]+/g, "_").replace(/^_+|_+$/g, "").slice(0, 60) || "documento";
  return `documentos/${String(index + 1).padStart(3, "0")}-${base}${ext}`;
};

export function readme(data: ExportData, failed: { title: string; reason: string }[] = []): string {
  const L: string[] = [
    `PACOTE DO CONTADOR — ${data.organization}`, `Unidade: ${data.unit.name}${data.unit.legal_name ? ` · ${data.unit.legal_name}${data.unit.cnpj ? ` (CNPJ ${data.unit.cnpj})` : ""}` : ""}`,
    `Competência: ${mon(data.month)} — situação: ${STATUS_PT[data.period_status]}`, `Gerado em: ${data.generated_at}`, "",
  ];
  if (data.provisional) L.push("ATENÇÃO: COMPETÊNCIA NÃO FECHADA — DADOS PROVISÓRIOS. Podem mudar até o fechamento.", "");
  else L.push(`Competência fechada por ${data.closed_by ?? "—"} em ${data.closed_at ?? "—"} (versão ${data.close_seq}).${data.close_note ? ` Observação: ${data.close_note}` : ""}`, "");
  L.push(
    "CONTEÚDO", "- lancamentos_competencia.csv: lançamentos pela competência (mês a que o fato pertence).", "- lancamentos_caixa.csv: movimentos pela data do dinheiro (recebimentos, estornos e contas pagas).",
    "  As duas bases NÃO se somam: são visões diferentes dos mesmos fatos.", "- pendencias.csv: o que ainda estava pendente no momento da exportação.", "- resumo.csv: totais e situação.",
    "- documentos/: comprovantes e arquivos anexados. manifesto.csv lista cada arquivo com SHA-256.", "",
    "LIMITES", "Este pacote é uma preparação GERENCIAL da competência. Não é escrituração contábil ou fiscal oficial, não contém apuração de tributos e não substitui a emissão de documentos fiscais.",
    "Classificações são gerenciais e devem ser mapeadas para o plano de contas do contador.", data.names_visible ? "" : "Nomes de pacientes foram substituídos por códigos (pseudônimos) conforme o perfil de acesso de quem exportou.", "",
  );
  if (failed.length) L.push("DOCUMENTOS QUE NÃO FORAM INCLUÍDOS (falha ao baixar):", ...failed.map((f) => `- ${f.title}: ${f.reason}`), "");
  return L.filter((x, i, a) => !(x === "" && a[i - 1] === "")).join("\n");
}

export function manifestCsv(files: { name: string; title: string; kind: string; size: number; sha256: string }[]): string {
  return ["Arquivo;Título;Tipo;Tamanho (bytes);SHA-256", ...files.map((f) => line([[f.name], [f.title], [f.kind], [f.size, true], [f.sha256]]))].join("\n");
}

export const sha256Hex = async (buf: ArrayBuffer | string): Promise<string> => {
  const data = typeof buf === "string" ? new TextEncoder().encode(buf) : new Uint8Array(buf);
  return [...new Uint8Array(await crypto.subtle.digest("SHA-256", data))].map((b) => b.toString(16).padStart(2, "0")).join("");
};
