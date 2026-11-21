import { useMemo, useState, type ReactNode } from "react";
import { ArrowRight, Check, HelpCircle, Repeat2, ShieldCheck } from "lucide-react";
import { brl } from "@/lib/format";
import { brandLogoUrl } from "@/lib/org";
import capaHp from "@/assets/ebook-capa-hp.jpg";
import { ExerciseCards, FunctionalCard, JourneyProvider, JourneyTimeline, PainChartCard, PatientDashboard, WeekCard } from "@/portal/journey/ui";
import type { JourneyModel } from "@/portal/journey/model";
import { isScale10, type DeckData, type DeckSelection } from "./deckModel";
import { DEMO_TEXT, Glass, Legend, MeasureChart, Metric, Page, PageFoot, PageHead, Phone, SLIDE_H, SLIDE_W, Steps, short, type PhoneMark } from "./parts";
import "@/portal/journey/journey.css";
import "./deck.css";

export { SLIDE_H, SLIDE_W };
const PAY_STATE: Record<string, string> = { no_contract: "Contratação ainda não feita", awaiting: "Aguardando o pagamento da 1ª parcela", confirmed: "Pagamento confirmado — acompanhamento ativo" };
const REC_ST: Record<string, string> = { open: "Em aberto", partial: "Parcial", paid: "Paga", refunded: "Estornada", cancelled: "Cancelada" };

export interface SlideCtx {
  model: JourneyModel | null; appBase: string;        // endereço do aplicativo (origem + base da organização), montado pela tela
  live?: { payment?: "no_contract" | "awaiting" | "confirmed"; installments?: { no: number; due_date: string; amount_cents: number; status: string }[]; responded?: string[]; enrollment_status?: "pending" | "active" };
  onRespond?: (c: "questions" | "start") => void; interactive: boolean;
}

/** Ordem e presença das páginas: respeita a seleção do profissional e nunca cria página sem dado (evidência sem ficha aprovada simplesmente não existe).
 *  O aplicativo ocupa três páginas legíveis: tela inicial (app), exercícios e vídeos (videos) e evolução (evolution). */
export const slideKeys = (d: DeckData): string[] => {
  const s = d.selection, ev = (d.snapshot.presentation.content.evidence ?? []).length > 0;
  const keys = ["cover"]; (["goals", "start", "path", "app", "videos", "evolution", "continuity"] as (keyof DeckSelection)[]).forEach((k) => { if (s[k]) keys.push(k); });
  if (s.evidence && ev) keys.push("evidence"); if (s.plan) keys.push("plan"); if (s.next) keys.push("next"); return keys;
};

const Cover = ({ d, total }: { d: DeckData; total: number }) => {
  const s = d.snapshot, hp = !!s.clinic.is_default_brand, logo = brandLogoUrl(s.clinic.logo_path);
  return (
    <section className="slide is-navy slide-cover" data-testid="slide-1" aria-label="Capa">
      {hp ? <img className="cover-photo" src={capaHp} alt="HP Fisio Group — Hugo Pavão, fisioterapeuta" data-testid="deck-capa" /> : <div className="cover-brand">{logo ? <img src={logo} alt={s.clinic.name} /> : <b>{s.clinic.name}</b>}</div>}
      <div className="cover-text">
        <p className="t-eyebrow">PLANO DE CUIDADO PERSONALIZADO</p>
        <h1 className="t-title is-cover" data-testid="deck-title">Seu plano <em>de cuidado</em></h1>
        <p className="cover-name" data-testid="deck-patient">{s.patient.name}</p>
        <Glass tone="dark" className="cover-meta"><span>{s.professional ? <>Profissional: <b>{s.professional}</b></> : "Plano de cuidado"}</span><i aria-hidden />{short(s.evaluation_at ?? s.generated_at)}</Glass>
      </div>
      <footer className="slide-foot">{d.is_demo ? <b className="slide-demo">{DEMO_TEXT}</b> : <span />}<span className="t-label">1 / {total}</span></footer>
    </section>
  );
};

