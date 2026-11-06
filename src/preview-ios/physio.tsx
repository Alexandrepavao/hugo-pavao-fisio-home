import { useMemo, useState } from "react";
import { CalendarDays, Check, ChevronLeft, ChevronRight, ClipboardList, Home, Link2Off, Plus, Search, TrendingUp, User, Users, Wallet } from "lucide-react";
import { act, addDays, adherenceOf, apptsOf, balanceOf, brl, earningsOf, evolutionPending, feedbackPending, flagsOf, fmtDay, fmtDayLong, fmtTime, logsOf, measuresOf, patientById, protocolOf, resultLabel, upcomingOf, useDemo, weekdayName } from "./store";
import type { Appointment, Demo, Patient, Phase, RoutineItem } from "./types";
import { ApptBadge } from "./patient";
import { AlertBox, Avatar, Badge, Btn, Empty, ExerciseArt, Field, Group, Indicator, MeasureChart, MonthCalendar, NavHost, Page, Progress, Row, Segmented, Sheet, Switch, TabBar, useNav, type Screen } from "./ui";
import { useShell } from "./shell-context";

const KIND = { avaliacao: "Avaliação", atendimento: "Atendimento", reavaliacao: "Reavaliação" };
const PHASE: Record<Phase, [string, "info" | "ok" | "warn" | "gray"]> = { avaliacao: ["Avaliação inicial", "info"], tratamento: ["Em tratamento", "ok"], reavaliacao: ["Reavaliação pendente", "warn"], concluido: ["Concluído", "gray"] };
const inWindow = (d: Demo, day: string, days = 30) => day >= addDays(d.anchor, -(days - 1)) && day <= d.anchor;
const PERIOD = "Últimos 30 dias (demonstração)";
const Flags = ({ d, p }: { d: Demo; p: Patient }) => { const f = flagsOf(d, p.id); return <>{f.evolution > 0 && <Badge tone="warn">Evolução pendente</Badge>} {f.reassessment > 0 && <Badge tone="bad">Reavaliação</Badge>} {f.feedback > 0 && <Badge tone="info">Feedback sem resposta</Badge>}</>; };

