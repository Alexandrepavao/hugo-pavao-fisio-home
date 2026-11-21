import { useLayoutEffect, useRef, useState, type ReactNode } from "react";
import { ArrowRight, Check, HelpCircle, PlayCircle, Repeat2, ShieldCheck } from "lucide-react";
import { brl, fmtDate } from "@/lib/format";
import { brandLogoUrl } from "@/lib/org";
import capaHp from "@/assets/ebook-capa-hp.jpg";
import { PatientDashboard, JourneyProvider } from "@/portal/journey/ui";
import type { JourneyModel } from "@/portal/journey/model";
import type { Series } from "@/portal/Evolution";
import { SCALE_TEXT, isScale10, type DeckData, type DeckSelection } from "./deckModel";
import "@/portal/journey/journey.css";
import "./deck.css";

export const SLIDE_W = 1280, SLIDE_H = 720;
const short = (iso?: string | null) => (iso ? fmtDate(iso.length === 10 ? `${iso}T12:00:00Z` : iso) : null);
const PAY_STATE: Record<string, string> = { no_contract: "Contratação ainda não feita", awaiting: "Aguardando o pagamento da 1ª parcela", confirmed: "Pagamento confirmado — acompanhamento ativo" };
const REC_ST: Record<string, string> = { open: "Em aberto", partial: "Parcial", paid: "Paga", refunded: "Estornada", cancelled: "Cancelada" };

export interface SlideCtx {
  model: JourneyModel | null; appBase: string;        // endereço do aplicativo (origem + base da organização), montado pela tela
  live?: { payment?: "no_contract" | "awaiting" | "confirmed"; installments?: { no: number; due_date: string; amount_cents: number; status: string }[]; responded?: string[]; enrollment_status?: "pending" | "active" };
  onRespond?: (c: "questions" | "start") => void; interactive: boolean;
}

/** Ordem e presença dos slides: respeita a seleção do profissional e nunca cria página sem dado (evidência sem ficha aprovada simplesmente não existe). */
export const slideKeys = (d: DeckData): string[] => {
  const s = d.selection, ev = (d.snapshot.presentation.content.evidence ?? []).length > 0;
  const keys = ["cover"]; (["goals", "start", "path", "evolution", "app", "videos", "continuity"] as (keyof DeckSelection)[]).forEach((k) => { if (s[k]) keys.push(k); });
  if (s.evidence && ev) keys.push("evidence"); if (s.plan) keys.push("plan"); if (s.next) keys.push("next"); return keys;
};

const Frame = ({ n, total, d, tone = "cream", title, eyebrow, children }: { n: number; total: number; d: DeckData; tone?: "cream" | "navy"; title?: ReactNode; eyebrow?: string; children: ReactNode }) => (
  <section className={`slide is-${tone}`} data-testid={`slide-${n}`} aria-label={typeof title === "string" ? title : eyebrow}>
    <div className="slide-body">
      {eyebrow && <p className="slide-eyebrow">{eyebrow}</p>}
      {title && <h2 className="slide-title">{title}</h2>}
      {children}
    </div>
    <footer className="slide-foot"><span>{d.snapshot.clinic.name.toUpperCase()}</span>{d.is_demo && <b className="slide-demo">EXEMPLO · paciente fictício, sem dados reais</b>}<span>{n} / {total}</span></footer>
  </section>
);

/** Escala 0–10 com o valor, a data e a origem. Uma escala por medida: nada é somado nem convertido em “pontuação de saúde”. */
const ScaleBar = ({ s }: { s: Series }) => {
  const pts = s.points; const last = pts[pts.length - 1]; const first = pts[0]; const x = (v: number) => 20 + (v / 10) * 560;
  return (
    <div className="sc" data-testid="deck-measure">
      <div className="sc-head"><b>{s.label ?? s.name}</b><span>{pts.length > 1 ? `${pts.length} registros` : "1 registro"}</span></div>
      <svg viewBox="0 0 600 70" role="img" aria-label={`${s.label ?? s.name}: ${last.value} de 10`}>
        <rect x="20" y="30" width="560" height="10" rx="5" className="sc-track" />
        {[0, 2, 4, 6, 8, 10].map((t) => <g key={t}><line x1={x(t)} y1="26" x2={x(t)} y2="44" className="sc-tick" /><text x={x(t)} y="64" textAnchor="middle" className="sc-num">{t}</text></g>)}
        {pts.length > 1 && <polyline points={pts.map((p) => `${x(p.value)},35`).join(" ")} className="sc-line" />}
        {pts.length > 1 && <circle cx={x(first.value)} cy="35" r="9" className="sc-first" />}
        <circle cx={x(last.value)} cy="35" r="13" className="sc-dot" /><text x={x(last.value)} y="20" textAnchor="middle" className="sc-val">{String(last.value).replace(".", ",")}</text>
      </svg>
      <p className="sc-meta">{short(last.at)} · {last.by === "professional" ? "registrado pelo fisioterapeuta" : "relatado por você"}{pts.length > 1 ? ` · primeiro registro ${String(first.value).replace(".", ",")} em ${short(first.at)}` : ""}</p>
      <p className="sc-expl">{SCALE_TEXT[s.instrument] ?? ""}</p>
    </div>
  );
};

