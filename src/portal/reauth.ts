import { supabase } from "@/lib/supabase";
import { errText, promptText } from "@/lib/ui";

/** Ações sensíveis (consentir, revogar acesso, aceitar delegação) exigem senha digitada há pouco: o banco confere o instante do login no próprio token.
 *  Aqui pedimos a senha e fazemos um login novo — nada é guardado, e a senha nunca sai do navegador a não ser para o serviço de login. */
export const reauthenticate = async (): Promise<{ ok: boolean; error?: string }> => {
  const { data } = await supabase.auth.getUser(); const email = data.user?.email;
  if (!email) return { ok: false, error: "Sessão expirada. Entre novamente." };
  const pass = await promptText("Confirme sua senha", "Senha", { description: "Por segurança, confirme que é você antes de continuar.", kind: "password", confirmLabel: "Confirmar" });
  if (pass === null) return { ok: false };
  const r = await supabase.auth.signInWithPassword({ email, password: pass });
  return r.error ? { ok: false, error: "Senha incorreta." } : { ok: true };
};

const NEEDS = /reautentica/i;
/** Chama uma função do banco; se ela pedir senha recente, pergunta a senha e tenta de novo uma vez. */
export const rpcReauth = async (fn: string, args: Record<string, unknown>): Promise<{ error?: string; data?: unknown }> => {
  let r = await supabase.rpc(fn, args);
  if (r.error && NEEDS.test(r.error.message)) {
    const a = await reauthenticate(); if (!a.ok) return { error: a.error ?? "Ação cancelada." };
    r = await supabase.rpc(fn, args);
  }
  return r.error ? { error: errText(r.error) } : { data: r.data };
};
