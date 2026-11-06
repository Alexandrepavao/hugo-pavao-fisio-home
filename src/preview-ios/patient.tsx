import { useEffect, useMemo, useRef, useState } from "react";
import { Bell, CalendarDays, Check, CreditCard, Dumbbell, Home, LifeBuoy, LineChart, MessageCircle, Pause, Play, RotateCcw, Shield, User } from "lucide-react";
import { act, addDays, adherenceOf, balanceOf, brl, cancelConsequence, demoNow, fmtDay, fmtDayLong, fmtTime, loggedToday, logsOf, measuresOf, patientById, protocolOf, resultLabel, routinesForDay, sharedNotes, timelineOf, upcomingOf, useDemo, weekdayName, apptsOf } from "./store";
import type { Appointment, ApptStatus, Exercise, LogResult, Routine, RoutineItem } from "./types";
import { AlertBox, Avatar, Badge, Btn, Empty, ExerciseArt, Field, Group, Indicator, MeasureChart, MonthCalendar, NavHost, Page, PrivateVideoSlot, Progress, Row, Segmented, Sheet, Switch, TabBar, useNav, type Screen } from "./ui";
import { useShell } from "./shell-context";

const STATUS: Record<ApptStatus, [string, "info" | "ok" | "warn" | "bad" | "gray"]> = { scheduled: ["Agendado", "gray"], confirmed: ["Presença confirmada", "info"], done: ["Realizado", "ok"], no_show: ["Falta", "bad"], cancelled: ["Cancelado", "gray"], cancelled_late: ["Cancelado tardio (descontado)", "warn"] };
export const ApptBadge = ({ s }: { s: ApptStatus }) => <Badge tone={STATUS[s][1]}>{STATUS[s][0]}</Badge>;
const KIND = { avaliacao: "Avaliação", atendimento: "Atendimento", reavaliacao: "Reavaliação" };
const dose = (i: RoutineItem) => `${i.sets} × ${i.reps != null ? `${i.reps} repetições` : i.durationS && i.durationS >= 60 ? `${Math.round(i.durationS / 60)} min` : `${i.durationS} s`}`;
const greeting = () => { const h = demoNow().getHours(); return h < 12 ? "Bom dia" : h < 18 ? "Boa tarde" : "Boa noite"; };

