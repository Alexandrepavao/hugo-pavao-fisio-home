import { useState, type FormEvent } from "react";
import { Link } from "react-router-dom";
import { Loader2, Mail } from "lucide-react";
import { supabase, backendConfigured } from "@/lib/supabase";
import AuthShell from "./AuthShell";
import AuthField from "./AuthField";
import AuthPasswordField from "./AuthPasswordField";

/**
 * Primeiro acesso: a pessoa cria a própria senha e confirma o e-mail. O papel só é concedido no banco
 * quando o e-mail VERIFICADO corresponde a um convite aberto (ou ao bootstrap de gestores). Sem convite = sem acesso.
 */
const FirstAccess = () => {
  const [email, setEmail] = useState("");
  const [pw, setPw] = useState("");
  const [pw2, setPw2] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [sent, setSent] = useState(false);

  const submit = async (e: FormEvent) => {
    e.preventDefault();
    if (busy) return;
    setError(null);
    if (pw.length < 10) return setError("Use ao menos 10 caracteres.");
    if (pw !== pw2) return setError("As senhas não coincidem.");
    setBusy(true);
    try {
      const { error } = await supabase.auth.signUp({ email: email.trim(), password: pw, options: { emailRedirectTo: `${window.location.origin}/app` } });
      if (error && error.status === 429) { setError("Muitas tentativas. Aguarde alguns minutos."); return; }
      setSent(true); // mesma resposta com ou sem convite (não revela quem está convidado)
    } catch {
      setError("Não foi possível conectar agora. Verifique sua internet e tente novamente.");
    } finally { setBusy(false); }
  };

  if (sent) return (
    <AuthShell title="Verifique seu e-mail" subtitle="Enviamos um link de confirmação.">
      <p className="mb-6 text-[15px] text-white/70">
        Depois de confirmar o e-mail, entre com a senha que você acabou de criar. O acesso só é liberado se houver um convite para este endereço.
      </p>
      <Link
        to="/login"
        className="flex h-11 w-full items-center justify-center rounded-lg bg-accent text-[15px] font-medium text-accent-foreground transition-all hover:bg-accent/90"
      >
        Ir para o login
      </Link>
    </AuthShell>
  );

  return (
    <AuthShell title="Primeiro acesso" subtitle="Explique brevemente: use o mesmo e-mail que recebeu o convite para criar sua senha.">
      {!backendConfigured && <p role="alert" className="mb-4 text-sm text-red-300">Backend não configurado neste ambiente.</p>}
      <form onSubmit={submit} className="space-y-4" noValidate>
        <AuthField id="e" label="E-mail" type="email" icon={Mail} autoComplete="email" required value={email} onChange={setEmail} />
        <AuthPasswordField id="p1" label="Crie uma senha" autoComplete="new-password" required value={pw} onChange={setPw} />
        <AuthPasswordField id="p2" label="Confirme a senha" autoComplete="new-password" required value={pw2} onChange={setPw2} />
        {error && <p role="alert" className="text-sm text-red-300">{error}</p>}
        <button
          type="submit"
          disabled={busy || !backendConfigured}
          className="flex h-11 w-full items-center justify-center gap-2 rounded-lg bg-accent text-[15px] font-medium text-accent-foreground transition-all hover:bg-accent/90 disabled:opacity-50"
        >
          {busy && <Loader2 className="h-4 w-4 animate-spin" aria-hidden="true" />}
          {busy ? "Aguarde…" : "Criar acesso"}
        </button>
      </form>
      <p className="mt-6 text-center text-sm">
        <Link to="/login" className="text-white/60 transition-colors hover:text-white">Já tenho acesso</Link>
      </p>
    </AuthShell>
  );
};

export default FirstAccess;
