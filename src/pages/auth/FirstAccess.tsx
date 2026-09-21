import { useState, type FormEvent } from "react";
import { Link } from "react-router-dom";
import { supabase, backendConfigured } from "@/lib/supabase";
import AuthShell, { fieldClass } from "./AuthShell";

/**
 * Primeiro acesso: a pessoa cria a própria senha e confirma o e-mail. O papel só é concedido no banco
 * quando o e-mail VERIFICADO corresponde a um convite aberto (ou ao bootstrap de gestores). Sem convite = sem acesso.
 */
const FirstAccess = () => {
  const [email, setEmail] = useState(""); const [pw, setPw] = useState(""); const [pw2, setPw2] = useState("");
  const [busy, setBusy] = useState(false); const [error, setError] = useState<string | null>(null); const [sent, setSent] = useState(false);
  const submit = async (e: FormEvent) => {
    e.preventDefault(); setError(null);
    if (pw.length < 10) return setError("Use ao menos 10 caracteres."); if (pw !== pw2) return setError("As senhas não coincidem.");
    setBusy(true);
    const { error } = await supabase.auth.signUp({ email: email.trim(), password: pw, options: { emailRedirectTo: `${window.location.origin}/app` } });
    setBusy(false);
    if (error && error.status === 429) return setError("Muitas tentativas. Aguarde alguns minutos.");
    setSent(true); // mesma resposta com ou sem convite (não revela quem está convidado)
  };
  if (sent) return (<AuthShell title="Verifique seu e-mail" subtitle="Enviamos um link de confirmação."><p className="text-navy-700 mb-4">Depois de confirmar o e-mail, entre com a senha que você acabou de criar. O acesso só é liberado se houver um convite para este endereço.</p><Link to="/login" className="btn-primary w-full">Ir para o login</Link></AuthShell>);
  return (
    <AuthShell title="Primeiro acesso" subtitle="Use o mesmo e-mail que recebeu o convite.">
      {!backendConfigured && <p role="alert" className="mb-4 text-sm text-destructive">Backend não configurado neste ambiente.</p>}
      <form onSubmit={submit} className="space-y-5" noValidate>
        <div><label htmlFor="e" className="block text-sm text-navy-700 mb-1">E-mail</label><input id="e" type="email" autoComplete="email" required value={email} onChange={(e) => setEmail(e.target.value)} className={fieldClass} /></div>
        <div><label htmlFor="p1" className="block text-sm text-navy-700 mb-1">Crie uma senha</label><input id="p1" type="password" autoComplete="new-password" required value={pw} onChange={(e) => setPw(e.target.value)} className={fieldClass} /></div>
        <div><label htmlFor="p2" className="block text-sm text-navy-700 mb-1">Confirme a senha</label><input id="p2" type="password" autoComplete="new-password" required value={pw2} onChange={(e) => setPw2(e.target.value)} className={fieldClass} /></div>
        {error && <p role="alert" className="text-sm text-destructive">{error}</p>}
        <button disabled={busy || !backendConfigured} className="btn-primary w-full disabled:opacity-60">{busy ? "Aguarde…" : "Criar acesso"}</button>
      </form>
      <p className="mt-6 text-sm"><Link to="/login" className="text-accent">Já tenho acesso</Link></p>
    </AuthShell>
  );
};
export default FirstAccess;