// ---------------------------------------------------------------- HOJE
const Hoje = () => {
  const d = useDemo(); const nav = useNav(); const me = patientById(d, d.meId); const next = upcomingOf(d, me.id)[0]; const routines = routinesForDay(d, me.id, d.anchor);
  const [mood, setMood] = useState<number | null>(d.checkins.find((c) => c.date === d.anchor && c.patientId === me.id)?.mood ?? null); const [note, setNote] = useState("");
  const total = routines.reduce((s, r) => s + r.items.length, 0); const done = routines.reduce((s, r) => s + r.items.filter((i) => loggedToday(d, me.id, r.id, i.exerciseId)).length, 0);
  const firstOpen = routines.find((r) => r.items.some((i) => !loggedToday(d, me.id, r.id, i.exerciseId)));
  const replies = d.logs.filter((l) => l.patientId === me.id && l.reply && l.date >= addDays(d.anchor, -7)).sort((x, y) => (y.reviewedAt ?? y.date).localeCompare(x.reviewedAt ?? x.date)).slice(0, 1);
  return (
    <Page title={`${greeting()}, ${me.name.split(" ")[0]}`} back={false}>
      <div className="ios-gap">
        <div className="ios-hero" data-testid="next-appt">
          <p style={{ fontSize: 12, fontWeight: 700, opacity: .8, letterSpacing: ".05em", textTransform: "uppercase" }}>Próximo atendimento</p>
          {next ? <>
            <p className="ios-display" style={{ fontSize: 22, fontWeight: 800, marginTop: 4 }}>{fmtDayLong(next.at)} · {fmtTime(next.at)}</p>
            <p style={{ opacity: .85, fontSize: 13.5 }}>{KIND[next.kind]} · {next.place}</p>
            <div style={{ display: "flex", gap: 10, alignItems: "center", marginTop: 12 }}><Avatar name={d.physio.name} hue={d.physio.hue} size={38} /><div><p style={{ fontWeight: 700, fontSize: 14 }}>{d.physio.name}</p><p style={{ opacity: .8, fontSize: 12 }}>Seu fisioterapeuta responsável</p></div></div>
            <div style={{ display: "flex", gap: 8, marginTop: 14 }}>{next.status === "scheduled" && <button className="ios-btn ios-btn-sm" style={{ background: "#fff", color: "#1c4373" }} onClick={() => { act.confirmPresence(next.id); nav.toast("Presença confirmada. Obrigado!"); }}>Confirmar presença</button>}<button className="ios-btn ios-btn-sm" style={{ background: "rgba(255,255,255,.18)", color: "inherit" }} onClick={() => { nav.setTab("agenda"); nav.push({ id: "appt", params: { id: next.id } }); }}>Ver detalhes</button></div>
          </> : <p style={{ marginTop: 6 }}>Nenhum atendimento agendado. Fale com a equipe pelo Perfil.</p>}
        </div>
        <div className="ios-card ios-card-pad"><p className="ios-dim ios-small" style={{ fontWeight: 700 }}>MEU OBJETIVO</p><p className="ios-display" style={{ fontSize: 19, fontWeight: 800, marginTop: 2 }}>{me.goal}</p><p className="ios-dim ios-small" style={{ marginTop: 2 }}>Definido com seu fisioterapeuta na avaliação inicial.</p></div>
        {replies[0] && <div className="ios-card ios-card-pad" style={{ borderLeft: "4px solid var(--primary)" }}><p className="ios-small ios-dim" style={{ fontWeight: 700 }}>RESPOSTA DO SEU FISIOTERAPEUTA</p><p style={{ marginTop: 2 }}>{replies[0].reply}</p></div>}
        <section data-testid="today-exercises">
          <h2 className="ios-group-title">Exercícios de hoje</h2>
          <div className="ios-card ios-card-pad">
            {routines.length === 0 ? <p className="ios-dim">Hoje é dia de descanso na sua rotina.</p> : <>
              <p style={{ fontWeight: 700 }}>{routines.map((r) => r.name).join(" · ")}</p><p className="ios-dim ios-small" style={{ margin: "2px 0 10px" }}>{done} de {total} exercícios registrados hoje</p><Progress value={done} max={total} label="Exercícios registrados hoje" />
              <div style={{ marginTop: 14 }}>{firstOpen ? <Btn onClick={() => nav.push({ id: "runner", params: { routine: firstOpen.id } })}><Play size={18} aria-hidden />Iniciar minha rotina</Btn> : <Btn variant="secondary" onClick={() => nav.setTab("exercicios")}><Check size={18} aria-hidden />Rotina de hoje registrada</Btn>}</div></>}
          </div>
        </section>
        <section data-testid="checkin">
          <h2 className="ios-group-title">Como você está hoje?</h2>
          <div className="ios-card ios-card-pad">
            <div style={{ display: "grid", gridTemplateColumns: "repeat(5,1fr)", gap: 6 }} role="group" aria-label="Como você está se sentindo">
              {[["Mal", "😣"], ["Cansada", "😕"], ["Ok", "😐"], ["Bem", "🙂"], ["Ótimo", "😄"]].map(([l, e], i) => <button key={l} aria-pressed={mood === i + 1} onClick={() => { setMood(i + 1); act.addCheckin(me.id, (i + 1) as 1 | 2 | 3 | 4 | 5, note); }} style={{ minHeight: 62, borderRadius: 14, background: mood === i + 1 ? "var(--primary-soft)" : "var(--surface2)", outline: mood === i + 1 ? "2px solid var(--primary)" : "none", fontSize: 11, fontWeight: 600 }}><div style={{ fontSize: 22 }} aria-hidden>{e}</div>{l}</button>)}
            </div>
            {mood && <div style={{ marginTop: 10 }}><Field id="ck-note" label="Quer contar algo? (opcional)" value={note} onChange={setNote} placeholder="Ex.: dormi mal, joelho tranquilo" /><div style={{ marginTop: 8 }}><Btn small variant="secondary" onClick={() => { act.addCheckin(me.id, mood as 1 | 2 | 3 | 4 | 5, note); nav.toast("Check-in salvo."); }}>Salvar observação</Btn></div></div>}
            <p className="ios-dim ios-small" style={{ marginTop: 8 }}>{mood ? "Registrado. Seu fisioterapeuta pode ver este check-in." : "Leva 5 segundos e ajuda seu fisioterapeuta a ajustar o tratamento."}</p>
          </div>
        </section>
      </div>
    </Page>
  );
};

