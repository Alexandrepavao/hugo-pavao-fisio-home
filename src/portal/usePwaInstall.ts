import { useCallback, useEffect, useState } from "react";

interface BeforeInstallPromptEvent extends Event { prompt: () => Promise<void>; userChoice: Promise<{ outcome: "accepted" | "dismissed" }> }

/** Instalação do app (PWA). Android/desktop: evento `beforeinstallprompt`. iPhone: não existe evento; mostramos a instrução “Adicionar à Tela de Início”. */
export const usePwaInstall = () => {
  const [evt, setEvt] = useState<BeforeInstallPromptEvent | null>(null);
  const standalone = typeof window !== "undefined" && (window.matchMedia?.("(display-mode: standalone)").matches || (navigator as Navigator & { standalone?: boolean }).standalone === true);
  const ios = typeof navigator !== "undefined" && /iphone|ipad|ipod/i.test(navigator.userAgent) && !standalone;
  useEffect(() => {
    const onPrompt = (e: Event) => { e.preventDefault(); setEvt(e as BeforeInstallPromptEvent); };
    const onInstalled = () => setEvt(null);
    window.addEventListener("beforeinstallprompt", onPrompt); window.addEventListener("appinstalled", onInstalled);
    return () => { window.removeEventListener("beforeinstallprompt", onPrompt); window.removeEventListener("appinstalled", onInstalled); };
  }, []);
  const install = useCallback(async () => { if (!evt) return; await evt.prompt(); setEvt(null); }, [evt]);
  return { canInstall: !!evt && !standalone, install, ios, standalone };
};
