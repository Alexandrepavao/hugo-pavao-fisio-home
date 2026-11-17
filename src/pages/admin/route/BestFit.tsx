import { useState } from "react";
import { Route as RouteIcon } from "lucide-react";
import { supabase } from "@/lib/supabase";
import { bestFit, fmtMinutes, legsFromMatrix, MIN, MSG_NO_TRAFFIC, MSG_UNAVAILABLE, type FitOption } from "@/lib/route/core";
import { fmtClock, routeDay, RouteError, toAppts } from "@/lib/route/api";
import { btnGhost, errText, inputCls } from "@/lib/ui";
import "./route.css";

export type BookMode = "in_clinic" | "home_visit" | "remote";
interface Row extends FitOption { date: string; simulated: boolean; note: string | null; raw: string }
const addDays = (iso: string, n: number) => { const d = new Date(`${iso}T12:00:00Z`); d.setUTCDate(d.getUTCDate() + n); return d.toISOString().slice(0, 10); };

/** "Buscar melhor encaixe": ordena horários LIVRES do profissional pelo menor acréscimo de deslocamento. Só sugere — não agenda nada, não move ninguém.
 *  Cada dia consultado usa 1 consulta de rota (com cache); por isso o intervalo é curto e o consumo é mostrado antes. */
const BestFit = ({ professionalId, unitId, serviceId, durationMin, person, mode, fromDate, onPick }: { professionalId: string; unitId: string; serviceId: string; durationMin: number | null; person: { id: string; full_name: string } | null; mode: BookMode; fromDate: string; onPick: (date: string, slotIso: string) => void }) => {
  const [days, setDays] = useState(3); const [busy, setBusy] = useState(false); const [rows, setRows] = useState<Row[] | null>(null); const [err, setErr] = useState<string | null>(null); const [tz, setTz] = useState("America/Sao_Paulo");
  const ready = !!professionalId && !!unitId && !!serviceId && !!durationMin && (mode === "remote" || !!person);
  const run = async () => {
    setBusy(true); setErr(null); setRows(null); const out: Row[] = []; const notes = new Set<string>();
    try {
      for (let i = 0; i < days; i++) {
        const date = addDays(fromDate, i);
        const { data: sl, error } = await supabase.rpc("available_slots", { p_professional: professionalId, p_unit: unitId, p_service: serviceId, p_date: date });
        if (error) throw new Error(errText(error));
        const rawByMs = new Map<number, string>(); for (const r of (sl ?? []) as { slot_start: string }[]) rawByMs.set(Date.parse(r.slot_start), r.slot_start);     // o valor ORIGINAL do horário (é ele que o formulário da Agenda reconhece)
        const cands = [...rawByMs.keys()].filter((t) => t > Date.now());
        if (!cands.length) continue;
        const r = await routeDay(professionalId, date, mode === "home_visit" ? person!.id : undefined); setTz(r.day.timezone);
        if (r.matrix.message) notes.add(r.matrix.message);
        const legs = legsFromMatrix(r.matrix.keys, r.matrix.durations);
        const newPt = mode === "home_visit" ? r.extra_place : mode === "in_clinic" && r.day.start?.kind === "unit" ? r.day.start : null;
        const fit = bestFit(toAppts(r.day), r.day.start, legs, r.day.prefs.buffer_min, newPt, (durationMin as number) * MIN, cands, mode === "remote");
        for (const f of fit) out.push({ ...f, date, simulated: r.matrix.simulated, note: null, raw: rawByMs.get(f.start) ?? new Date(f.start).toISOString() });
      }
      const rank = (o: Row) => (o.verdict === "unknown" ? 2 : o.verdict === "tight" ? 1 : 0);
      out.sort((a, b) => rank(a) - rank(b) || (a.extraS ?? Infinity) - (b.extraS ?? Infinity) || a.start - b.start);
      setRows(out.slice(0, 10)); if (notes.size) setErr([...notes][0]);
    } catch (e) { setErr(e instanceof RouteError ? e.message : (e as Error).message || MSG_UNAVAILABLE); } finally { setBusy(false); }
  };
  return (
    <section className="rt rt-card grid gap-3 mb-6" aria-label="Melhor encaixe pela rota" data-testid="bestfit">
      <div className="flex flex-wrap items-end justify-between gap-3">
        <div><h3 className="flex items-center gap-2 text-base font-semibold"><RouteIcon size={16} aria-hidden />Buscar melhor encaixe</h3>
          <p className="rt-small rt-muted">Ordena os horários livres pelo menor acréscimo de deslocamento. É só uma sugestão: nada é agendado nem movido. {MSG_NO_TRAFFIC}</p></div>
        <div className="flex flex-wrap items-end gap-2">
          <div><label htmlFor="bf-days" className="mb-1 block text-xs">Dias a partir da data</label><select id="bf-days" className={`${inputCls} !w-auto`} value={days} onChange={(e) => setDays(Number(e.target.value))}>{[1, 3, 5, 7].map((n) => <option key={n} value={n}>{n} dia(s)</option>)}</select></div>
          <button type="button" className={btnGhost} disabled={!ready || busy} onClick={() => void run()} data-testid="bestfit-run">{busy ? "Buscando…" : "Buscar melhor encaixe"}</button>
        </div>
      </div>
      {!ready && <p className="rt-small rt-muted">Escolha profissional, serviço{mode === "remote" ? "" : " e paciente"} para buscar. Usa até {days} consulta(s) de rota (com cache).</p>}
      {err && <div className="rt-banner" role="status" data-testid="bestfit-note">{err}</div>}
      {rows && rows.length === 0 && !err && <p className="rt-small rt-muted" data-testid="bestfit-empty">Nenhum horário livre viável nesse intervalo.</p>}
      {rows && rows.length > 0 && (
        <ul className="grid gap-2" data-testid="bestfit-list">{rows.map((r) => (
          <li key={`${r.date}-${r.start}`} className="rt-card flex flex-wrap items-start justify-between gap-2" data-testid="bestfit-row">
            <div className="min-w-0"><b className="rt-time">{new Date(`${r.date}T12:00:00Z`).toLocaleDateString("pt-BR", { weekday: "short", day: "2-digit", month: "2-digit", timeZone: "UTC" })} · {fmtClock(r.start, tz)}–{fmtClock(r.end, tz)}</b>
              <div className="rt-chips">{r.verdict === "unknown" ? <span className="rt-chip is-lilac">{MSG_UNAVAILABLE}</span> : <span className="rt-chip">{r.extraS === 0 ? "Sem acréscimo de deslocamento" : `+${fmtMinutes(r.extraS)} de deslocamento`}</span>}{r.verdict === "tight" && <span className="rt-chip is-lilac">folga curta</span>}{r.simulated && <span className="rt-chip is-amber">tempo simulado (teste)</span>}</div>
              <ul className="rt-small rt-muted mt-1">{r.reasons.map((x, i) => <li key={i}>{x}</li>)}</ul></div>
            <button type="button" className={btnGhost} onClick={() => onPick(r.date, r.raw)} data-testid="bestfit-pick">Usar este horário</button>
          </li>))}</ul>)}
    </section>
  );
};
export default BestFit;
