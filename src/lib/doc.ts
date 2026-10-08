/** Documentos e máscaras dos formulários de cadastro. A validação no navegador só poupa tempo: quem decide é sempre o servidor. */
export const onlyDigits = (s: string) => s.replace(/\D/g, "");

const allSame = (d: string) => /^(\d)\1+$/.test(d);

export const isValidCpf = (raw: string): boolean => {
  const d = onlyDigits(raw);
  if (d.length !== 11 || allSame(d)) return false;
  const calc = (len: number) => { let s = 0; for (let i = 0; i < len; i++) s += Number(d[i]) * (len + 1 - i); const r = (s * 10) % 11; return r === 10 ? 0 : r; };
  return calc(9) === Number(d[9]) && calc(10) === Number(d[10]);
};

export const isValidCnpj = (raw: string): boolean => {
  const d = onlyDigits(raw);
  if (d.length !== 14 || allSame(d)) return false;
  const calc = (len: number) => {
    const w = len === 12 ? [5, 4, 3, 2, 9, 8, 7, 6, 5, 4, 3, 2] : [6, 5, 4, 3, 2, 9, 8, 7, 6, 5, 4, 3, 2];
    const s = w.reduce((a, v, i) => a + v * Number(d[i]), 0); const r = s % 11; return r < 2 ? 0 : 11 - r;
  };
  return calc(12) === Number(d[12]) && calc(13) === Number(d[13]);
};

export const fmtCpf = (s: string) => {
  const d = onlyDigits(s).slice(0, 11); let o = d.slice(0, 3);
  if (d.length > 3) o += "." + d.slice(3, 6); if (d.length > 6) o += "." + d.slice(6, 9); if (d.length > 9) o += "-" + d.slice(9);
  return o;
};
export const fmtCnpj = (s: string) => {
  const d = onlyDigits(s).slice(0, 14); let o = d.slice(0, 2);
  if (d.length > 2) o += "." + d.slice(2, 5); if (d.length > 5) o += "." + d.slice(5, 8); if (d.length > 8) o += "/" + d.slice(8, 12); if (d.length > 12) o += "-" + d.slice(12);
  return o;
};
export const fmtCep = (s: string) => { const d = onlyDigits(s).slice(0, 8); return d.length > 5 ? `${d.slice(0, 5)}-${d.slice(5)}` : d; };
export const fmtPhone = (s: string) => {
  const d = onlyDigits(s).slice(0, 11);
  if (d.length <= 2) return d.length ? `(${d}` : "";
  if (d.length <= 6) return `(${d.slice(0, 2)}) ${d.slice(2)}`;
  if (d.length <= 10) return `(${d.slice(0, 2)}) ${d.slice(2, 6)}-${d.slice(6)}`;
  return `(${d.slice(0, 2)}) ${d.slice(2, 7)}-${d.slice(7)}`;
};
export const isValidPhone = (s: string) => { const n = onlyDigits(s).length; return n >= 10 && n <= 13; };
export const isValidEmail = (s: string) => /^[^@\s]+@[^@\s]+\.[^@\s]+$/.test(s.trim());

export interface CepResult { street: string; neighborhood: string; city: string; state_uf: string }
/** Preenche o endereço pelo CEP (ViaCEP, serviço público: só o CEP é enviado). Se falhar, a pessoa digita; nunca bloqueia. */
export const lookupCep = async (cep: string): Promise<CepResult | null> => {
  const d = onlyDigits(cep);
  if (d.length !== 8) return null;
  try {
    const ctl = new AbortController(); const t = setTimeout(() => ctl.abort(), 5000);
    const r = await fetch(`https://viacep.com.br/ws/${d}/json/`, { signal: ctl.signal }); clearTimeout(t);
    if (!r.ok) return null;
    const j = await r.json() as { erro?: boolean; logradouro?: string; bairro?: string; localidade?: string; uf?: string };
    if (j.erro) return null;
    return { street: j.logradouro ?? "", neighborhood: j.bairro ?? "", city: j.localidade ?? "", state_uf: j.uf ?? "" };
  } catch { return null; }
};

export const MIN_PASSWORD = 10;