const Goals = ({ d, n, total }: { d: DeckData; n: number; total: number }) => {
  const c = d.snapshot.presentation.content; const items = [c.goal ? { who: "Objetivo definido com seu fisioterapeuta", text: c.goal.title, extra: c.goal.target_date ? `Meta para ${short(c.goal.target_date)}` : null } : null,
    c.reported.activities ? { who: "Relatado por você", text: c.reported.activities, extra: null } : null].filter((x): x is { who: string; text: string; extra: string | null } => !!x);
  return (
    <Page n={n} total={total} d={d} eyebrow="SEUS OBJETIVOS" title={<>O que você quer <em>voltar a fazer</em></>}>
      <div className="page-body">
        {items.length === 0 ? <p className="t-sub">Seu fisioterapeuta vai registrar os seus objetivos com você.</p> : <div className="goal-grid" data-testid="deck-goals">{items.map((it) => <Glass as="blockquote" key={it.who} className="goal-card"><span className="t-label">{it.who}</span><p className="goal-quote">{it.text}</p>{it.extra && <span className="t-cap">{it.extra}</span>}</Glass>)}</div>}
        <p className="t-cap page-note">Nada aqui foi inventado: são as palavras registradas na sua avaliação.</p>
      </div>
    </Page>
  );
};

const Start = ({ d, n, total }: { d: DeckData; n: number; total: number }) => {
  const c = d.snapshot.presentation.content; const ms = d.snapshot.measures.filter((m) => m.points.length > 0 && isScale10(m));
  const other = d.snapshot.measures.filter((m) => m.points.length > 0 && !isScale10(m));
  return (
    <Page n={n} total={total} d={d} eyebrow="PONTO DE PARTIDA" title={<>Onde você <em>está hoje</em></>}>
      <div className="page-body start-grid">
        <div className="start-text">
          <p className="t-label">Relatado por você</p><p className="start-big">{c.reported.complaint ?? "Sem relato registrado"}</p>
          {c.reported.symptom_duration && <p className="t-body"><b>Há quanto tempo:</b> {c.reported.symptom_duration}</p>}{c.reported.limitations && <p className="t-body"><b>Limitações:</b> {c.reported.limitations}</p>}
          {c.assessed.condition_text && <><p className="t-label is-pro">{c.assessed.condition_kind === "hypothesis" ? "Hipótese em investigação (fisioterapeuta)" : "Avaliado pelo fisioterapeuta"}</p><p className="t-body">{c.assessed.condition_text}</p></>}
        </div>
        <div className="start-charts" data-testid="deck-measures">
          {ms.length === 0 && other.length === 0 ? <p className="t-sub">Nesta avaliação ainda não há medidas registradas. Elas aparecem aqui assim que o fisioterapeuta as coletar.</p> : null}
          {ms.map((m) => <MeasureChart key={`${m.instrument}-${m.label ?? m.name}`} s={m} demo={d.is_demo} />)}
          {other.map((m) => <Glass key={`${m.instrument}-${m.label}`} className="measure"><span className="t-label">{m.label ?? m.name}</span><span className="metric-val"><b className="t-num">{m.last}</b>{m.unit && <span className="t-unit">{m.unit}</span>}</span><span className="t-cap">último registro em {short(m.points[m.points.length - 1].at)}</span></Glass>)}
        </div>
      </div>
    </Page>
  );
};

