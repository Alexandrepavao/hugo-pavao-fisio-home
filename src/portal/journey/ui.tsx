import { createContext, useContext, type ReactNode } from "react";
import { Link } from "react-router-dom";
import { Area, CartesianGrid, ComposedChart, LabelList, Line, ResponsiveContainer, XAxis, YAxis } from "recharts";
import { Activity, BookOpen, CalendarDays, Check, ClipboardList, Dumbbell, Flag, LineChart, Map as MapIcon, Package, PlayCircle, Sparkles, Target, Video } from "lucide-react";
import { fmtDateTime } from "@/lib/format";
import { APPT_KIND_LABEL, EDU_TOPIC_LABEL, apptKind, nextAction, num, painSummary, sessionsSummary, stageStates, weekDays, type ApptItem, type ExerciseItem, type JourneyModel, type JourneyTab, type VideoItem } from "./model";
import "./journey.css";

/** O que muda entre o portal real e a demonstração: para onde os botões levam e o que os botões de ação fazem. Os componentes não sabem em qual dos dois estão. */
export interface JourneyActions {
  hrefFor?: (tab: JourneyTab) => string;           // portal real: links de verdade
  go?: (tab: JourneyTab) => void;                  // demonstração: troca de aba interna
  confirmAppt?: (a: ApptItem) => void; cancelAppt?: (a: ApptItem) => void;
  watch?: (v: { id: string; title: string; kind: "exercise" | "video" }) => void;
  markDone?: (e: ExerciseItem) => void;            // só na demonstração (estado local); no portal real o registro é feito na aba Exercícios
}
const Ctx = createContext<JourneyActions>({});
export const JourneyProvider = ({ value, children }: { value: JourneyActions; children: ReactNode }) => <Ctx.Provider value={value}>{children}</Ctx.Provider>;
export const useJourney = () => useContext(Ctx);

export const TabLink = ({ tab, className = "jr-btn", children, ...rest }: { tab: JourneyTab; className?: string; children: ReactNode } & Record<string, unknown>) => {
  const a = useJourney();
  if (a.hrefFor) return <Link to={a.hrefFor(tab)} className={className} {...rest}>{children}</Link>;
  return <button type="button" className={className} onClick={() => a.go?.(tab)} {...rest}>{children}</button>;
};

const dt = (iso: string) => new Date(iso).toLocaleDateString("pt-BR", { day: "2-digit", month: "short", timeZone: "America/Sao_Paulo" }).replace(".", "");
const hm = (iso: string) => new Date(iso).toLocaleTimeString("pt-BR", { hour: "2-digit", minute: "2-digit", timeZone: "America/Sao_Paulo" }).replace(":", "h").replace("h00", "h");
const Ph = ({ title, children }: { title: string; children: ReactNode }) => <div className="jr-ph"><b>{title}</b><span className="jr-muted jr-small">{children}</span></div>;

// ---------------------------------------------------------------- A. saudação, objetivo e próxima ação
export const JourneyHero = ({ m, now }: { m: JourneyModel; now?: Date }) => {
  const na = nextAction(m, now);
  return (
    <section className="jr-card jr-hero jr-c8" aria-label="Saudação e próximo passo" data-testid="jr-hero">
      <div><h1 className="jr-hello">Olá, {m.firstName}</h1><p className="jr-muted">{m.goal ? "Seu objetivo definido com seu fisioterapeuta" : "Seu acompanhamento em um só lugar."}</p></div>
      {m.goal ? (
        <div className="jr-hero-goal" data-testid="jr-goal"><span className="jr-goal-ico" aria-hidden><Target size={22} /></span>
          <div><p className="jr-eyebrow">Meu objetivo</p><p className="jr-big" style={{ fontSize: 19 }}>{m.goal.title}</p>{m.goal.target_date && <p className="jr-small jr-muted">Meta para {new Date(m.goal.target_date + "T12:00:00Z").toLocaleDateString("pt-BR")}</p>}</div></div>
      ) : <Ph title="Seu objetivo será definido na avaliação">Seu fisioterapeuta registra, com você, o que você quer voltar a fazer.</Ph>}
      <div className="jr-next" data-testid="jr-next-action"><Sparkles size={20} aria-hidden style={{ flex: "none" }} />
        <div style={{ flex: 1, minWidth: 0 }}><p className="jr-eyebrow" style={{ color: "inherit", opacity: .8 }}>O que fazer agora</p><p style={{ fontWeight: 800 }}>{na.title}</p><p className="jr-small">{na.detail}</p></div>
        {na.tab !== "inicio" && <TabLink tab={na.tab} className="jr-btn is-amber">Abrir</TabLink>}
      </div>
    </section>
  );
};