// ---------------------------------------------------------------- EXECUÇÃO DO EXERCÍCIO
const Timer = ({ seconds, onDone }: { seconds: number; onDone: () => void }) => {
  const [left, setLeft] = useState(seconds); const [run, setRun] = useState(false); const done = useRef(onDone); done.current = onDone;
  useEffect(() => { if (!run) return; const t = window.setInterval(() => setLeft((l) => { if (l <= 1) { window.clearInterval(t); setRun(false); done.current(); return 0; } return l - 1; }), 1000); return () => window.clearInterval(t); }, [run]);
  const mm = String(Math.floor(left / 60)).padStart(2, "0"); const ss = String(left % 60).padStart(2, "0");
  return <div className="ios-card ios-card-pad" data-testid="timer"><p className="ios-timer" aria-live="off">{mm}:{ss}</p><div style={{ display: "flex", gap: 8, marginTop: 8 }}><Btn variant="secondary" onClick={() => setRun(!run)}>{run ? <><Pause size={18} />Pausar</> : <><Play size={18} />{left === seconds ? "Iniciar cronômetro" : "Continuar"}</>}</Btn><Btn variant="plain" onClick={() => { setRun(false); setLeft(seconds); }}><RotateCcw size={18} aria-label="Reiniciar" /></Btn></div></div>;
};
const ExerciseCard = ({ ex, item, onOpen, status }: { ex: Exercise; item: RoutineItem; onOpen: () => void; status?: LogResult }) => (
  <button className="ios-row" onClick={onOpen} style={{ gap: 12 }} data-testid="exercise-card"><div style={{ width: 74, flex: "none" }}><ExerciseArt pose={ex.pose} size={64} /></div><div className="ios-row-body"><div className="ios-row-title">{ex.name}</div><div className="ios-row-sub">{dose(item)} · {ex.region}</div>{status && <div style={{ marginTop: 4 }}><Badge tone={status === "concluido" ? "ok" : status === "parcial" ? "warn" : "bad"}>{resultLabel[status]} (declarado)</Badge></div>}</div></button>
);
const Runner = ({ routineId }: { routineId: string }) => {
  const d = useDemo(); const nav = useNav(); const me = patientById(d, d.meId); const r = d.routines.find((x) => x.id === routineId)!;
  const firstOpen = Math.max(0, r.items.findIndex((i) => !loggedToday(d, me.id, r.id, i.exerciseId))); const [idx, setIdx] = useState(firstOpen); const [finished, setFinished] = useState(false);
  const item = r.items[idx]; const ex = d.library.find((e) => e.id === item?.exerciseId); const [result, setResult] = useState<LogResult | null>(null); const [diff, setDiff] = useState(""); const [doubt, setDoubt] = useState(""); const [demo, setDemo] = useState(false);
  useEffect(() => { setResult(null); setDiff(""); setDoubt(""); setDemo(false); }, [idx]);
  if (finished) return (
    <Page title="Rotina registrada" back><div className="ios-gap" data-testid="runner-done"><div className="ios-card ios-card-pad" style={{ textAlign: "center" }}><Check size={40} color="var(--success)" aria-hidden /><h2 style={{ fontSize: 20, marginTop: 6 }}>Rotina registrada!</h2><p className="ios-dim" style={{ marginTop: 4 }}>Isto é o que você <b>declarou</b>. Seu fisioterapeuta revisa os registros e ajusta a rotina — você não precisa se cobrar por perfeição.</p></div><Btn onClick={() => nav.setTab("hoje")}>Voltar para Hoje</Btn></div></Page>);
  if (!item || !ex) return <Page title="Exercício"><Empty title="Sem exercícios" text="Esta rotina não tem exercícios." /></Page>;
  const save = () => { if (!result) return; act.logExercise({ patientId: me.id, routineId: r.id, exerciseId: ex.id, result, difficulty: diff, doubt, demoViewed: demo }); if (idx + 1 < r.items.length) { setIdx(idx + 1); nav.toast(doubt ? "Registrado. Dúvida enviada ao fisioterapeuta." : "Registrado."); } else setFinished(true); };
  return (
    <Page title={`Exercício ${idx + 1} de ${r.items.length}`} large={false} back>
      <div className="ios-gap" data-testid="runner">
        <div><h1 className="ios-large" style={{ paddingBottom: 4 }}>{ex.name}</h1><p className="ios-dim">{dose(item)} · {ex.region}</p></div>
        <ExerciseArt pose={ex.pose} size={150} />
        <PrivateVideoSlot videoRef={ex.videoRef} />
        <div className="ios-card ios-card-pad"><p style={{ fontWeight: 700 }}>Orientação do seu fisioterapeuta</p><p style={{ marginTop: 2 }}>{item.guidance}</p><p className="ios-dim ios-small" style={{ marginTop: 6 }}>{ex.caution}</p>
          <div style={{ marginTop: 10 }}><Btn small variant="secondary" onClick={() => setDemo(true)}>{demo ? "Passo a passo aberto" : "Ver passo a passo"}</Btn></div>
          {demo && <ol style={{ margin: "10px 0 0", paddingLeft: 20 }} data-testid="steps">{ex.steps.map((s, i) => <li key={i} style={{ marginBottom: 4 }}>{s}</li>)}</ol>}</div>
        {item.durationS ? <Timer seconds={item.durationS} onDone={() => undefined} /> : <div className="ios-card ios-card-pad"><p style={{ fontWeight: 700 }}>{item.sets} séries de {item.reps} repetições</p><p className="ios-dim ios-small">Descanse entre as séries conforme se sentir.</p></div>}
        <section><h2 className="ios-group-title">Como foi?</h2>
          <div className="ios-gap" role="radiogroup" aria-label="Resultado do exercício">{(["concluido", "parcial", "nao_consegui"] as LogResult[]).map((v) => <button key={v} role="radio" aria-checked={result === v} onClick={() => setResult(v)} className="ios-card ios-row" style={{ outline: result === v ? "2px solid var(--primary)" : "none", fontWeight: 700 }}><span className="ios-row-body">{resultLabel[v]}</span>{result === v && <Check size={20} color="var(--primary)" aria-hidden />}</button>)}</div>
          {result && result !== "concluido" && <Field id="rn-diff" label="O que dificultou?" value={diff} onChange={setDiff} multiline placeholder="Ex.: dor, cansaço, não entendi o movimento" />}
          <Field id="rn-doubt" label="Tem alguma dúvida para o fisioterapeuta? (opcional)" value={doubt} onChange={setDoubt} multiline placeholder="Sua dúvida é enviada junto com o registro" />
        </section>
        <p className="ios-dim ios-small">Você está <b>declarando</b> que fez o exercício. Abrir a demonstração e declarar são registros diferentes; seu fisioterapeuta vê os dois.</p>
        <Btn disabled={!result} onClick={save}>{idx + 1 < r.items.length ? "Concluir e ir para o próximo" : "Concluir rotina"}</Btn>
      </div>
    </Page>
  );
};

