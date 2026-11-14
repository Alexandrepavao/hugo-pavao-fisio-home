import { supabase } from "@/lib/supabase";
import type { Appt, Pt } from "./core";

/** Contrato com a Edge Function `route-planner` e com as RPCs de logística. Nada aqui chama provedor de rotas direto: a chave fica no backend. */
export type Profile = "driving-car" | "foot-walking" | "cycling-regular";
export const PROFILE_LABEL: Record<Profile, string> = { "driving-car": "Carro", "foot-walking": "A pé", "cycling-regular": "Bicicleta" };
export interface DayAppt { id: string; starts_at: string; ends_at: string; status: string; person_id: string; person: string; service: string; unit_id: string; unit: string; mode: Appt["mode"]; fixed: boolean; lat: number | null; lng: number | null; precision: Pt["precision"]; patient_confirmed_at: string | null }
export interface RouteDay { is_self: boolean; timezone: string; date: string; unit_id: string | null; prefs: { profile: Profile; buffer_min: number; start_mode: "unit" | "own_point" }; start: (Pt & { kind: "unit" | "own_point"; label: string }) | null; appointments: DayAppt[] }
export interface MatrixInfo { keys: string[]; durations: (number | null)[][]; status: "ok" | "partial" | "unavailable" | "cap"; message: string | null; source: "cache" | "provider" | "mixed" | "none"; profile: Profile; provider: string; attribution: string | null; simulated: boolean }
export interface DayResponse { day: RouteDay; matrix: MatrixInfo; extra_place: Pt | null; note: string }
export interface Place { lat: number; lng: number; precision: "exact" | "street" | "cep"; source: string; access_notes: string | null; updated_at: string }
export interface Change { id: string; expected_start: string; new_start: string }

export class RouteError extends Error { constructor(public code: string, message: string, public status?: number) { super(message); this.name = "RouteError"; } }

async function invoke<T>(body: Record<string, unknown>): Promise<T> {
  const { data, error } = await supabase.functions.invoke("route-planner", { body });
  if (error) {
    let payload: { error?: string; message?: string } | null = null;
    try { payload = await (error as { context?: Response }).context?.json(); } catch { /* sem corpo */ }
    throw new RouteError(payload?.error ?? "erro", payload?.message ?? (payload?.error === "sem permissão" ? "Sem permissão para ver esta rota." : "Não foi possível consultar a rota agora."), (error as { context?: Response }).context?.status);
  }
  return data as T;
}
export const routeDay = (professional: string, date: string, extraPerson?: string) => invoke<DayResponse>({ action: "day", professional, date, ...(extraPerson ? { extra_person: extraPerson } : {}) });
export const routeGeometry = (professional: string, date: string, order?: string[]) => invoke<{ status: "ok" | "unavailable" | "cap"; message?: string; line?: [number, number][]; distance_m?: number; duration_s?: number; attribution?: string }>({ action: "geometry", professional, date, order });
export const routeApply = (professional: string, date: string, changes: Change[], note?: string) => invoke<{ ok: true; log_id: string; applied: { id: string; old_start: string; new_start: string }[] }>({ action: "apply", professional, date, changes, note });
export const routeStatus = () => invoke<{ configured: boolean; provider: string; message: string | null }>({ action: "status" });

export const toAppts = (d: RouteDay): Appt[] => d.appointments.map((a) => ({
  id: a.id, start: Date.parse(a.starts_at), end: Date.parse(a.ends_at), status: a.status, mode: a.mode, fixed: a.fixed,
  pt: a.lat !== null && a.lng !== null ? { lat: a.lat, lng: a.lng, precision: a.precision } : null, label: (a.person ?? "").split(" ")[0],
}));

/** "-23.5614, -46.6559" (cópia de coordenadas do Google Maps) → {lat,lng}. */
export function parseLatLng(text: string): { lat: number; lng: number } | null {
  const m = /^\s*(-?\d{1,3}(?:[.,]\d+)?)\s*[,;\s]\s*(-?\d{1,3}(?:[.,]\d+)?)\s*$/.exec(text.replace(/\s+/g, " "));
  if (!m) return null;
  const lat = Number(m[1].replace(",", ".")), lng = Number(m[2].replace(",", "."));
  return Number.isFinite(lat) && Number.isFinite(lng) ? { lat, lng } : null;
}
/** Link de navegação SÓ para um destino (o do aparelho de quem usa). A rota com todos os pacientes nunca vira link. */
export const navUrl = (p: { lat: number; lng: number }, profile: Profile) =>
  `https://www.google.com/maps/dir/?api=1&destination=${p.lat.toFixed(5)},${p.lng.toFixed(5)}&travelmode=${profile === "foot-walking" ? "walking" : profile === "cycling-regular" ? "bicycling" : "driving"}`;

export const fmtClock = (ms: number, tz: string) => new Date(ms).toLocaleTimeString("pt-BR", { hour: "2-digit", minute: "2-digit", timeZone: tz });
