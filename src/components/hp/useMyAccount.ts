import { useQuery } from "@tanstack/react-query";
import { supabase } from "@/lib/supabase";
import { useAuth } from "@/auth/AuthProvider";

export interface MyAccount { display_name: string | null; email: string | null; person_id: string | null }
export const MY_ACCOUNT_KEY = "my-account";

/** Conta do usuário logado (nome de exibição, e-mail e vínculo com o cadastro de pessoa). Uma única consulta compartilhada por cabeçalho, saudação e Configurações. */
export const useMyAccount = () => {
  const { user } = useAuth();
  return useQuery({
    queryKey: [MY_ACCOUNT_KEY, user?.id], enabled: !!user, staleTime: 60_000,
    queryFn: async () => ((await supabase.from("user_accounts").select("display_name, email, person_id").eq("user_id", user!.id).maybeSingle()).data ?? null) as MyAccount | null,
  });
};

/** Nome para exibir: o definido pelo usuário/gestor; na falta dele, a parte do e-mail antes do @. */
export const shownName = (a: MyAccount | null | undefined, email?: string | null) => (a?.display_name?.trim() || (a?.email ?? email ?? "").split("@")[0] || "—");

/** Duas letras para o avatar: iniciais do primeiro e do último nome (ou as duas primeiras letras de um nome só). */
export const initialsOf = (name: string) => {
  const parts = name.trim().split(/\s+/).filter(Boolean);
  const s = parts.length >= 2 ? parts[0][0] + parts[parts.length - 1][0] : (parts[0] ?? "?").slice(0, 2);
  return s.toUpperCase();
};