// ---------------------------------------------------------------- EXERCÍCIOS
const Exercicios = () => {
  const d = useDemo(); const nav = useNav(); const me = patientById(d, d.meId); const todayW = new Date(d.anchor + "T12:00").getDay(); const [wd, setWd] = useState(todayW);
  const routines = d.routines.filter((r) => r.patientId === me.id && r.active && r.days.includes(wd)); const adh = adherenceOf(d, me.id, 14); const logs = logsOf(d, me.id).slice(0, 8);
  return (
    <Page title="Exercícios em casa">
      <div className="ios-gap">
        <div className="ios-chips" role="group" aria-label="Dia da semana">{[1, 2, 3, 4, 5, 6, 0].map((w) => <button key={w} className="ios-chip" aria-pressed={wd === w} onClick={() => setWd(w)}>{weekdayName(w).slice(0, 3)}{w === todayW ? " · hoje" : ""}</button>)}</div>
        {routines.length === 0 ? <Empty title="Sem rotina neste dia" text="Seu fisioterapeuta não prescreveu exercícios para este dia." /> : routines.map((r) => (
          <Group key={r.id} title={r.name} foot={`${r.note} · versão ${r.version}, ajustada pelo seu fisioterapeuta em ${fmtDay(r.assignedAt)}.`}>
            {r.items.map((i) => { const ex = d.library.find((e) => e.id === i.exerciseId)!; const l = d.logs.find((x) => x.patientId === me.id && x.routineId === r.id && x.exerciseId === i.exerciseId && x.date === (wd === todayW ? d.anchor : "-")); return <ExerciseCard key={i.exerciseId} ex={ex} item={i} status={l?.result} onOpen={() => nav.push({ id: "runner", params: { routine: r.id } })} />; })}
            {wd === todayW && <div className="ios-card-pad"><Btn onClick={() => nav.push({ id: "runner", params: { routine: r.id } })}><Play size={18} aria-hidden />Fazer esta rotina agora</Btn></div>}
          </Group>))}
        <Indicator label="Adesão declarada" value={`${adh.pct}%`} sub={`${adh.declared} de ${adh.days} dias`} period={`Últimos ${adh.days} dias`} definition="Dias em que você declarou ter feito ao menos um exercício (concluído ou parcial). Mede constância, não resultado do tratamento." rows={logs.map((l) => ({ title: `${fmtDay(l.date)} · ${d.library.find((e) => e.id === l.exerciseId)?.name}`, sub: `${resultLabel[l.result]} (autodeclarado) · demonstração ${l.demoViewed ? "aberta" : "não aberta"}` }))} />
        <Group title="Dúvidas e respostas" foot="Dúvidas enviadas durante os exercícios aparecem aqui com a resposta do fisioterapeuta.">
          {logs.filter((l) => l.doubt || l.difficulty).length === 0 ? <Row title="Nenhuma dúvida enviada" /> : logs.filter((l) => l.doubt || l.difficulty).map((l) => <Row key={l.id} title={l.doubt || l.difficulty} sub={l.reply ? `Resposta: ${l.reply}` : "Aguardando resposta"} right={<Badge tone={l.reply ? "ok" : "warn"}>{l.reply ? "Respondida" : "Pendente"}</Badge>} />)}
        </Group>
      </div>
    </Page>
  );
};

