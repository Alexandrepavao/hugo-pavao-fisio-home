import { lazy, Suspense, useEffect, useMemo, useState } from "react";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { Check, ClipboardList, Navigation, Route as RouteIcon, Settings2, Sparkles } from "lucide-react";
import { supabase } from "@/lib/supabase";
import { confirmDialog, EmptyState, errText, inputCls, btnGhost, btnPrimary, Msg, State, useMsg } from "@/lib/ui";
import { fmtMinutes, legsFromMatrix, MIN, MSG_NO_TRAFFIC, MSG_UNAVAILABLE, planDay, suggestRoute, type Stop, type Suggestion } from "@/lib/route/core";
import { fmtClock, navUrl, PROFILE_LABEL, routeApply, routeDay, routeGeometry, toAppts, RouteError, type DayAppt, type Profile, type RouteDay } from "@/lib/route/api";
import PlaceEditor from "./PlaceEditor";
import type { MapPoint } from "./RouteMap";
import "./route.css";

const RouteMap = lazy(() => import("./RouteMap"));
const MODE_LABEL = { in_clinic: "Na unidade", home_visit: "Domiciliar", remote: "Remoto" } as const;
const STATUS_PAST: Record<string, string> = { attended: "Realizado", no_show: "Faltou" };
const mins = (ms: number) => Math.round(ms / MIN);

/** "Rota" do Meu dia: os atendimentos do dia com deslocamento estimado, folgas, mapa e uma "rota sugerida" (heurística). Simular NUNCA altera a agenda:
 *  aplicar é uma ação explícita, com comparação antes/depois, confirmação e revalidação no servidor. Ver docs/mapas-e-rotas.md. */
