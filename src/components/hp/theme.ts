import { useEffect } from "react";

/** Tema claro/escuro da área logada: escolha guardada no navegador (por pessoa), aplicada no <html> para valer também nos portais do Radix. */
export const THEME_KEY = "hp-theme";
export type ThemeMode = "light" | "dark";
export const readTheme = (): ThemeMode => { try { return localStorage.getItem(THEME_KEY) === "dark" ? "dark" : "light"; } catch { return "light"; } };
export const applyTheme = (t: ThemeMode) => { document.documentElement.dataset.theme = t; };

/** Aplica o escopo visual da área logada no <html> (portais do Radix renderizam fora do container) e o tema escolhido. */
export const useAppTheme = () => {
  useEffect(() => {
    document.documentElement.classList.add("hp-app"); applyTheme(readTheme());
    return () => { document.documentElement.classList.remove("hp-app"); delete document.documentElement.dataset.theme; };
  }, []);
};
