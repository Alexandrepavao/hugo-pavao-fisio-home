// Dinheiro: sempre inteiros em centavos. Nunca calcular com float.
export const brl = (cents: number | string | null | undefined): string => {
  if (cents == null) return "—";
  const n = typeof cents === "string" ? Number(cents) : cents;
  const sign = n < 0 ? "-" : "";
  const abs = Math.abs(n);
  const reais = Math.trunc(abs / 100).toString().replace(/\B(?=(\d{3})+(?!\d))/g, ".");
  return `${sign}R$ ${reais},${String(abs % 100).padStart(2, "0")}`;
};

/** "1.234,56" -> 123456. Retorna null se inválido. */
export const parseCents = (input: string): number | null => {
  const s = input.trim().replace(/[R$\s.]/g, "");
  if (!/^\d+(,\d{1,2})?$/.test(s)) return null;
  const [int, dec = ""] = s.split(",");
  return Number(int) * 100 + Number(dec.padEnd(2, "0"));
};

export const fmtDate = (iso: string | null | undefined, tz = "America/Sao_Paulo") =>
  iso ? new Date(iso).toLocaleDateString("pt-BR", { timeZone: tz }) : "—";
export const fmtDateTime = (iso: string | null | undefined, tz = "America/Sao_Paulo") =>
  iso ? new Date(iso).toLocaleString("pt-BR", { timeZone: tz, dateStyle: "short", timeStyle: "short" }) : "—";

/** Chave de idempotência gerada por tentativa de operação (evita duplicar recebimentos em cliques repetidos). */
export const newKey = (prefix: string) => `${prefix}-${crypto.randomUUID()}`;

export const toCsv = (rows: Record<string, unknown>[]): string => {
  if (!rows.length) return "";
  const cols = Object.keys(rows[0]);
  const esc = (v: unknown) => {
    let s = v == null ? "" : String(v);
    if (/^[=+\-@]/.test(s)) s = "'" + s;                 // neutraliza injeção de fórmulas em planilhas
    return /[",\n;]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s;
  };
  return [cols.join(";"), ...rows.map((r) => cols.map((c) => esc(r[c])).join(";"))].join("\n");
};

export const download = (name: string, content: string, type = "text/csv;charset=utf-8") => {
  const url = URL.createObjectURL(new Blob(["﻿" + content], { type }));
  const a = document.createElement("a"); a.href = url; a.download = name; a.click(); URL.revokeObjectURL(url);
};
