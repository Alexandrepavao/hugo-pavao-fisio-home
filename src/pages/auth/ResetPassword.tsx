import { useEffect, useState, type FormEvent } from "react";
import { Link, useNavigate } from "react-router-dom";
import { supabase } from "@/lib/supabase";
import AuthShell, { fieldClass } from "./AuthShell";

type Phase = "checking" | "ready" | "invalid" | "done";

// Serve para recuperação de senha e para o primeiro acesso por convite (mesmo mecanismo de link).
function readLinkError(): string | null {
  const params = new URLSearchParams(window.location.hash.replace(/^#/, "") || window.location.search);
  return params.get("error_code") || params.get("error");
}

const ResetPassword = () => {
  const navigate = useNavigate();
  const [phase, setPhase] = useState<Phase>("checking");
  const [password, setPassword] = useState("");
  const [confirm, setConfirm] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    if (readLinkError()) { setPhase("invalid"); return; }
    let cancelled = false;
    const { data: sub } = supabase.auth.onAuthStateChange((event, session) => {
      if ((event === "PASSWORD_RECOVERY" || event === "SIGNED_IN") && session && !cancelled) setPhase("ready");
    });
    // Se o link foi consumido e a sessão existe, libera o formulário; caso contrário o link é inválido/expirado.
    const t = setTimeout(async () => {
      const { data } = await supabase.auth.getSession();
      if (!cancelled) setPhase((p) => (p === "checking" ? (data.session ? "ready" : "invalid") : p));
    }, 1500);
    return () => { cancelled = true; clearTimeout(t); sub.subscription.unsubscribe(); };
  }, []);

  const submit = async (e: FormEvent) => {
    e.preventDefault();
    setError(null);
    if (password.length < 10) return setError("Use ao menos 10 caracteres.");
    if (password !== confirm) return setError("As senhas não coincidem.");
    setBusy(true);
    const { error } = await supabase.auth.updateUser({ password });
    setBusy(false);
    if (error) return setError(error.message.includes("same") ? "Escolha uma senha diferente da anterior." : "Não foi possível atualizar a senha. Solicite um novo link.");
    setPhase("done");
    await supabase.auth.signOut(); // força o login com a nova senha (fluxo: link → nova senha → login)
    setTimeout(() => navigate("/login", { replace: true }), 2500);
  };

  if (phase === "checking")
    return <AuthShell title="Validando link…"><p role="status" className="text-navy-400">Aguarde um instante.</p></AuthShell>;

  if (phase === "invalid")
    return (
      <AuthShell title="Link inválido ou expirado" subtitle="Por segurança, cada link vale por tempo limitado e só pode ser usado uma vez.">
        <Link to="/login" className="btn-primary w-full">Solicitar novo link</Link>
      </AuthShell>
    );

  if (phase === "done")
    return (
      <AuthShell title="Senha atualizada">
        <p role="status" className="text-navy-700">Pronto. Redirecionando para o login…</p>
      </AuthShell>
    );

  return (
    <AuthShell title="Definir nova senha" subtitle="Escolha uma senha com ao menos 10 caracteres.">
      <form onSubmit={submit} className="space-y-5" noValidate>
        <div>
          <label htmlFor="pw" className="block text-sm text-navy-700 mb-1">Nova senha</label>
          <input id="pw" type="password" autoComplete="new-password" required value={password}
            onChange={(e) => setPassword(e.target.value)} className={fieldClass} />
        </div>
        <div>
          <label htmlFor="pw2" className="block text-sm text-navy-700 mb-1">Confirmar senha</label>
          <input id="pw2" type="password" autoComplete="new-password" required value={confirm}
            onChange={(e) => setConfirm(e.target.value)} className={fieldClass} />
        </div>
        {error && <p role="alert" className="text-sm text-destructive">{error}</p>}
        <button type="submit" disabled={busy} className="btn-primary w-full disabled:opacity-60">
          {busy ? "Salvando…" : "Salvar nova senha"}
        </button>
      </form>
    </AuthShell>
  );
};

export default ResetPassword;
