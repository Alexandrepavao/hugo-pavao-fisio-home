/** “Ver como”: o gestor vê o app como o fisioterapeuta ou o paciente veria, SOMENTE LEITURA (migration 128).
 *  A sessão fica só nesta aba (sessionStorage): outra aba, ou o login normal, continua sendo o gestor. O servidor valida a sessão a cada chamada (cabeçalho x-view-as). */
const KEY = "hp.viewAs";

export interface ViewAsInfo {
  session_id: string; target_user_id: string; target_person_id: string | null; name: string | null; email?: string | null; kind: "physio" | "patient";
  roles: { role: string; unit_id: string | null }[]; expires_at: string; started_at?: string;
}

let current: string | null = (() => { try { return sessionStorage.getItem(KEY); } catch { return null; } })();
export const getViewAsSession = () => current;
export const setViewAsSession = (id: string | null) => {
  current = id;
  try { if (id) sessionStorage.setItem(KEY, id); else sessionStorage.removeItem(KEY); } catch { /* sem sessionStorage: vale só até recarregar */ }
};

export const VIEW_AS_KIND_LABEL: Record<ViewAsInfo["kind"], string> = { physio: "Fisioterapeuta", patient: "Paciente" };
/** Rota inicial de cada tipo de visão. */
export const viewAsHome = (kind: ViewAsInfo["kind"]) => (kind === "physio" ? "/fisio" : "/paciente");
export const VIEW_AS_EXIT_ROUTE = "/admin/ver-como";

/** Encerra a sessão no servidor. Tem de ir SEM o cabeçalho e com o login real do gestor (com o cabeçalho a chamada é somente leitura). */
export const endViewAsOnServer = async (sessionId: string | null, accessToken: string | null | undefined) => {
  const url = import.meta.env.VITE_SUPABASE_URL as string | undefined; const key = import.meta.env.VITE_SUPABASE_PUBLISHABLE_KEY as string | undefined;
  if (!sessionId || !url || !key || !accessToken) return;
  try { await fetch(`${url}/rest/v1/rpc/view_as_end`, { method: "POST", headers: { apikey: key, authorization: `Bearer ${accessToken}`, "content-type": "application/json" }, body: JSON.stringify({ p_session: sessionId }) }); } catch { /* a sessão expira sozinha em 4 h */ }
};