// ---------------------------------------------------------------- formulários (sheets)
const EvolutionForm = ({ d, pid, apptId, onClose }: { d: Demo; pid: string; apptId?: string; onClose: () => void }) => {
  const nav = useNav(); const pending = evolutionPending(d, pid); const [ap, setAp] = useState(apptId ?? pending[0]?.id ?? ""); const [shared, setShared] = useState(""); const [internal, setInternal] = useState(""); const meas = measuresOf(d, pid).filter((m) => m.source === "profissional"); const [vals, setVals] = useState<Record<string, string>>({});
  const save = () => { const values: Record<string, number> = {}; Object.entries(vals).forEach(([k, v]) => { const n = Number(v.replace(",", ".")); if (v.trim() !== "" && Number.isFinite(n)) values[k] = n; });
    if (!shared.trim() && !internal.trim() && Object.keys(values).length === 0) return nav.toast("Registre ao menos uma observação ou medida.");
    act.saveEvolution({ patientId: pid, apptId: ap || undefined, shared, internal, values }); onClose(); nav.toast(shared.trim() ? "Evolução registrada. A parte compartilhada já aparece para o paciente." : "Evolução registrada (somente interna)."); };
  return (
    <div data-testid="evolution-form"><label className="ios-label" htmlFor="ev-ap">Atendimento</label><select id="ev-ap" className="ios-field" value={ap} onChange={(e) => setAp(e.target.value)}><option value="">Sem vínculo com atendimento</option>{apptsOf(d, pid).filter((a) => a.status === "done").slice(-6).reverse().map((a) => <option key={a.id} value={a.id}>{fmtDay(a.at)} · {KIND[a.kind]}{a.evolutionNoteId ? " (já tem evolução)" : ""}</option>)}</select>
      <Field id="ev-sh" label="Mensagem para o paciente (compartilhada)" value={shared} onChange={setShared} multiline placeholder="O que foi feito e o que ele já conquistou" />
      <Field id="ev-in" label="Nota interna (o paciente NÃO vê)" value={internal} onChange={setInternal} multiline placeholder="Raciocínio clínico, cuidados, hipóteses" />
      {meas.length > 0 && <><p className="ios-label">Suas medidas de hoje</p>{meas.map((m) => <Field key={m.id} id={`ev-m-${m.id}`} label={`${m.label} (${m.unit})`} value={vals[m.id] ?? ""} onChange={(v) => setVals({ ...vals, [m.id]: v })} placeholder={`Último: ${String(m.points[m.points.length - 1].value).replace(".", ",")}`} />)}</>}
      <div style={{ marginTop: 16 }}><Btn onClick={save}>Salvar evolução</Btn></div></div>
  );
};
const ReassessForm = ({ d, pid, onClose }: { d: Demo; pid: string; onClose: () => void }) => {
  const nav = useNav(); const [dec, setDec] = useState<"concluir" | "manter" | "recomendar">("manter"); const [reason, setReason] = useState(""); const [shared, setShared] = useState(""); const [proto, setProto] = useState("Manutenção mensal");
  return (
    <div data-testid="reassess-form"><p className="ios-label">Próximo passo (decisão clínica sua)</p>
      <div className="ios-gap" role="radiogroup" aria-label="Próximo passo">{([["concluir", "Concluir o acompanhamento"], ["manter", "Manter o acompanhamento"], ["recomendar", "Recomendar outro protocolo"]] as const).map(([v, l]) => <button key={v} role="radio" aria-checked={dec === v} onClick={() => setDec(v)} className="ios-card ios-row" style={{ outline: dec === v ? "2px solid var(--primary)" : "none", fontWeight: 700 }}><span className="ios-row-body">{l}</span>{dec === v && <Check size={20} color="var(--primary)" aria-hidden />}</button>)}</div>
      {dec === "recomendar" && <Field id="rs-proto" label="Protocolo recomendado" value={proto} onChange={setProto} />}
      <Field id="rs-reason" label="Motivo clínico (aparece para o paciente na recomendação)" value={reason} onChange={setReason} multiline />
      <Field id="rs-shared" label="Mensagem ao paciente" value={shared} onChange={setShared} multiline />
      <p className="ios-dim ios-small" style={{ marginTop: 8 }}>O sistema não gera prescrição nem renovação automática: o paciente só vê o que você registrar aqui.</p>
      <div style={{ marginTop: 14 }}><Btn disabled={reason.trim().length < 5} onClick={() => { act.reassess({ patientId: pid, decision: dec, reason: reason.trim(), shared: shared.trim() || "Reavaliação registrada.", recommendedProtocol: dec === "recomendar" ? proto : undefined }); onClose(); nav.toast("Reavaliação registrada."); }}>Registrar reavaliação</Btn></div></div>
  );
};
const RoutineEditor = ({ d, pid, routineId, onClose }: { d: Demo; pid: string; routineId?: string; onClose: () => void }) => {
  const nav = useNav(); const prev = d.routines.find((r) => r.id === routineId); const [name, setName] = useState(prev?.name ?? ""); const [days, setDays] = useState<number[]>(prev?.days ?? [1, 3, 5]); const [note, setNote] = useState(prev?.note ?? "");
  const [items, setItems] = useState<RoutineItem[]>(prev?.items ?? [{ exerciseId: d.library[0].id, sets: 3, reps: 10, guidance: "" }]);
  const upd = (i: number, p: Partial<RoutineItem>) => setItems(items.map((x, j) => (j === i ? { ...x, ...p } : x)));
  const save = () => { if (name.trim().length < 3 || days.length === 0 || items.length === 0) return nav.toast("Informe nome, dias e ao menos um exercício."); act.assignRoutine({ patientId: pid, id: prev?.id, name: name.trim(), days, items, note }); onClose(); nav.toast("Rotina publicada. O paciente já a vê no app."); };
  return (
    <div data-testid="routine-editor"><Field id="rt-name" label="Nome da rotina" value={name} onChange={setName} placeholder="Ex.: Rotina A · Força" />
      <p className="ios-label">Dias da semana</p><div className="ios-chips" role="group" aria-label="Dias da rotina">{[1, 2, 3, 4, 5, 6, 0].map((w) => <button key={w} className="ios-chip" aria-pressed={days.includes(w)} onClick={() => setDays(days.includes(w) ? days.filter((x) => x !== w) : [...days, w])}>{weekdayName(w).slice(0, 3)}</button>)}</div>
      {items.map((it, i) => <div key={i} className="ios-card ios-card-pad" style={{ marginTop: 10 }}>
        <label className="ios-label" style={{ marginTop: 0 }} htmlFor={`rt-ex-${i}`}>Exercício {i + 1}</label><select id={`rt-ex-${i}`} className="ios-field" value={it.exerciseId} onChange={(e) => upd(i, { exerciseId: e.target.value })}>{d.library.map((e) => <option key={e.id} value={e.id}>{e.name}</option>)}</select>
        <div className="ios-grid2" style={{ marginTop: 6 }}><Field id={`rt-se-${i}`} label="Séries" type="number" value={String(it.sets)} onChange={(v) => upd(i, { sets: Number(v) || 1 })} /><Field id={`rt-re-${i}`} label={it.durationS != null ? "Segundos" : "Repetições"} type="number" value={String(it.durationS ?? it.reps ?? "")} onChange={(v) => upd(i, it.durationS != null ? { durationS: Number(v) || 1 } : { reps: Number(v) || 1 })} /></div>
        <Segmented label="Tipo de dose" value={it.durationS != null ? "tempo" : "reps"} onChange={(v) => upd(i, v === "tempo" ? { durationS: 30, reps: undefined } : { reps: 10, durationS: undefined })} options={[{ id: "reps", label: "Repetições" }, { id: "tempo", label: "Tempo" }]} />
        <Field id={`rt-gu-${i}`} label="Orientação ao paciente" value={it.guidance} onChange={(v) => upd(i, { guidance: v })} /><button className="ios-bar-btn" style={{ color: "var(--danger)" }} onClick={() => setItems(items.filter((_, j) => j !== i))}>Remover exercício</button></div>)}
      <div style={{ margin: "10px 0" }}><Btn variant="secondary" small onClick={() => setItems([...items, { exerciseId: d.library[0].id, sets: 3, reps: 10, guidance: "" }])}><Plus size={16} aria-hidden />Adicionar exercício</Btn></div>
      <Field id="rt-note" label="Orientação geral (o paciente vê)" value={note} onChange={setNote} multiline />
      <p className="ios-dim ios-small" style={{ marginTop: 8 }}>A prescrição e a progressão são decisão sua; nada é gerado automaticamente.</p><div style={{ marginTop: 14 }}><Btn onClick={save}>{prev ? `Publicar versão ${prev.version + 1}` : "Publicar rotina"}</Btn></div></div>
  );
};