const STEPS = [
  { title: "Avaliar", text: "Entendemos o seu ponto de partida." }, { title: "Cuidar", text: "Sessões e orientações para o seu dia a dia." }, { title: "Reavaliar", text: "Olhamos juntos o que mudou." },
  { title: "Ajustar", text: "O plano é revisto com você." }, { title: "Autonomia", text: "Alta quando indicada pelo fisioterapeuta." },
];
const Path = ({ d, n, total }: { d: DeckData; n: number; total: number }) => {
  const p = d.snapshot.presentation.content.plan; const planned = d.snapshot.planned_sessions;
  return (
    <Page n={n} total={total} d={d} eyebrow="CAMINHO DO ACOMPANHAMENTO" title={<>Um caminho <em>que se ajusta a você</em></>}>
      <div className="page-body path-body">
        <Steps items={STEPS} repeat={[2, 3]} />
        <div className="facts" data-testid="deck-path-facts">
          <Metric label="Frequência" value={p.freq_per_week ? `${p.freq_per_week}x` : null} unit="por semana" />
          <Metric label="Duração inicial estimada" value={p.duration_weeks ?? null} unit="semanas" />
          <Metric label="Sessões previstas" value={planned ?? null} unit="sessões" />
          <Metric label="Próxima reavaliação" value={p.reassessment_on ? short(p.reassessment_on) : null} />
        </div>
        <p className="t-cap page-note">Frequência, duração e sessões vêm do plano definido pelo seu fisioterapeuta e podem mudar a cada reavaliação. Este é um caminho de cuidado, não uma previsão de resultado.</p>
      </div>
    </Page>
  );
};

/** Página do aplicativo: cabeçalho e explicação de um lado, celular real do outro. Marcadores só nos blocos que existem na tela. */
const AppPage = ({ d, n, total, phoneSide, eyebrow, title, sub, marks, skipTo, screen, children, testid, dense }: { d: DeckData; n: number; total: number; dense?: boolean; phoneSide: "left" | "right"; eyebrow: string; title: ReactNode; sub?: ReactNode; marks: PhoneMark[]; skipTo?: string; screen: ReactNode; children?: ReactNode; testid?: string }) => {
  const [present, setPresent] = useState<PhoneMark[]>([]);
  return (
    <section className={`slide is-cream app-page is-phone-${phoneSide}`} data-testid={`slide-${n}`} aria-label={eyebrow}>
      <div className={`app-text ${dense ? "is-dense" : ""}`} data-testid={testid}>
        <PageHead eyebrow={eyebrow} title={title} sub={sub} />
        {present.length > 0 && <Legend items={present} />}
        {children}
      </div>
      <Phone testid={`deck-phone-${n}`} side={phoneSide === "right" ? "left" : "right"} marks={marks} skipTo={skipTo} onMarks={setPresent}>{screen}</Phone>
      <PageFoot d={d} n={n} total={total} />
    </section>
  );
};

const AppHome = ({ d, n, total, ctx }: { d: DeckData; n: number; total: number; ctx: SlideCtx }) => {
  const marks = useMemo<PhoneMark[]>(() => [{ target: "jr-goal", text: "O seu objetivo, definido com o seu fisioterapeuta." }, { target: "jr-next-appt", text: "A sua próxima consulta, quando houver." }, { target: "jr-journey", text: "O acompanhamento: em que etapa do cuidado você está." }], []);
  return (
    <AppPage d={d} n={n} total={total} phoneSide="right" eyebrow="SEU APLICATIVO" testid="deck-app" title={<>Seu cuidado, <em>sempre por perto</em></>} sub="Esta é a tela inicial que você encontra ao entrar, com os seus dados." marks={marks} skipTo="jr-hero"
      screen={ctx.model ? <JourneyProvider value={{ go: () => undefined }}><PatientDashboard m={ctx.model} /></JourneyProvider> : null}>
      {d.snapshot.enrollment_status === "pending" && <p className="t-cap app-note">No aplicativo, o acompanhamento aparece como <b>pendente</b> até a confirmação da 1ª parcela. Nada é cobrado por esta tela.</p>}
    </AppPage>
  );
};