const RouteTab = ({ professionalId, date, isManager }: { professionalId: string; date: string; isManager: boolean }) => {
  const qc = useQueryClient(); const [msg, m] = useMsg();
  const q = useQuery({ queryKey: ["route-day", professionalId, date], enabled: !!professionalId, retry: false, queryFn: () => routeDay(professionalId, date) });
  const [view, setView] = useState<"lista" | "mapa">("lista");
  // Sugestão e linha do trajeto valem só para o profissional e o dia em que foram calculadas: trocar de dia/agenda as descarta (antes, a sugestão antiga apontava para atendimentos de outro dia e quebrava a tela).
  const ctx = `${professionalId}|${date}`;
  const [sugRaw, setSugRaw] = useState<{ ctx: string; v: Suggestion } | null>(null);
  const sug = sugRaw?.ctx === ctx ? sugRaw.v : null;
  const setSug = (v: Suggestion | null) => setSugRaw(v ? { ctx, v } : null);
  const [lineRaw, setLineRaw] = useState<{ ctx: string; v: { coords: [number, number][]; info: string } } | null>(null);
  const line = lineRaw?.ctx === ctx ? lineRaw.v : null;
  const setLine = (v: { coords: [number, number][]; info: string } | null) => setLineRaw(v ? { ctx, v } : null);
  useEffect(() => { setSugRaw(null); setLineRaw(null); }, [ctx]);   // ao voltar a um dia anterior a sugestão não reaparece (a agenda pode ter mudado)
  const [busy, setBusy] = useState(false);

  const d = q.data?.day, mx = q.data?.matrix;
  const calc = useMemo(() => {
    if (!d || !mx) return null;
    const legs = legsFromMatrix(mx.keys, mx.durations); const appts = toAppts(d);
    return { legs, appts, plan: planDay(appts, d.start, legs, d.prefs.buffer_min), byId: new Map(d.appointments.map((a) => [a.id, a])) };
  }, [d, mx]);

  const refresh = () => { for (const k of ["route-day", "prof-day", "my-day", "agenda"]) void qc.invalidateQueries({ queryKey: [k] }); setSug(null); setLine(null); };
  const tz = d?.timezone ?? "America/Sao_Paulo";

  const points: MapPoint[] = useMemo(() => {
    if (!d || !calc) return [];
    const out: MapPoint[] = []; if (d.start) out.push({ key: "start", n: null, lat: d.start.lat, lng: d.start.lng, label: d.start.label, kind: "start" });
    calc.plan.stops.forEach((s, i) => { const a = s.appt; if (a.pt && a.mode !== "remote") out.push({ key: a.id, n: i + 1, lat: a.pt.lat, lng: a.pt.lng, label: calc.byId.get(a.id)?.person ?? "", kind: s.approx ? "approx" : "stop" }); });
    return out;
  }, [d, calc]);

  const draw = async (order?: string[]) => {
    setBusy(true); try {
      const r = await routeGeometry(professionalId, date, order);
      if (r.status === "ok" && r.line?.length) { setLine({ coords: r.line, info: `Trajeto estimado: ${((r.distance_m ?? 0) / 1000).toFixed(1)} km · ${Math.round((r.duration_s ?? 0) / 60)} min, sem trânsito em tempo real.` }); setView("mapa"); }
      else m.err(r.message ?? "Estimativa indisponível: não foi possível desenhar o trajeto.");
    } catch (e) { m.err(e instanceof RouteError ? e.message : MSG_UNAVAILABLE); } finally { setBusy(false); }
  };

  const simulate = () => { if (!calc || !d) return; setLine(null); setSug(suggestRoute(calc.appts, d.start, calc.legs, d.prefs.buffer_min, Date.now())); };
  const apply = async () => {
    if (!sug || sug.status !== "improved" || !calc) return;
    const ok = await confirmDialog("Aplicar a rota sugerida?", `${sug.moves.length} atendimento(s) mudarão para os horários indicados. É o mesmo atendimento (mesmo paciente e mesmo pacote) em outro horário, com a duração original. Os pacientes passam a ver o novo horário no app e nenhuma mensagem é enviada por aqui — avise-os se for o caso. Atendimentos confirmados, fixos, remotos e passados não são alterados.`, "Aplicar na agenda");
    if (!ok) return;
    setBusy(true); try {
      const res = await routeApply(professionalId, date, sug.moves.map((mv) => ({ id: mv.id, expected_start: new Date(mv.from).toISOString(), new_start: new Date(mv.to).toISOString() })), "Rota sugerida aplicada");
      m.ok(`Rota aplicada: ${res.applied.length} atendimento(s) movido(s) de horário. O resultado foi registrado.`); refresh();
    } catch (e) {
      const msg = e instanceof RouteError ? (e.code === "ROTA_DESATUALIZADA" ? "A agenda mudou depois da simulação. Nada foi alterado: simule de novo." : e.message) : "Não foi possível aplicar. Nada foi alterado.";
      m.err(msg); void qc.invalidateQueries({ queryKey: ["route-day"] });
    } finally { setBusy(false); }
  };
  const setMode = async (a: DayAppt, mode: string, fixed?: boolean) => {
    let ack = false;
    if (a.status === "confirmed" && mode !== a.mode) { ack = await confirmDialog("Mudar o formato de um atendimento confirmado?", "O paciente já confirmou. Mudar de onde o atendimento acontece não envia aviso automático: combine com o paciente.", "Mudar mesmo assim"); if (!ack) return; }
    const { data, error } = await supabase.rpc("appointment_set_mode", { p_id: a.id, p_mode: mode, p_fixed: fixed ?? null, p_ack_confirmed: ack });
    if (error) return m.err(errText(error));
    if (mode === "home_visit" && !(data as { has_place?: boolean })?.has_place) m.err("Formato salvo, mas o paciente ainda não tem local definido: o trecho ficará como “Estimativa indisponível”."); else m.ok("Atendimento atualizado.");
    refresh();
  };

  if (!professionalId) return <EmptyState title="Sem agenda clínica">Você não tem agenda de atendimentos para ver a rota.</EmptyState>;
  const t = calc?.plan.totals;
  const noPlace = d ? d.appointments.filter((a) => a.mode === "home_visit" && a.lat === null).length : 0;
  const counts = d ? { clinic: d.appointments.filter((a) => a.mode === "in_clinic").length, home: d.appointments.filter((a) => a.mode === "home_visit").length, remote: d.appointments.filter((a) => a.mode === "remote").length } : null;

  return (
    <div className="rt grid gap-4" data-testid="route-tab">
      <Msg m={msg} /><State loading={q.isLoading} error={q.error} />
      {d && mx && calc && t && (<>
        <div className="grid gap-2">
          {mx.simulated && <div className="rt-banner is-lilac" role="note" data-testid="route-simulated"><b>Dados de teste:</b> os tempos abaixo são SIMULADOS (não vieram do serviço de rotas).</div>}
          {mx.message && <div className="rt-banner" role="status" data-testid="route-unavailable">{mx.message}</div>}
          {!d.start && calc.plan.stops.some((s) => s.appt.pt) && <div className="rt-banner is-info" role="note">Ponto de partida não definido: o trajeto até o primeiro atendimento não entra nos totais. Defina o local da unidade ou um ponto de partida seu em “Preferências de rota”.</div>}
          {noPlace > 0 && <div className="rt-banner is-info" role="note" data-testid="route-noplace">{noPlace} atendimento(s) domiciliar(es) sem local definido: os trechos aparecem como “{MSG_UNAVAILABLE}”. Defina o local na ficha do paciente.</div>}
        </div>

        <div className="rt-kpis" role="group" aria-label="Indicadores da rota do dia">
          <div className="rt-kpi" data-testid="kpi-appts"><span>Atendimentos</span><b>{d.appointments.length}</b><small>{counts!.clinic} na unidade · {counts!.home} domiciliar(es) · {counts!.remote} remoto(s)</small></div>
          <div className={`rt-kpi${t.complete ? "" : " is-partial"}`} data-testid="kpi-travel"><span>Deslocamento estimado</span><b>{t.knownLegs === 0 && !t.complete ? MSG_UNAVAILABLE : `${t.complete ? "" : "≥ "}${Math.round(t.travelS / 60)} min`}</b>
            <small>{t.complete ? "Soma dos trechos com estimativa" : `PARCIAL: soma de ${t.knownLegs} trecho(s) com estimativa; ${t.unknownLegs} sem estimativa`}{t.startMissing ? "; sem o trajeto de saída" : ""}. {MSG_NO_TRAFFIC}</small></div>
          <div className="rt-kpi" data-testid="kpi-slack"><span>Menor folga entre atendimentos</span><b>{t.minSlackMs === null ? "—" : `${mins(t.minSlackMs)} min`}</b><small>Depois do deslocamento e da folga mínima ({d.prefs.buffer_min} min entre locais diferentes).</small></div>
          <div className="rt-kpi" data-testid="kpi-bad"><span>Trechos inviáveis</span><b style={t.infeasible ? { color: "hsl(var(--rt-amber-ink))" } : undefined}>{t.infeasible}</b><small>O próximo começa antes de dar tempo de chegar.</small></div>
          <div className="rt-kpi" data-testid="kpi-unknown"><span>Sem estimativa</span><b>{t.unknownLegs}</b><small>Local indefinido ou serviço de rotas indisponível. Nunca contado como zero.</small></div>
        </div>

        <div className="flex flex-wrap items-center gap-2">
          <button className={btnPrimary} onClick={simulate} disabled={busy || mx.status === "unavailable" || mx.status === "cap"} data-testid="route-suggest"><Sparkles size={16} aria-hidden className="mr-1.5 inline" />Sugerir rota</button>
          <button className={btnGhost} onClick={() => void draw()} disabled={busy || mx.status === "unavailable"} data-testid="route-draw"><RouteIcon size={16} aria-hidden className="mr-1.5 inline" />Desenhar trajeto no mapa</button>
          <div className="rt-toggle" role="group" aria-label="Lista ou mapa"><button aria-pressed={view === "lista"} onClick={() => setView("lista")}>Lista</button><button aria-pressed={view === "mapa"} onClick={() => setView("mapa")}>Mapa</button></div>
          <span className="rt-small rt-muted">Perfil: {PROFILE_LABEL[d.prefs.profile]} · {MSG_NO_TRAFFIC}</span>
        </div>

        {sug && (
          <section className="rt-card grid gap-3" aria-label="Rota sugerida" data-testid="route-suggestion">
            <h3 className="flex items-center gap-2 text-base font-semibold"><ClipboardList size={16} aria-hidden />Rota sugerida <span className="rt-chip is-lilac">heurística, não é a rota ótima</span></h3>
            <p data-testid="route-suggestion-msg">{sug.message}</p>
            {sug.status === "improved" && sug.after && (<>
              <div className="overflow-x-auto"><table className="rt-diff" data-testid="route-diff"><thead><tr><th>Atendimento</th><th>Horário atual</th><th>Horário sugerido</th></tr></thead><tbody>
                {sug.moves.map((mv) => { const a = calc.byId.get(mv.id); if (!a) return null; return <tr key={mv.id}><td>{a.person} <span className="rt-muted">· {a.service}</span></td><td>{fmtClock(mv.from, tz)}</td><td className="is-new">{fmtClock(mv.to, tz)}</td></tr>; })}</tbody></table></div>
              <div className="rt-kpis"><div className="rt-kpi"><span>Deslocamento estimado</span><b>{Math.round(sug.before.travelS / 60)} → {Math.round(sug.after.travelS / 60)} min</b><small>antes → depois, só trechos com estimativa. {MSG_NO_TRAFFIC}</small></div>
                <div className="rt-kpi"><span>Trechos inviáveis</span><b>{sug.before.infeasible} → {sug.after.infeasible}</b><small>antes → depois</small></div></div>
              <p className="rt-small rt-muted">Nenhum atendimento é encurtado. Confirmados, fixos, remotos e passados não se movem. A agenda só muda se você aplicar; o servidor revalida tudo antes.</p>
              <div className="flex flex-wrap gap-2"><button className={btnPrimary} onClick={() => void apply()} disabled={busy} data-testid="route-apply"><Check size={16} aria-hidden className="mr-1.5 inline" />Aplicar na agenda…</button>
                <button className={btnGhost} onClick={() => void draw(sug.afterAppts.filter((a) => a.mode !== "remote").map((a) => a.id))} disabled={busy}>Desenhar a sugerida no mapa</button>
                <button className={btnGhost} onClick={() => setSug(null)}>Descartar</button></div></>)}
            {sug.status !== "improved" && <div><button className={btnGhost} onClick={() => setSug(null)}>Fechar</button></div>}
          </section>)}

        {d.appointments.length === 0 ? <EmptyState icon={RouteIcon} title="Nenhum atendimento neste dia">Escolha outra data para ver a rota.</EmptyState> : (
          <div className={`rt-split has-map`} data-view={view}>
            <div className="rt-listbox">
              <ol className="rt-stops" aria-label="Atendimentos do dia na ordem">
                {calc.plan.stops.map((s, i) => <StopItem key={s.appt.id} s={s} i={i} a={calc.byId.get(s.appt.id)!} tz={tz} profile={d.prefs.profile} onMode={setMode} first={i === 0} startLabel={d.start?.label ?? null} />)}
              </ol>
            </div>
            <div className="rt-mapbox-wrap rt-mapbox-slot">
              <Suspense fallback={<div className="rt-mapbox"><div className="rt-mapmsg">Carregando o mapa…</div></div>}><RouteMap points={points} line={line?.coords ?? null} attribution={mx.attribution} /></Suspense>
              {line && <p className="rt-small rt-muted mt-1">{line.info}</p>}
            </div>
          </div>)}

        {(d.is_self || isManager) && <Prefs professionalId={professionalId} d={d} isManager={isManager} onSaved={refresh} />}
      </>)}
    </div>
  );
};