// ---------------------------------------------------------------- MINHA JORNADA
const Jornada = () => {
  const d = useDemo(); const me = patientById(d, d.meId); const pr = protocolOf(d, me); const [seg, setSeg] = useState<"resumo" | "medidas" | "metas">("resumo"); const b = balanceOf(d, me.id);
  const tl = timelineOf(d, me.id); const meas = measuresOf(d, me.id); const goals = d.goals.filter((g) => g.patientId === me.id); const notes = sharedNotes(d, me.id); const rec = d.recommendations.find((r) => r.patientId === me.id);
  return (
    <Page title="Minha jornada">
      <div className="ios-gap">
        <Segmented label="Seções da jornada" value={seg} onChange={(v) => setSeg(v as never)} options={[{ id: "resumo", label: "Resumo" }, { id: "medidas", label: "Medidas" }, { id: "metas", label: "Metas" }]} />
        {seg === "resumo" && <>
          <div className="ios-card ios-card-pad" data-testid="encounters"><div style={{ display: "flex", justifyContent: "space-between" }}><p style={{ fontWeight: 700 }}>Encontros realizados</p><Badge tone="gray">{pr.name}</Badge></div><p className="ios-display" style={{ fontSize: 26, fontWeight: 800, margin: "4px 0 8px" }}>{b.done} de {b.contracted}</p><Progress value={b.done} max={b.contracted} label="Encontros realizados do protocolo" />
            <p className="ios-dim ios-small" style={{ marginTop: 8 }}>Mostra a sua <b>participação</b> no protocolo definido por {pr.definedBy}. Não indica porcentagem de recuperação — isso é visto nas medidas e nas metas.</p></div>
          <div className="ios-card ios-card-pad"><h2 className="ios-group-title" style={{ paddingTop: 0 }}>Linha do tempo</h2><div className="ios-timeline">{tl.map((e) => <div key={e.id} className="ios-tl" data-s={e.state}><p style={{ fontWeight: 700 }}>{e.title}{e.date && <span className="ios-dim" style={{ fontWeight: 500 }}> · {fmtDay(e.date)}</span>}</p><p className="ios-dim ios-small">{e.detail}</p></div>)}</div></div>
          <div className="ios-card ios-card-pad"><p style={{ fontWeight: 700 }}>Próximo passo</p><p className="ios-dim" style={{ marginTop: 2 }}>{rec ? "Seu fisioterapeuta registrou uma recomendação — veja em Perfil › Continuidade." : "Depende da reavaliação. Seu fisioterapeuta decide se o ideal é concluir, manter o acompanhamento ou indicar outro protocolo. Nada é renovado automaticamente por fim de sessões."}</p></div>
        </>}
        {seg === "medidas" && <>{meas.map((m) => <MeasureChart key={m.id} m={m} />)}<p className="ios-dim ios-small">Cada ponto é um registro real com data. Informações <b>relatadas por você</b> e <b>avaliadas pelo profissional</b> aparecem separadas.</p></>}
        {seg === "metas" && <>
          <Group title="Metas individuais">{goals.map((g) => { const m = meas.find((x) => x.id === g.measureId); const last = m?.points[m.points.length - 1]; return <Row key={g.id} title={g.title} sub={<>{g.note}{m && last ? ` Atual: ${String(last.value).replace(".", ",")} ${m.unit} · meta ${m.goal}.` : ""}</>} right={<Badge tone={g.status === "atingida" ? "ok" : "info"}>{g.status === "atingida" ? "Atingida" : "Em andamento"}</Badge>} />; })}</Group>
          <Group title="Conquistas">{d.achievements.filter((a) => a.patientId === me.id).map((a) => <Row key={a.id} title={a.text} sub={fmtDay(a.date)} left={<Check size={18} color="var(--success)" aria-hidden />} />)}</Group>
          <Group title="Observações do fisioterapeuta" foot="Somente observações compartilhadas com você. Anotações internas do profissional não aparecem aqui.">{notes.length === 0 ? <Row title="Nenhuma observação ainda" /> : notes.map((n) => <Row key={n.id} title={n.text} sub={`${n.author} · ${fmtDay(n.date)}`} />)}</Group>
        </>}
      </div>
    </Page>
  );
};