// ---------------------------------------------------------------- HOJE
const ApptCard = ({ d, a, compact }: { d: Demo; a: Appointment; compact?: boolean }) => {
  const nav = useNav(); const p = patientById(d, a.patientId); const open = a.status === "scheduled" || a.status === "confirmed";
  return (
    <div className="ios-row" style={{ alignItems: "flex-start", flexWrap: "wrap" }} data-testid="today-appt">
      <div style={{ width: 52, textAlign: "center", flex: "none" }}><p className="ios-display" style={{ fontWeight: 800 }}>{fmtTime(a.at)}</p><p className="ios-dim" style={{ fontSize: 11 }}>{a.durationMin} min</p></div>
      <div className="ios-row-body"><button className="ios-row-title" onClick={() => nav.push({ id: "paciente", params: { id: p.id } })} style={{ textAlign: "left" }}>{p.name}</button><div className="ios-row-sub">{KIND[a.kind]} · {a.place} · {protocolOf(d, p).name}</div><div style={{ marginTop: 4 }}><ApptBadge s={a.status} /></div></div>
      {!compact && open && <div style={{ display: "flex", gap: 8, width: "100%", paddingLeft: 64 }}><Btn small onClick={() => { act.confirmAttendance(a.id); nav.toast("Atendimento registrado. Entra em Ganhos como apurado (regra fictícia)."); }}><Check size={15} aria-hidden />Confirmar atendimento</Btn><Btn small variant="plain" onClick={() => { act.markNoShow(a.id); nav.toast("Falta do paciente registrada."); }}>Registrar falta</Btn></div>}
    </div>
  );
};
const Hoje = () => {
  const d = useDemo(); const nav = useNav(); const today = d.appts.filter((a) => a.at.slice(0, 10) === d.anchor).sort((x, y) => x.at.localeCompare(y.at));
  const cnt = (f: (a: Appointment) => boolean) => today.filter(f).length; const pend = d.patients.flatMap((p) => evolutionPending(d, p.id).map((a) => ({ p, a }))); const reav = d.patients.filter((p) => p.phase === "reavaliacao"); const fb = d.patients.flatMap((p) => feedbackPending(d, p.id).map((l) => ({ p, l })));
  return (
    <Page title={`Olá, ${d.physio.name.split(" ")[1]} ${d.physio.name.split(" ")[2] ?? ""}`.trim()} back={false}>
      <div className="ios-gap">
        <p className="ios-dim" style={{ marginTop: -8 }}>{fmtDayLong(d.anchor)} · dados de demonstração</p>
        <div className="ios-grid2"><Indicator label="Hoje na agenda" value={String(today.length)} sub={`${cnt((a) => a.status === "done")} realizados · ${cnt((a) => a.status === "scheduled" || a.status === "confirmed")} a atender`} period="Hoje" definition="Atendimentos marcados para hoje, por situação: realizado, a atender (agendado ou confirmado) e cancelado." rows={today.map((a) => ({ title: `${fmtTime(a.at)} · ${patientById(d, a.patientId).name}`, sub: KIND[a.kind], right: a.status === "done" ? "Realizado" : a.status === "cancelled" ? "Cancelado" : "A atender" }))} />
          <Indicator label="Pendências" value={String(pend.length + reav.length + fb.length)} sub={`${pend.length} evolução · ${reav.length} reaval. · ${fb.length} feedback`} tone={pend.length + reav.length + fb.length > 0 ? "warn" : "ok"} period="Situação atual" definition="Evoluções de atendimentos realizados nos últimos 14 dias sem registro, reavaliações pendentes e feedbacks de pacientes sem resposta." rows={[...pend.map(({ p, a }) => ({ title: `Evolução · ${p.name}`, sub: `Atendimento de ${fmtDay(a.at)}` })), ...reav.map((p) => ({ title: `Reavaliação · ${p.name}`, sub: protocolOf(d, p).name })), ...fb.map(({ p, l }) => ({ title: `Feedback · ${p.name}`, sub: l.doubt || l.difficulty }))]} /></div>
        <Group title="Agenda do dia">{today.length === 0 ? <Row title="Sem atendimentos hoje" /> : today.map((a) => <ApptCard key={a.id} d={d} a={a} />)}</Group>
        <Group title={`Evoluções pendentes (${pend.length})`} foot="Atendimentos realizados nos últimos 14 dias que ainda não têm evolução registrada.">{pend.length === 0 ? <Row title="Nenhuma pendência" left={<Check size={18} color="var(--success)" />} /> : pend.map(({ p, a }) => <Row key={a.id} onClick={() => nav.push({ id: "paciente", params: { id: p.id, tab: "evolucao", evo: a.id } })} left={<Avatar name={p.name} hue={p.hue} size={36} />} title={p.name} sub={`Atendimento de ${fmtDay(a.at)} · ${fmtTime(a.at)}`} />)}</Group>
        <Group title={`Reavaliações (${reav.length})`}>{reav.length === 0 ? <Row title="Nenhuma pendente" /> : reav.map((p) => <Row key={p.id} onClick={() => nav.push({ id: "paciente", params: { id: p.id, tab: "evolucao" } })} left={<Avatar name={p.name} hue={p.hue} size={36} />} title={p.name} sub={protocolOf(d, p).name} right={<Badge tone="warn">Pendente</Badge>} />)}</Group>
        <Group title={`Feedbacks sem resposta (${fb.length})`}>{fb.length === 0 ? <Row title="Nenhum" /> : fb.map(({ p, l }) => <Row key={l.id} onClick={() => nav.push({ id: "paciente", params: { id: p.id, tab: "feedbacks" } })} left={<Avatar name={p.name} hue={p.hue} size={36} />} title={p.name} sub={l.doubt || l.difficulty || resultLabel[l.result]} />)}</Group>
      </div>
    </Page>
  );
};

