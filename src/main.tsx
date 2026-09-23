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