const Cover = ({ d, total }: { d: DeckData; total: number }) => {
  const s = d.snapshot, hp = !!s.clinic.is_default_brand, logo = brandLogoUrl(s.clinic.logo_path);
  return (
    <section className="slide is-navy slide-cover" data-testid="slide-1" aria-label="Capa">
      {hp ? <img className="cover-photo" src={capaHp} alt="HP Fisio Group — Hugo Pavão, fisioterapeuta" data-testid="deck-capa" /> : <div className="cover-brand">{logo ? <img src={logo} alt={s.clinic.name} /> : <b>{s.clinic.name}</b>}</div>}
      <div className="cover-text">
        <p className="slide-eyebrow">PLANO DE CUIDADO PERSONALIZADO</p>
        <h1 data-testid="deck-title">Seu plano <em>de cuidado</em></h1>
        <p className="cover-name" data-testid="deck-patient">{s.patient.name}</p>
        <p className="cover-meta">Profissional responsável: <b>{s.professional ?? "—"}</b> · {short(s.evaluation_at ?? s.generated_at)}</p>
      </div>
      <footer className="slide-foot">{d.is_demo ? <b className="slide-demo">EXEMPLO · paciente fictício, sem dados reais</b> : <span />}<span>1 / {total}</span></footer>
    </section>
  );
};

const Goals = ({ d, n, total }: { d: DeckData; n: number; total: number }) => {
  const c = d.snapshot.presentation.content; const items = [c.goal ? { who: "Objetivo definido com seu fisioterapeuta", text: c.goal.title, extra: c.goal.target_date ? `Meta para ${short(c.goal.target_date)}` : null } : null,
    c.reported.activities ? { who: "Relatado por você", text: c.reported.activities, extra: null } : null].filter((x): x is { who: string; text: string; extra: string | null } => !!x);
  return (
    <Frame n={n} total={total} d={d} eyebrow="2 · SEUS OBJETIVOS" title={<>O que você quer <em>voltar a fazer?</em></>}>
      {items.length === 0 ? <p className="slide-lead">Seu fisioterapeuta vai registrar os seus objetivos com você.</p> : <div className="goal-grid" data-testid="deck-goals">{items.map((it) => <blockquote key={it.who} className="goal-card"><span>{it.who}</span><p>“{it.text}”</p>{it.extra && <small>{it.extra}</small>}</blockquote>)}</div>}
      <p className="slide-note">Nada aqui foi inventado: são as palavras registradas na sua avaliação.</p>
    </Frame>
  );
};

const Start = ({ d, n, total }: { d: DeckData; n: number; total: number }) => {
  const c = d.snapshot.presentation.content; const ms = d.snapshot.measures.filter((m) => m.points.length > 0 && isScale10(m));
  const other = d.snapshot.measures.filter((m) => m.points.length > 0 && !isScale10(m));
  return (
    <Frame n={n} total={total} d={d} eyebrow="3 · PONTO DE PARTIDA" title={<>Onde você <em>está hoje</em></>}>
      <div className="start-grid">
        <div className="start-text">
          <p className="tag">Relatado por você</p><p className="start-big">{c.reported.complaint ?? "Sem relato registrado"}</p>
          {c.reported.symptom_duration && <p><b>Há quanto tempo:</b> {c.reported.symptom_duration}</p>}{c.reported.limitations && <p><b>Limitações:</b> {c.reported.limitations}</p>}
          {c.assessed.condition_text && <><p className="tag is-pro">{c.assessed.condition_kind === "hypothesis" ? "Hipótese em investigação (fisioterapeuta)" : "Avaliado pelo fisioterapeuta"}</p><p>{c.assessed.condition_text}</p></>}
        </div>
        <div className="start-charts" data-testid="deck-measures">
          {ms.length === 0 && other.length === 0 ? <p className="slide-lead">Nesta avaliação ainda não há medidas registradas. Elas aparecem aqui assim que o fisioterapeuta as coletar.</p> : null}
          {ms.map((m) => <ScaleBar key={`${m.instrument}-${m.label ?? m.name}`} s={m} />)}
          {other.map((m) => <div key={`${m.instrument}-${m.label}`} className="sc"><div className="sc-head"><b>{m.label ?? m.name}</b></div><p className="sc-meta">Último registro: <b>{m.last}</b>{m.unit ? ` ${m.unit}` : ""} · {short(m.points[m.points.length - 1].at)}</p></div>)}
        </div>
      </div>
    </Frame>
  );
};