// ---------------------------------------------------------------- G. próxima consulta
export const NextAppointmentCard = ({ m }: { m: JourneyModel }) => {
  const a = useJourney(); const n = m.nextAppointment;
  return (
    <section className="jr-card jr-c4" aria-label="Próxima consulta" data-testid="jr-next-appt">
      <h2 className="jr-title"><CalendarDays size={18} aria-hidden />Próxima consulta</h2>
      {n ? (<>
        <p className="jr-big">{dt(n.starts_at)} · {hm(n.starts_at)}</p>
        <p className="jr-muted">{n.professional}</p><p className="jr-small jr-muted">{n.service}</p>
        <p className="jr-small" style={{ marginTop: 6 }}><span className="jr-pill">{APPT_KIND_LABEL[apptKind(n.status)]}</span></p>
        {(a.confirmAppt || a.cancelAppt) && (
          <div className="jr-row" style={{ marginTop: 10 }}>
            {n.canConfirm && !n.confirmed && a.confirmAppt && <button type="button" className="jr-btn" onClick={() => a.confirmAppt?.(n)}><Check size={16} aria-hidden />Confirmar presença</button>}
            {a.cancelAppt && <button type="button" className="jr-btn is-soft" onClick={() => a.cancelAppt?.(n)}>Cancelar</button>}
          </div>)}
        {a.hrefFor && <TabLink tab="agenda" className="jr-small" style={{ display: "inline-block", marginTop: 8, color: "hsl(var(--jr-blue))", fontWeight: 700 }}>Ver toda a agenda →</TabLink>}
      </>) : <Ph title="Nenhuma consulta marcada">Quando houver uma consulta, a data e o profissional aparecem aqui.</Ph>}
    </section>
  );
};

// ---------------------------------------------------------------- B. jornada
export const JourneyTimeline = ({ m }: { m: JourneyModel }) => {
  const st = stageStates(m);
  return (
    <section className="jr-card jr-c12 jr-span-all" aria-label="Etapas da jornada de recuperação" data-testid="jr-journey">
      <h2 className="jr-title"><MapIcon size={18} aria-hidden />Minha jornada de recuperação</h2>
      {st.length === 0 ? <Ph title="As etapas ainda não foram definidas">Seu fisioterapeuta vai definir as etapas do seu acompanhamento. Elas só avançam quando ele registrar, nunca por número de sessões.</Ph> : (<>
        <ol className="jr-stages" style={{ ["--jr-n" as string]: st.length }}>
          {st.map((s, i) => (
            <li key={s.name + i} className={`jr-stage is-${s.state === "concluida" ? "done" : s.state === "atual" ? "now" : "pending"}`} aria-current={s.state === "atual" ? "step" : undefined} data-testid="jr-stage" data-state={s.state}>
              <span className="jr-stage-dot" aria-hidden>{s.state === "concluida" ? <Check size={18} /> : <span style={{ fontWeight: 800 }}>{i + 1}</span>}</span>
              <span><span className="jr-stage-name">{s.name}</span>{s.state === "atual" && <><br /><span className="jr-stage-now-tag">Etapa atual</span></>}{s.state === "concluida" && <span className="jr-small jr-muted" style={{ display: "block" }}>Concluída</span>}</span>
            </li>))}
        </ol>
        <p className="jr-small jr-muted" style={{ marginTop: 10 }}>As etapas e a etapa atual são definidas pelo seu fisioterapeuta e podem mudar com as reavaliações.</p>
      </>)}
    </section>
  );
};