// ---------------------------------------------------------------- AGENDA
const ApptRow = ({ a, onOpen }: { a: Appointment; onOpen: () => void }) => <Row onClick={onOpen} title={`${fmtDayLong(a.at)} · ${fmtTime(a.at)}`} sub={`${KIND[a.kind]} · ${a.place}`} right={<ApptBadge s={a.status} />} />;
const Agenda = () => {
  const d = useDemo(); const nav = useNav(); const me = patientById(d, d.meId); const b = balanceOf(d, me.id); const [view, setView] = useState<"lista" | "calendario">("lista"); const [sel, setSel] = useState(d.anchor);
  const all = apptsOf(d, me.id); const up = upcomingOf(d, me.id); const past = all.filter((a) => !up.includes(a)).reverse(); const marks = new Set(all.map((a) => a.at.slice(0, 10)));
  return (
    <Page title="Agenda">
      <div className="ios-gap">
        <div className="ios-card ios-card-pad" data-testid="balance"><p style={{ fontWeight: 700 }}>Saldo do protocolo</p>
          <div className="ios-grid2" style={{ gridTemplateColumns: "repeat(4,1fr)", marginTop: 8, textAlign: "center" }}>{[["Contratadas", b.contracted], ["Realizadas", b.done], ["Descontadas", b.discounted], ["Disponíveis", b.available]].map(([l, v]) => <div key={String(l)}><p className="ios-display" style={{ fontSize: 24, fontWeight: 800 }}>{v}</p><p className="ios-dim" style={{ fontSize: 10.5 }}>{l}</p></div>)}</div>
          <p className="ios-dim ios-small" style={{ marginTop: 8 }}>Descontadas = {b.noShow} falta(s) + {b.late} cancelamento(s) com menos de 24 h. Das {b.available} disponíveis, {b.scheduled} já estão agendadas.</p></div>
        <Segmented label="Modo de visualização" value={view} onChange={(v) => setView(v as never)} options={[{ id: "lista", label: "Lista" }, { id: "calendario", label: "Calendário" }]} />
        {view === "lista" ? <>
          <Group title="Próximos">{up.length === 0 ? <Row title="Nenhum atendimento agendado" /> : up.map((a) => <ApptRow key={a.id} a={a} onOpen={() => nav.push({ id: "appt", params: { id: a.id } })} />)}</Group>
          <Group title="Histórico">{past.map((a) => <ApptRow key={a.id} a={a} onOpen={() => nav.push({ id: "appt", params: { id: a.id } })} />)}</Group>
        </> : <>
          <MonthCalendar selected={sel} onSelect={setSel} today={d.anchor} marks={marks} />
          <Group title={fmtDayLong(sel)}>{all.filter((a) => a.at.slice(0, 10) === sel).length === 0 ? <Row title="Nada neste dia" /> : all.filter((a) => a.at.slice(0, 10) === sel).map((a) => <ApptRow key={a.id} a={a} onOpen={() => nav.push({ id: "appt", params: { id: a.id } })} />)}</Group>
        </>}
        <Group title="Como ler os status" foot="Presença confirmada = você avisou que vai. Realizado = o profissional registrou o atendimento. Falta = não compareceu e não cancelou (desconta do saldo).">{null}</Group>
      </div>
    </Page>
  );
};
const ApptDetail = ({ id }: { id: string }) => {
  const d = useDemo(); const nav = useNav(); const a = d.appts.find((x) => x.id === id)!; const [ask, setAsk] = useState(false); const cons = cancelConsequence(a); const active = a.status === "scheduled" || a.status === "confirmed";
  return (
    <Page title="Atendimento" large={false}>
      <div className="ios-gap" data-testid="appt-detail">
        <div className="ios-card ios-card-pad"><h1 className="ios-display" style={{ fontSize: 22 }}>{fmtDayLong(a.at)}</h1><p style={{ fontSize: 18, fontWeight: 700 }}>{fmtTime(a.at)} · {a.durationMin} min</p><div style={{ marginTop: 8, display: "flex", gap: 6, flexWrap: "wrap" }}><ApptBadge s={a.status} /><Badge tone="gray">{KIND[a.kind]}</Badge><Badge tone="gray">{a.place}</Badge></div></div>
        <Group><Row left={<Avatar name={d.physio.name} hue={d.physio.hue} size={40} />} title={d.physio.name} sub={d.physio.specialty} /></Group>
        {a.status === "confirmed" && <p className="ios-dim ios-small">Você confirmou presença. Isso não significa atendimento realizado: o profissional registra o atendimento depois que acontece.</p>}
        {a.status === "no_show" && <p className="ios-small" style={{ color: "var(--danger)" }}>Falta: você não compareceu e não cancelou. Esta sessão foi descontada do saldo.</p>}
        {a.status === "cancelled_late" && <p className="ios-small" style={{ color: "var(--warning)" }}>Cancelado com menos de 24 h de antecedência: sessão descontada do saldo.</p>}
        {a.status === "done" && <p className="ios-dim ios-small">Atendimento realizado e registrado pelo profissional.</p>}
        {active && <>{a.status === "scheduled" && <Btn onClick={() => { act.confirmPresence(a.id); nav.toast("Presença confirmada."); }}>Confirmar presença</Btn>}<Btn variant="danger" onClick={() => setAsk(true)}>Cancelar atendimento</Btn></>}
      </div>
      <AlertBox open={ask} title="Cancelar este atendimento?" message={cons.text} actions={[{ label: "Manter atendimento", onClick: () => setAsk(false) }, { label: cons.late ? "Cancelar e descontar a sessão" : "Cancelar sem desconto", danger: true, onClick: () => { act.cancelAppt(a.id); setAsk(false); nav.toast(cons.late ? "Cancelado. A sessão foi descontada." : "Cancelado. Nenhuma sessão foi descontada."); nav.pop(); } }]} />
    </Page>
  );
};

