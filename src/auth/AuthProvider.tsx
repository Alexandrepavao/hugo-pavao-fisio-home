import { createContext, useCallback, useContext, useEffect, useMemo, useState, type ReactNode } from "react";
import type { Session, User } from "@supabase/supabase-js";
import { supabase, backendConfigured } from "@/lib/supabase";
import { endViewAsOnServer, getViewAsSession, setViewAsSession, VIEW_AS_EXIT_ROUTE, type ViewAsInfo } from "@/lib/viewAs";

export type AppRole =
  | "manager" | "ops_admin" | "unit_manager" | "sales" | "finance"
  | "physio" | "teacher" | "partner" | "member";

export interface RoleAssignment { role: AppRole; unit_id: string | null }

interface AuthState {
  loading: boolean;
  session: Session | null;
  user: User | null;
  roles: RoleAssignment[];
  /** true quando o usuário autenticou mas não possui conta/papel ativo (sem convite). */
  noAccess: boolean;
  /** Apenas para exibir/ocultar menus. A autorização real é feita no servidor (RLS/funções). */
  hasRole: (...roles: AppRole[]) => boolean;
  signOut: () => Promise<void>;
  refreshRoles: () => Promise<void>;
  /** “Ver como” ativo nesta aba (gestor vendo o app de outra pessoa, somente leitura); user e roles já são os da pessoa vista. */
  viewAs: ViewAsInfo | null;
  exitViewAs: () => Promise<void>;
}

const AuthContext = createContext<AuthState | null>(null);

export const AuthProvider = ({ children }: { children: ReactNode }) => {
  const [session, setSession] = useState<Session | null>(null);
  const [roles, setRoles] = useState<RoleAssignment[]>([]);
  const [loading, setLoading] = useState(backendConfigured);
  // "Papéis carregando" conta como carregamento: logo após o login a sessão existe, mas os papéis ainda não chegaram.
  const [rolesLoading, setRolesLoading] = useState(false);
  const [viewAs, setViewAs] = useState<ViewAsInfo | null>(null);
  const [viewLoading, setViewLoading] = useState(() => backendConfigured && !!getViewAsSession());

  const loadRoles = useCallback(async (s: Session | null) => {
    if (!s) { setRoles([]); setRolesLoading(false); return; }
    if (getViewAsSession()) { setRolesLoading(false); return; }   // em “ver como” os papéis são os da pessoa vista (vêm do servidor)
    setRolesLoading(true);
    const { data, error } = await supabase
      .from("role_assignments")
      .select("role, unit_id, valid_from, valid_until, revoked_at")
      .eq("user_id", s.user.id);
    if (error) { setRoles([]); setRolesLoading(false); return; }
    const now = Date.now();
    setRoles(
      (data ?? [])
        .filter((r) => !r.revoked_at && new Date(r.valid_from).getTime() <= now && (!r.valid_until || new Date(r.valid_until).getTime() > now))
        .map((r) => ({ role: r.role as AppRole, unit_id: r.unit_id }))
    );
    setRolesLoading(false);
  }, []);

  useEffect(() => {
    if (!backendConfigured) return;
    let active = true;
    supabase.auth.getSession().then(async ({ data }) => {
      if (!active) return;
      setSession(data.session);
      if (getViewAsSession() && data.session) {
        // aba em “ver como”: o servidor confirma a sessão e devolve quem está sendo visto; sessão inválida = volta a ser o gestor
        const { data: info, error } = await supabase.rpc("view_as_current");
        if (!active) return;
        if (!error && info) setViewAs(info as ViewAsInfo); else { setViewAsSession(null); await loadRoles(data.session); }
        setViewLoading(false);
      } else {
        await loadRoles(data.session);
      }
      if (active) setLoading(false);
    });
    const { data: sub } = supabase.auth.onAuthStateChange((_event, s) => {
      setSession(s);
      if (s) setRolesLoading(true);
      // Não chamar o supabase dentro do callback de forma síncrona (evita deadlock do cliente).
      setTimeout(() => { void loadRoles(s); }, 0);
    });
    return () => { active = false; sub.subscription.unsubscribe(); };
  }, [loadRoles]);

  const exitViewAs = useCallback(async () => {
    const id = viewAs?.session_id ?? getViewAsSession();
    await endViewAsOnServer(id, session?.access_token);
    setViewAsSession(null);
    window.location.assign(VIEW_AS_EXIT_ROUTE);   // recarrega tudo: nada da pessoa vista fica em memória
  }, [viewAs, session]);

  const value = useMemo<AuthState>(() => {
    const effRoles: RoleAssignment[] = viewAs ? viewAs.roles.map((r) => ({ role: r.role as AppRole, unit_id: r.unit_id })) : roles;
    return {
      loading: loading || rolesLoading || viewLoading,
      session,
      user: viewAs && session ? ({ ...session.user, id: viewAs.target_user_id, email: viewAs.email ?? undefined } as User) : session?.user ?? null,
      roles: effRoles,
      noAccess: Boolean(session) && !loading && !rolesLoading && !viewLoading && effRoles.length === 0,
      hasRole: (...wanted) => effRoles.some((r) => wanted.includes(r.role)),
      signOut: async () => { if (viewAs) await exitViewAs(); else await supabase.auth.signOut(); },
      refreshRoles: () => loadRoles(session),
      viewAs, exitViewAs,
    };
  }, [loading, rolesLoading, viewLoading, session, roles, loadRoles, viewAs, exitViewAs]);

  return <AuthContext.Provider value={value}>{children}</AuthContext.Provider>;
};

export const useAuth = () => {
  const ctx = useContext(AuthContext);
  if (!ctx) throw new Error("useAuth deve ser usado dentro de AuthProvider");
  return ctx;
};

export const STAFF_ROLES: AppRole[] = ["manager", "ops_admin", "unit_manager", "sales", "finance", "physio", "teacher"];
