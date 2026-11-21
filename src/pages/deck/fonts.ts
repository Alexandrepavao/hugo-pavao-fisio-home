/**
 * Fontes da apresentação.
 *
 * DEPENDÊNCIA NÃO RESOLVIDA: os arquivos das fontes OFICIAIS da identidade (serifada editorial dos títulos e a fonte de apoio da marca) NÃO estão no
 * projeto. Enquanto não chegam, o documento usa estas fontes PROVISÓRIAS (livres, via Google Fonts, como o site já faz com Manrope/Inter):
 *   • títulos: Playfair Display (serifada de alto contraste, a mais próxima do estilo do logotipo "HP") — NÃO é a fonte oficial;
 *   • texto/legendas/números de apoio: Inter (a fonte de texto já usada no site).
 * Para trocar pelas oficiais: acrescentar os @font-face e alterar --deck-serif / --deck-sans em deck.css (e remover este carregamento).
 */
const HREF = "https://fonts.googleapis.com/css2?family=Playfair+Display:ital,wght@0,400;0,500;0,600;1,400;1,500&family=Inter:wght@400;500;600&display=swap";
const FACES = ['500 54px "Playfair Display"', 'italic 400 54px "Playfair Display"', '400 20px "Playfair Display"', '400 20px "Inter"', '500 20px "Inter"', '600 14px "Inter"'];

let pending: Promise<void> | null = null;

/** Injeta (uma vez) a folha de fontes e resolve quando TODAS as faces usadas estiverem carregadas — o PDF só deve ser gerado depois disso. */
export const ensureDeckFonts = (): Promise<void> => {
  if (pending) return pending;
  try {
    if (!document.querySelector('link[data-deck-fonts]')) {
      const l = document.createElement("link"); l.rel = "stylesheet"; l.href = HREF; l.setAttribute("data-deck-fonts", "1"); document.head.appendChild(l);
    }
  } catch { /* sem DOM completo */ }
  pending = (async () => {
    try {
      // a folha precisa existir antes de pedir as faces
      await new Promise<void>((ok) => { const l = document.querySelector<HTMLLinkElement>('link[data-deck-fonts]'); if (!l || l.sheet) return ok(); l.addEventListener("load", () => ok(), { once: true }); l.addEventListener("error", () => ok(), { once: true }); setTimeout(ok, 6000); });
      await Promise.all(FACES.map((f) => document.fonts.load(f, "Aáçãõ0123456789")));
      await document.fonts.ready;
    } catch { /* sem fontes: cai para a pilha de reserva, o documento continua legível */ }
  })();
  return pending;
};

/** true quando as fontes da apresentação já estão carregadas (para recalcular medidas depois do carregamento). */
export const deckFontsLoaded = () => { try { return ['500 20px "Playfair Display"', '400 20px "Inter"'].every((f) => document.fonts.check(f)); } catch { return true; } };