// ---------------------------------------------------------------- PACIENTES
const Pacientes = () => {
  const d = useDemo(); const nav = useNav(); const [q, setQ] = useState(""); const [proto, setProto] = useState("todos"); const [phase, setPhase] = useState("todas"); const [pend, setPend] = useState("todas");
  const list = d.patients.filter((p) => p.physioId === d.physio.id).filter((p) => p.name.toLowerCase().includes(q.toLowerCase()) && (proto === "todos" || p.protocolId === proto) && (phase === "todas" || p.phase === phase) && (pend === "todas" || (pend === "evolucao" ? flagsOf(d, p.id).evolution > 0 : pend === "reavaliacao" ? flagsOf(d, p.id).reassessment > 0 : flagsOf(d, p.id).feedback > 0)));
  const active = d.patients.filter((p) => p.phase !== "concluido"); const adh = active.map((p) => ({ p, a: adherenceOf(d, p.id, 14) })); const avg = adh.length ? Math.round(adh.reduce((s, x) => s + x.a.pct, 0) / adh.length) : 0; const goals = d.goals.filter((g) => g.status === "em_andamento");
  return (
    <Page title="Pacientes">
      <div className="ios-gap">
        <div className="ios-grid2">
          <Indicator label="Pacientes ativos" value={String(active.length)} sub="em acompanhamento" period="Situação atual" definition="Pacientes vinculados a você cujo acompanhamento não foi concluído." rows={active.map((p) => ({ title: p.name, sub: protocolOf(d, p).name, right: PHASE[p.phase][0] }))} />
          <Indicator label="Reavaliações pendentes" value={String(d.patients.filter((p) => p.phase === "reavaliacao").length)} sub="aguardam decisão" tone="warn" period="Situação atual" definition="Pacientes na fase de reavaliação: o próximo passo depende da sua decisão clínica." rows={d.patients.filter((p) => p.phase === "reavaliacao").map((p) => ({ title: p.name, sub: protocolOf(d, p).name }))} />
          <Indicator label="Adesão declarada" value={`${avg}%`} sub="média dos ativos" period="Últimos 14 dias" definition="Média, entre pacientes ativos, dos dias com ao menos um exercício declarado (concluído ou parcial). É autodeclaração, não medida de resultado." rows={adh.map(({ p, a }) => ({ title: p.name, sub: `${a.declared} de ${a.days} dias`, right: `${a.pct}%` }))} />
          <Indicator label="Metas acompanhadas" value={String(goals.length)} sub="em andamento" period="Situação atual" definition="Metas individuais de pacientes ainda em andamento." rows={goals.map((g) => ({ title: g.title, sub: patientById(d, g.patientId).name }))} />
        </div>
        <div style={{ position: "relative" }}><Search size={16} aria-hidden style={{ position: "absolute", left: 14, top: 15, color: "var(--label3)" }} /><input className="ios-field" style={{ paddingLeft: 38 }} placeholder="Buscar paciente" aria-label="Buscar paciente" value={q} onChange={(e) => setQ(e.target.value)} /></div>
        <div className="ios-chips" role="group" aria-label="Filtrar por protocolo">{[["todos", "Todos os protocolos"], ...d.protocols.map((p) => [p.id, p.name])].map(([id, l]) => <button key={id} className="ios-chip" aria-pressed={proto === id} onClick={() => setProto(id)}>{l}</button>)}</div>
        <div className="ios-chips" role="group" aria-label="Filtrar por fase">{[["todas", "Todas as fases"], ["avaliacao", "Avaliação"], ["tratamento", "Tratamento"], ["reavaliacao", "Reavaliação"], ["concluido", "Concluído"]].map(([id, l]) => <button key={id} className="ios-chip" aria-pressed={phase === id} onClick={() => setPhase(id)}>{l}</button>)}</div>
        <div className="ios-chips" role="group" aria-label="Filtrar por pendência">{[["todas", "Qualquer pendência"], ["evolucao", "Evolução"], ["reavaliacao", "Reavaliação"], ["feedback", "Feedback"]].map(([id, l]) => <button key={id} className="ios-chip" aria-pressed={pend === id} onClick={() => setPend(id)}>{l}</button>)}</div>
        <Group foot={`${list.length} paciente(s) vinculado(s) a você. Você não vê pacientes de outros profissionais.`}>{list.length === 0 ? <Row title="Nenhum paciente com esses filtros" /> : list.map((p) => <Row key={p.id} data-testid="patient-row" onClick={() => nav.push({ id: "paciente", params: { id: p.id } })} left={<Avatar name={p.name} hue={p.hue} size={42} />} title={p.name} sub={<><span>{protocolOf(d, p).name} · {PHASE[p.phase][0]}</span><br /><Flags d={d} p={p} /></>} />)}</Group>
      </div>
    </Page>
  );
};
const PatientFile = ({ id, tab: t0, evo }: { id: string; tab?: string; evo?: string }) => {
  const d = useDemo(); const nav = useNav(); const p = patientById(d, id); const pr = protocolOf(d, p); const b = balanceOf(d, id); const [tab, setTab] = useState<"resumo" | "rotina" | "evolucao" | "feedbacks">((t0 as "resumo") ?? "resumo");
  const [sheet, setSheet] = useState<null | "evo" | "reav" | "rotina">(evo ? "evo" : null); const [editRoutine, setEditRoutine] = useState<string | undefined>(); const [reply, setReply] = useState<{ id: string; text: string } | null>(null);
  const meas = measuresOf(d, id); const routines = d.routines.filter((r) => r.patientId === id && r.active); const logs = logsOf(d, id); const notes = d.notes.filter((n) => n.patientId === id).sort((x, y) => y.date.localeCompare(x.date)); const adh = adherenceOf(d, id, 14);
  return (
    <Page title={p.name} large={false}>
      <div className="ios-gap" data-testid="patient-file">
        <div style={{ display: "flex", gap: 14, alignItems: "center" }}><Avatar name={p.name} hue={p.hue} size={58} /><div><h1 className="ios-display" style={{ fontSize: 22, fontWeight: 800 }}>{p.name}</h1><p className="ios-dim ios-small">{p.age} anos · paciente {p.code} · {pr.name}</p><div style={{ marginTop: 4 }}><Badge tone={PHASE[p.phase][1]}>{PHASE[p.phase][0]}</Badge> <Flags d={d} p={p} /></div></div></div>
        <Segmented label="Seções da ficha" value={tab} onChange={(v) => setTab(v as never)} options={[{ id: "resumo", label: "Resumo" }, { id: "rotina", label: "Rotina" }, { id: "evolucao", label: "Evolução" }, { id: "feedbacks", label: "Feedbacks" }]} />
        {tab === "resumo" && <>
          <div className="ios-card ios-card-pad"><p className="ios-small ios-dim" style={{ fontWeight: 700 }}>OBJETIVO DO PACIENTE</p><p className="ios-display" style={{ fontSize: 18, fontWeight: 800 }}>{p.goal}</p></div>
          <div className="ios-card ios-card-pad"><div style={{ display: "flex", justifyContent: "space-between" }}><p style={{ fontWeight: 700 }}>Plano: {pr.totalSessions} encontros</p><span className="ios-dim ios-small">definido em {fmtDay(pr.definedOn)}</span></div><Progress value={b.done} max={b.contracted} label="Encontros realizados" /><p className="ios-dim ios-small" style={{ marginTop: 6 }}>{b.done} realizados · {b.discounted} descontados (falta/cancelamento tardio) · {b.available} disponíveis · {b.scheduled} agendados.</p></div>
          <Group title="Próximos atendimentos">{upcomingOf(d, id).length === 0 ? <Row title="Nenhum agendado" /> : upcomingOf(d, id).map((a) => <Row key={a.id} onClick={() => nav.push({ id: "appt", params: { id: a.id } })} title={`${fmtDayLong(a.at)} · ${fmtTime(a.at)}`} sub={KIND[a.kind]} right={<ApptBadge s={a.status} />} />)}</Group>
          {meas.map((m) => <MeasureChart key={m.id} m={m} viewer="physio" />)}
          <Group title="Metas">{d.goals.filter((g) => g.patientId === id).map((g) => <Row key={g.id} title={g.title} sub={g.note} right={<Badge tone={g.status === "atingida" ? "ok" : "info"}>{g.status === "atingida" ? "Atingida" : "Em andamento"}</Badge>} />)}</Group>
        </>}
        {tab === "rotina" && <>
          <Group title="Rotinas prescritas" foot="A rotina publicada aparece imediatamente no app do paciente.">{routines.length === 0 ? <Row title="Nenhuma rotina" /> : routines.map((r) => <Row key={r.id} title={r.name} sub={`${r.days.map((w) => weekdayName(w).slice(0, 3)).join(", ")} · ${r.items.length} exercícios · versão ${r.version}`} onClick={() => { setEditRoutine(r.id); setSheet("rotina"); }} />)}</Group>
          <Btn onClick={() => { setEditRoutine(undefined); setSheet("rotina"); }}><Plus size={18} aria-hidden />Criar nova rotina</Btn>
          <Indicator label="Adesão declarada" value={`${adh.pct}%`} sub={`${adh.declared} de ${adh.days} dias`} period="Últimos 14 dias" definition="Dias com ao menos um exercício declarado pelo paciente (concluído ou parcial). Autodeclaração; não comprova execução nem resultado." rows={logs.slice(0, 12).map((l) => ({ title: `${fmtDay(l.date)} · ${d.library.find((e) => e.id === l.exerciseId)?.name}`, sub: `${resultLabel[l.result]} (autodeclarado) · demonstração ${l.demoViewed ? "aberta" : "não aberta"}` }))} />
        </>}
        {tab === "evolucao" && <>
          <div className="ios-grid2"><Btn onClick={() => setSheet("evo")}>Registrar evolução</Btn><Btn variant="secondary" onClick={() => setSheet("reav")}>Reavaliação</Btn></div>
          <Group title="Notas e evoluções" foot="“Compartilhada” aparece para o paciente; “Interna” fica só com a equipe clínica.">{notes.length === 0 ? <Row title="Nenhum registro" /> : notes.map((n) => <Row key={n.id} title={n.text} sub={`${fmtDay(n.date)} · ${n.author}`} right={<Badge tone={n.shared ? "info" : "gray"}>{n.shared ? "Compartilhada" : "Interna"}</Badge>} />)}</Group>
          <Group title="Reavaliações">{d.reassessments.filter((r) => r.patientId === id).length === 0 ? <Row title="Nenhuma registrada" /> : d.reassessments.filter((r) => r.patientId === id).map((r) => <Row key={r.id} title={r.decision === "concluir" ? "Concluir acompanhamento" : r.decision === "manter" ? "Manter acompanhamento" : `Recomendar: ${r.recommendedProtocol}`} sub={`${fmtDay(r.date)} · ${r.reason}`} />)}</Group>
        </>}
        {tab === "feedbacks" && <Group title="Registros e feedbacks do paciente" foot="Resultados são autodeclarados. “Demonstração aberta” é um registro separado de “declarou que fez”.">{logs.length === 0 ? <Row title="Sem registros" /> : logs.slice(0, 14).map((l) => <Row key={l.id} data-testid="feedback-row" title={`${d.library.find((e) => e.id === l.exerciseId)?.name} · ${fmtDay(l.date)}`} sub={<>{resultLabel[l.result]} (autodeclarado) · demonstração {l.demoViewed ? "aberta" : "não aberta"}{l.difficulty && <><br />Dificuldade: {l.difficulty}</>}{l.doubt && <><br />Dúvida: {l.doubt}</>}{l.reply && <><br />Sua resposta: {l.reply}</>}</>} right={l.reviewedAt ? <Badge tone="ok">Revisado</Badge> : <Btn small variant="secondary" onClick={() => setReply({ id: l.id, text: "" })}>Responder</Btn>} />)}</Group>}
      </div>
      <Sheet open={sheet === "evo"} onClose={() => setSheet(null)} title="Registrar evolução"><EvolutionForm d={d} pid={id} apptId={evo} onClose={() => setSheet(null)} /></Sheet>
      <Sheet open={sheet === "reav"} onClose={() => setSheet(null)} title="Reavaliação"><ReassessForm d={d} pid={id} onClose={() => setSheet(null)} /></Sheet>
      <Sheet open={sheet === "rotina"} onClose={() => setSheet(null)} title={editRoutine ? "Ajustar rotina" : "Nova rotina"}><RoutineEditor d={d} pid={id} routineId={editRoutine} onClose={() => setSheet(null)} /></Sheet>
      <Sheet open={!!reply} onClose={() => setReply(null)} title="Responder paciente">{reply && <div><Field id="fb-reply" label="Resposta (o paciente vê)" value={reply.text} onChange={(v) => setReply({ ...reply, text: v })} multiline /><div className="ios-grid2" style={{ marginTop: 12 }}><Btn onClick={() => { act.reviewFeedback(reply.id, reply.text); setReply(null); nav.toast(reply.text.trim() ? "Resposta enviada ao paciente." : "Marcado como revisado."); }}>{reply.text.trim() ? "Enviar resposta" : "Marcar revisado"}</Btn></div></div>}</Sheet>
    </Page>
  );
};