// ---------------------------------------------------------------- C. evolução da dor
export const PainChartCard = ({ m }: { m: JourneyModel }) => {
  const s = painSummary(m.pain); const rows = [...m.pain].sort((a, b) => a.at.localeCompare(b.at)).map((p) => ({ t: new Date(p.at).getTime(), v: p.value, label: dt(p.at) }));
  return (
    <section className="jr-card jr-c7" aria-label="Como minha dor mudou" data-testid="jr-pain">
      <h2 className="jr-title"><Activity size={18} aria-hidden />Como minha dor mudou</h2>
      {s.count === 0 ? <Ph title="Ainda não há registros de dor">Quando você ou seu fisioterapeuta registrarem, o gráfico aparece aqui. Ausência de registro não significa “sem dor”.</Ph> : (<>
        <div className="jr-chart" role="img" aria-label={`Gráfico da dor (escala de 0 a 10): ${s.count} registro(s), último valor ${num(s.last ?? 0)}`}>
          <ResponsiveContainer width="100%" height="100%">
            <ComposedChart data={rows} margin={{ top: 18, right: 14, left: -14, bottom: 0 }}>
              <CartesianGrid strokeDasharray="3 3" stroke="hsl(var(--jr-line))" vertical={false} />
              <XAxis dataKey="t" type="number" scale="time" domain={rows.length > 1 ? ["dataMin", "dataMax"] : [(d: number) => d - 864e5, (d: number) => d + 864e5]} fontSize={11} tickFormatter={(v) => dt(new Date(v).toISOString())} tickLine={false} />
              <YAxis domain={[0, 10]} ticks={[0, 2, 4, 6, 8, 10]} fontSize={11} tickLine={false} width={34} />
              {s.trend && <Area type="linear" dataKey="v" stroke="none" fill="hsl(var(--jr-blue))" fillOpacity={0.14} isAnimationActive={false} />}
              <Line type="linear" dataKey="v" stroke="hsl(var(--jr-navy))" strokeWidth={3} dot={{ r: 5, fill: "hsl(var(--jr-navy))", stroke: "hsl(var(--jr-card))", strokeWidth: 2 }} activeDot={{ r: 6 }} isAnimationActive={false}>
                <LabelList dataKey="v" position="top" fontSize={12} fontWeight={800} fill="hsl(var(--jr-navy))" formatter={(v: number) => num(v)} />
              </Line>
            </ComposedChart>
          </ResponsiveContainer>
        </div>
        <p className="jr-legend"><span>Escala de 0 a 10: 0 = sem dor · 10 = pior dor imaginável</span></p>
        <p style={{ marginTop: 6 }}>
          {s.count === 1 ? <>Há <b>1 registro</b> (<b>{num(s.last ?? 0)}</b> em {dt(new Date(rows[0].t).toISOString())}). A linha de evolução aparece a partir do segundo registro.</>
            : <>De <b>{num(s.first ?? 0)}</b> para <b>{num(s.last ?? 0)}</b> em {s.count} registros{s.delta != null && s.delta !== 0 ? <> ({s.delta < 0 ? "queda" : "aumento"} de {num(Math.abs(s.delta))} ponto(s))</> : null}.</>}
        </p>
        <p className="jr-small jr-muted">São relatos registrados por você e por seu fisioterapeuta. Não são uma previsão de recuperação.</p>
      </>)}
    </section>
  );
};