const Path = ({ d, n, total }: { d: DeckData; n: number; total: number }) => {
  const p = d.snapshot.presentation.content.plan; const planned = d.snapshot.planned_sessions;
  const steps = ["Avaliar", "Cuidar", "Reavaliar", "Ajustar", "Autonomia ou alta, quando indicada"];
  return (
    <Frame n={n} total={total} d={d} eyebrow="4 · CAMINHO DO ACOMPANHAMENTO" title={<>Um caminho <em>que se ajusta a você</em></>}>
      <ol className="flow" data-testid="deck-flow">{steps.map((t, i) => <li key={t} className={i === 0 ? "is-done" : ""}><span>{i + 1}</span>{t}{i < steps.length - 1 && <ArrowRight className="flow-arrow" aria-hidden />}</li>)}</ol>
      <div className="facts" data-testid="deck-path-facts">
        <div><b>{p.freq_per_week ? `${p.freq_per_week}x` : "—"}</b><span>por semana{p.freq_per_week ? "" : " · a definir"}</span></div>
        <div><b>{p.duration_weeks ?? "—"}</b><span>semanas previstas{p.duration_weeks ? "" : " · a definir"}</span></div>
        <div><b>{planned ?? "—"}</b><span>sessões no plano{planned ? "" : " · a definir"}</span></div>
        <div><b>{p.reassessment_on ? short(p.reassessment_on) : "—"}</b><span>reavaliação{p.reassessment_on ? "" : " · a definir"}</span></div>
      </div>
      <p className="slide-note">Frequência, duração e sessões vêm do plano definido pelo seu fisioterapeuta e podem mudar a cada reavaliação. Isto é um caminho de cuidado, não uma previsão de resultado.</p>
    </Frame>
  );
};

const Evolution = ({ d, n, total }: { d: DeckData; n: number; total: number }) => {
  const ms = d.snapshot.measures.filter((m) => m.points.length > 0); const goal = d.snapshot.presentation.content.goal; const only1 = ms.every((m) => m.points.length < 2);
  return (
    <Frame n={n} total={total} d={d} eyebrow="5 · ACOMPANHANDO A EVOLUÇÃO" title={<>Como vamos <em>medir o seu progresso</em></>}>
      <div className="evo-grid">
        <ul className="evo-list" data-testid="deck-evo-measures">{ms.length === 0 ? <li>As medidas de acompanhamento serão escolhidas pelo seu fisioterapeuta.</li> : ms.map((m) => <li key={`${m.instrument}-${m.label}`}><b>{m.label ?? m.name}</b><span>{m.instrument === "nprs" ? "mostra como a dor muda ao longo do tratamento" : "mostra o quanto você consegue retomar o que quer fazer"}</span><span className="evo-start">Ponto de partida: <b>{m.points[0].value}</b>{m.unit ? ` ${m.unit}` : ""} · {short(m.points[0].at)}</span></li>)}</ul>
        <div className="evo-side">
          <div className="evo-state" data-testid="deck-evo-state">{only1 ? <><b>Hoje existe só o ponto de partida.</b><p>Depois das próximas avaliações a linha de evolução aparece aqui e no seu aplicativo, com a data e o autor de cada registro. Nenhuma curva futura é desenhada.</p></> : <><b>Evolução registrada</b><p>Os pontos abaixo são registros reais, com data.</p></>}</div>
          {goal && <div className="evo-goal"><span className="tag">Meta — separada dos resultados observados</span><p>{goal.title}{goal.target_date ? ` · até ${short(goal.target_date)}` : ""}</p></div>}
        </div>
      </div>
    </Frame>
  );
};

