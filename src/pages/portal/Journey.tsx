import { useState, type FormEvent } from "react";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { CartesianGrid, Legend, Line, LineChart, ResponsiveContainer, Tooltip, XAxis, YAxis } from "recharts";
import { supabase } from "@/lib/supabase";
import { fmtDate, fmtDateTime } from "@/lib/format";
import { Badge, btnGhost, btnPrimary, errText, Msg, State, useMsg } from "@/lib/ui";
import { DECISION_LABEL as DECISION, GOAL_STATUS as GOAL_ST, KIND_HINT, KIND_LABEL, type JourneyAssessment, type JourneyData } from "@/lib/journeyTypes";

const KIND_COLOR: Record<JourneyAssessment["kind"], string> = { dor: "hsl(var(--destructive))", funcionalidade: "hsl(var(--primary))", bem_estar: "hsl(var(--success))" };

/** Gráfico de evolução: pontos REAIS registrados (paciente ou profissional), cada um com data e autoria no detalhe. Sem interpolar nem estimar. */
export const EvolutionChart = ({ items }: { items: JourneyAssessment[] }) => {
  const rows = items.map((a) => ({ t: new Date(a.assessed_at).getTime(), [a.kind]: Number(a.score), _a: a })).sort((x, y) => x.t - y.t);
  if (rows.length === 0) return <p className="text-sm text-muted-foreground">Ainda não há avaliações registradas.</p>;
  return (
    <div style={{ height: 260 }} role="img" aria-label="Gráfico de evolução das avaliações registradas">
      <ResponsiveContainer width="100%" height="100%">
        <LineChart data={rows} margin={{ top: 8, right: 12, left: -12, bottom: 0 }}>
          <CartesianGrid strokeDasharray="3 3" stroke="hsl(var(--border))" />
          <XAxis dataKey="t" type="number" scale="time" domain={["dataMin", "dataMax"]} fontSize={11} tickFormatter={(v) => new Date(v).toLocaleDateString("pt-BR", { day: "2-digit", month: "2-digit" })} />
          <YAxis domain={[0, 10]} fontSize={12} allowDecimals={false} />
          <Tooltip content={({ active, payload }) => { const a = (payload?.[0]?.payload as { _a?: JourneyAssessment } | undefined)?._a; if (!active || !a) return null;
            return <div className="hp-card p-2 text-xs"><p className="font-medium">{KIND_LABEL[a.kind]}: {a.score.toString().replace(".", ",")}</p><p>{fmtDateTime(a.assessed_at)}</p><p className="text-muted-foreground">Registrado por {a.author}</p>{a.note && <p className="text-muted-foreground">“{a.note}”</p>}</div>; }} />
          <Legend wrapperStyle={{ fontSize: 12 }} formatter={(v) => KIND_LABEL[v as JourneyAssessment["kind"]] ?? v} />
          {(["dor", "funcionalidade", "bem_estar"] as const).map((k) => <Line key={k} type="monotone" dataKey={k} stroke={KIND_COLOR[k]} strokeWidth={2} connectNulls dot={{ r: 3 }} isAnimationActive={false} />)}
        </LineChart>
      </ResponsiveContainer>
    </div>
  );
};

