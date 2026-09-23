import { createContext, useCallback, useContext, useEffect, useMemo, useState, type ReactNode } from "react";
import type { Session, User } from "@supabase/supabase-js";
import { supabase, backendConfigured } from "@/lib/supabase";

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
}

const AuthContext = createContext<AuthState | null>(null);

export const AuthProvider = ({ children }: { children: ReactNode }) => {
  const [session, setSession] = useState<Session | null>(null);
  const [roles, setRoles] = useState<RoleAssignment[]>([]);
  const [loading, setLoading] = useState(backendConfigured);
  // "Papéis carregando" conta como carregamento: logo após o login a sessão existe, mas os papéis ainda não chegaram.
  const [rolesLoading, setRolesLoading] = useState(false);

  const loadRoles = useCallback(async (s: Session | null) => {
    if (!s) { setRoles([]); setRolesLoading(false); return; }
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
      await loadRoles(data.session);
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

  const value = useMemo<AuthState>(() => ({
    loading: loading || rolesLoading,
    session,
    user: session?.user ?? null,
    roles,
    noAccess: Boolean(session) && !loading && !rolesLoading && roles.length === 0,
    hasRole: (...wanted) => roles.some((r) => wanted.includes(r.role)),
    signOut: async () => { await supabase.auth.signOut(); },
    refreshRoles: () => loadRoles(session),
  }), [loading, rolesLoading, session, roles, loadRoles]);

  return <AuthContext.Provider value={value}>{children}</AuthContext.Provider>;
};

export const useAuth = () => {
  const ctx = useContext(AuthContext);
  if (!ctx) throw new Error("useAuth deve ser usado dentro de AuthProvider");
  return ctx;
};

export const STAFF_ROLES: AppRole[] = ["manager", "ops_admin", "unit_manager", "sales", "finance", "physio", "teacher"];
