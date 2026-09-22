import { useEffect, useState, type FormEvent } from "react";
import { Link, useNavigate } from "react-router-dom";
import { Loader2 } from "lucide-react";
import { supabase } from "@/lib/supabase";
import AuthShell from "./AuthShell";
import AuthPasswordField from "./AuthPasswordField";

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
    // Aguardamos a validação antes de mostrar qualquer estado de erro (nunca redireciona antes de checar a sessão).
    const t = setTimeout(async () => {
      const { data } = await supabase.auth.getSession();
      if (!cancelled) setPhase((p) => (p === "checking" ? (data.session ? "ready" : "invalid") : p));
    }, 1500);
    return () => { cancelled = true; clearTimeout(t); sub.subscription.unsubscribe(); };
  }, []);

  const submit = async (e: FormEvent) => {
    e.preventDefault();
    if (busy) return;
    setError(null);
    if (password.length < 10) return setError("Use ao menos 10 caracteres.");
    if (password !== confirm) return setError("As senhas não coincidem.");
    setBusy(true);
    try {
      const { error } = await supabase.auth.updateUser({ password });
      if (error) { setError(error.message.includes("same") ? "Escolha uma senha diferente da anterior." : "Não foi possível atualizar a senha. Solicite um novo link."); return; }
      setPhase("done");
      await supabase.auth.signOut(); // força o login com a nova senha (fluxo: link → nova senha → login)
      setTimeout(() => navigate("/login", { replace: true }), 2500);
    } catch {
      setError("Não foi possível conectar agora. Verifique sua internet e tente novamente.");
    } finally { setBusy(false); }
  };

  if (phase === "checking")
    return (
      <AuthShell title="Validando link…">
        <p role="status" className="text-white/60">Aguarde um instante.</p>
      </AuthShell>
    );

  if (phase === "invalid")
    return (
      <AuthShell title="Link inválido ou expirado" subtitle="Por segurança, cada link vale por tempo limitado e só pode ser usado uma vez — inclusive se já foi aberto antes.">
        <Link
          to="/login"
          className="flex h-11 w-full items-center justify-center rounded-lg bg-accent text-[15px] font-medium text-accent-foreground transition-all hover:bg-accent/90"
        >
          Solicitar novo link
        </Link>
      </AuthShell>
    );

  if (phase === "done")
    return (
      <AuthShell title="Senha atualizada">
        <p role="status" className="text-white/70">Pronto. Redirecionando para o login…</p>
      </AuthShell>
    );

  return (
    <AuthShell title="Definir nova senha" subtitle="Escolha uma senha com ao menos 10 caracteres.">
      <form onSubmit={submit} className="space-y-4" noValidate>
        <AuthPasswordField id="pw" label="Nova senha" autoComplete="new-password" required value={password} onChange={setPassword} />
        <AuthPasswordField id="pw2" label="Confirmar senha" autoComplete="new-password" required value={confirm} onChange={setConfirm} />
        {error && <p role="alert" className="text-sm text-red-300">{error}</p>}
        <button
          type="submit"
          disabled={busy}
          className="flex h-11 w-full items-center justify-center gap-2 rounded-lg bg-accent text-[15px] font-medium text-accent-foreground transition-all hover:bg-accent/90 disabled:opacity-50"
        >
          {busy && <Loader2 className="h-4 w-4 animate-spin" aria-hidden="true" />}
          {busy ? "Salvando…" : "Salvar nova senha"}
        </button>
      </form>
    </AuthShell>
  );
};

export default ResetPassword;