/** Vídeo privado: a URL de reprodução é pedida ao backend (Edge Function bunny-playback), que autoriza no banco e assina um link de curta duração. */
export const PrivateVideo = ({ video }: { video: { id: string; title: string } }) => {
  const [url, setUrl] = useState<string | null>(null); const [state, setState] = useState<"idle" | "loading" | "unconfigured" | "denied" | "error">("idle");
  const play = async () => {
    setState("loading");
    const { data, error } = await supabase.functions.invoke("bunny-playback", { body: { video_id: video.id } });
    if (!error && data?.url) { setUrl(data.url as string); setState("idle"); return; }
    const status = (error as { context?: { status?: number } } | null)?.context?.status;
    setState(status === 503 ? "unconfigured" : status === 403 ? "denied" : "error");
  };
  return (
    <div>
      {url ? <iframe title={video.title} src={url} className="w-full aspect-video border border-border bg-black" allow="encrypted-media; picture-in-picture" allowFullScreen referrerPolicy="strict-origin-when-cross-origin" />
        : <button className={btnGhost} onClick={play} disabled={state === "loading"}>{state === "loading" ? "Autorizando…" : "Assistir"}</button>}
      {state === "unconfigured" && <p role="status" className="text-sm text-muted-foreground mt-2">Reprodução indisponível por configuração: a proteção de vídeo ainda não foi ativada no servidor. O vídeo não é exibido de forma pública.</p>}
      {state === "denied" && <p role="alert" className="text-sm text-destructive mt-2">Você não tem acesso a este vídeo (ele pode ter sido revogado ou vencido).</p>}
      {state === "error" && <p role="alert" className="text-sm text-destructive mt-2">Não foi possível carregar o vídeo agora. Tente novamente em instantes.</p>}
    </div>
  );
};

const Stat = ({ label, value, hint }: { label: string; value: number; hint?: string }) => (
  <div className="hp-card p-3"><p className="text-xs text-muted-foreground">{label}</p><p className="text-2xl font-bold tabular">{value}</p>{hint && <p className="text-[11px] leading-4 text-muted-foreground mt-1">{hint}</p>}</div>
);