// ---------------------------------------------------------------- AGENDA
const weekStart = (day: string) => { const w = new Date(day + "T12:00").getDay(); return addDays(day, -((w + 6) % 7)); };
const Agenda = () => {
  const d = useDemo(); const nav = useNav(); const [view, setView] = useState<"dia" | "semana" | "mes">("dia"); const [day, setDay] = useState(d.anchor); const [sheet, setSheet] = useState<null | "disp" | "google">(null);
  const dayList = (x: string) => d.appts.filter((a) => a.at.slice(0, 10) === x).sort((a, b) => a.at.localeCompare(b.at));
  const ws = weekStart(day); const week = Array.from({ length: 7 }, (_, i) => addDays(ws, i)); const marks = new Set(d.appts.map((a) => a.at.slice(0, 10)));
  const weekNow = weekStart(d.anchor); const wk = Array.from({ length: 7 }, (_, i) => addDays(weekNow, i)); const booked = d.appts.filter((a) => wk.includes(a.at.slice(0, 10)) && ["scheduled", "confirmed", "done"].includes(a.status)); const bookedMin = booked.reduce((s, a) => s + a.durationMin, 0);
  const availMin = d.availability.filter((a) => a.enabled).reduce((s, a) => s + (Number(a.to.slice(0, 2)) * 60 + Number(a.to.slice(3)) - Number(a.from.slice(0, 2)) * 60 - Number(a.from.slice(3))), 0); const occ = availMin ? Math.round((100 * bookedMin) / availMin) : 0;
  const lost = d.appts.filter((a) => inWindow(d, a.at.slice(0, 10)) && ["no_show", "cancelled", "cancelled_late"].includes(a.status));
  return (
    <Page title="Agenda">
      <div className="ios-gap">
        <div className="ios-grid2"><Indicator label="Ocupação da agenda" value={`${occ}%`} sub="semana atual" period={`Semana de ${fmtDay(weekNow)}`} definition="Minutos de atendimento marcados (agendados, confirmados ou realizados) ÷ minutos de disponibilidade que você cadastrou." rows={booked.map((a) => ({ title: `${fmtDay(a.at)} ${fmtTime(a.at)} · ${patientById(d, a.patientId).name}`, sub: `${a.durationMin} min`, right: KIND[a.kind] }))} />
          <Indicator label="Faltas e cancelamentos" value={String(lost.length)} sub="últimos 30 dias" tone={lost.length > 2 ? "warn" : undefined} period={PERIOD} definition="Atendimentos com falta do paciente, cancelamento ou cancelamento tardio no período." rows={lost.map((a) => ({ title: `${fmtDay(a.at)} · ${patientById(d, a.patientId).name}`, sub: KIND[a.kind], right: a.status === "no_show" ? "Falta" : a.status === "cancelled" ? "Cancelado" : "Cancel. tardio" }))} /></div>
        <Segmented label="Visão da agenda" value={view} onChange={(v) => setView(v as never)} options={[{ id: "dia", label: "Dia" }, { id: "semana", label: "Semana" }, { id: "mes", label: "Mês" }]} />
        {view === "dia" && <><div style={{ display: "flex", alignItems: "center", justifyContent: "space-between" }}><button className="ios-bar-btn" aria-label="Dia anterior" onClick={() => setDay(addDays(day, -1))}><ChevronLeft /></button><b data-testid="day-title">{fmtDayLong(day)}</b><button className="ios-bar-btn" aria-label="Próximo dia" onClick={() => setDay(addDays(day, 1))}><ChevronRight /></button></div>
          <Group>{dayList(day).length === 0 ? <Row title="Sem atendimentos neste dia" /> : dayList(day).map((a) => <ApptCard key={a.id} d={d} a={a} compact />)}</Group></>}
        {view === "semana" && week.map((x) => <Group key={x} title={`${fmtDayLong(x)}${x === d.anchor ? " · hoje" : ""}`}>{dayList(x).length === 0 ? <Row title="Livre" /> : dayList(x).map((a) => <Row key={a.id} onClick={() => nav.push({ id: "appt", params: { id: a.id } })} title={`${fmtTime(a.at)} · ${patientById(d, a.patientId).name}`} sub={KIND[a.kind]} right={<ApptBadge s={a.status} />} />)}</Group>)}
        {view === "mes" && <><MonthCalendar selected={day} onSelect={setDay} today={d.anchor} marks={marks} /><Group title={fmtDayLong(day)}>{dayList(day).length === 0 ? <Row title="Nada neste dia" /> : dayList(day).map((a) => <Row key={a.id} onClick={() => nav.push({ id: "appt", params: { id: a.id } })} title={`${fmtTime(a.at)} · ${patientById(d, a.patientId).name}`} sub={KIND[a.kind]} right={<ApptBadge s={a.status} />} />)}</Group></>}
        <Group title="Configurações da agenda"><Row onClick={() => setSheet("disp")} title="Disponibilidade" sub={`${d.availability.filter((a) => a.enabled).length} dias por semana`} /><Row onClick={() => setSheet("google")} title="Google Calendar" sub="Não conectado — demonstração" right={<Badge tone="gray">Sem sincronização</Badge>} left={<Link2Off size={18} aria-hidden />} /></Group>
      </div>
      <Sheet open={sheet === "disp"} onClose={() => setSheet(null)} title="Disponibilidade semanal"><div className="ios-card ios-list">{[1, 2, 3, 4, 5, 6, 0].map((w) => { const a = d.availability.find((x) => x.weekday === w)!; return <div key={w} className="ios-row" style={{ flexWrap: "wrap" }}><span className="ios-row-body" style={{ fontWeight: 600, textTransform: "capitalize" }}>{weekdayName(w)}</span><Switch checked={a.enabled} onChange={(v) => act.setAvailability(w, { enabled: v })} label={`Atender ${weekdayName(w)}`} />{a.enabled && <div style={{ display: "flex", gap: 8, width: "100%" }}><input aria-label={`Início ${weekdayName(w)}`} type="time" className="ios-field" value={a.from} onChange={(e) => act.setAvailability(w, { from: e.target.value })} /><input aria-label={`Fim ${weekdayName(w)}`} type="time" className="ios-field" value={a.to} onChange={(e) => act.setAvailability(w, { to: e.target.value })} /></div>}</div>; })}</div><p className="ios-dim ios-small" style={{ marginTop: 8 }}>A ocupação da agenda usa estes horários.</p></Sheet>
      <Sheet open={sheet === "google"} onClose={() => setSheet(null)} title="Google Calendar"><div className="ios-gap"><p><b>Estado: não conectado.</b> Esta prévia não se conecta ao Google nem sincroniza eventos.</p><p className="ios-dim">No app definitivo, a conexão usará a autorização do Google (OAuth) e a integração que já existe no Hub. Até lá, nada aqui é enviado ou lido da sua agenda real.</p></div></Sheet>
    </Page>
  );
};
const ApptDetail = ({ id }: { id: string }) => {
  const d = useDemo(); const nav = useNav(); const a = d.appts.find((x) => x.id === id)!; const p = patientById(d, a.patientId); const open = a.status === "scheduled" || a.status === "confirmed";
  return (
    <Page title="Atendimento" large={false}>
      <div className="ios-gap" data-testid="physio-appt">
        <div className="ios-card ios-card-pad"><h1 className="ios-display" style={{ fontSize: 22 }}>{fmtDayLong(a.at)} · {fmtTime(a.at)}</h1><p className="ios-dim">{KIND[a.kind]} · {a.place} · {a.durationMin} min</p><div style={{ marginTop: 8 }}><ApptBadge s={a.status} /></div></div>
        <Group><Row onClick={() => nav.push({ id: "paciente", params: { id: p.id } })} left={<Avatar name={p.name} hue={p.hue} size={40} />} title={p.name} sub={protocolOf(d, p).name} /></Group>
        {open && <><Btn onClick={() => { act.confirmAttendance(a.id); nav.toast("Atendimento registrado. Entra em Ganhos como apurado (regra fictícia)."); nav.pop(); }}>Confirmar atendimento realizado</Btn><Btn variant="danger" onClick={() => { act.markNoShow(a.id); nav.pop(); }}>Registrar falta do paciente</Btn></>}
        {a.status === "done" && !a.evolutionNoteId && <Btn variant="secondary" onClick={() => nav.push({ id: "paciente", params: { id: p.id, tab: "evolucao", evo: a.id } })}>Registrar evolução deste atendimento</Btn>}
      </div>
    </Page>
  );
};

