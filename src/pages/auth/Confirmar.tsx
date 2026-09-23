import { useState, type MouseEvent } from "react";
import { Link, useNavigate, useSearchParams } from "react-router-dom";
import { Loader2 } from "lucide-react";
import { supabase } from "@/lib/supabase";
import AuthShell from "./AuthShell";

/**
 * Confirmação de e-mail com identidade HP (não supabase.co, não localhost). O link do e-mail (montado pelo
 * hook em supabase/functions/auth-email-hook) aponta para cá com ?token_hash=...&type=...; esta página
 * valida o token pelo mecanismo OFICIAL do Supabase Auth (`verifyOtp`, client-side) — o Supabase continua
 * dono da validade/expiração/uso único do token, isto não é um mecanismo paralelo, só troca QUEM mostra a
 * página que recebe o link.
 *
 * Exige um clique explícito antes de consumir o token (não valida automaticamente ao carregar) — pré-visu­
 * alizadores automáticos de e-mail (antivírus corporativo, "Safe Links" etc.) às vezes abrem o link sozinhos
 * e queimariam um token de uso único antes da pessoa de verdade clicar.
 */

type TokenType = "signup" | "invite" | "recovery" | "email_change" | "magiclink" | "reauthentication";
const KNOWN_TYPES: readonly TokenType[] = ["signup", "invite", "recovery", "email_change", "magiclink", "reauthentication"];

const COPY: Record<TokenType, { title: string; subtitle: string; cta: string }> = {
  signup: { title: "Confirmar e-mail", subtitle: "Confirme seu e-mail para concluir o primeiro acesso.", cta: "Confirmar e-mail" },
  invite: { title: "Aceitar convite", subtitle: "Confirme para criar sua senha e concluir o acesso.", cta: "Continuar" },
  recovery: { title: "Redefinir senha", subtitle: "Confirme para criar uma nova senha.", cta: "Continuar" },
  email_change: { title: "Confirmar novo e-mail", subtitle: "Confirme a alteração do seu e-mail.", cta: "Confirmar" },
  magiclink: { title: "Entrar", subtitle: "Confirme para acessar o HP Group Hub.", cta: "Entrar" },
  reauthentication: { title: "Confirmar identidade", subtitle: "Por segurança, confirme sua identidade.", cta: "Confirmar" },
};

// Depois de validado, cada tipo de token continua para o lugar certo da jornada.
function destinationFor(type: TokenType): string {
  if (type === "recovery") return "/redefinir-senha";
  return "/app"; // signup/invite/email_change/magiclink/reauthentication: sessão criada, Landing.tsx decide por perfil
}

const Confirmar = () => {
  const [params] = useSearchParams();
  const navigate = useNavigate();
  const [busy, setBusy] = useState(false);
  const [failed, setFailed] = useState(false);

  const tokenHash = params.get("token_hash");
  const rawType = params.get("type");
  const type: TokenType | null = KNOWN_TYPES.includes(rawType as TokenType) ? (rawType as TokenType) : null;

  // Link malformado (sem token ou tipo desconhecido) — nada a consumir, mostra inválido direto.
  if (!tokenHash || !type || failed) {
    return (
      <AuthShell title="Link inválido ou expirado" subtitle="Por segurança, cada link vale por tempo limitado e só pode ser usado uma vez — inclusive se já foi aberto antes.">
        <Link to="/login" className="flex h-11 w-full items-center justify-center rounded-lg bg-accent text-[15px] font-medium text-accent-foreground transition-all hover:bg-accent/90">
          Ir para o login
        </Link>
      </AuthShell>
    );
  }

  const confirm = async (e: MouseEvent) => {
    e.preventDefault();
    if (busy) return;
    setBusy(true);
    try {
      const { error } = await supabase.auth.verifyOtp({ token_hash: tokenHash, type });
      // Limpa o token da URL visível assim que processado, sucesso ou falha.
      window.history.replaceState(null, "", window.location.pathname);
      if (error) { setFailed(true); return; }
      navigate(destinationFor(type), { replace: true });
    } catch {
      window.history.replaceState(null, "", window.location.pathname);
      setFailed(true);
    } finally {
      setBusy(false);
    }
  };

  const { title, subtitle, cta } = COPY[type];

  return (
    <AuthShell title={title} subtitle={subtitle}>
      <button
        type="button"
        onClick={confirm}
        disabled={busy}
        className="flex h-11 w-full items-center justify-center gap-2 rounded-lg bg-accent text-[15px] font-medium text-accent-foreground transition-all hover:bg-accent/90 disabled:opacity-50"
      >
        {busy && <Loader2 className="h-4 w-4 animate-spin" aria-hidden="true" />}
        {busy ? "Confirmando…" : cta}
      </button>
    </AuthShell>
  );
};

export default Confirmar;
