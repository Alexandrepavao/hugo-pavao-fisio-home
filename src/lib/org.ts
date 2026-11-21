/** Organização ativa (multiempresa). O identificador só é uma ESCOLHA da interface, enviada no cabeçalho `x-org`; o BANCO revalida o vínculo do usuário a cada chamada
 *  (vínculo inexistente/inativo → 42501). Domínio, tema e cabeçalho nunca concedem acesso. Fica só nesta aba (sessionStorage): outra aba continua na sua organização. */
const KEY = "hp.activeOrg";
const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

let current: string | null = (() => { try { const v = sessionStorage.getItem(KEY); return v && UUID.test(v) ? v : null; } catch { return null; } })();
export const getActiveOrg = () => current;
export const setActiveOrg = (id: string | null) => {
  current = id && UUID.test(id) ? id : null;
  try { if (current) sessionStorage.setItem(KEY, current); else sessionStorage.removeItem(KEY); } catch { /* sem sessionStorage: vale só até recarregar */ }
};

/** Troca de organização: nada da anterior fica em memória (cache de consultas, estados de tela). Recarrega a aplicação inteira na rota inicial. */
export const switchOrganization = (id: string, to = "/admin") => { setActiveOrg(id); window.location.assign(to); };

export interface OrgBrand {
  org_id?: string; name: string; legal_name?: string | null; logo_path?: string | null; logo_dark_path?: string | null;
  color_primary?: string | null; color_accent?: string | null; color_ink?: string | null; support_email?: string | null; website_url?: string | null;
  texts?: Record<string, string>; is_default_brand?: boolean; version?: number;
}
export interface OrgContext {
  org: { id: string; name: string; slug: string; status: string; segment: string | null; template_version: number | null } | null;
  brand?: OrgBrand; modules?: string[]; vocabulary?: Record<string, string>;
}
export interface Membership { org_id: string; name: string; slug: string; is_default: boolean }

export const brandLogoUrl = (path?: string | null) => {
  const base = import.meta.env.VITE_SUPABASE_URL as string | undefined;
  return path && base ? `${base}/storage/v1/object/public/org-brand/${path.split("/").map(encodeURIComponent).join("/")}` : null;
};

/** #RRGGBB → "H S% L%" (formato dos tokens do tema). Entrada inválida → null (a marca nunca quebra o tema). */
export const hexToHsl = (hex?: string | null): string | null => {
  if (!hex || !/^#[0-9a-fA-F]{6}$/.test(hex)) return null;
  const r = parseInt(hex.slice(1, 3), 16) / 255, g = parseInt(hex.slice(3, 5), 16) / 255, b = parseInt(hex.slice(5, 7), 16) / 255;
  const max = Math.max(r, g, b), min = Math.min(r, g, b), l = (max + min) / 2; let h = 0, s = 0;
  if (max !== min) {
    const d = max - min; s = l > 0.5 ? d / (2 - max - min) : d / (max + min);
    h = max === r ? (g - b) / d + (g < b ? 6 : 0) : max === g ? (b - r) / d + 2 : (r - g) / d + 4; h *= 60;
  }
  return `${Math.round(h)} ${Math.round(s * 100)}% ${Math.round(l * 100)}%`;
};
