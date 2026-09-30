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

const CalendarViews = ({ view, date, professionalId, onPickDay, onConfirm }: { view: CalView; date: string; professionalId: string; onPickDay: (d: string) => void; onConfirm: (id: string) => void }) => {
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
    for (const v of m.values()) v.sort((a, b) => a.at.localeCompare(b.at));
    return m;
  }, [q.data]);
  const today = dayKey(new Date()); const curMonth = parseDay(date).getMonth();
  const tone = (k: Item["kind"]) => k === "appt" ? "border-l-2 border-primary" : k === "ext" ? "border-l-2 border-dashed border-muted-foreground text-muted-foreground" : k === "crm" ? "border-l-2 border-accent" : "border-l-2 border-border";

  return (
    <div>
      <State loading={q.isLoading} error={q.error} />
      {q.data && (<>
        <ul className="flex flex-wrap gap-3 text-xs text-muted-foreground mb-2" aria-label="Legenda">
          <li><span className="inline-block w-2 h-2 bg-primary mr-1" aria-hidden />Atendimento</li><li><span className="inline-block w-2 h-2 bg-accent mr-1" aria-hidden />Tarefa de CRM</li>
          {q.data.is_self && <><li><span className="inline-block w-2 h-2 bg-border mr-1" aria-hidden />Tarefa pessoal (privada)</li><li><span className="inline-block w-2 h-2 border border-dashed border-muted-foreground mr-1" aria-hidden />Compromisso externo (Google, só leitura)</li></>}
        </ul>
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
          <div role="grid" aria-label="Mês">
            <div className="grid grid-cols-7 gap-1 text-[11px] text-muted-foreground mb-1">{WD.map((w) => <span key={w} className="text-center">{w}</span>)}</div>
            <div className="grid grid-cols-7 gap-1">
              {days.map((d) => { const k = dayKey(d); const items = byDay.get(k) ?? []; const appts = items.filter((x) => x.kind === "appt").length;
                return (
                  <button key={k} onClick={() => onPickDay(k)} aria-label={`${d.toLocaleDateString("pt-BR", { day: "numeric", month: "long" })}: ${items.length} item(ns)`}
                    className={`hp-card text-left p-1.5 min-h-[4.5rem] min-w-0 hover:border-accent/60 ${k === today ? "ring-2 ring-primary" : ""} ${d.getMonth() === curMonth ? "" : "opacity-50"}`}>
                    <span className="text-xs font-semibold">{d.getDate()}</span>
                    <span className="block md:hidden text-[10px] text-muted-foreground">{appts > 0 ? `${appts} at.` : ""}{items.length - appts > 0 ? ` +${items.length - appts}` : ""}</span>
                    <span className="hidden md:block">{items.slice(0, 3).map((it) => <span key={it.key} className={`block text-[10px] leading-4 truncate pl-1 ${tone(it.kind)}`}>{it.label}</span>)}{items.length > 3 && <span className="block text-[10px] text-muted-foreground">+{items.length - 3}</span>}</span>
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
