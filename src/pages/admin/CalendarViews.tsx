import { useMemo } from "react";
import { useQuery } from "@tanstack/react-query";
import { supabase } from "@/lib/supabase";
import { Badge, State } from "@/lib/ui";
import { addDays, calRange, dayKey, hhmm, pad, parseDay, WD, type CalView } from "./calendarUtil";

interface Appt { id: string; starts_at: string; ends_at: string; status: string; person: string; service: string; unit: string; can_confirm: boolean; patient_confirmed_at: string | null; professional_confirmed_at: string | null }
interface Cal {
  is_self: boolean; appointments: Appt[];
  tasks: { id: string; title: string; task_date: string; end_date: string | null; start_time: string | null; completed: boolean }[];
  crm_tasks: { id: string; title: string; due_at: string }[];
  external: { id: string; summary: string | null; starts_at: string; ends_at: string; all_day: boolean }[];
}
interface Item { key: string; at: string; label: string; kind: "appt" | "task" | "crm" | "ext"; appt?: Appt; done?: boolean }

/** Semana e mês do "Meu dia". Agenda própria por padrão; `professionalId` só funciona com permissão (o servidor recusa o resto). Tarefas, tarefas de CRM e compromissos
 *  externos só aparecem na agenda do PRÓPRIO usuário. Confirmar atendimento só existe na própria agenda (nunca em nome de outro profissional). */
const ST: Record<string, string> = { scheduled: "Agendado", confirmed: "Confirmado", attended: "Compareceu", no_show: "Paciente faltou", professional_no_show: "Profissional ausente" };

export type EventKind = "appt" | "task" | "crm" | "ext";
export const KIND_LABEL: Record<EventKind, string> = { appt: "Atendimentos", crm: "Tarefas de CRM", task: "Tarefas pessoais", ext: "Google Calendar" };

