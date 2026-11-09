import { createRoot } from 'react-dom/client'
import App from './App.tsx'
import './index.css'
import './styles/app.css'

// Pageview manual e saneado: só origem + caminho, nunca querystring/hash (evita vazar token_hash de
// links de confirmação de autenticação para o Analytics — ver index.html).
declare global { interface Window { gtag?: (...args: unknown[]) => void } }
window.gtag?.('event', 'page_view', {
  page_location: window.location.origin + window.location.pathname,
  page_title: document.title,
});

createRoot(document.getElementById("root")!).render(<App />);

// PWA dos portais: o service worker só entra em produção/preview publicados (nunca no servidor de desenvolvimento) e nunca guarda dado de API (ver public/sw.js).
if (import.meta.env.PROD && "serviceWorker" in navigator) {
  window.addEventListener("load", () => { void navigator.serviceWorker.register("/sw.js").catch(() => { /* sem service worker o app segue funcionando normalmente */ }); });
}