// ---------------------------------------------------------------- PERFIL
const Perfil = () => {
  const d = useDemo(); const nav = useNav(); const sh = useShell(); const me = patientById(d, d.meId); const pr = protocolOf(d, me); const [msg, setMsg] = useState(""); const [more, setMore] = useState(false);
  const rec = d.recommendations.find((r) => r.patientId === me.id); const msgs = d.messages.filter((m) => m.patientId === me.id);
  return (
    <Page title="Perfil">
      <div className="ios-gap">
        <div className="ios-card ios-card-pad" style={{ display: "flex", gap: 14, alignItems: "center" }}><Avatar name={me.name} hue={me.hue} size={60} /><div><p className="ios-display" style={{ fontSize: 19, fontWeight: 800 }}>{me.name}</p><p className="ios-dim ios-small">{me.age} anos · paciente desde {fmtDay(me.since)}</p><Badge tone="gold">Dados de demonstração</Badge></div></div>
        {rec && <div className="ios-card ios-card-pad" style={{ borderLeft: "4px solid var(--accent)" }} data-testid="recommendation"><p className="ios-small ios-dim" style={{ fontWeight: 700 }}>CONTINUIDADE RECOMENDADA PELO SEU FISIOTERAPEUTA</p><p className="ios-display" style={{ fontSize: 18, fontWeight: 800, marginTop: 2 }}>{rec.protocolName}</p><p style={{ marginTop: 4 }}>Motivo: {rec.reason}</p><p className="ios-dim ios-small" style={{ margin: "4px 0 10px" }}>Registrada em {fmtDay(rec.createdAt)}. Nada é contratado ou cobrado automaticamente.</p><Btn small variant="secondary" onClick={() => setMore(true)}>{rec.interested ? "Você pediu mais informações" : "Quero saber mais"}</Btn></div>}
        <Group title="Lembretes"><Row title="Lembrete de atendimento" right={<Switch checked={d.prefs.reminderAppt} onChange={(v) => act.setPref("reminderAppt", v)} label="Lembrete de atendimento" />} left={<Bell size={18} aria-hidden />} /><Row title="Lembrete da rotina de exercícios" right={<Switch checked={d.prefs.reminderRoutine} onChange={(v) => act.setPref("reminderRoutine", v)} label="Lembrete da rotina" />} /><Row title="Check-in semanal" right={<Switch checked={d.prefs.reminderCheckin} onChange={(v) => act.setPref("reminderCheckin", v)} label="Check-in semanal" />} /></Group>
        <Group title="Privacidade" foot="Seu fisioterapeuta vê o que você registra aqui. Anotações internas dele não são compartilhadas com você, e você escolhe se relatos de desconforto aparecem nos gráficos dele."><Row left={<Shield size={18} aria-hidden />} title="Compartilhar relatos de desconforto" sub="Valores que você informa nas medidas" right={<Switch checked={d.prefs.shareReported} onChange={(v) => act.setPref("shareReported", v)} label="Compartilhar relatos" />} /></Group>
        <Group title="Protocolos e assinaturas"><Row title={pr.name} sub={`${pr.totalSessions} encontros · definido por ${pr.definedBy} · ${brl(pr.priceCents)}`} right={<Badge tone="ok">Ativo</Badge>} /><Row title="Manutenção mensal" sub="Assinatura opcional, só se for indicada na reavaliação" right={<Badge tone="gray">Não contratada</Badge>} /></Group>
        <Group title="Pagamentos (fictícios)">{d.payments.filter((p) => p.patientId === me.id).map((p) => <Row key={p.id} left={<CreditCard size={18} aria-hidden />} title={p.label} sub={`${fmtDay(p.date)} · ${p.method}`} right={<b>{brl(p.cents)}</b>} />)}</Group>
        <Group title="Atendimento da equipe" foot="Respondemos em até 24 horas. Esta prévia não envia mensagens de verdade.">{msgs.map((m) => <Row key={m.id} left={<MessageCircle size={18} aria-hidden />} title={m.text} sub={`${m.from === "paciente" ? "Você" : "Equipe HP"} · ${fmtDay(m.at)}`} />)}<div className="ios-card-pad"><Field id="pf-msg" label="Nova mensagem" value={msg} onChange={setMsg} multiline placeholder="Escreva sua dúvida para a equipe" /><div style={{ marginTop: 8 }}><Btn disabled={!msg.trim()} onClick={() => { act.sendMessage(me.id, msg.trim()); setMsg(""); nav.toast("Mensagem registrada (demonstração)."); }}><LifeBuoy size={18} aria-hidden />Enviar à equipe</Btn></div></div></Group>
        <Group title="Quem acessou meu prontuário" foot="Todo acesso de profissionais e da administração ao seu prontuário fica registrado e visível para você.">{d.admin.accessLog.filter((e) => e.patientId === me.id).length === 0 ? <Row title="Nenhum acesso registrado" /> : d.admin.accessLog.filter((e) => e.patientId === me.id).map((e) => <Row key={e.id} left={<Shield size={18} aria-hidden />} title={e.who} sub={`${fmtDay(e.at)} ${fmtTime(e.at)} · ${e.what}`} />)}</Group>
        <Group title="Aparência e demonstração"><div className="ios-card-pad ios-gap"><Segmented label="Tema" value={sh.theme} onChange={(v) => sh.setTheme(v as never)} options={[{ id: "light", label: "Claro" }, { id: "dark", label: "Escuro" }]} /><Segmented label="Tamanho do texto" value={String(sh.textScale)} onChange={(v) => sh.setTextScale(Number(v))} options={[{ id: "1", label: "Padrão" }, { id: "1.15", label: "Maior" }, { id: "1.3", label: "Bem maior" }]} /><Btn variant="secondary" onClick={() => { sh.reset(); nav.toast("Demonstração restaurada."); }}>Restaurar demonstração</Btn><Btn variant="plain" onClick={sh.exit}>Sair da demonstração</Btn></div></Group>
      </div>
      <Sheet open={more} onClose={() => setMore(false)} title={rec?.protocolName ?? "Continuidade"}>
        {rec && <div className="ios-gap"><p>{rec.reason}</p><p className="ios-dim ios-small">Esta é uma orientação clínica do seu fisioterapeuta, não uma oferta automática. Ao tocar em “Tenho interesse”, a equipe entra em contato para explicar valores e agenda — sem cobrança nem compromisso.</p><Btn disabled={rec.interested} onClick={() => { act.interestedIn(rec.id); setMore(false); nav.toast("Pronto! A equipe vai entrar em contato (demonstração)."); }}>{rec.interested ? "Interesse registrado" : "Tenho interesse"}</Btn></div>}
      </Sheet>
    </Page>
  );
};

