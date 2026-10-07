// Planejamento da sincronização HP → Google (puro: sem rede, sem banco) — por isso dá para testar criação, remarcação, cancelamento, duplicidade e privacidade sem o Google.
// O que entra no Google é SEMPRE o mínimo: "Atendimento HP" + unidade. Nunca nota, motivo de cancelamento, avaliação ou qualquer dado clínico. O primeiro nome do paciente e o nome do
// serviço só saem se o PRÓPRIO usuário escolher "names" nas configurações da conexão.

export type Detail = "minimal" | "names";
export interface Appt { id: string; period: string; status: string; updated_at: string; person?: { full_name?: string | null } | null; service?: { name?: string | null } | null; unit?: { name?: string | null } | null }
export interface Link { local_id: string; google_event_id: string; local_version: number | string }
export type Action =
  | { type: "upsert"; localId: string; eventId: string; create: boolean; version: number; body: Record<string, unknown> }
  | { type: "delete"; localId: string; eventId: string };

/** Estados que aparecem no calendário; qualquer outro (cancelado, remarcado, falta, ausência do profissional) sai. */
export const VISIBLE = ["scheduled", "confirmed", "attended"];
/** Id de evento determinístico por atendimento: impossível criar dois eventos para o mesmo atendimento (o Google recusa id repetido com 409). */
export const eventIdFor = (appointmentId: string) => "hp" + String(appointmentId).replace(/-/g, "");
export const versionOf = (updatedAt: string) => Math.floor(Date.parse(updatedAt) / 1000);

/** "[2026-10-01 13:00:00+00,2026-10-01 13:50:00+00)" (ou com microssegundos/deslocamentos) → [início, fim] em ISO UTC. */
export function parsePeriod(p: string): [string, string] {
  const parts = p.replace(/[[\]()"]/g, "").split(",");
  const iso = (s: string) => { const t = s.trim().replace(" ", "T"); return new Date(/[zZ]|[+-]\d{2}(:?\d{2})?$/.test(t) ? t.replace(/([+-]\d{2})$/, "$1:00") : t + "Z").toISOString(); };
  return [iso(parts[0]), iso(parts[1])];
}

export function buildBody(a: Appt, detail: Detail): Record<string, unknown> {
  const [s, e] = parsePeriod(a.period);
  const first = String(a.person?.full_name ?? "").trim().split(/\s+/)[0] ?? "";
  const summary = detail === "names" && first ? `Atendimento: ${first}${a.service?.name ? ` — ${a.service.name}` : ""}` : "Atendimento HP";
  return {
    id: eventIdFor(a.id), status: "confirmed", summary, location: a.unit?.name ?? undefined,
    description: "Evento do HP Group Hub. Alterações aqui não voltam para o HP.",
    start: { dateTime: s, timeZone: "UTC" }, end: { dateTime: e, timeZone: "UTC" },
    extendedProperties: { private: { hp_kind: "appointment", hp_id: a.id } }, reminders: { useDefault: false },
  };
}

/** Decide, para cada atendimento da agenda do profissional, o que fazer no Google. Um atendimento repetido na lista gera no máximo uma ação. */
export function planAppointments(appts: Appt[], links: Link[], detail: Detail): Action[] {
  const byLocal = new Map(links.map((l) => [l.local_id, l])); const seen = new Set<string>(); const out: Action[] = [];
  for (const a of appts) {
    if (seen.has(a.id)) continue; seen.add(a.id);
    const link = byLocal.get(a.id); const eventId = eventIdFor(a.id); const version = versionOf(a.updated_at);
    if (VISIBLE.includes(a.status)) {
      if (link && Number(link.local_version) === version) continue;                 // nada mudou desde o último envio
      out.push({ type: "upsert", localId: a.id, eventId, create: !link, version, body: buildBody(a, detail) });   // criação (sem vínculo) ou remarcação/alteração (vínculo com versão antiga)
    } else if (link) out.push({ type: "delete", localId: a.id, eventId: link.google_event_id || eventId });         // cancelado/remarcado/ausência: remove do Google
  }
  return out;
}