/** “Minha jornada” no portal do paciente: só o próprio paciente (my_journey() devolve apenas os dados dele e omite o que é restrito ao profissional). */
const Journey = () => {
  const qc = useQueryClient(); const [msg, m] = useMsg();
  const q = useQuery({ queryKey: ["my-journey"], retry: false, queryFn: async () => { const { data, error } = await supabase.rpc("my_journey"); if (error) throw error; return data as JourneyData; } });
  const [kind, setKind] = useState<JourneyAssessment["kind"]>("dor"); const [score, setScore] = useState("5"); const [note, setNote] = useState(""); const [reqMsg, setReqMsg] = useState("");
  const refresh = () => void qc.invalidateQueries({ queryKey: ["my-journey"] });
  const addAssessment = async (e: FormEvent) => {
    e.preventDefault(); const v = Number(score.replace(",", "."));
    if (!Number.isFinite(v) || v < 0 || v > 10) return m.err("Informe uma nota de 0 a 10.");
    const { error } = await supabase.rpc("my_assessment_add", { p_kind: kind, p_score: v, p_note: note.trim() || null });
    if (error) return m.err(errText(error)); m.ok("Registro salvo. Ele aparece no gráfico com a sua autoria."); setNote(""); refresh();
  };
  const request = async (k: "renovacao" | "contato") => {
    const { error } = await supabase.rpc("my_renewal_request", { p_kind: k, p_message: reqMsg.trim() || null });
    if (error) return m.err(errText(error)); m.ok("Pedido enviado. A equipe entrará em contato — nenhuma cobrança é feita automaticamente."); setReqMsg(""); refresh();
  };
  if (q.error) return <section className="mb-10"><h2 className="text-xl mb-3">Minha jornada</h2><p className="text-sm text-muted-foreground">A jornada de acompanhamento ainda não está disponível para a sua conta.</p></section>;
  const d = q.data; const p = d?.plan;
  return (
    <section className="mb-10" aria-label="Minha jornada">
      <h2 className="text-xl mb-1">Minha jornada</h2>
      <p className="text-sm text-muted-foreground mb-4">Registros do seu acompanhamento. O número de sessões é apenas uma contagem — <b>não indica, por si só, melhora ou resultado</b>. A quantidade final de sessões e a continuidade dependem da avaliação do seu fisioterapeuta.</p>
      <Msg m={msg} /><State loading={q.isLoading} error={undefined} />
      {d && (<div className="grid gap-6">
        <div><h3 className="text-base font-semibold mb-2">Objetivos definidos com o seu fisioterapeuta</h3>
          {d.goals.length === 0 ? <p className="text-sm text-muted-foreground">Seu fisioterapeuta ainda não registrou objetivos.</p> : (
            <ul className="grid gap-2">{d.goals.map((g) => <li key={g.id} className="hp-card p-3 text-sm flex flex-wrap justify-between gap-2"><span><b>{g.title}</b>{g.details && <span className="text-muted-foreground"> — {g.details}</span>}{g.target_date && <span className="text-muted-foreground"> · meta: {fmtDate(g.target_date + "T12:00:00Z")}</span>}</span><Badge tone={g.status === "achieved" ? "success" : g.status === "dropped" ? "neutral" : "info"}>{GOAL_ST[g.status]}</Badge></li>)}</ul>)}
        </div>

        <div><h3 className="text-base font-semibold mb-2">Plano de sessões</h3>
          {!p ? <p className="text-sm text-muted-foreground">Ainda não há um plano de sessões registrado. O modelo inicial da clínica é de {d.default_sessions} sessões, ajustado pelo fisioterapeuta conforme a sua avaliação.</p> : (<>
            <p className="text-sm mb-2">Plano de {p.planned_sessions} sessão(ões) desde {fmtDate(p.started_on + "T12:00:00Z")} {p.maintenance && <Badge tone="gold">Manutenção</Badge>} {p.status === "completed" && <Badge tone="success">Plano encerrado (alta)</Badge>}</p>
            <div className="h-2 bg-muted rounded overflow-hidden mb-3" role="progressbar" aria-valuemin={0} aria-valuemax={p.planned_sessions} aria-valuenow={Math.min(p.attended, p.planned_sessions)} aria-label="Sessões realizadas do plano"><div className="h-full bg-primary" style={{ width: `${Math.min(100, Math.round((100 * p.attended) / p.planned_sessions))}%` }} /></div>
            <div className="grid gap-2 grid-cols-2 sm:grid-cols-4 lg:grid-cols-5">
              <Stat label="Sessões realizadas" value={p.attended} hint="comparecimentos registrados" />
              <Stat label="Suas faltas" value={p.patient_no_show} hint="sem cancelamento; podem descontar do pacote conforme a regra" />
              <Stat label="Ausência do profissional" value={p.professional_no_show} hint="não desconta do seu pacote" />
              <Stat label="Canceladas" value={p.cancelled} />
              <Stat label="Saldo do pacote" value={d.package_balance} hint="sessões ainda disponíveis (separado do plano)" />
            </div></>)}
        </div>

        <div><h3 className="text-base font-semibold mb-2">Próximas consultas</h3>
          {d.upcoming.length === 0 ? <p className="text-sm text-muted-foreground">Nenhuma consulta futura agendada.</p> : <ul className="grid gap-2">{d.upcoming.map((a) => <li key={a.id} className="hp-card p-3 text-sm flex justify-between gap-2"><span>{fmtDateTime(a.starts_at)} — {a.service} com {a.professional}</span><span className="text-muted-foreground">{a.status === "confirmed" ? "Confirmada" : "Agendada"}</span></li>)}</ul>}
        </div>

        <div><h3 className="text-base font-semibold mb-1">Evolução</h3>
          <p className="text-xs text-muted-foreground mb-2">Cada ponto é uma avaliação real, com data e autoria (você ou o profissional). As escalas são de autorrelato de 0 a 10; interpretar a evolução é papel do seu fisioterapeuta.</p>
          <div className="hp-card p-3"><EvolutionChart items={d.assessments} /></div>
          {d.assessments.length > 0 && <ul className="mt-2 grid gap-1 text-xs text-muted-foreground">{[...d.assessments].reverse().slice(0, 8).map((a) => <li key={a.id + a.source}>{fmtDateTime(a.assessed_at)} · {KIND_LABEL[a.kind]} {a.score.toString().replace(".", ",")} · {a.author}{a.source === "atividade" ? " (registro de atividade)" : ""}</li>)}</ul>}
          <form onSubmit={addAssessment} className="hp-card p-3 mt-3 grid gap-2 sm:grid-cols-5 items-end" aria-label="Registrar como estou hoje">
            <div><label htmlFor="ja-kind" className="block text-xs mb-1">O que registrar</label><select id="ja-kind" value={kind} onChange={(e) => setKind(e.target.value as JourneyAssessment["kind"])}>{(Object.keys(KIND_LABEL) as JourneyAssessment["kind"][]).map((k) => <option key={k} value={k}>{KIND_LABEL[k]}</option>)}</select></div>
            <div><label htmlFor="ja-score" className="block text-xs mb-1">Nota (0 a 10)</label><input id="ja-score" inputMode="decimal" value={score} onChange={(e) => setScore(e.target.value)} /></div>
            <div className="sm:col-span-2"><label htmlFor="ja-note" className="block text-xs mb-1">Observação (opcional)</label><input id="ja-note" value={note} onChange={(e) => setNote(e.target.value)} maxLength={500} /></div>
            <button className={btnPrimary}>Registrar</button>
            <p className="sm:col-span-5 text-[11px] text-muted-foreground">{KIND_HINT[kind]}</p>
          </form>
        </div>

        <div><h3 className="text-base font-semibold mb-2">Vídeos do seu fisioterapeuta</h3>
          {d.videos.length === 0 ? <p className="text-sm text-muted-foreground">Nenhum vídeo liberado para você.</p> : (
            <ul className="grid gap-3">{d.videos.map((v) => <li key={v.id} className="hp-card p-3"><p className="font-medium text-sm">{v.title}</p>{v.description && <p className="text-xs text-muted-foreground mb-2">{v.description}</p>}<PrivateVideo video={v} /></li>)}</ul>)}
          <p className="text-[11px] text-muted-foreground mt-2">Os vídeos são privados e só abrem para a sua conta.</p>
        </div>

        <div><h3 className="text-base font-semibold mb-2">Reavaliação</h3>
          {d.reassessments.length === 0 ? <p className="text-sm text-muted-foreground">Ainda não houve reavaliação registrada.</p> : (
            <ul className="grid gap-2">{d.reassessments.map((r) => <li key={r.id} className="hp-card p-3 text-sm"><p><Badge tone={r.decision === "alta" ? "success" : "info"}>{DECISION[r.decision]}</Badge> <span className="text-muted-foreground"> {fmtDate(r.decided_at)} · {r.author}</span>{r.extra_sessions ? <span className="text-muted-foreground"> · +{r.extra_sessions} sessão(ões) no plano</span> : null}</p>{r.patient_message && <p className="mt-1">{r.patient_message}</p>}</li>)}</ul>)}
        </div>

        <div><h3 className="text-base font-semibold mb-2">Renovação ou contato</h3>
          {d.renewal ? <p className="text-sm hp-card p-3">Você pediu {d.renewal.kind === "renovacao" ? "a renovação" : "contato da equipe"} em {fmtDateTime(d.renewal.created_at)}. A equipe vai falar com você — <b>nenhuma cobrança é feita automaticamente</b>.</p> : (
            <div className="hp-card p-3 grid gap-2"><label htmlFor="rq-msg" className="text-xs">Mensagem (opcional)</label><input id="rq-msg" value={reqMsg} onChange={(e) => setReqMsg(e.target.value)} maxLength={1000} />
              <div className="flex flex-wrap gap-2"><button className={btnPrimary} onClick={() => request("renovacao")}>Quero renovar meu acompanhamento</button><button className={btnGhost} onClick={() => request("contato")}>Quero falar com a equipe</button></div>
              <p className="text-[11px] text-muted-foreground">Isto só avisa a equipe. Nenhuma cobrança, compra ou desconto de sessão é feito automaticamente.</p></div>)}
        </div>
      </div>)}
    </section>
  );
};

export default Journey;