const AppCare = ({ d, n, total, ctx }: { d: DeckData; n: number; total: number; ctx: SlideCtx }) => {
  const vids = ctx.model?.videos ?? []; const hasEx = (ctx.model?.training?.items.length ?? 0) > 0;
  const marks = useMemo<PhoneMark[]>(() => [{ target: "jr-exercises", text: "Os exercícios que o seu fisioterapeuta liberar para você." }, { target: "jr-videos", text: "Os vídeos explicativos, no seu ritmo." }, { target: "jr-week", text: "A sua semana: consultas e os treinos que você informar." }], []);
  return (
    <AppPage d={d} n={n} total={total} phoneSide="left" eyebrow="CUIDADO EM CASA" testid="deck-care" title={<>Orientações para <em>o seu dia a dia</em></>} sub="O seu fisioterapeuta escolhe e libera os exercícios e vídeos para o seu caso. Você os encontra em Treinos e registra o que fez." marks={marks}
      screen={ctx.model ? <JourneyProvider value={{ go: () => undefined }}><div className="jr"><div className="jr-grid"><ExerciseCards m={ctx.model} showAll /><WeekCard m={ctx.model} /></div></div></JourneyProvider> : null}>
      <p className="t-cap app-note" data-testid="deck-videos-steps">{hasEx || vids.length > 0 ? "" : "Ainda não há exercícios nem vídeos liberados para você: eles aparecem aqui quando o seu fisioterapeuta os definir. "}No PDF, o botão abre o aplicativo; o vídeo não toca dentro do PDF.</p>
      <a className="slide-btn" href={`${ctx.appBase}/paciente/treinos`} data-testid="deck-link-treinos">Abrir Treinos no aplicativo <ArrowRight aria-hidden /></a>
    </AppPage>
  );
};

const AppEvolution = ({ d, n, total, ctx }: { d: DeckData; n: number; total: number; ctx: SlideCtx }) => {
  const ms = d.snapshot.measures.filter((m) => m.points.length > 0 && isScale10(m)); const goal = d.snapshot.presentation.content.goal; const only1 = d.snapshot.measures.filter((m) => m.points.length > 0).every((m) => m.points.length < 2);
  const marks = useMemo<PhoneMark[]>(() => [{ target: "jr-pain", text: "O gráfico da sua dor, com a data de cada registro." }, { target: "jr-functional", text: "As atividades que você quer retomar." }], []);
  return (
    <AppPage d={d} n={n} total={total} dense phoneSide="right" eyebrow="ACOMPANHANDO A EVOLUÇÃO" testid="deck-evolution" title={<>Você acompanha. <em>Nós ajustamos.</em></>} marks={marks}
      screen={ctx.model ? <JourneyProvider value={{ go: () => undefined }}><div className="jr"><div className="jr-grid"><PainChartCard m={ctx.model} /><FunctionalCard m={ctx.model} /><JourneyTimeline m={ctx.model} /></div></div></JourneyProvider> : null}>
      <div className="evo-wrap" data-testid="deck-evo-measures">
        {ms.length === 0 ? <p className="t-sub">As medidas de acompanhamento serão escolhidas pelo seu fisioterapeuta.</p> : ms.slice(0, 2).map((m) => <MeasureChart key={`${m.instrument}-${m.label ?? m.name}`} s={m} demo={d.is_demo} />)}
      </div>
      <div className="evo-how" data-testid="deck-evo-state">
        <p className="t-body">{only1 ? <><b>Hoje existe só o ponto de partida.</b> Depois das próximas avaliações a linha de evolução aparece aqui e no seu aplicativo, com a data de cada registro. Nenhuma curva futura é desenhada.</> : <><b>Cada ponto é um registro real</b>, com data. Compare o primeiro com o mais recente.</>}</p>
        {goal && <p className="t-cap evo-goal"><b>Meta definida pelo profissional</b> (separada dos resultados): {goal.title}{goal.target_date ? ` · até ${short(goal.target_date)}` : ""}</p>}
      </div>
    </AppPage>
  );
};

const Continuity = ({ d, n, total }: { d: DeckData; n: number; total: number }) => (
  <Page n={n} total={total} d={d} tone="navy" eyebrow="CONTINUIDADE COM PROPÓSITO" title={<>Cuidar também é <em>acompanhar</em></>}>
    <div className="page-body">
      <div className="loop" data-testid="deck-continuity">
        <Glass tone="dark"><Repeat2 aria-hidden /><b className="loop-title">Acompanhamento</b><span className="t-body">Sessões com o seu fisioterapeuta.</span></Glass>
        <Glass tone="dark"><Check aria-hidden /><b className="loop-title">Prática orientada</b><span className="t-body">O que você faz no seu dia a dia.</span></Glass>
        <Glass tone="dark"><ShieldCheck aria-hidden /><b className="loop-title">Reavaliação</b><span className="t-body">Olhamos juntos o que mudou e ajustamos.</span></Glass>
      </div>
      <p className="t-sub">Cada parte reforça a outra. A reavaliação diz se o plano continua o mesmo, muda ou chega a um ponto de autonomia.</p>
      <p className="t-cap page-note">Ninguém promete resultado: o plano é revisto com você a cada reavaliação.</p>
    </div>
  </Page>
);

