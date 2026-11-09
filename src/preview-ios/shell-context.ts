import { createContext, useContext } from "react";
import type { Role } from "./types";

/** Controles da casca (tema, tamanho do texto, papel) que as telas também precisam em celular, onde não há painel lateral. */
export interface ShellApi { role: Role; setRole: (r: Role) => void; theme: "light" | "dark"; setTheme: (t: "light" | "dark") => void; textScale: number; setTextScale: (n: number) => void; reset: () => void; exit: () => void }
export const ShellCtx = createContext<ShellApi | null>(null);
export const useShell = () => { const c = useContext(ShellCtx); if (!c) throw new Error("useShell fora da casca"); return c; };