export const PatientApp = () => {
  const d = useDemo(); const flags = useMemo(() => ({ hoje: 0, exercicios: routinesForDay(d, d.meId, d.anchor).reduce((s, r) => s + r.items.filter((i) => !loggedToday(d, d.meId, r.id, i.exerciseId)).length, 0) }), [d]);
  const render = (s: Screen) => { switch (s.id) { case "runner": return <Runner routineId={s.params!.routine} />; case "appt": return <ApptDetail id={s.params!.id} />; case "hoje": return <Hoje />; case "jornada": return <Jornada />; case "exercicios": return <Exercicios />; case "agenda": return <Agenda />; default: return <Perfil />; } };
  const items = [{ id: "hoje", label: "Hoje", icon: <Home size={24} aria-hidden /> }, { id: "jornada", label: "Minha jornada", icon: <LineChart size={24} aria-hidden /> }, { id: "exercicios", label: "Exercícios", icon: <Dumbbell size={24} aria-hidden /> }, { id: "agenda", label: "Agenda", icon: <CalendarDays size={24} aria-hidden /> }, { id: "perfil", label: "Perfil", icon: <User size={24} aria-hidden /> }];
  return <NavHost tabs={items.map((i) => i.id)} initial="hoje" render={render} renderTabBar={(t, set) => <TabBar items={items} active={t} onChange={set} badges={{ exercicios: flags.exercicios }} />} />;
};
