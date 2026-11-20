import { Navigate } from "react-router-dom";
import { supabase } from "@/lib/supabase";
import { getActiveOrg } from "@/lib/org";
import AuthShell from "@/pages/auth/AuthShell";
import { useOrg } from "./OrgProvider";
import { PendingInvitations } from "./OrgWidgets";

export const Neutral = () => <div className="min-h-screen flex items-center justify-center text-navy-400" role="status" data-testid="organizacao-carregando">Carregando…</div>;

/** Slug desconhecido, organização suspensa/arquivada/em preparação: UMA resposta só (não revela qual é o caso). Sem marca, sem menu e sem dado nenhum. */
export const ScopeNotFound = () => (
  <div className="min-h-screen flex items-center justify-center px-6 text-center" data-testid="organizacao-indisponivel">
    <div className="max-w-md"><h1 className="font-display text-2xl text-navy-900 mb-2">Endereço indisponível</h1>
      <p className="text-navy-400">Este endereço não está disponível. Confira o link recebido ou fale com quem enviou.</p></div>
  </div>
);

/** Usuário conectado SEM vínculo com a organização do endereço: nada da organização é carregado; só o convite (se houver) para aceitar, ou sair. */
export const ScopeNoAccess = () => {
  const org = useOrg();
  return (
    <AuthShell title="Sem acesso a esta organização" subtitle={`Sua conta não tem vínculo ativo com ${org.brandName}.`}>
      <div data-testid="sem-vinculo" className="text-left text-white">
        <PendingInvitations />
        <button type="button" onClick={() => void supabase.auth.signOut().then(() => window.location.assign(window.location.pathname))}
          className="mt-6 flex h-11 w-full items-center justify-center rounded-lg border border-white/20 text-[15px] text-white/80 hover:bg-white/10">Sair e entrar com outra conta</button>
      </div>
    </AuthShell>
  );
};

/** Depois do login em /empresa/<slug>: só segue quando os vínculos foram carregados E a organização do endereço virou a ativa desta aba (a troca recarrega a página uma vez).
 *  Sem vínculo: tela própria (com o convite pendente, se existir). Nunca cai em outra organização sem o usuário ver. */
export const ScopeEnter = ({ to }: { to: string }) => {
  const org = useOrg();
  if (org.loading || org.scope.access === "loading") return <Neutral />;
  if (org.scope.access === "none") return <ScopeNoAccess />;
  const mine = org.memberships.find((m) => m.slug === org.scope.slug);
  if (!mine || getActiveOrg() !== mine.org_id) return <Neutral />;
  return <Navigate to={to} replace />;
};