/** Simulação do aplicativo: os componentes REAIS do portal com os dados congelados, em dois celulares, com chamadas numeradas ancoradas nos blocos reais. */
const CALLS: { id: string; testid: string; text: string }[] = [
  { id: "1", testid: "jr-goal", text: "Aqui você acompanha seu objetivo." }, { id: "2", testid: "jr-next-appt", text: "Aqui encontra suas próximas consultas." },
  { id: "3", testid: "jr-exercises", text: "Aqui consulta as orientações do seu fisioterapeuta." }, { id: "4", testid: "jr-sessions", text: "Aqui vê as sessões e o pacote, quando houver." }, { id: "5", testid: "jr-education", text: "Aqui lê o que o seu fisioterapeuta liberou para você." },
];
const AppSim = ({ d, n, total, ctx }: { d: DeckData; n: number; total: number; ctx: SlideCtx }) => {
  const a = useRef<HTMLDivElement>(null), b = useRef<HTMLDivElement>(null); const [pos, setPos] = useState<{ id: string; phone: 1 | 2; top: number }[]>([]); const [off2, setOff2] = useState(0);
  useLayoutEffect(() => {
    const m = a.current; if (!m) return; const top = (tid: string) => m.querySelector<HTMLElement>(`[data-testid="${tid}"]`)?.offsetTop;
    const ex = top("jr-exercises"), na = top("jr-next-appt");
    const o2 = na != null && ex != null && ex - (na - 24) < 520 ? Math.max(0, na - 24) : Math.max(0, (ex ?? na ?? 24) - 24); setOff2(o2);
    const out: { id: string; phone: 1 | 2; top: number }[] = [];
    for (const c of CALLS) { const t = top(c.testid); if (t == null) continue; if (t < 470) out.push({ id: c.id, phone: 1, top: t + 24 }); else if (t - o2 < 500 && t - o2 > -10) out.push({ id: c.id, phone: 2, top: t - o2 + 24 }); }
    setPos(out);
  }, [ctx.model]);
  const phone = (ref: React.RefObject<HTMLDivElement>, offset: number, which: 1 | 2) => (
    <div className="phone" data-testid={`deck-phone-${which}`}><div className="phone-screen"><div ref={ref} className="phone-inner" style={{ transform: `translateY(${-offset}px)` }}>
      {ctx.model && <JourneyProvider value={{ go: () => undefined }}><PatientDashboard m={ctx.model} /></JourneyProvider>}</div>
      {pos.filter((p) => p.phone === which).map((p) => <span key={p.id} className="callout" style={{ top: p.top }}>{p.id}</span>)}</div></div>);
  return (
    <Frame n={n} total={total} d={d} eyebrow="6 · SEU APLICATIVO" title={<>Esta é a <em>sua área do paciente</em></>}>
      <div className="app-grid" data-testid="deck-app">
        {phone(a, 0, 1)}{phone(b, off2, 2)}
        <ol className="app-legend">{CALLS.filter((c) => pos.some((p) => p.id === c.id)).map((c) => <li key={c.id}><span className="callout is-static">{c.id}</span>{c.text}</li>)}
          <li className="app-note"><b>Simulação com os seus dados.</b> Consultas, exercícios e vídeos só aparecem quando o seu fisioterapeuta os definir.</li></ol>
      </div>
    </Frame>
  );
};

const Videos = ({ d, n, total, ctx }: { d: DeckData; n: number; total: number; ctx: SlideCtx }) => {
  const vids = ctx.model?.videos ?? [];
  return (
    <Frame n={n} total={total} d={d} eyebrow="7 · CUIDADO EM CASA" title={<>Vídeos e orientações <em>no seu ritmo</em></>}>
      <div className="vid-grid">
        <ol className="steps" data-testid="deck-videos-steps"><li>Seu fisioterapeuta escolhe e libera os vídeos e orientações para o seu caso.</li><li>Você os encontra em <b>Treinos</b>, no aplicativo, em ambiente protegido.</li><li>Você registra o que fez, e ele acompanha.</li></ol>
        <div className="vid-tiles">{vids.length > 0 ? vids.slice(0, 3).map((v) => <div key={v.id} className="vid-tile"><PlayCircle aria-hidden /><b>{v.title}</b><small>liberado pelo seu fisioterapeuta</small></div>)
          : [1, 2, 3].map((i) => <div key={i} className="vid-tile is-demo"><PlayCircle aria-hidden /><b>Exemplo de vídeo {i}</b><small>EXEMPLO DEMONSTRATIVO — não é prescrição</small></div>)}</div>
      </div>
      <p className="slide-note">{vids.length > 0 ? "" : "Ainda não há vídeos liberados para você: os quadros acima são só uma demonstração de como aparecem. "}No PDF o botão abre o aplicativo; o vídeo não toca dentro do PDF.</p>
      <a className="slide-btn" href={`${ctx.appBase}/paciente/treinos`} data-testid="deck-link-treinos">Abrir Treinos no aplicativo <ArrowRight aria-hidden /></a>
    </Frame>
  );
};

