import { useEffect } from "react";

export const ONBOARDING_CONSENT_VERSION = "onboarding-v1";
export const PRIMARY_BTN = "inline-flex items-center justify-center gap-2 bg-accent text-accent-foreground text-[13px] uppercase tracking-[0.16em] px-8 py-4 hover:opacity-90 transition-opacity disabled:opacity-50 disabled:cursor-not-allowed";
export const LINK_BTN = "inline-flex items-center gap-1.5 text-[13px] text-navy-400 hover:text-navy-900 transition-colors disabled:opacity-40";

export type FormState = Record<string, string>;
export type Errors = Record<string, string>;

/** Páginas de cadastro por link/rota direta não devem aparecer em buscadores. */
export const usePageMeta = (title: string) => {
  useEffect(() => {
    const prev = document.title; document.title = title;
    const meta = document.createElement("meta"); meta.name = "robots"; meta.content = "noindex, nofollow"; document.head.appendChild(meta);
    return () => { document.title = prev; meta.remove(); };
  }, [title]);
};