const Evidence = ({ d, n, total }: { d: DeckData; n: number; total: number }) => {
  const ev = (d.snapshot.presentation.content.evidence ?? []).slice(0, 3);
  return (
    <Page n={n} total={total} d={d} eyebrow="A CIÊNCIA POR TRÁS" title={<>O que a pesquisa <em>diz</em></>}>
      <div className="page-body"><div className="ev-grid" data-testid="deck-evidence">{ev.map((e) => { const href = e.url ?? (e.doi ? `https://doi.org/${e.doi}` : null); return (
        <Glass as="article" key={e.id} className="ev-card"><b className="ev-title">{e.title}</b><span className="t-cap">{[e.authors, e.journal, e.year].filter(Boolean).join(" · ")}</span>
          {e.relation && <p><span className="t-label">Por que serve a você</span>{e.relation}</p>}{e.benefits && <p><span className="t-label">O que foi observado</span>{e.benefits}</p>}{e.limitations && <p><span className="t-label">Limites</span>{e.limitations}</p>}
          {href && <a href={href}>Ver a referência</a>}</Glass>); })}</div></div>
    </Page>
  );
};

const Plan = ({ d, n, total }: { d: DeckData; n: number; total: number }) => {
  const c = d.snapshot.presentation.content, p = c.plan, o = d.offer, show = d.selection.commercial && !!o; const planned = d.snapshot.planned_sessions;
  const Row = ({ k, v }: { k: string; v: ReactNode }) => <div><dt className="t-label">{k}</dt><dd className="t-body">{v}</dd></div>;
  return (
    <Page n={n} total={total} d={d} eyebrow="PLANO PROPOSTO" title={<>O plano <em>proposto para você</em></>}>
      <div className="page-body plan-grid">
        <Glass className="plan-col" testid="deck-plan-clinico"><h3 className="t-sub-title">Recomendação clínica</h3>
          <dl><Row k="Objetivo" v={c.goal?.title ?? "A definir"} /><Row k="Frequência" v={p.freq_per_week ? `${p.freq_per_week}x por semana` : "A definir"} /><Row k="Duração" v={p.duration_weeks ? `${p.duration_weeks} semanas` : "A definir"} />
            <Row k="Sessões previstas" v={planned ?? "A definir"} /><Row k="Reavaliação" v={<>{p.reassessment_on ? short(p.reassessment_on) : "A definir"}{p.reassessment_criteria ? ` · ${p.reassessment_criteria}` : ""}</>} /><Row k="Rotina orientada" v={p.routine ?? "A definir"} /></dl>
          <p className="t-cap">O que está incluído: acompanhamento conforme o plano, acesso à sua área do paciente e reavaliações no momento definido.</p></Glass>
        <Glass tone="tint" className="plan-col is-commercial" testid="deck-plan-comercial"><h3 className="t-sub-title">Condições comerciais</h3>
          {show && o ? <><p className="price-line"><span className="t-body">{o.name}</span><b className="t-num" data-testid="deck-preco">{brl(o.price_cents)}</b></p><ul className="t-body">{o.sessions_count ? <li>{o.sessions_count} sessões{o.per_session_cents ? ` · cerca de ${brl(o.per_session_cents)} por sessão` : ""}</li> : null}{o.validity_days ? <li>Validade de {o.validity_days} dias</li> : null}
            {o.late_cancel_hours ? <li>Cancelamento com menos de {o.late_cancel_hours} h conta como sessão realizada</li> : null}{o.consume_on_no_show ? <li>Falta sem aviso consome uma sessão</li> : null}</ul>
            <p className="t-cap">Valores vigentes em {short(o.quoted_at)}. Forma e parcelas são combinadas com a clínica. O pacote é uma condição comercial, não uma medida de recuperação. O acompanhamento só fica ativo com a 1ª parcela quitada.</p></>
            : <p className="t-sub">As condições comerciais serão apresentadas à parte, se você quiser seguir.</p>}</Glass>
      </div>
    </Page>
  );
};