// ---------------------------------------------------------------- D. evolução funcional (só o que foi cadastrado e avaliado)
export const FunctionalCard = ({ m, limit = 4 }: { m: JourneyModel; limit?: number }) => (
  <section className="jr-card jr-c5" aria-label="Minhas atividades e conquistas" data-testid="jr-functional">
    <h2 className="jr-title"><Flag size={18} aria-hidden />Atividades que quero retomar</h2>
    {m.functional.length === 0 ? <Ph title="Suas atividades aparecem aqui">Quando seu fisioterapeuta cadastrar e avaliar uma atividade do seu objetivo (por exemplo, caminhar ou subir escadas), você acompanha a evolução dela.</Ph> : (<>
      {m.functional.slice(0, limit).map((f) => (
        <div key={f.name} className="jr-bar-row" data-testid="jr-functional-item">
          <div className="jr-bar-top"><span>{f.name}</span><span className="tabular">{num(f.last)}<span className="jr-muted jr-small"> / 10</span></span></div>
          <div className="jr-bar" role="img" aria-label={`${f.name}: ${num(f.last)} de 10${f.count > 1 ? `, início em ${num(f.first)}` : ""}`}><i style={{ width: `${Math.max(0, Math.min(10, f.last)) * 10}%` }} />{f.count > 1 && <b style={{ left: `calc(${Math.max(0, Math.min(10, f.first)) * 10}% - 1px)` }} />}</div>
          <p className="jr-small jr-muted">{f.count > 1 ? `Início ${num(f.first)} (${dt(f.firstAt)}) → agora ${num(f.last)} (${dt(f.lastAt)})` : `1 registro em ${dt(f.lastAt)}; a comparação aparece a partir do segundo.`}</p>
        </div>))}
      <p className="jr-small jr-muted">Escala informada em cada avaliação, de 0 (não consigo) a 10 (como antes). Não é percentual de recuperação.</p>
    </>)}
  </section>
);

// ---------------------------------------------------------------- E. exercícios em casa
const dur = (s: number | null) => (s ? `${Math.floor(s / 60)}:${String(s % 60).padStart(2, "0")}` : null);
export const ExerciseCards = ({ m, showAll = false }: { m: JourneyModel; showAll?: boolean }) => {
  const a = useJourney(); const t = m.training;
  const items = (t?.items ?? []).filter((i) => showAll || !t?.workoutToday || i.workout === t.workoutToday);
  return (
    <section className="jr-card jr-c7" aria-label="Exercícios em casa" data-testid="jr-exercises">
      <div className="jr-split"><h2 className="jr-title"><Dumbbell size={18} aria-hidden />{showAll ? "Minha rotina de exercícios" : "Seus exercícios de hoje"}</h2>{!showAll && t && <TabLink tab="exercicios" className="jr-small" style={{ color: "hsl(var(--jr-blue))", fontWeight: 700 }}>Ver rotina →</TabLink>}</div>
      {!t || t.items.length === 0 ? <Ph title="Nenhum exercício liberado">Seu fisioterapeuta libera a rotina de exercícios em casa depois da avaliação. Nada é prescrito automaticamente.</Ph> : (<>
        <p className="jr-small jr-muted" style={{ marginBottom: 4 }}>{t.title ?? "Rotina"} · liberada pelo seu fisioterapeuta{t.weeklyTarget ? ` · meta de ${t.weeklyTarget} treino(s) por semana` : ""}.</p>
        {t.todayTotal > 0 && <p className="jr-small" style={{ marginBottom: 8 }} data-testid="jr-training-today">Registrado hoje: <b>{t.todayDone} de {t.todayTotal}</b> exercício(s){t.streak > 0 ? ` · sequência de ${t.streak} dia(s)` : ""}.</p>}
        <div className="jr-ex-list">
          {items.map((e) => (
            <article key={e.id} className={`jr-ex ${e.done ? "is-done" : ""}`} data-testid="jr-exercise">
              <div className={`jr-ex-thumb ${e.videoAvailable ? "" : "is-off"}`} aria-hidden><span className="jr-play"><PlayCircle size={26} /></span>{dur(e.duration_s) && <span className="jr-ex-dur">{dur(e.duration_s)}</span>}</div>
              <div className="jr-ex-body">
                <p className="jr-ex-title">{e.title}</p>
                <p className="jr-small jr-muted">{[e.sets ? `${e.sets} série(s)` : null, e.reps ? `${e.reps} repetições` : null, e.duration_s ? `${e.duration_s} s` : null].filter(Boolean).join(" · ") || "Siga a orientação do seu fisioterapeuta"}</p>
                {e.instructions && <p className="jr-small">{e.instructions}</p>}
                {e.notes && <p className="jr-small jr-muted">Orientação do fisioterapeuta: {e.notes}</p>}
                <div className="jr-row">
                  <button type="button" className="jr-btn is-soft" disabled={!e.videoAvailable || !a.watch} onClick={() => a.watch?.({ id: e.id, title: e.title, kind: "exercise" })}><PlayCircle size={16} aria-hidden />{e.videoAvailable ? "Assistir" : "Vídeo indisponível"}</button>
                  {a.markDone && <button type="button" className="jr-btn" onClick={() => a.markDone?.(e)} aria-pressed={!!e.done}>{e.done ? "Registrado como feito" : "Registrar que fiz"}</button>}
                </div>
              </div>
            </article>))}
        </div>
        <p className="jr-small jr-muted" style={{ marginTop: 8 }}>Assistir ao vídeo e registrar que fez o exercício são coisas diferentes: só o seu registro conta como feito.</p>
      </>)}
      {m.videos.length > 0 && (
        <div style={{ marginTop: 12 }} data-testid="jr-videos"><p className="jr-eyebrow" style={{ marginBottom: 6 }}>Vídeos do seu fisioterapeuta</p>
          <div className="jr-ex-list">{m.videos.map((v: VideoItem) => (
            <article key={v.id} className="jr-ex"><div className="jr-ex-thumb" aria-hidden><span className="jr-play"><Video size={22} /></span></div>
              <div className="jr-ex-body"><p className="jr-ex-title">{v.title}</p>{v.description && <p className="jr-small jr-muted">{v.description}</p>}
                <button type="button" className="jr-btn is-soft" disabled={!a.watch} onClick={() => a.watch?.({ id: v.id, title: v.title, kind: "video" })}><PlayCircle size={16} aria-hidden />Assistir</button></div></article>))}</div></div>)}
    </section>
  );
};

