import { createContext, useCallback, useContext, useLayoutEffect, useMemo, useState, type ReactNode } from "react";

/** Metadados da página atual que alimentam o BANNER único da moldura (AppFrame). Cada página declara o título (e, se quiser, a descrição) com `useRegisterPageMeta` — normalmente
 *  via `PageHead`, que já existe em quase todas as telas. A moldura mostra UM banner por página: sem declaração, usa o nome do item ativo do menu do aplicativo. */
export interface PageMeta {
  title: string;
  /** descrição curta e útil (opcional) */
  description?: string;
  /** "hub": saudação ampliada da página inicial; "page" (padrão): banner compacto das demais telas */
  variant?: "hub" | "page";
}

interface Ctx { meta: PageMeta | null; set: (m: PageMeta | null) => void }
const PageMetaContext = createContext<Ctx | null>(null);

export const PageMetaProvider = ({ children }: { children: ReactNode }) => {
  const [meta, setMeta] = useState<PageMeta | null>(null);
  const set = useCallback((m: PageMeta | null) => setMeta((prev) => (prev?.title === m?.title && prev?.description === m?.description && prev?.variant === m?.variant ? prev : m)), []);
  const value = useMemo<Ctx>(() => ({ meta, set }), [meta, set]);
  return <PageMetaContext.Provider value={value}>{children}</PageMetaContext.Provider>;
};

/** null fora da moldura (portais do paciente/fisioterapeuta, páginas públicas): quem chama mantém o cabeçalho próprio. */
export const usePageMetaContext = () => useContext(PageMetaContext);

export const useRegisterPageMeta = (m: PageMeta | null) => {
  const ctx = useContext(PageMetaContext);
  const set = ctx?.set;
  const title = m?.title, description = m?.description, variant = m?.variant;
  useLayoutEffect(() => {
    if (!set) return;
    set(title ? { title, description, variant } : null);
    return () => set(null);
  }, [set, title, description, variant]);
};