// ---------------------------------------------------------------- GANHOS
const Ganhos = () => {
  const d = useDemo(); const e = earningsOf(d); const [sheet, setSheet] = useState<null | "rule">(null);
  const rowsFor = (state: "apurado" | "liberado" | "pago") => d.payouts.filter((x) => x.state === state).sort((a, b) => b.date.localeCompare(a.date)).map((x) => { const a = d.appts.find((y) => y.id === x.apptId); const p = a ? patientById(d, a.patientId) : null; return { title: x.kind === "sessao" && a ? `${fmtDay(x.date)} · ${KIND[a.kind]} · Paciente ${p?.code}` : x.label, sub: x.kind === "sessao" && p ? `${protocolOf(d, p).name} · ${x.label}` : `${fmtDay(x.date)} · ${x.kind === "estorno" ? "Estorno" : "Ajuste"}`, right: brl(x.cents) }; });
  const adj = d.payouts.filter((x) => x.kind !== "sessao");
  return (
    <Page title="Ganhos">
      <div className="ios-gap">
        <div className="ios-hero"><p style={{ fontSize: 12, fontWeight: 700, opacity: .8, textTransform: "uppercase", letterSpacing: ".05em" }}>Repasses do período · {PERIOD}</p><p className="ios-display" style={{ fontSize: 32, fontWeight: 800, marginTop: 2 }} data-testid="earn-total">{brl(e.total)}</p>
          <p style={{ opacity: .85, fontSize: 13 }}>{e.eligible} sessões elegíveis × {brl(e.rate)} = {brl(e.eligibleCents)}{adj.length ? ` ${adj.reduce((s, x) => s + x.cents, 0) >= 0 ? "+" : "−"} ajustes/estornos ${brl(Math.abs(adj.reduce((s, x) => s + x.cents, 0)))}` : ""}</p></div>
        <p className="ios-dim ios-small">Cada valor abaixo abre os atendimentos que o compõem. <b>Atendimento agendado não é dinheiro recebido.</b></p>
        <div className="ios-grid2" data-testid="earn-buckets">
          <Indicator label="Estimativa (futuro)" value={brl(e.estimateCents)} sub={`${e.estimateCount} atendimentos agendados`} period="Atendimentos agendados a partir de hoje" definition={`Estimativa: atendimentos futuros × ${brl(e.rate)}. Só vira repasse depois de realizado e apurado. Não é valor recebido.`} rows={e.future.map((a) => ({ title: `${fmtDay(a.at)} ${fmtTime(a.at)} · Paciente ${patientById(d, a.patientId).code}`, sub: KIND[a.kind], right: brl(e.rate) }))} />
          <Indicator label="Apurados" value={brl(e.apurado)} sub="realizados, aguardando liberação" period={PERIOD} definition="Sessões realizadas e elegíveis (pacote pago) que a administração ainda não liberou. Inclui estornos e ajustes nesta situação." rows={rowsFor("apurado")} />
          <Indicator label="Liberados" value={brl(e.liberado)} sub="autorizados, a pagar" period={PERIOD} definition="Valores autorizados pela administração e ainda não pagos." rows={rowsFor("liberado")} />
          <Indicator label="Pagos" value={brl(e.pago)} sub="já recebidos" period={PERIOD} definition="Valores já pagos a você." rows={rowsFor("pago")} tone="ok" />
        </div>
        <Group title="Ajustes e estornos" foot="Aparecem com o motivo registrado pela administração.">{adj.map((x) => <Row key={x.id} title={x.label} sub={`${fmtDay(x.date)} · ${x.state}`} right={<b style={{ color: x.cents < 0 ? "var(--danger)" : "var(--success)" }}>{brl(x.cents)}</b>} />)}</Group>
        <Group title="Como é calculado"><Row onClick={() => setSheet("rule")} left={<ClipboardList size={18} aria-hidden />} title={`${brl(e.rate)} por sessão elegível`} sub="Regra fictícia deste preview" /></Group>
        <p className="ios-dim ios-small">Você vê apenas os seus repasses. O faturamento da clínica e os ganhos de outros profissionais não aparecem aqui.</p>
      </div>
      <Sheet open={sheet === "rule"} onClose={() => setSheet(null)} title="Regra de repasse (fictícia)"><div className="ios-gap"><p><b>{brl(e.rate)}</b> por sessão elegível. Elegível = atendimento <b>realizado</b>, de um pacote com pagamento confirmado.</p><p>Exemplo com os dados desta demonstração: <b>{e.eligible} sessões × {brl(e.rate)} = {brl(e.eligibleCents)}</b>.</p><p className="ios-dim ios-small">Valor e regras reais serão definidos pela administração no Hub. Faltas e cancelamentos não geram repasse; sessão devolvida gera estorno.</p></div></Sheet>
    </Page>
  );
};