const Continuity = ({ d, n, total }: { d: DeckData; n: number; total: number }) => (
  <Frame n={n} total={total} d={d} tone="navy" eyebrow="8 · CONTINUIDADE COM PROPÓSITO" title={<>Cuidar também é <em>orientar e acompanhar</em></>}>
    <div className="loop" data-testid="deck-continuity"><div><Repeat2 aria-hidden /><b>Acompanhamento</b><span>sessões com o seu fisioterapeuta</span></div><div><Check aria-hidden /><b>Prática orientada</b><span>o que você faz no seu dia a dia</span></div><div><ShieldCheck aria-hidden /><b>Reavaliação</b><span>olhamos juntos o que mudou e ajustamos</span></div></div>
    <p className="slide-lead">Cada parte reforça a outra. A reavaliação diz se o plano continua o mesmo, muda ou chega a um ponto de autonomia.</p>
    <p className="slide-note">Ninguém promete resultado: o plano é revisto com você a cada reavaliação.</p>
  </Frame>
);

const Evidence = ({ d, n, total }: { d: DeckData; n: number; total: number }) => {
  const ev = (d.snapshot.presentation.content.evidence ?? []).slice(0, 3);
  return (
    <Frame n={n} total={total} d={d} eyebrow="9 · A CIÊNCIA POR TRÁS" title={<>O que a pesquisa <em>diz sobre o seu caso</em></>}>
      <div className="ev-grid" data-testid="deck-evidence">{ev.map((e) => { const href = e.url ?? (e.doi ? `https://doi.org/${e.doi}` : null); return (
        <article key={e.id} className="ev-card"><b>{e.title}</b><small>{[e.authors, e.journal, e.year].filter(Boolean).join(" · ")}</small>
          {e.relation && <p><span className="tag">Por que serve a você</span>{e.relation}</p>}{e.benefits && <p><span className="tag">O que foi observado</span>{e.benefits}</p>}{e.limitations && <p><span className="tag">Limites</span>{e.limitations}</p>}
          {href && <a href={href}>Ver a referência</a>}</article>); })}</div>
    </Frame>
  );
};

const Plan = ({ d, n, total }: { d: DeckData; n: number; total: number }) => {
  const c = d.snapshot.presentation.content, p = c.plan, o = d.offer, show = d.selection.commercial && !!o; const planned = d.snapshot.planned_sessions;
  return (
    <Frame n={n} total={total} d={d} eyebrow="10 · PLANO PROPOSTO" title={<>O plano <em>que o seu fisioterapeuta propõe</em></>}>
      <div className="plan-grid">
        <div className="plan-col" data-testid="deck-plan-clinico"><h3>Recomendação clínica</h3>
          <dl><div><dt>Objetivo</dt><dd>{c.goal?.title ?? "a definir"}</dd></div><div><dt>Frequência</dt><dd>{p.freq_per_week ? `${p.freq_per_week}x por semana` : "a definir"}</dd></div>
            <div><dt>Duração</dt><dd>{p.duration_weeks ? `${p.duration_weeks} semanas` : "a definir"}</dd></div><div><dt>Sessões previstas</dt><dd>{planned ?? "a definir"}</dd></div>
            <div><dt>Reavaliação</dt><dd>{p.reassessment_on ? short(p.reassessment_on) : "a definir"}{p.reassessment_criteria ? ` · ${p.reassessment_criteria}` : ""}</dd></div><div><dt>Rotina orientada</dt><dd>{p.routine ?? "a definir"}</dd></div></dl>
          <p className="slide-note">O que está incluído: acompanhamento conforme o plano, acesso à sua área do paciente e reavaliações no momento definido.</p></div>
        <div className="plan-col is-commercial" data-testid="deck-plan-comercial"><h3>Condições comerciais</h3>
          {show && o ? <><p className="price-line"><span>{o.name}</span><b data-testid="deck-preco">{brl(o.price_cents)}</b></p><ul>{o.sessions_count ? <li>{o.sessions_count} sessões{o.per_session_cents ? ` · cerca de ${brl(o.per_session_cents)} por sessão` : ""}</li> : null}{o.validity_days ? <li>Validade de {o.validity_days} dias</li> : null}
            {o.late_cancel_hours ? <li>Cancelamento com menos de {o.late_cancel_hours} h conta como sessão realizada</li> : null}{o.consume_on_no_show ? <li>Falta sem aviso consome uma sessão</li> : null}</ul>
            <p className="slide-note">Valores vigentes em {short(o.quoted_at)}. Forma e parcelas são combinadas com a clínica. O pacote é uma condição comercial, não uma medida de recuperação. O acompanhamento só fica ativo com a 1ª parcela quitada.</p></>
            : <p className="slide-lead">As condições comerciais serão apresentadas à parte, se você quiser seguir.</p>}</div>
      </div>
    </Frame>
  );
};