// ---------------------------------------------------------------- F. minha semana
export const WeekCard = ({ m, now }: { m: JourneyModel; now?: Date }) => {
  const days = weekDays(m, now); const t = m.training; const informed = days.filter((d) => d.trained).length;
  return (
    <section className="jr-card jr-c5" aria-label="Minha semana" data-testid="jr-week">
      <h2 className="jr-title"><CalendarDays size={18} aria-hidden />Minha semana</h2>
      <div className="jr-week" role="list">
        {days.map((d) => (
          <div key={d.date} role="listitem" className={`jr-day ${d.isToday ? "is-today" : ""}`} aria-label={`${d.label}, ${d.date.slice(8)}${d.isToday ? " (hoje)" : ""}`}>
            <b>{d.label}</b><em>{d.date.slice(8)}</em>
            {d.appts.map((a) => <span key={a.id} className={`jr-mark ${apptKind(a.status)}`} title={`${APPT_KIND_LABEL[apptKind(a.status)]}: ${a.service} ${hm(a.starts_at)}`} data-testid="jr-week-appt" data-kind={apptKind(a.status)} />)}
            {d.trained && <span className="jr-mark treino" title="Treino informado por você" data-testid="jr-week-trained" />}
            {d.skipped && <span className="jr-mark pulou" title="Você informou que não fez o treino" />}
          </div>))}
      </div>
      <div className="jr-key" aria-label="Legenda"><span><i className="jr-mark agendado" />Agendado</span><span><i className="jr-mark realizado" />Realizado</span><span><i className="jr-mark cancelado" />Cancelado/falta</span><span><i className="jr-mark treino" />Treino informado por você</span></div>
      {t?.weeklyTarget ? <p className="jr-small" style={{ marginTop: 8 }}>Meta combinada: <b>{t.weeklyTarget}</b> treino(s) na semana · informados até agora: <b>{informed}</b>.</p> : null}
    </section>
  );
};

