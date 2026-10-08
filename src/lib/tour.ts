import type { AppRole } from "@/auth/AuthProvider";

const STAFF: AppRole[] = ["manager", "ops_admin", "unit_manager", "sales", "finance", "physio", "teacher"];
export const tourKey = (uid: string) => `hp-boas-vindas:${uid}`;
export const hasSeenTour = (uid: string): boolean => { try { return localStorage.getItem(tourKey(uid)) === "1"; } catch { return true; } };      // sem storage: não insiste
export const markTourSeen = (uid: string) => { try { localStorage.setItem(tourKey(uid), "1"); } catch { /* sem storage */ } };

/** O tutorial abre sozinho no primeiro login de quem entra por convite/onboarding (fisioterapeuta, paciente e demais papéis); gestão já conhece o sistema e acessa pelo menu. */
export const shouldAutoTour = (hasRole: (...r: AppRole[]) => boolean) => !hasRole("manager", "ops_admin");

/** Destino padrão de cada perfil (o mesmo da tela /app). */
export const homeFor = (hasRole: (...r: AppRole[]) => boolean): string => {
  if (hasRole(...STAFF)) return "/admin";
  if (hasRole("partner")) return "/parceiro";
  return "/paciente";
};
