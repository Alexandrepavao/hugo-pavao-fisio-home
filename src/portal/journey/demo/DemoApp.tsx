import { useEffect, useMemo, useRef, useState } from "react";
import { CalendarDays, ChevronLeft, ChevronRight, Dumbbell, Home, LineChart, LogOut, MoreHorizontal, PlayCircle, Smartphone, Monitor, Wand2 } from "lucide-react";
import logo from "@/assets/hp-logo.png";
import { Dialog, DialogContent, DialogDescription, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { APPT_KIND_LABEL, apptKind, type JourneyModel, type JourneyTab } from "../model";
import { EducationCard, ExerciseCards, FunctionalCard, JourneyProvider, JourneyTimeline, NextAppointmentCard, PainChartCard, PatientDashboard, ReassessmentCard, SessionsCard, WeekCard } from "../ui";
import { SCENARIOS, TOUR, buildDemoModel, type ScenarioKey } from "./scenarios";

const NAV: { tab: JourneyTab; label: string; icon: typeof Home }[] = [
  { tab: "inicio", label: "Início", icon: Home }, { tab: "evolucao", label: "Evolução", icon: LineChart }, { tab: "exercicios", label: "Exercícios", icon: Dumbbell }, { tab: "agenda", label: "Agenda", icon: CalendarDays }, { tab: "mais", label: "Mais", icon: MoreHorizontal },
];
const useWide = () => { const q = "(min-width: 1024px)"; const [w, setW] = useState(() => window.matchMedia(q).matches); useEffect(() => { const m = window.matchMedia(q); const f = () => setW(m.matches); m.addEventListener("change", f); return () => m.removeEventListener("change", f); }, []); return w; };

/** Demonstração interativa do acompanhamento (para o fisioterapeuta apresentar durante a consulta). Usa os MESMOS componentes do portal real, alimentados por exemplos ILUSTRATIVOS.
 *  Totalmente isolada: não chama o banco, não grava nada (nem no navegador), não envia mensagem e não mostra dados de ninguém. Nome e objetivo digitados ficam só na memória desta tela e somem ao sair. */
const DemoApp = ({ firstName = "", goal = "", onExit, onPrepareReal }: { firstName?: string; goal?: string; onExit: () => void; onPrepareReal?: () => void }) => {
  const wide = useWide(); const [frame, setFrame] = useState<"phone" | "full">("phone"); const phone = wide && frame === "phone";
  const [scenario, setScenario] = useState<ScenarioKey>("acompanhamento"); const [tab, setTab] = useState<JourneyTab>("inicio");
  const [name, setName] = useState(firstName); const [obj, setObj] = useState(goal); const [tour, setTour] = useState<number | null>(null);
  const [done, setDone] = useState<Set<string>>(new Set()); const [confirmed, setConfirmed] = useState<Set<string>>(new Set()); const [note, setNote] = useState<string | null>(null);
  const [video, setVideo] = useState<{ title: string } | null>(null); const stage = useRef<HTMLDivElement>(null); const [ctrlOpen, setCtrlOpen] = useState(false);
  const now = useMemo(() => new Date(), []);

  const model: JourneyModel = useMemo(() => {
    const m = buildDemoModel(scenario, { firstName: name, goal: obj }, now);
    const na = m.nextAppointment && confirmed.has(m.nextAppointment.id) ? { ...m.nextAppointment, status: "confirmed", confirmed: true, canConfirm: false } : m.nextAppointment;
    return { ...m, nextAppointment: na, appointments: m.appointments.map((a) => (na && a.id === na.id ? na : a)), training: m.training ? { ...m.training, items: m.training.items.map((i) => ({ ...i, done: done.has(i.id) })) } : null };
  }, [scenario, name, obj, now, done, confirmed]);

  const step = tour == null ? null : TOUR[tour];
  useEffect(() => { if (step) setTab(step.tab); }, [step]);
  useEffect(() => {   // destaca o bloco do passo atual
    if (!step) return; const el = stage.current?.querySelector<HTMLElement>(`[data-testid="${step.target}"]`); if (!el) return;
    el.classList.add("jr-tour-hl"); el.scrollIntoView({ block: "center", behavior: window.matchMedia("(prefers-reduced-motion: reduce)").matches ? "auto" : "smooth" });
    return () => el.classList.remove("jr-tour-hl");
  }, [step, tab, scenario]);
  useEffect(() => { if (!note) return; const h = setTimeout(() => setNote(null), 5000); return () => clearTimeout(h); }, [note]);

  const actions = {
    go: (t: JourneyTab) => { setTour(null); setTab(t); },
    confirmAppt: (a: { id: string }) => { setConfirmed((s) => new Set(s).add(a.id)); setNote("Simulação: a presença não foi confirmada de verdade."); },
    cancelAppt: () => setNote("Simulação: nenhuma consulta foi cancelada e nenhuma sessão foi descontada."),
    watch: (v: { title: string }) => setVideo({ title: v.title }),
    markDone: (e: { id: string }) => setDone((s) => { const n = new Set(s); if (n.has(e.id)) n.delete(e.id); else n.add(e.id); return n; }),
  };

  const body = (
    <div ref={stage} className="jr" data-testid="demo-stage">
      {tab === "inicio" && <PatientDashboard m={model} now={now} />}
      {tab === "evolucao" && <div className="jr-grid"><PainChartCard m={model} /><FunctionalCard m={model} /><JourneyTimeline m={model} /></div>}
      {tab === "exercicios" && <div className="jr-grid"><ExerciseCards m={model} showAll /><WeekCard m={model} now={now} /></div>}
      {tab === "agenda" && (
        <div className="jr-grid"><NextAppointmentCard m={model} /><WeekCard m={model} now={now} />
          <section className="jr-card jr-c12 jr-span-all" aria-label="Consultas"><h2 className="jr-title"><CalendarDays size={18} aria-hidden />Consultas</h2>
            <ul style={{ display: "grid", gap: 6, listStyle: "none", margin: 0, padding: 0 }}>{[...model.appointments].sort((a, b) => b.starts_at.localeCompare(a.starts_at)).map((a) => (
              <li key={a.id} className="jr-row jr-small"><span className="jr-pill">{APPT_KIND_LABEL[apptKind(a.status)]}</span><span>{new Date(a.starts_at).toLocaleDateString("pt-BR", { day: "2-digit", month: "short", timeZone: "America/Sao_Paulo" })} · {a.service} · {a.professional}</span></li>))}</ul></section></div>)}
      {tab === "mais" && <div className="jr-grid"><SessionsCard m={model} /><EducationCard m={model} /><ReassessmentCard m={model} /></div>}
    </div>
  );
  const header = (
    <div className="jr-row" style={{ padding: "10px 14px", background: "hsl(var(--jr-card))", borderBottom: "1px solid hsl(var(--jr-line))", paddingTop: phone ? 34 : 10 }}>
      <img src={logo} alt="HP Fisioterapia" style={{ height: 26, width: "auto" }} /><b style={{ color: "hsl(var(--jr-navy))" }}>Meu acompanhamento</b>
      <span className="jr-demo-badge" style={{ marginLeft: "auto" }} data-testid="demo-badge-app">DEMONSTRAÇÃO · Dados ilustrativos</span>
    </div>);
  const nav = (
    <nav aria-label="Seções do app de demonstração" style={{ display: "grid", gridTemplateColumns: `repeat(${NAV.length}, 1fr)`, borderTop: "1px solid hsl(var(--jr-line))", background: "hsl(var(--jr-card))" }}>
      {NAV.map((n) => <button key={n.tab} type="button" onClick={() => actions.go(n.tab)} aria-current={tab === n.tab ? "page" : undefined} data-testid={`demo-tab-${n.tab}`}
        style={{ minHeight: 56, display: "grid", placeItems: "center", gap: 2, background: "none", border: 0, cursor: "pointer", fontSize: 11, fontWeight: 700, color: tab === n.tab ? "hsl(var(--jr-navy))" : "hsl(var(--jr-muted))", borderTop: tab === n.tab ? "3px solid hsl(var(--jr-amber))" : "3px solid transparent" }}><n.icon size={20} aria-hidden />{n.label}</button>)}
    </nav>);
  const app = (
    <div style={{ display: "flex", flexDirection: "column", height: "100%", minHeight: 0 }}>
      {header}<div style={{ flex: 1, overflowY: "auto", padding: 12 }} tabIndex={0} aria-label="Conteúdo do app de demonstração">{body}</div>{nav}
    </div>);

  const controls = (
    <aside className="jr" aria-label="Controles da demonstração" style={{ display: "grid", gap: 12, alignContent: "start" }}>
      <div className="jr-card" data-testid="demo-controls">
        <p className="jr-eyebrow">Exemplo mostrado</p>
        <div className="jr-row" style={{ marginTop: 6 }} role="group" aria-label="Exemplo">{SCENARIOS.map((s) => <button key={s.key} type="button" className={`jr-btn ${scenario === s.key ? "" : "is-soft"}`} aria-pressed={scenario === s.key} onClick={() => { setScenario(s.key); setTour(null); setDone(new Set()); setConfirmed(new Set()); }} data-testid={`demo-sc-${s.key}`}>{s.label}</button>)}</div>
        <p className="jr-small jr-muted" style={{ marginTop: 6 }}>{SCENARIOS.find((s) => s.key === scenario)?.hint}.</p>
        <details style={{ marginTop: 10 }}><summary className="jr-small" style={{ cursor: "pointer", fontWeight: 700 }}>Personalizar (só nesta tela)</summary>
          <div style={{ display: "grid", gap: 8, marginTop: 8 }}>
            <label className="jr-small">Primeiro nome<input value={name} onChange={(e) => setName(e.target.value)} maxLength={30} placeholder="Ana" style={{ width: "100%" }} /></label>
            <label className="jr-small">Objetivo<input value={obj} onChange={(e) => setObj(e.target.value)} maxLength={80} placeholder="Voltar a caminhar com conforto" style={{ width: "100%" }} /></label>
            <p className="jr-small jr-muted">Fica só na memória desta tela e some ao sair.</p>
          </div></details>
        {wide && <div className="jr-row" style={{ marginTop: 10 }} role="group" aria-label="Moldura"><button type="button" className={`jr-btn ${frame === "phone" ? "" : "is-soft"}`} aria-pressed={frame === "phone"} onClick={() => setFrame("phone")}><Smartphone size={16} aria-hidden />Celular</button><button type="button" className={`jr-btn ${frame === "full" ? "" : "is-soft"}`} aria-pressed={frame === "full"} onClick={() => setFrame("full")}><Monitor size={16} aria-hidden />Tela cheia</button></div>}
      </div>
      <div className="jr-card" data-testid="demo-tour">
        {step ? (<>
          <p className="jr-eyebrow">Tour guiado · passo {tour! + 1} de {TOUR.length}</p><h2 className="jr-title" style={{ marginTop: 4 }}>{step.title}</h2><p>{step.text}</p>
          <div className="jr-row" style={{ marginTop: 10 }}>
            <button type="button" className="jr-btn is-soft" disabled={tour === 0} onClick={() => setTour((t) => Math.max(0, (t ?? 0) - 1))}><ChevronLeft size={16} aria-hidden />Voltar</button>
            {tour! < TOUR.length - 1 ? <button type="button" className="jr-btn" onClick={() => setTour((t) => (t ?? 0) + 1)} data-testid="demo-next">Avançar<ChevronRight size={16} aria-hidden /></button> : <button type="button" className="jr-btn" onClick={() => setTour(null)}>Concluir</button>}
            <button type="button" className="jr-btn is-soft" onClick={() => setTour(null)} data-testid="demo-tour-exit">Sair do tour</button>
          </div></>) : (<>
          <p className="jr-eyebrow">Apresentação</p><p className="jr-small jr-muted" style={{ margin: "4px 0 8px" }}>Siga o roteiro ou navegue livremente pelo app ao lado.</p>
          <button type="button" className="jr-btn" onClick={() => setTour(0)} data-testid="demo-tour-start"><Wand2 size={16} aria-hidden />Iniciar tour guiado</button></>)}
      </div>
      <div className="jr-card is-amber"><p className="jr-small"><b>Exemplos, não promessas.</b> Os dados são ilustrativos e mostram possibilidades de acompanhamento. Nenhum resultado é garantido para este paciente, e nada desta tela é gravado.</p></div>
      <div className="jr-row">
        {onPrepareReal && <button type="button" className="jr-btn is-soft" onClick={onPrepareReal} data-testid="demo-prepare">Preparar acompanhamento real</button>}
        <button type="button" className="jr-btn is-soft" onClick={onExit} data-testid="demo-exit"><LogOut size={16} aria-hidden />Sair da demonstração</button>
      </div>
      {note && <p role="status" className="jr-card is-lilac jr-small" data-testid="demo-note">{note}</p>}
    </aside>);

  return (
    <JourneyProvider value={actions}>
      <div style={{ minHeight: "100vh", background: "hsl(216 40% 96%)" }} data-testid="demo-root">
        <div className="jr" style={{ background: "hsl(var(--jr-amber))", color: "hsl(30 80% 12%)", textAlign: "center", padding: "8px 12px", fontWeight: 800 }} role="status" data-testid="demo-banner">
          DEMONSTRAÇÃO — Dados ilustrativos · nada desta tela é gravado ou enviado
        </div>
        <div style={{ display: "grid", gap: 16, padding: 16, maxWidth: 1280, margin: "0 auto", gridTemplateColumns: wide ? "340px minmax(0, 1fr)" : "minmax(0, 1fr)" }}>
          {wide ? controls : (
            <details className="jr" open={ctrlOpen || tour != null} onToggle={(e) => setCtrlOpen((e.target as HTMLDetailsElement).open)} data-testid="demo-controls-toggle">
              <summary className="jr-btn is-soft" style={{ listStyle: "none", cursor: "pointer" }}>Exemplos, tour guiado e personalização</summary><div style={{ marginTop: 10 }}>{controls}</div>
            </details>)}
          <div>{phone
            ? <div className="jr-phone" data-testid="demo-phone"><div className="jr-phone-screen jr">{app}</div></div>
            : <div className="jr" style={{ height: wide ? "min(860px, calc(100vh - 110px))" : "calc(100vh - 150px)", minHeight: 520, border: "1px solid hsl(var(--jr-line))", borderRadius: 16, overflow: "hidden", background: "hsl(var(--jr-bg))" }} data-testid="demo-full">{app}</div>}</div>
        </div>
        <Dialog open={!!video} onOpenChange={(o) => { if (!o) setVideo(null); }}>
          <DialogContent className="max-w-xl"><DialogHeader><DialogTitle>{video?.title}</DialogTitle><DialogDescription>Vídeo de demonstração (ilustrativo)</DialogDescription></DialogHeader>
            <div className="jr" style={{ aspectRatio: "16 / 9", display: "grid", placeItems: "center", borderRadius: 12, background: "linear-gradient(135deg, hsl(var(--jr-lilac-soft)), hsl(var(--jr-blue-soft)))" }}><PlayCircle size={56} color="hsl(222 56% 21%)" aria-hidden /></div>
            <p className="text-sm">Aqui o paciente assistiria ao vídeo aprovado pelo fisioterapeuta. Os vídeos reais são privados e só abrem para o paciente autorizado. Assistir não registra o exercício como feito.</p>
            <button type="button" className="hp-btn hp-btn-outline" onClick={() => setVideo(null)}>Fechar</button></DialogContent>
        </Dialog>
      </div>
    </JourneyProvider>
  );
};
export default DemoApp;