// ---------------------------------------------------------------- PERFIL
const Perfil = () => {
  const d = useDemo(); const nav = useNav(); const sh = useShell(); const [g, setG] = useState(false); const done = d.appts.filter((a) => a.status === "done" && inWindow(d, a.at.slice(0, 10)));
  return (
    <Page title="Perfil">
      <div className="ios-gap">
        <div className="ios-card ios-card-pad" style={{ display: "flex", gap: 14, alignItems: "center" }}><Avatar name={d.physio.name} hue={d.physio.hue} size={60} /><div><p className="ios-display" style={{ fontSize: 19, fontWeight: 800 }}>{d.physio.name}</p><p className="ios-dim ios-small">{d.physio.specialty}</p><p className="ios-dim ios-small">{d.physio.council}</p><Badge tone="gold">Dados de demonstração</Badge></div></div>
        <Indicator label="Atendimentos realizados" value={String(done.length)} sub="no período" period={PERIOD} definition="Atendimentos com status realizado, registrados por você, no período." rows={done.sort((a, b) => b.at.localeCompare(a.at)).map((a) => ({ title: `${fmtDay(a.at)} ${fmtTime(a.at)} · ${patientById(d, a.patientId).name}`, sub: KIND[a.kind] }))} />
        <Group title="Integrações"><Row onClick={() => setG(true)} title="Google Calendar" sub="Não conectado — demonstração" right={<Badge tone="gray">Sem sincronização</Badge>} /></Group>
        <Group title="Privacidade" foot="Você acessa apenas pacientes vinculados a você. Notas internas ficam só com a equipe clínica; o que você compartilha aparece para o paciente."><Row title="Pacientes visíveis" sub={`${d.patients.length} vinculados`} /></Group>
        <Group title="Aparência e demonstração"><div className="ios-card-pad ios-gap"><Segmented label="Tema" value={sh.theme} onChange={(v) => sh.setTheme(v as never)} options={[{ id: "light", label: "Claro" }, { id: "dark", label: "Escuro" }]} /><Segmented label="Tamanho do texto" value={String(sh.textScale)} onChange={(v) => sh.setTextScale(Number(v))} options={[{ id: "1", label: "Padrão" }, { id: "1.15", label: "Maior" }, { id: "1.3", label: "Bem maior" }]} /><Btn variant="secondary" onClick={() => { sh.reset(); nav.toast("Demonstração restaurada."); }}>Restaurar demonstração</Btn><Btn variant="plain" onClick={sh.exit}>Sair da demonstração</Btn></div></Group>
      </div>
      <AlertBox open={g} title="Google Calendar" message="Esta prévia não se conecta ao Google. No app definitivo a conexão será real e opcional." actions={[{ label: "Entendi", onClick: () => setG(false) }]} />
    </Page>
  );
};

