import { useEffect, useState, type FormEvent } from "react";
import { Link, Navigate, useLocation } from "react-router-dom";
import { supabase, backendConfigured } from "@/lib/supabase";
import { useAuth } from "@/auth/AuthProvider";
import AuthShell, { fieldClass } from "./AuthShell";

type Mode = "login" | "forgot";

const Login = () => {
  const { session, loading } = useAuth();
  const location = useLocation();
  const from = (location.state as { from?: string } | null)?.from ?? "/admin";
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
    } finally { setBusy(false); }
  };

  return (
    <AuthShell
      title={mode === "login" ? "Entrar" : "Recuperar senha"}
      subtitle={mode === "login" ? "Acesse o painel com o e-mail do seu convite." : "Informe seu e-mail para receber o link de recuperação."}
    >
      {!backendConfigured && (
        <p role="alert" className="mb-4 text-sm text-destructive">Backend não configurado neste ambiente.</p>
      )}
      <form onSubmit={submit} className="space-y-5" noValidate>
        <div>
          <label htmlFor="email" className="block text-sm text-navy-700 mb-1">E-mail</label>
          <input id="email" type="email" autoComplete="email" required value={email}
            onChange={(e) => setEmail(e.target.value)} className={fieldClass} />
        </div>
        {mode === "login" && (
          <div>
            <label htmlFor="password" className="block text-sm text-navy-700 mb-1">Senha</label>
            <input id="password" type="password" autoComplete="current-password" required value={password}
              onChange={(e) => setPassword(e.target.value)} className={fieldClass} />
          </div>
        )}
        {error && <p role="alert" className="text-sm text-destructive">{error}</p>}
        {info && <p role="status" className="text-sm text-navy-700">{info}</p>}
        <button type="submit" disabled={busy || !backendConfigured} className="btn-primary w-full disabled:opacity-60">
          {busy ? "Aguarde…" : mode === "login" ? "Entrar" : "Enviar link"}
        </button>
      </form>
      <div className="mt-6 flex justify-between text-sm">
        {mode === "login"
          ? <button type="button" onClick={() => setMode("forgot")} className="text-accent hover:text-navy-900">Esqueci minha senha</button>
          : <button type="button" onClick={() => setMode("login")} className="text-accent hover:text-navy-900">Voltar ao login</button>}
        <Link to="/" className="text-navy-400 hover:text-navy-900">Ir para o site</Link>
      </div>
    </AuthShell>
  );
};

export default Login;