const StopItem = ({ s, i, a, tz, profile, onMode, first, startLabel }: { s: Stop; i: number; a: DayAppt; tz: string; profile: Profile; onMode: (a: DayAppt, mode: string, fixed?: boolean) => void; first: boolean; startLabel: string | null }) => {
  const past = !!STATUS_PAST[a.status]; const remote = a.mode === "remote";
  const leg = (() => {
    if (remote) return { cls: "", text: "Sem deslocamento (atendimento remoto)" };
    if (s.verdict === "unknown") return { cls: "is-unknown", text: MSG_UNAVAILABLE };
    if (s.legKind === "none") return { cls: "", text: first ? "Ponto de partida não definido" : "—" };
    const base = s.legKind === "same" ? "Mesmo local" : `${fmtMinutes(s.legS)} de deslocamento${first && startLabel ? ` desde ${startLabel}` : ""}`;
    if (s.verdict === "infeasible") return { cls: "is-bad", text: `${base} · Inviável: ${Math.ceil(s.shortByMs / MIN) <= 1 ? "falta menos de 1 min" : `faltam ${Math.ceil(s.shortByMs / MIN)} min`}` };
    if (s.verdict === "tight") return { cls: "is-tight", text: `${base} · folga curta (${mins(s.slackMs ?? 0)} min)` };
    return { cls: "", text: `${base}${s.slackMs !== null ? ` · folga ${mins(s.slackMs)} min` : ""}` };
  })();
  return (
    <li data-testid="route-stop">
      <div className={`rt-leg ${leg.cls}`} data-testid="route-leg" data-verdict={s.verdict}>{leg.text}{s.approx && !remote && <span className="rt-chip is-amber">estimativa aproximada</span>}</div>
      <div className="rt-card rt-stop">
        <div className={`rt-num${remote ? " is-remote" : past ? " is-past" : ""}`} aria-hidden>{i + 1}</div>
        <div className="min-w-0">
          <div className="flex flex-wrap items-baseline justify-between gap-2"><b>{a.person}</b><span className="rt-time">{fmtClock(Date.parse(a.starts_at), tz)}–{fmtClock(Date.parse(a.ends_at), tz)}</span></div>
          <p className="rt-small rt-muted">{a.service} · {a.unit}</p>
          <div className="rt-chips">
            <span className="rt-chip">{MODE_LABEL[a.mode]}</span>
            {past && <span className="rt-chip">{STATUS_PAST[a.status]}</span>}
            {!past && a.status === "confirmed" && <span className="rt-chip">Confirmado</span>}
            {a.fixed && <span className="rt-chip is-lilac">Horário fixo</span>}
            {a.mode === "home_visit" && a.lat === null && <span className="rt-chip is-amber">Local não definido</span>}
            {a.precision === "cep" && <span className="rt-chip is-amber">Local aproximado (CEP)</span>}
            {a.precision === "street" && <span className="rt-chip is-amber">Local aproximado</span>}
          </div>
          {!past && <div className="rt-actions">
            <label className="sr-only" htmlFor={`md-${a.id}`}>Formato do atendimento</label>
            <select id={`md-${a.id}`} className={`${inputCls} !w-auto !min-h-[34px]`} value={a.mode} onChange={(e) => onMode(a, e.target.value)} data-testid="route-mode">{Object.entries(MODE_LABEL).map(([k, l]) => <option key={k} value={k}>{l}</option>)}</select>
            <button className={btnGhost} onClick={() => onMode(a, a.mode, !a.fixed)} aria-pressed={a.fixed} data-testid="route-fixed">{a.fixed ? "Liberar horário" : "Fixar horário"}</button>
            {a.lat !== null && a.lng !== null && a.mode !== "remote" && <a className={btnGhost} href={navUrl({ lat: a.lat, lng: a.lng }, profile)} target="_blank" rel="noopener noreferrer" data-testid="route-nav"><Navigation size={14} aria-hidden className="mr-1 inline" />Abrir navegação</a>}
          </div>}
        </div>
      </div>
    </li>
  );
};