const CalendarViews = ({ view, date, professionalId, kinds, onPickDay, onConfirm }: { view: CalView; date: string; professionalId: string; kinds: Set<EventKind>; onPickDay: (d: string) => void; onConfirm: (id: string) => void }) => {
  const { start, end } = calRange(view, date);
  const q = useQuery({ queryKey: ["my-calendar", start.toISOString(), end.toISOString(), professionalId], queryFn: async () => {
    const { data, error } = await supabase.rpc("my_calendar", { p_from: start.toISOString(), p_to: end.toISOString(), p_professional: professionalId || null }); if (error) throw error; return data as Cal;
  } });
  const days = useMemo(() => Array.from({ length: view === "semana" ? 7 : 42 }, (_, i) => addDays(start, i)), [view, start]);
  const byDay = useMemo(() => {
    const m = new Map<string, Item[]>(); const add = (k: string, it: Item) => { if (!m.has(k)) m.set(k, []); m.get(k)!.push(it); };
    const c = q.data; if (!c) return m;
    for (const a of c.appointments) add(dayKey(new Date(a.starts_at)), { key: a.id, at: a.starts_at, label: `${hhmm(a.starts_at)} ${c.is_self ? a.person : a.person} · ${a.service}`, kind: "appt", appt: a });
    for (const t of c.tasks) { const s = parseDay(t.task_date); const e = t.end_date ? parseDay(t.end_date) : s; for (let d = s; d <= e; d = addDays(d, 1)) add(dayKey(d), { key: t.id + dayKey(d), at: `${dayKey(d)}T${t.start_time ?? "23:59"}`, label: `${t.start_time ? t.start_time.slice(0, 5) + " " : ""}${t.title}`, kind: "task", done: t.completed }); }
    for (const t of c.crm_tasks) add(dayKey(new Date(t.due_at)), { key: t.id, at: t.due_at, label: `${hhmm(t.due_at)} ${t.title}`, kind: "crm" });
    for (const e of c.external) {
      const lab = `${e.all_day ? "" : hhmm(e.starts_at) + " "}${e.summary ?? "(sem título)"}`;
      if (e.all_day) { const en = parseDay(e.ends_at.slice(0, 10)); for (let d = parseDay(e.starts_at.slice(0, 10)); d < en; d = addDays(d, 1)) add(dayKey(d), { key: e.id + dayKey(d), at: `${dayKey(d)}T00:00`, label: lab, kind: "ext" }); }   // dia inteiro vem como data (fim exclusivo), sem deslocar pelo fuso
      else { const s0 = new Date(e.starts_at); const en = new Date(e.ends_at); let d = new Date(s0.getFullYear(), s0.getMonth(), s0.getDate()); do { add(dayKey(d), { key: e.id + dayKey(d), at: e.starts_at, label: lab, kind: "ext" }); d = addDays(d, 1); } while (d < en); }
    }
    for (const [k, v] of m) { const keep = v.filter((it) => kinds.has(it.kind)); if (keep.length) { keep.sort((a, b) => a.at.localeCompare(b.at)); m.set(k, keep); } else m.delete(k); }
    return m;
  }, [q.data, kinds]);
  const today = dayKey(new Date()); const curMonth = parseDay(date).getMonth();
  const tone = (k: Item["kind"]) => `hp-ev hp-ev-${k}`;

  return (
    <div>
      <State loading={q.isLoading} error={q.error} />
      {q.data && (<>
        {view === "semana" ? (
          <div className="grid gap-2 md:grid-cols-7" role="grid" aria-label="Semana">
            {days.map((d, i) => { const k = dayKey(d); const items = byDay.get(k) ?? [];
              return (
                <section key={k} className={`hp-card p-2 min-w-0 ${k === today ? "ring-2 ring-primary" : ""}`} aria-label={d.toLocaleDateString("pt-BR", { weekday: "long", day: "numeric", month: "long" })}>
                  <button className="text-xs font-semibold mb-2 hover:underline" onClick={() => onPickDay(k)}>{WD[i]} {pad(d.getDate())}/{pad(d.getMonth() + 1)}</button>
                  {items.length === 0 ? <p className="text-[11px] text-muted-foreground">—</p> : (
                    <ul className="grid gap-1">{items.map((it) => (
                      <li key={it.key} className={`text-[11px] leading-4 pl-1.5 py-0.5 break-words ${tone(it.kind)} ${it.done ? "line-through opacity-60" : ""}`}>
                        {it.label}
                        {it.appt && <span className="block"><Badge tone={it.appt.status === "no_show" || it.appt.status === "professional_no_show" ? "warning" : "info"}>{ST[it.appt.status] ?? it.appt.status}</Badge></span>}
                        {it.appt?.can_confirm && <button className="block text-accent underline mt-0.5" onClick={() => onConfirm(it.appt!.id)}>Confirmo o atendimento</button>}
                      </li>))}</ul>)}
                </section>); })}
          </div>
        ) : (
          <div role="grid" aria-label="Mês" className="hp-cal-month">
            <div className="hp-cal-wd">{WD.map((w) => <span key={w}>{w}</span>)}</div>
            <div className="hp-cal-grid">
              {days.map((d) => { const k = dayKey(d); const items = byDay.get(k) ?? []; const appts = items.filter((x) => x.kind === "appt").length; const out = d.getMonth() !== curMonth;
                return (
                  <button key={k} onClick={() => onPickDay(k)} aria-label={`${d.toLocaleDateString("pt-BR", { day: "numeric", month: "long" })}: ${items.length} item(ns)`}
                    className={`hp-cal-cell ${k === today ? "is-today" : ""} ${out ? "is-out" : ""}`}>
                    <span className="hp-cal-num">{d.getDate()}</span>
                    <span className="hp-cal-dots md:hidden" aria-hidden>{(["appt", "crm", "task", "ext"] as EventKind[]).filter((kd) => items.some((x) => x.kind === kd)).map((kd) => <i key={kd} className={`hp-ev-dot hp-ev-dot-${kd}`} />)}{items.length > 0 && <b>{items.length}</b>}</span>
                    <span className="hidden md:block">{items.slice(0, 3).map((it) => <span key={it.key} className={`${tone(it.kind)} hp-ev-line`}>{it.label}</span>)}{items.length > 3 && <span className="hp-ev-more">+{items.length - 3} mais</span>}</span>
                    {appts > 0 && <span className="sr-only">{appts} atendimento(s)</span>}
                  </button>); })}
            </div>
          </div>
        )}
        {!q.data.is_self && <p className="text-xs text-muted-foreground mt-3">Agenda de outro profissional: você vê apenas os atendimentos das unidades em que tem permissão; tarefas, compromissos externos e a confirmação do atendimento são exclusivos do próprio profissional.</p>}
      </>)}
    </div>
  );
};

export default CalendarViews;
