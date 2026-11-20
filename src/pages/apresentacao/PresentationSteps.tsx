import { useState, type ReactNode } from "react";
import { ArrowLeft, ArrowRight, Check, ClipboardList, FlaskConical, HeartHandshake, LineChart, Map as MapIcon, Repeat2, Target, Smartphone } from "lucide-react";
import { fmtDate } from "@/lib/format";
import { EvidenceBlock } from "@/portal/journey/ui";
import { num, painSummary, type JourneyModel } from "@/portal/journey/model";
import type { PatientPayload } from "./api";
import "@/portal/journey/journey.css";
import "./presentation.css";

export const STEPS = [
  { key: "objetivo", title: "Seu objetivo", icon: Target },
  { key: "partida", title: "Seu ponto de partida", icon: LineChart },
  { key: "acompanhamento", title: "Como será o acompanhamento", icon: MapIcon },
  { key: "rotina", title: "A importância da rotina", icon: Repeat2 },
  { key: "plano", title: "Seu plano", icon: ClipboardList },
  { key: "ciencia", title: "A ciência por trás do acompanhamento", icon: FlaskConical },
  { key: "area", title: "Esta é a sua área do paciente", icon: Smartphone },
] as const;

const TBD = <span className="pp-tbd">A definir com seu fisioterapeuta</span>;
const Authored = ({ who, children }: { who: "paciente" | "profissional"; children: ReactNode }) => (
  <div className="pp-field">
    <span className={`pp-who is-${who}`}>{who === "paciente" ? "Relatado por você" : "Registrado pelo seu fisioterapeuta"}</span>
    <p>{children}</p>
  </div>
);
const shortDate = (iso: string | null | undefined) => (iso ? fmtDate(iso.length === 10 ? `${iso}T12:00:00Z` : iso) : null);

/** As 7 etapas da apresentação personalizada. Mostra SÓ o que foi registrado: sem sessões presumidas, sem curva de recuperação, sem “zero” no lugar de “não avaliado”. A última etapa é entregue por quem usa
 *  (a fisioterapeuta vê a PRÉVIA real do portal; o paciente segue para a própria área). */