const Next = ({ d, n, total, ctx }: { d: DeckData; n: number; total: number; ctx: SlideCtx }) => {
  const done = ctx.live?.responded ?? [];
  const btn = (c: "questions" | "start", label: string, cls: string) => ctx.interactive
    ? <button type="button" className={`slide-btn ${cls}`} onClick={() => ctx.onRespond?.(c)} disabled={done.includes(c)} data-testid={`deck-cta-${c}`}>{done.includes(c) ? "Recebemos o seu pedido ✓" : label}<ArrowRight aria-hidden /></button>
    : <a className={`slide-btn ${cls}`} href={`${ctx.appBase}/paciente/proposta?acao=${c === "start" ? "iniciar" : "duvidas"}`} data-testid={`deck-cta-${c}`}>{label}<ArrowRight aria-hidden /></a>;
  return (
    <Frame n={n} total={total} d={d} tone="navy" eyebrow="11 · PRÓXIMO PASSO" title={<>Qual é o seu <em>próximo passo?</em></>}>
      <div className="cta-row">{btn("questions", "Esclarecer dúvidas sobre meu plano", "is-light")}{btn("start", "Quero iniciar meu acompanhamento", "is-solid")}</div>
      {ctx.live?.payment && <p className="pay-status" data-testid="deck-pay-status">Situação agora: <b>{PAY_STATE[ctx.live.payment]}</b></p>}
      {ctx.live?.installments && ctx.live.installments.length > 0 && <table className="pay-table" data-testid="deck-parcelas"><thead><tr><th>Parcela</th><th>Vencimento</th><th>Valor</th><th>Situação</th></tr></thead><tbody>{ctx.live.installments.map((p) => <tr key={p.no}><td>{p.no}/{ctx.live!.installments!.length}</td><td>{short(p.due_date)}</td><td>{brl(p.amount_cents)}</td><td>{REC_ST[p.status] ?? p.status}</td></tr>)}</tbody></table>}
      <p className="slide-note"><HelpCircle size={16} aria-hidden /> Abrir, baixar ou clicar aqui não contrata nada: o seu pedido chega à equipe, que confirma tudo com você. Acesso por login no aplicativo, com identificação segura da proposta; o PDF não guarda senha nem chave.</p>
    </Frame>
  );
};

export const DeckSlide = ({ k, d, n, total, ctx }: { k: string; d: DeckData; n: number; total: number; ctx: SlideCtx }) => {
  switch (k) {
    case "cover": return <Cover d={d} total={total} />; case "goals": return <Goals d={d} n={n} total={total} />; case "start": return <Start d={d} n={n} total={total} />; case "path": return <Path d={d} n={n} total={total} />;
    case "evolution": return <Evolution d={d} n={n} total={total} />; case "app": return <AppSim d={d} n={n} total={total} ctx={ctx} />; case "videos": return <Videos d={d} n={n} total={total} ctx={ctx} />;
    case "continuity": return <Continuity d={d} n={n} total={total} />; case "evidence": return <Evidence d={d} n={n} total={total} />; case "plan": return <Plan d={d} n={n} total={total} />; case "next": return <Next d={d} n={n} total={total} ctx={ctx} />;
    default: return null;
  }
};