const Next = ({ d, n, total, ctx }: { d: DeckData; n: number; total: number; ctx: SlideCtx }) => {
  const done = ctx.live?.responded ?? [];
  const btn = (c: "questions" | "start", label: string, cls: string) => ctx.interactive
    ? <button type="button" className={`slide-btn ${cls}`} onClick={() => ctx.onRespond?.(c)} disabled={done.includes(c)} data-testid={`deck-cta-${c}`}>{done.includes(c) ? "Recebemos o seu pedido ✓" : label}<ArrowRight aria-hidden /></button>
    : <a className={`slide-btn ${cls}`} href={`${ctx.appBase}/paciente/proposta?acao=${c === "start" ? "iniciar" : "duvidas"}`} data-testid={`deck-cta-${c}`}>{label}<ArrowRight aria-hidden /></a>;
  return (
    <Page n={n} total={total} d={d} tone="navy" eyebrow="PRÓXIMO PASSO" title={<>Qual é o seu <em>próximo passo?</em></>}>
      <div className="page-body">
        <p className="t-sub">Você decide o ritmo. Nada é contratado ao abrir ou baixar este documento.</p>
        <div className="cta-row">{btn("questions", "Esclarecer dúvidas sobre meu plano", "is-light")}{btn("start", "Quero iniciar meu acompanhamento", "is-solid")}</div>
        {ctx.live?.payment && <p className="pay-status t-body" data-testid="deck-pay-status">Situação agora: <b>{PAY_STATE[ctx.live.payment]}</b></p>}
        {ctx.live?.installments && ctx.live.installments.length > 0 && <Glass tone="dark" className="pay-box"><table className="pay-table" data-testid="deck-parcelas"><thead><tr><th>Parcela</th><th>Vencimento</th><th>Valor</th><th>Situação</th></tr></thead><tbody>{ctx.live.installments.map((p) => <tr key={p.no}><td>{p.no}/{ctx.live!.installments!.length}</td><td>{short(p.due_date)}</td><td>{brl(p.amount_cents)}</td><td>{REC_ST[p.status] ?? p.status}</td></tr>)}</tbody></table></Glass>}
        <ol className="after">
          <li><span className="callout is-static">1</span><span className="t-body">Você escolhe uma das opções acima.</span></li>
          <li><span className="callout is-static">2</span><span className="t-body">A equipe recebe o pedido e fala com você.</span></li>
          <li><span className="callout is-static">3</span><span className="t-body">O acompanhamento só é ativado depois que a 1ª parcela estiver confirmada.</span></li>
        </ol>
        <p className="t-cap page-note"><HelpCircle size={16} aria-hidden /> Acesso por login no aplicativo, com identificação segura da proposta; o PDF não guarda senha nem chave.</p>
      </div>
    </Page>
  );
};

export const DeckSlide = ({ k, d, n, total, ctx }: { k: string; d: DeckData; n: number; total: number; ctx: SlideCtx }) => {
  switch (k) {
    case "cover": return <Cover d={d} total={total} />; case "goals": return <Goals d={d} n={n} total={total} />; case "start": return <Start d={d} n={n} total={total} />; case "path": return <Path d={d} n={n} total={total} />;
    case "app": return <AppHome d={d} n={n} total={total} ctx={ctx} />; case "videos": return <AppCare d={d} n={n} total={total} ctx={ctx} />; case "evolution": return <AppEvolution d={d} n={n} total={total} ctx={ctx} />;
    case "continuity": return <Continuity d={d} n={n} total={total} />; case "evidence": return <Evidence d={d} n={n} total={total} />; case "plan": return <Plan d={d} n={n} total={total} />; case "next": return <Next d={d} n={n} total={total} ctx={ctx} />;
    default: return null;
  }
};