const Prefs = ({ professionalId, d, isManager, onSaved }: { professionalId: string; d: RouteDay; isManager: boolean; onSaved: () => void }) => {
  const [msg, m] = useMsg(); const [profile, setProfile] = useState<Profile>(d.prefs.profile); const [buffer, setBuffer] = useState(String(d.prefs.buffer_min)); const [start, setStart] = useState(d.prefs.start_mode);
  const save = async () => {
    const { error } = await supabase.rpc("route_prefs_set", { p_professional: professionalId, p_profile: profile, p_buffer: Number(buffer), p_start_mode: start });
    if (error) return m.err(errText(error)); m.ok("Preferências salvas."); onSaved();
  };
  return (
    <details className="rt-card" data-testid="route-prefs"><summary className="flex cursor-pointer items-center gap-2 font-semibold"><Settings2 size={16} aria-hidden />Preferências de rota</summary>
      <div className="mt-3 grid gap-3">
        <Msg m={msg} />
        <div className="grid gap-2 sm:grid-cols-3">
          <div><label htmlFor="rp-prof" className="mb-1 block text-xs">Como se desloca</label><select id="rp-prof" className={inputCls} value={profile} onChange={(e) => setProfile(e.target.value as Profile)}>{(Object.keys(PROFILE_LABEL) as Profile[]).map((k) => <option key={k} value={k}>{PROFILE_LABEL[k]}</option>)}</select></div>
          <div><label htmlFor="rp-buf" className="mb-1 block text-xs">Folga mínima entre locais diferentes (min)</label><input id="rp-buf" type="number" min={0} max={120} className={inputCls} value={buffer} onChange={(e) => setBuffer(e.target.value)} /></div>
          <div><label htmlFor="rp-start" className="mb-1 block text-xs">Ponto de partida do dia</label><select id="rp-start" className={inputCls} value={start} onChange={(e) => setStart(e.target.value as "unit" | "own_point")}><option value="unit">A unidade (padrão)</option><option value="own_point">Um ponto meu (opcional)</option></select></div>
        </div>
        <div><button className={btnPrimary} onClick={() => void save()}>Salvar preferências</button></div>
        <p className="rt-small rt-muted">Não é preciso informar endereço residencial: a partida padrão é a unidade. O ponto próprio é opcional e só você (ou a gestão) o vê.</p>
        {start === "own_point" && <PlaceEditor kind="professional" id={professionalId} title="Meu ponto de partida" hint="Pode ser um ponto próximo, sem o número da casa (precisão aproximada)." />}
        {isManager && d.unit_id && <PlaceEditor kind="unit" id={d.unit_id} title="Local da unidade" hint="Ponto de partida padrão e local dos atendimentos na unidade. Só a gestão altera." />}
      </div>
    </details>
  );
};
export default RouteTab;
