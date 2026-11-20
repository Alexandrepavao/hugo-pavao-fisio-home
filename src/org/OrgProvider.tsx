import { createContext, useCallback, useContext, useEffect, useMemo, useState, type ReactNode } from "react";
import { supabase, backendConfigured } from "@/lib/supabase";
import { useAuth } from "@/auth/AuthProvider";
import { useLocation } from "react-router-dom";
import { useQueryClient } from "@tanstack/react-query";
import { brandLogoUrl, getActiveOrg, hexToHsl, setActiveOrg, switchOrganization, type Membership, type OrgBrand, type OrgContext } from "@/lib/org";
import { scopeSlugFromPath } from "@/lib/orgScope";

/** Organização escolhida pelo ENDEREÇO (/empresa/<slug>): `loading` enquanto o servidor resolve (a interface NÃO mostra a marca HP nesse intervalo), `notfound` para slug desconhecido/desativado
 *  (mesma resposta nos dois casos), `ok` com a marca pública. `access` diz se o usuário logado tem vínculo ativo com ela (o servidor revalida em cada chamada). */
export interface OrgScopeState { slug: string | null; status: "none" | "loading" | "ok" | "notfound"; capture: boolean; access: "n/a" | "loading" | "member" | "none" }

interface OrgState {
  loading: boolean;
  scope: OrgScopeState;
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
  const [memFor, setMemFor] = useState<string | null>(null);   // usuário cujos vínculos já foram carregados
  const [loading, setLoading] = useState(backendConfigured);
  const userId = session?.user.id ?? null;
  const location = useLocation();
  const qc = useQueryClient();
  const scopeSlug = scopeSlugFromPath(location.pathname);
  const [scopeData, setScopeData] = useState<{ slug: string; found: boolean; capture: boolean; brand: OrgBrand | null } | null>(null);

  // Organização do ENDEREÇO: resolvida no servidor antes de qualquer marca/tela; ao mudar de organização o cache de consultas é descartado (nada da anterior sobra).
  useEffect(() => {
    if (!scopeSlug) { setScopeData(null); return; }
    let live = true;
    setScopeData((prev) => (prev?.slug === scopeSlug ? prev : null));
    void (async () => {
      if (!backendConfigured) { if (live) setScopeData({ slug: scopeSlug, found: false, capture: false, brand: null }); return; }
      const { data } = await supabase.rpc("org_public_by_slug", { p_slug: scopeSlug });
      const r = data as { found?: boolean; capture?: boolean; brand?: OrgBrand } | null;
      if (live) setScopeData({ slug: scopeSlug, found: Boolean(r?.found), capture: Boolean(r?.capture), brand: r?.found && r.brand ? r.brand : null });
    })();
    return () => { live = false; };
  }, [scopeSlug]);
  useEffect(() => { qc.clear(); }, [scopeSlug, qc]);

  const load = useCallback(async () => {
    if (!backendConfigured) { setLoading(false); return; }
    if (!userId) {   // sem login: só a marca do ENDEREÇO (host verificado), nunca dados da organização
      setCtx(null); setMemberships([]); setPlatformAdmin(false); setMemFor(null);
      const { data } = await supabase.rpc("org_brand_for_host", { p_host: window.location.hostname });
      const r = data as { found?: boolean; brand?: OrgBrand } | null;
      setHostBrand(r?.found && r.brand ? r.brand : null); setLoading(false); return;
    }
    const [c, m] = await Promise.all([supabase.rpc("org_context"), supabase.rpc("my_memberships")]);
    setCtx(c.error ? null : (c.data as OrgContext));
    const mm = m.error ? null : (m.data as { memberships?: Membership[]; platform_admin?: boolean } | null);
    setMemberships(mm?.memberships ?? []); setPlatformAdmin(Boolean(mm?.platform_admin)); setHostBrand(null); setMemFor(userId); setLoading(false);
    // endereço de uma organização em que o usuário TEM vínculo: ela vira a organização ativa desta aba (uma única recarga; o banco revalida o vínculo em cada chamada)
    const want = scopeSlugFromPath(window.location.pathname);
    const mine = want ? mm?.memberships?.find((x) => x.slug === want) : undefined;
    if (mine && getActiveOrg() !== mine.org_id) { setActiveOrg(mine.org_id); window.location.reload(); }
  }, [userId]);

  useEffect(() => { if (!authLoading) void load(); }, [authLoading, load]);

  const scopeReady = scopeSlug ? scopeData?.slug === scopeSlug : true;
  const scope = useMemo<OrgScopeState>(() => !scopeSlug ? { slug: null, status: "none", capture: false, access: "n/a" }
    : !scopeReady ? { slug: scopeSlug, status: "loading", capture: false, access: "n/a" }
    : !scopeData?.found ? { slug: scopeSlug, status: "notfound", capture: false, access: "n/a" }
    : { slug: scopeSlug, status: "ok", capture: scopeData.capture, access: !userId ? "n/a" : memFor !== userId ? "loading" : memberships.some((m) => m.slug === scopeSlug) ? "member" : "none" },
    [scopeSlug, scopeReady, scopeData, userId, memFor, memberships]);
  // com endereço de organização, a marca é a DELA (nunca a HP, nem a da organização ativa de outra empresa)
  const brand = scopeSlug ? (scopeReady ? scopeData?.brand ?? null : null) : ctx?.brand ?? hostBrand ?? null;
  const isDefaultBrand = scopeSlug ? Boolean(scopeReady && scopeData?.found && scopeData.brand?.is_default_brand) : !brand || Boolean(brand.is_default_brand);
  useEffect(() => {
    applyTheme(brand, isDefaultBrand);
    if (brand && !isDefaultBrand) document.title = brand.name;
  }, [brand, isDefaultBrand]);

  const value = useMemo<OrgState>(() => ({
    loading: loading || authLoading || scope.status === "loading", scope, ctx, brand, isDefaultBrand, brandName: scope.status === "loading" ? "" : isDefaultBrand ? "HP Group" : brand?.name ?? "", logoUrl: isDefaultBrand ? null : brandLogoUrl(brand?.logo_path),
    memberships, platformAdmin,
    moduleOn: (key) => (ctx?.modules ? ctx.modules.includes(key) : true),
    term: (key, fallback) => ctx?.vocabulary?.[key] ?? fallback,
    switchOrg: (id) => switchOrganization(id), refresh: load,
  }), [loading, authLoading, scope, ctx, brand, isDefaultBrand, memberships, platformAdmin, load]);

  return <OrgContextReact.Provider value={value}>{children}</OrgContextReact.Provider>;
};

export const useOrg = () => {
  const v = useContext(OrgContextReact);
  if (!v) throw new Error("useOrg deve ser usado dentro de OrgProvider");
  return v;
};
