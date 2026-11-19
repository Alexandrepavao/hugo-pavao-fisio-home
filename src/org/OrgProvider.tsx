import { createContext, useCallback, useContext, useEffect, useMemo, useState, type ReactNode } from "react";
import { supabase, backendConfigured } from "@/lib/supabase";
import { useAuth } from "@/auth/AuthProvider";
import { brandLogoUrl, hexToHsl, switchOrganization, type Membership, type OrgBrand, type OrgContext } from "@/lib/org";

interface OrgState {
  loading: boolean;
  /** Organização ativa (confirmada pelo banco) e seus dados públicos de marca, módulos e vocabulário. */
  ctx: OrgContext | null;
  brand: OrgBrand | null;
  /** true quando a marca é a da HP (ou não há marca): a interface continua exatamente como era. */
  isDefaultBrand: boolean;
  brandName: string;
  logoUrl: string | null;
  memberships: Membership[];
  platformAdmin: boolean;
  /** Só para mostrar/ocultar menus: o servidor é quem bloqueia módulo desabilitado (RLS + guarda de rotas). Sem contexto carregado, não oculta nada. */
  moduleOn: (key: string) => boolean;
  /** Vocabulário do modelo (ex.: "paciente" → "cliente"); sem entrada, devolve o padrão. */
  term: (key: string, fallback: string) => string;
  switchOrg: (id: string) => void;
  refresh: () => Promise<void>;
}

const OrgContextReact = createContext<OrgState | null>(null);

/** Aplica a marca à interface por tokens de tema (HSL). Marca HP/ausente → remove qualquer sobrescrita (a HP permanece idêntica). */
const THEME_VARS = ["--primary", "--navy-700", "--navy-900", "--accent", "--ring"] as const;
const applyTheme = (brand: OrgBrand | null, isDefault: boolean) => {
  const root = document.documentElement;
  THEME_VARS.forEach((v) => root.style.removeProperty(v));
  if (!brand || isDefault) return;
  const p = hexToHsl(brand.color_primary), a = hexToHsl(brand.color_accent), i = hexToHsl(brand.color_ink);
  if (p) { root.style.setProperty("--primary", p); root.style.setProperty("--navy-700", p); root.style.setProperty("--ring", p); }
  if (i) root.style.setProperty("--navy-900", i);
  if (a) root.style.setProperty("--accent", a);
};

export const OrgProvider = ({ children }: { children: ReactNode }) => {
  const { session, loading: authLoading } = useAuth();
  const [ctx, setCtx] = useState<OrgContext | null>(null);
  const [hostBrand, setHostBrand] = useState<OrgBrand | null>(null);
  const [memberships, setMemberships] = useState<Membership[]>([]);
  const [platformAdmin, setPlatformAdmin] = useState(false);
  const [loading, setLoading] = useState(backendConfigured);
  const userId = session?.user.id ?? null;

  const load = useCallback(async () => {
    if (!backendConfigured) { setLoading(false); return; }
    if (!userId) {   // sem login: só a marca do ENDEREÇO (host verificado), nunca dados da organização
      setCtx(null); setMemberships([]); setPlatformAdmin(false);
      const { data } = await supabase.rpc("org_brand_for_host", { p_host: window.location.hostname });
      const r = data as { found?: boolean; brand?: OrgBrand } | null;
      setHostBrand(r?.found && r.brand ? r.brand : null); setLoading(false); return;
    }
    const [c, m] = await Promise.all([supabase.rpc("org_context"), supabase.rpc("my_memberships")]);
    setCtx(c.error ? null : (c.data as OrgContext));
    const mm = m.error ? null : (m.data as { memberships?: Membership[]; platform_admin?: boolean } | null);
    setMemberships(mm?.memberships ?? []); setPlatformAdmin(Boolean(mm?.platform_admin)); setHostBrand(null); setLoading(false);
  }, [userId]);

  useEffect(() => { if (!authLoading) void load(); }, [authLoading, load]);

  const brand = ctx?.brand ?? hostBrand ?? null;
  const isDefaultBrand = !brand || Boolean(brand.is_default_brand);
  useEffect(() => {
    applyTheme(brand, isDefaultBrand);
    if (brand && !isDefaultBrand) document.title = brand.name;
  }, [brand, isDefaultBrand]);

  const value = useMemo<OrgState>(() => ({
    loading: loading || authLoading, ctx, brand, isDefaultBrand, brandName: isDefaultBrand ? "HP Group" : brand?.name ?? "", logoUrl: isDefaultBrand ? null : brandLogoUrl(brand?.logo_path),
    memberships, platformAdmin,
    moduleOn: (key) => (ctx?.modules ? ctx.modules.includes(key) : true),
    term: (key, fallback) => ctx?.vocabulary?.[key] ?? fallback,
    switchOrg: (id) => switchOrganization(id), refresh: load,
  }), [loading, authLoading, ctx, brand, isDefaultBrand, memberships, platformAdmin, load]);

  return <OrgContextReact.Provider value={value}>{children}</OrgContextReact.Provider>;
};

export const useOrg = () => {
  const v = useContext(OrgContextReact);
  if (!v) throw new Error("useOrg deve ser usado dentro de OrgProvider");
  return v;
};