const PresentationSteps = ({ content, model, firstName, final, onStep }: { content: PatientPayload; model: JourneyModel | null; firstName: string; final: ReactNode; onStep?: (n: number) => void }) => {
  const [i, setI] = useState(0);
  const go = (n: number) => { const v = Math.max(0, Math.min(STEPS.length - 1, n)); setI(v); onStep?.(v); };
  const S = STEPS[i]; const Icon = S.icon; const last = i === STEPS.length - 1;
  const pain = model ? painSummary(model.pain) : null; const fn = model?.functional ?? [];
  const p = content.plan; const hasFreq = p.freq_per_week != null || p.duration_weeks != null;
  return (
    <div className="jr pp" data-testid="presentation-steps" data-step={S.key}>
      <nav className="pp-progress" aria-label="Etapas da apresentação">
        <div className="pp-bar" role="progressbar" aria-valuemin={1} aria-valuemax={STEPS.length} aria-valuenow={i + 1} aria-label={`Etapa ${i + 1} de ${STEPS.length}`}><span style={{ width: `${((i + 1) / STEPS.length) * 100}%` }} /></div>
        <ol className="pp-dots">
          {STEPS.map((s, n) => (
            <li key={s.key}><button type="button" className={`pp-dot${n === i ? " is-on" : n < i ? " is-done" : ""}`} aria-current={n === i ? "step" : undefined} aria-label={`Etapa ${n + 1}: ${s.title}`} onClick={() => go(n)}>{n < i ? <Check size={12} aria-hidden /> : n + 1}</button></li>
          ))}
        </ol>
      </nav>

      <section className="jr-card pp-stage" aria-label={S.title} data-testid={`pp-step-${S.key}`}>
        <p className="jr-eyebrow">Etapa {i + 1} de {STEPS.length}</p>
        <h2 className="pp-h"><Icon size={22} aria-hidden />{S.title}</h2>

        {S.key === "objetivo" && (<>
          <p className="jr-hello">{firstName ? `Olá, ${firstName}.` : "Olá."}</p>
          <p style={{ marginTop: 6 }}>Esta apresentação mostra o que combinamos a partir da sua avaliação — e ela é sobre você.</p>
          {content.goal ? <div className="pp-goal"><span className="jr-eyebrow">O objetivo combinado</span><b>{content.goal.title}</b>{content.goal.target_date && <span className="jr-small jr-muted">Meta de data: {shortDate(content.goal.target_date)}</span>}</div> : <p className="pp-tbd">O objetivo ainda será definido com o seu fisioterapeuta.</p>}
          {content.reported.activities && <Authored who="paciente"><b>O que você quer voltar a fazer:</b> {content.reported.activities}</Authored>}
        </>)}

        {S.key === "partida" && (<>
          {content.areas.length > 0 && <div className="pp-chips" aria-label="Áreas da fisioterapia">{content.areas.map((a) => <span key={a.key} className="jr-pill">{a.label}</span>)}</div>}
          {content.reported.complaint ? <Authored who="paciente"><b>Queixa principal:</b> {content.reported.complaint}</Authored> : <p className="pp-tbd">Queixa principal ainda não registrada.</p>}
          {content.reported.symptom_duration && <Authored who="paciente"><b>Há quanto tempo:</b> {content.reported.symptom_duration}</Authored>}
          {content.reported.limitations && <Authored who="paciente"><b>O que ficou mais difícil:</b> {content.reported.limitations}</Authored>}
          {content.assessed.condition_text && (
            <Authored who="profissional"><b>{content.assessed.condition_kind === "assessed" ? "Condição avaliada" : "Hipótese em investigação"}:</b> {content.assessed.condition_text}
              {content.assessed.condition_kind === "hypothesis" && <span className="jr-small jr-muted"> — uma hipótese ainda precisa ser confirmada na avaliação; não é um diagnóstico definitivo.</span>}</Authored>)}
          <div className="pp-measures" data-testid="pp-measures">
            <span className="jr-eyebrow">Medidas iniciais registradas</span>
            {pain && pain.count > 0 ? <p>Dor (0 a 10): <b>{num(pain.first as number)}</b> no primeiro registro{pain.count > 1 ? <> · <b>{num(pain.last as number)}</b> no mais recente ({pain.count} registros)</> : ""}. {pain.count === 1 && <span className="jr-muted">Um único registro mostra o ponto de partida, não uma tendência.</span>}</p> : null}
            {fn.map((f) => <p key={f.name}>{f.name} (0 a 10): <b>{num(f.first)}</b> no primeiro registro{f.count > 1 ? <> · <b>{num(f.last)}</b> agora</> : ""}.</p>)}
            {(!pain || pain.count === 0) && fn.length === 0 && <p className="pp-tbd">Ainda não há medidas registradas. Elas aparecem aqui conforme o seu fisioterapeuta as coletar — ausência de medida não significa zero.</p>}
          </div>
        </>)}

        {S.key === "acompanhamento" && (
          <ol className="pp-flow" aria-label="Como o acompanhamento funciona">
            {["Avaliação", "Plano individual", "Atendimentos e rotina orientada", "Reavaliação", "Ajuste, continuidade ou alta"].map((t, n, a) => (
              <li key={t}><span className="pp-flow-n">{n + 1}</span><b>{t}</b>{n < a.length - 1 && <ArrowRight className="pp-flow-arrow" size={16} aria-hidden />}</li>
            ))}
          </ol>
        )}
        {S.key === "acompanhamento" && <p style={{ marginTop: 10 }}>Cada etapa é decidida com você. Depois da reavaliação, o plano é ajustado, mantido ou encerrado com alta — conforme a sua necessidade clínica.</p>}

        {S.key === "rotina" && (<>
          <p>Os atendimentos, as atividades combinadas para fazer em casa e as reavaliações se conectam: é a regularidade do que foi combinado que permite ao seu fisioterapeuta ver como o seu corpo está respondendo e ajustar o plano.</p>
          <p style={{ marginTop: 8 }}>Se algo estiver difícil de cumprir — horário, dor, dúvida —, conte para o seu fisioterapeuta. O plano pode ser ajustado.</p>
          <div className="pp-quote"><HeartHandshake size={20} aria-hidden /><p>Você entende o motivo do tratamento, acompanha sua evolução e participa das decisões sobre sua recuperação.</p></div>
        </>)}

        {S.key === "plano" && (
          <dl className="pp-plan" data-testid="pp-plan">
            <div><dt>Objetivo</dt><dd>{content.goal ? content.goal.title : TBD}</dd></div>
            <div><dt>Frequência e duração</dt><dd>{hasFreq ? [p.freq_per_week != null && `${p.freq_per_week}x por semana`, p.duration_weeks != null && `por cerca de ${p.duration_weeks} semanas`].filter(Boolean).join(" · ") : TBD}</dd></div>
            {model?.sessions.planned != null && <div><dt>Sessões planejadas pelo fisioterapeuta</dt><dd>{model.sessions.planned}</dd></div>}
            <div><dt>Rotina orientada</dt><dd>{p.routine ?? TBD}</dd></div>
            <div><dt>Próxima reavaliação</dt><dd>{p.reassessment_on ? shortDate(p.reassessment_on) : TBD}{p.reassessment_criteria && <span className="jr-small jr-muted"> — avaliaremos: {p.reassessment_criteria}</span>}</dd></div>
            <div><dt>Como acompanhar a resposta</dt><dd>Registros de dor e das atividades que você quer retomar, sempre com data e autoria — na sua área do paciente.</dd></div>
          </dl>
        )}

        {S.key === "ciencia" && (content.evidence.length > 0 ? (
          <div style={{ display: "grid", gap: 8 }} data-testid="pp-evidence">{content.evidence.slice(0, 3).map((e) => <EvidenceBlock key={e.id} e={e} />)}
            <p className="jr-small jr-muted">Resultados de grupos de pessoas em pesquisas não garantem o resultado individual. O tempo de seguimento de um estudo (por exemplo, um ano de acompanhamento) não é a duração do seu tratamento.</p></div>
        ) : <p className="pp-tbd" data-testid="pp-evidence-empty">Ainda não há um estudo aprovado selecionado para o seu caso. Quando houver, ele aparece aqui, com a fonte original — nada é inventado.</p>)}

        {S.key === "area" && final}
      </section>

      <div className="pp-nav">
        <button type="button" className="jr-btn is-soft" onClick={() => go(i - 1)} disabled={i === 0} data-testid="pp-back"><ArrowLeft size={16} aria-hidden />Voltar</button>
        {!last && <button type="button" className="jr-btn" onClick={() => go(i + 1)} data-testid="pp-next">Avançar<ArrowRight size={16} aria-hidden /></button>}
      </div>
    </div>
  );
};
export default PresentationSteps;