// ---------------------------------------------------------------- H. sessões e pacote (quatro coisas separadas)
export const SessionsCard = ({ m }: { m: JourneyModel }) => {
  const s = sessionsSummary(m.sessions);
  return (
    <section className="jr-card jr-c6" aria-label="Sessões e pacote" data-testid="jr-sessions">
      <h2 className="jr-title"><Package size={18} aria-hidden />Sessões e pacote</h2>
      <div className="jr-quad">
        <div className="jr-stat"><span className="jr-eyebrow">Plano clínico</span><strong>{m.sessions.planned ?? "—"}</strong><span className="jr-small jr-muted">{m.sessions.planned == null ? "ainda não definido pelo fisioterapeuta" : m.sessions.maintenance ? "sessões previstas (manutenção)" : "sessões previstas"}</span></div>
        <div className="jr-stat"><span className="jr-eyebrow">Realizadas</span><strong>{s.done ?? "—"}</strong><span className="jr-small jr-muted">atendimentos que aconteceram</span></div>
        <div className="jr-stat"><span className="jr-eyebrow">Consumidas sem atendimento</span><strong>{s.consumed ?? "—"}</strong><span className="jr-small jr-muted">{s.consumed == null ? "sem pacote contratado" : "falta ou cancelamento tardio, pela regra do pacote"}</span></div>
        <div className="jr-stat"><span className="jr-eyebrow">Saldo do pacote</span><strong>{s.balance ?? "—"}</strong><span className="jr-small jr-muted">{s.balance == null ? "sem pacote contratado" : "sessões disponíveis (financeiro, separado do plano)"}</span></div>
      </div>
      <p className="jr-small jr-muted" style={{ marginTop: 8 }}>Quantidade de sessões não mede recuperação. Quem avalia a evolução é o seu fisioterapeuta, a cada reavaliação.</p>
    </section>
  );
};

// ---------------------------------------------------------------- conteúdos educativos aprovados pelo profissional
export const EducationCard = ({ m }: { m: JourneyModel }) => (
  <section className="jr-card jr-c6" aria-label="Para entender seu acompanhamento" data-testid="jr-education">
    <h2 className="jr-title"><BookOpen size={18} aria-hidden />Para entender seu acompanhamento</h2>
    {m.education.length === 0 ? <Ph title="Conteúdos do seu fisioterapeuta">Aqui aparecem os textos que ele aprovar para você sobre: {Object.values(EDU_TOPIC_LABEL).join(", ").toLowerCase()}.</Ph> : (
      <div style={{ display: "grid", gap: 8 }}>{m.education.map((e) => (
        <details key={e.id} className="jr-ph" style={{ borderStyle: "solid" }}><summary style={{ cursor: "pointer", fontWeight: 700, color: "hsl(var(--jr-navy))" }}>{e.title} <span className="jr-pill is-lilac">{EDU_TOPIC_LABEL[e.topic]}</span></summary><p style={{ marginTop: 6, whiteSpace: "pre-line" }}>{e.body}</p></details>))}</div>)}
    <p className="jr-small jr-muted" style={{ marginTop: 8 }}>Conteúdos escritos ou aprovados pelo seu fisioterapeuta. Não substituem a avaliação individual.</p>
  </section>
);

// ---------------------------------------------------------------- programas/ofertas decididos pelo administrador (só com consentimento comercial)
export const OffersCard = ({ m }: { m: JourneyModel }) => m.offers.length === 0 ? null : (
  <section className="jr-card is-amber jr-c12 jr-span-all" aria-label="Próximo passo para você" data-testid="jr-offers">
    <h2 className="jr-title" style={{ color: "inherit" }}><Sparkles size={18} aria-hidden />Próximo passo para você</h2>
    {m.offers.map((o) => <div key={o.id}><p style={{ fontWeight: 800 }}>{o.title}</p>{o.summary && <p className="jr-small">{o.summary}</p>}</div>)}
    <TabLink tab="mais" className="jr-btn is-amber" style={{ marginTop: 8 }}>Ver detalhes</TabLink>
  </section>
);