export const PhysioApp = () => {
  const d = useDemo(); const pend = useMemo(() => d.patients.reduce((s, p) => { const f = flagsOf(d, p.id); return s + f.evolution + f.reassessment + f.feedback; }, 0), [d]);
  const render = (s: Screen) => { switch (s.id) { case "paciente": return <PatientFile key={s.params!.id + (s.params!.tab ?? "")} id={s.params!.id} tab={s.params!.tab} evo={s.params!.evo} />; case "appt": return <ApptDetail id={s.params!.id} />; case "hoje": return <Hoje />; case "pacientes": return <Pacientes />; case "agenda": return <Agenda />; case "ganhos": return <Ganhos />; default: return <Perfil />; } };
  const items = [{ id: "hoje", label: "Hoje", icon: <Home size={24} aria-hidden /> }, { id: "pacientes", label: "Pacientes", icon: <Users size={24} aria-hidden /> }, { id: "agenda", label: "Agenda", icon: <CalendarDays size={24} aria-hidden /> }, { id: "ganhos", label: "Ganhos", icon: <Wallet size={24} aria-hidden /> }, { id: "perfil", label: "Perfil", icon: <User size={24} aria-hidden /> }];
  void TrendingUp; void ExerciseArt; void Empty;
  return <NavHost tabs={items.map((i) => i.id)} initial="hoje" render={render} renderTabBar={(t, set) => <TabBar items={items} active={t} onChange={set} badges={{ hoje: pend }} />} />;
};
