import { useEffect, useState, type FormEvent } from "react";
import { Link, Navigate, useLocation } from "react-router-dom";
import { Loader2, Mail } from "lucide-react";
import { supabase, backendConfigured } from "@/lib/supabase";
import { useAuth } from "@/auth/AuthProvider";
import AuthShell from "./AuthShell";
import AuthField from "./AuthField";
import AuthPasswordField from "./AuthPasswordField";

type Mode = "login" | "forgot";

/** Só aceita um destino de retorno interno (rota própria) — nunca uma URL externa. */
function safeInternalPath(path: unknown): string {
  if (typeof path === "string" && path.startsWith("/") && !path.startsWith("//")) return path;
  return "/app";
}

const Login = () => {
  const { session, loading } = useAuth();
  const location = useLocation();
  const from = safeInternalPath((location.state as { from?: string } | null)?.from);
  const [mode, setMode] = useState<Mode>("login");
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [info, setInfo] = useState<string | null>(null);

  useEffect(() => { setError(null); setInfo(null); }, [mode]);

  if (!loading && session) return <Navigate to={from} replace />;

  const submit = async (e: FormEvent) => {
    e.preventDefault();
    if (busy) return;
    setBusy(true); setError(null); setInfo(null);
    try {
      if (mode === "login") {
        const { error } = await supabase.auth.signInWithPassword({ email: email.trim(), password });
        if (error) setError("E-mail ou senha incorretos.");
      } else {
        const { error } = await supabase.auth.resetPasswordForEmail(email.trim(), {
          redirectTo: `${window.location.origin}/redefinir-senha`,
        });
        // Mesma resposta exista ou não a conta (evita enumeração de usuários).
        if (error && error.status === 429) setError("Muitas tentativas. Aguarde alguns minutos e tente novamente.");
        else setInfo("Se este e-mail estiver cadastrado, você receberá um link para criar uma nova senha.");
      }
    } catch {
      setError("Não foi possível conectar agora. Verifique sua internet e tente novamente.");
    } finally { setBusy(false); }
  };

  return (
    <AuthShell
      title={mode === "login" ? "Bem-vindo ao HP Group" : "Recuperar senha"}
      subtitle={mode === "login" ? "Acesse o painel com o e-mail do seu convite." : "Informe seu e-mail para receber o link de recuperação."}
    >
      {!backendConfigured && (
        <p role="alert" className="mb-4 text-sm text-red-300">Backend não configurado neste ambiente.</p>
      )}
      <form onSubmit={submit} className="space-y-4" noValidate>
        <AuthField id="email" label="E-mail" type="email" icon={Mail} autoComplete="email" required value={email} onChange={setEmail} />
        {mode === "login" && (
          <AuthPasswordField id="password" label="Senha" autoComplete="current-password" required value={password} onChange={setPassword} />
        )}
        {error && <p role="alert" className="text-sm text-red-300">{error}</p>}
        {info && <p role="status" className="text-sm text-white/70">{info}</p>}

        {mode === "login" && (
          <div className="text-right">
            <button type="button" onClick={() => setMode("forgot")} className="text-sm text-white/60 transition-colors hover:text-white">
              Esqueci minha senha
            </button>
          </div>
        )}

        <button
          type="submit"
          disabled={busy || !backendConfigured}
          className="flex h-11 w-full items-center justify-center gap-2 rounded-lg bg-accent text-[15px] font-medium text-accent-foreground transition-all hover:bg-accent/90 disabled:opacity-50"
        >
          {busy && <Loader2 className="h-4 w-4 animate-spin" aria-hidden="true" />}
          {busy ? "Aguarde…" : mode === "login" ? "Entrar" : "Enviar link"}
        </button>
      </form>

      <div className="mt-6 flex items-center justify-between text-sm">
        {mode === "login" ? (
          <Link to="/primeiro-acesso" className="text-white/60 transition-colors hover:text-white">Primeiro acesso</Link>
        ) : (
          <button type="button" onClick={() => setMode("login")} className="text-white/60 transition-colors hover:text-white">Voltar ao login</button>
        )}
        <Link to="/" className="text-white/40 transition-colors hover:text-white/70">Ir para o site</Link>
      </div>
    </AuthShell>
  );
};

export default Login;