// ---------------------------------------------------------------- reavaliação (decisão registrada pelo profissional)
export const ReassessmentCard = ({ m }: { m: JourneyModel }) => !m.decision ? null : (
  <section className="jr-card is-lilac jr-c12 jr-span-all" aria-label="Última reavaliação" data-testid="jr-reassessment">
    <h2 className="jr-title"><ClipboardList size={18} aria-hidden />Última reavaliação</h2>
    <p><b>{m.decision === "alta" ? "Alta" : m.decision === "manutencao" ? "Plano de manutenção" : "Continuidade do acompanhamento"}</b></p>
    {m.decisionMessage && <p style={{ whiteSpace: "pre-line" }}>{m.decisionMessage}</p>}
    <p className="jr-small jr-muted">A continuidade depende da sua necessidade clínica e da reavaliação com o seu fisioterapeuta.</p>
  </section>
);

// ---------------------------------------------------------------- início de acompanhamento (sem avaliações)
export const StartState = ({ m, children }: { m: JourneyModel; children?: ReactNode }) => (
  <section className="jr-card is-soft jr-c12 jr-span-all" aria-label="Início do acompanhamento" data-testid="jr-start">
    <h2 className="jr-title"><LineChart size={18} aria-hidden />Seu acompanhamento está começando</h2>
    <p>Ainda não há avaliações registradas, e tudo bem: este espaço se preenche a partir da sua avaliação inicial. Nada aqui é estimado ou preenchido por padrão.</p>
    <ol className="jr-steps" style={{ marginTop: 10 }}>
      <li><span className="n">1</span><span><b>Avaliação inicial</b> — seu fisioterapeuta registra seu objetivo, sua dor e as atividades que você quer retomar.</span></li>
      <li><span className="n">2</span><span><b>Plano e jornada</b> — ele define as etapas, a quantidade de sessões e a rotina de exercícios em casa, se houver.</span></li>
      <li><span className="n">3</span><span><b>Acompanhamento</b> — gráficos, agenda e exercícios passam a mostrar o seu caminho, com datas e autoria.</span></li>
    </ol>
    <div className="jr-row" style={{ marginTop: 12 }}>
      <TabLink tab="agenda" className="jr-btn">Ver minha agenda</TabLink>
      <TabLink tab="evolucao" className="jr-btn is-soft">Registrar como estou hoje</TabLink>
    </div>
    {children}
  </section>
);

/** Passo de cadastro (data de nascimento): organizado como um primeiro passo claro; as regras de idade, responsável e acesso continuam as do servidor. */
export const OnboardingStep = ({ children }: { children: ReactNode }) => (
  <section className="jr-card is-amber jr-c12 jr-span-all" aria-label="Primeiro passo" data-testid="jr-onboarding">
    <p className="jr-eyebrow" style={{ color: "inherit" }}>Primeiro passo · 1 de 1</p>
    <h2 className="jr-title" style={{ color: "inherit" }}>Confirme sua data de nascimento</h2>
    <p className="jr-small" style={{ marginBottom: 8 }}>Ela define quais regras de acesso valem para este cadastro (por exemplo, menores de idade usam o aplicativo com um responsável). Só pode ser informada uma vez.</p>
    {children}
  </section>
);

// ---------------------------------------------------------------- composição do Início
/** Início do paciente, em torno de três perguntas: Como estou? (dor e atividades) · O que faço agora? (próxima ação, exercícios, semana) · Qual é meu próximo passo? (jornada, consulta, reavaliação). */
export const PatientDashboard = ({ m, now, onboarding }: { m: JourneyModel; now?: Date; onboarding?: ReactNode }) => (
  <div className="jr" data-testid="patient-home" data-mode={m.mode}>
    <div className="jr-grid">
      {onboarding && <OnboardingStep>{onboarding}</OnboardingStep>}
      <JourneyHero m={m} now={now} /><NextAppointmentCard m={m} />
      {m.hasData ? <JourneyTimeline m={m} /> : <StartState m={m} />}
      {m.hasData && <><PainChartCard m={m} /><FunctionalCard m={m} /></>}
      <ExerciseCards m={m} /><WeekCard m={m} now={now} />
      <ReassessmentCard m={m} /><OffersCard m={m} />
      <SessionsCard m={m} /><EducationCard m={m} />
    </div>
  </div>
);
