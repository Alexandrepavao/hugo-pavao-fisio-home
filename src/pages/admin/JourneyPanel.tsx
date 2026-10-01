import { useState, type FormEvent } from "react";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { supabase } from "@/lib/supabase";
import { fmtDate, fmtDateTime } from "@/lib/format";
import { Badge, btnDanger, btnGhost, btnPrimary, errText, Msg, State, useMsg } from "@/lib/ui";
import { DECISION_LABEL, GOAL_STATUS, KIND_HINT, KIND_LABEL, type JourneyAssessment, type JourneyData } from "@/lib/journeyTypes";
import { EvolutionChart, PrivateVideo } from "@/pages/portal/Journey";

/** Jornada do paciente, visão do fisioterapeuta com VÍNCULO ativo (professional_journey exige o vínculo; gestor/comercial/financeiro não abrem nada daqui).
 *  Tudo é registro clínico do profissional: o sistema não calcula melhora, não cobra e não consome sessão a partir disto. */
const JourneyPanel = ({ person }: { person: string }) => {
  const qc = useQueryClient(); const [msg, m] = useMsg();
  const q = useQuery({ queryKey: ["pro-journey", person], retry: false, queryFn: async () => { const { data, error } = await supabase.rpc("professional_journey", { p_person: person }); if (error) throw error; return data as JourneyData; } });
  const settings = useQuery({ queryKey: ["journey-settings"], retry: false, queryFn: async () => { const { data, error } = await supabase.rpc("journey_settings_get"); if (error) throw error; return (data as { default_sessions: number; bunny_library_id: string | null }[])[0]; } });
  const refresh = () => void qc.invalidateQueries({ queryKey: ["pro-journey", person] });
  const call = async (fn: string, args: Record<string, unknown>, ok: string) => { const { error } = await supabase.rpc(fn, args); if (error) { m.err(errText(error)); return false; } m.ok(ok); refresh(); return true; };

  const [gTitle, setGTitle] = useState(""); const [gDetails, setGDetails] = useState(""); const [gDate, setGDate] = useState("");
  const [sessions, setSessions] = useState(""); const [planNotes, setPlanNotes] = useState("");
  const [aKind, setAKind] = useState<JourneyAssessment["kind"]>("dor"); const [aScore, setAScore] = useState("5"); const [aNote, setANote] = useState("");
  const [rDecision, setRDecision] = useState<"continuidade" | "manutencao" | "alta">("continuidade"); const [rExtra, setRExtra] = useState("5"); const [rMsg, setRMsg] = useState(""); const [rClin, setRClin] = useState("");
  const [vTitle, setVTitle] = useState(""); const [vDesc, setVDesc] = useState(""); const [vLib, setVLib] = useState(""); const [vId, setVId] = useState("");

  if (q.error) return <section className="hp-card p-4 text-sm text-muted-foreground">A jornada do paciente ainda não está disponível (migration pendente ou sem vínculo assistencial ativo).</section>;
  const d = q.data; const p = d?.plan;
  const addGoal = async (e: FormEvent) => { e.preventDefault(); if (gTitle.trim().length < 3) return m.err("Descreva o objetivo (mínimo de 3 caracteres).");
    if (await call("patient_goal_save", { p_person: person, p_id: null, p_title: gTitle, p_details: gDetails || null, p_target_date: gDate || null, p_status: "active" }, "Objetivo registrado.")) { setGTitle(""); setGDetails(""); setGDate(""); } };
  const savePlan = async (e: FormEvent) => { e.preventDefault(); const n = sessions ? Number(sessions) : null;
    if (n == null || !Number.isInteger(n) || n < 1 || n > 200) return m.err("Informe de 1 a 200 sessões: a quantidade é definida por você na avaliação (não há número padrão).");
    await call("patient_plan_save", { p_person: person, p_planned_sessions: n, p_client_package: null, p_notes: planNotes || null }, "Plano de sessões salvo."); };
  const addAssessment = async (e: FormEvent) => { e.preventDefault(); const v = Number(aScore.replace(",", ".")); if (!Number.isFinite(v) || v < 0 || v > 10) return m.err("Nota de 0 a 10.");
    if (await call("professional_assessment_add", { p_person: person, p_kind: aKind, p_score: v, p_note: aNote || null, p_assessed_at: null }, "Avaliação registrada com a sua autoria.")) setANote(""); };
  const reassess = async (e: FormEvent) => { e.preventDefault(); const extra = rExtra ? Number(rExtra) : null;
    if (rDecision === "continuidade" && (!extra || extra < 1)) return m.err("Informe as sessões adicionais do plano de continuidade.");
    if (await call("patient_reassess", { p_person: person, p_decision: rDecision, p_extra_sessions: rDecision === "alta" ? null : extra, p_patient_message: rMsg || null, p_clinical_note: rClin || null }, "Reavaliação registrada.")) { setRMsg(""); setRClin(""); } };
  const assignVideo = async (e: FormEvent) => { e.preventDefault(); if (vTitle.trim().length < 2 || !vId.trim()) return m.err("Informe o título e o ID do vídeo no Bunny.");
    if (await call("patient_video_assign", { p_person: person, p_title: vTitle, p_description: vDesc || null, p_library_id: vLib || null, p_video_id: vId, p_expires_at: null }, "Vídeo atribuído ao paciente.")) { setVTitle(""); setVDesc(""); setVId(""); } };

  return (
    <section className="grid gap-6" aria-label="Jornada do paciente">
      <div><h3 className="text-lg">Jornada do paciente</h3><p className="text-xs text-muted-foreground">Registro clínico seu. O sistema não calcula melhora, não cobra e não desconta sessão a partir dele; sessões realizadas são só contagem. Só você (vínculo ativo) e o próprio paciente veem estes dados.</p></div>
      <Msg m={msg} /><State loading={q.isLoading} error={undefined} />
      {d && (<>
        {d.renewal && <div className="hp-card p-3 text-sm flex flex-wrap items-center justify-between gap-2" role="note"><span>O paciente pediu {d.renewal.kind === "renovacao" ? "a renovação do acompanhamento" : "contato"} em {fmtDateTime(d.renewal.created_at)}.</span>
          <span className="flex gap-2"><button className={btnGhost + " hp-btn-sm"} onClick={() => call("renewal_request_set_status", { p_id: d.renewal!.id, p_status: "contacted" }, "Marcado como contatado.")}>Contatado</button><button className={btnGhost + " hp-btn-sm"} onClick={() => call("renewal_request_set_status", { p_id: d.renewal!.id, p_status: "closed" }, "Pedido encerrado.")}>Encerrar</button></span></div>}

        <div><h4 className="font-medium mb-2">Objetivos</h4>
          <ul className="grid gap-2 mb-3">{d.goals.map((g) => <li key={g.id} className="hp-card p-3 text-sm flex flex-wrap items-center justify-between gap-2"><span><b>{g.title}</b>{g.details && <span className="text-muted-foreground"> — {g.details}</span>}{g.target_date && <span className="text-muted-foreground"> · meta {fmtDate(g.target_date + "T12:00:00Z")}</span>}</span>
            <span className="flex items-center gap-2"><Badge tone={g.status === "achieved" ? "success" : "neutral"}>{GOAL_STATUS[g.status]}</Badge>
              {g.status === "active" && <><button className="text-accent text-xs" onClick={() => call("patient_goal_save", { p_person: person, p_id: g.id, p_title: g.title, p_details: g.details, p_target_date: g.target_date, p_status: "achieved" }, "Objetivo marcado como alcançado.")}>Alcançado</button>
                <button className="text-muted-foreground text-xs" onClick={() => call("patient_goal_save", { p_person: person, p_id: g.id, p_title: g.title, p_details: g.details, p_target_date: g.target_date, p_status: "dropped" }, "Objetivo descontinuado.")}>Descontinuar</button></>}</span></li>)}
            {d.goals.length === 0 && <li className="text-sm text-muted-foreground">Nenhum objetivo registrado.</li>}</ul>
          <form onSubmit={addGoal} className="hp-card p-3 grid gap-2 sm:grid-cols-4 items-end"><div className="sm:col-span-2"><label htmlFor="jg-t" className="block text-xs mb-1">Novo objetivo</label><input id="jg-t" value={gTitle} onChange={(e) => setGTitle(e.target.value)} maxLength={200} /></div>
            <div><label htmlFor="jg-d" className="block text-xs mb-1">Meta (data)</label><input id="jg-d" type="date" value={gDate} onChange={(e) => setGDate(e.target.value)} /></div><button className={btnPrimary}>Adicionar</button>
            <div className="sm:col-span-4"><label htmlFor="jg-x" className="block text-xs mb-1">Detalhes (opcional)</label><input id="jg-x" value={gDetails} onChange={(e) => setGDetails(e.target.value)} maxLength={1000} /></div></form>
        </div>

        <div><h4 className="font-medium mb-2">Plano de sessões</h4>
          {p ? <p className="text-sm mb-2">Plano de <b>{p.planned_sessions}</b> sessão(ões) desde {fmtDate(p.started_on + "T12:00:00Z")} {p.maintenance && <Badge tone="gold">Manutenção</Badge>} {p.status !== "active" && <Badge tone="success">{p.status === "completed" ? "Encerrado (alta)" : "Cancelado"}</Badge>} — realizadas {p.attended} · faltas do paciente {p.patient_no_show} · ausência do profissional {p.professional_no_show} · canceladas {p.cancelled} · saldo do pacote {d.package_balance}</p>
            : <p className="text-sm text-muted-foreground mb-2">Sem plano ativo. Defina a quantidade de sessões conforme a sua avaliação clínica; o paciente só vê o número que você registrar.</p>}
          <form onSubmit={savePlan} className="hp-card p-3 grid gap-2 sm:grid-cols-4 items-end"><div><label htmlFor="jp-n" className="block text-xs mb-1">Sessões do plano *</label><input id="jp-n" type="number" min={1} max={200} required value={sessions} onChange={(e) => setSessions(e.target.value)} placeholder={settings.data?.default_sessions ? `sugestão da clínica: ${settings.data.default_sessions}` : undefined} /></div>
            <div className="sm:col-span-2"><label htmlFor="jp-o" className="block text-xs mb-1">Observações do plano</label><input id="jp-o" value={planNotes} onChange={(e) => setPlanNotes(e.target.value)} maxLength={1000} /></div><button className={btnPrimary}>{p && p.status === "active" ? "Atualizar plano" : "Criar plano"}</button></form>
        </div>

        <div><h4 className="font-medium mb-2">Evolução (avaliações reais)</h4>
          <div className="hp-card p-3"><EvolutionChart items={d.assessments} /></div>
          <form onSubmit={addAssessment} className="hp-card p-3 mt-2 grid gap-2 sm:grid-cols-5 items-end"><div><label htmlFor="ja-k" className="block text-xs mb-1">Avaliação</label><select id="ja-k" value={aKind} onChange={(e) => setAKind(e.target.value as JourneyAssessment["kind"])}>{(Object.keys(KIND_LABEL) as JourneyAssessment["kind"][]).map((k) => <option key={k} value={k}>{KIND_LABEL[k]}</option>)}</select></div>
            <div><label htmlFor="ja-s" className="block text-xs mb-1">Nota (0 a 10)</label><input id="ja-s" inputMode="decimal" value={aScore} onChange={(e) => setAScore(e.target.value)} /></div>
            <div className="sm:col-span-2"><label htmlFor="ja-n" className="block text-xs mb-1">Observação</label><input id="ja-n" value={aNote} onChange={(e) => setANote(e.target.value)} maxLength={500} /></div><button className={btnPrimary}>Registrar</button><p className="sm:col-span-5 text-[11px] text-muted-foreground">{KIND_HINT[aKind]}. Avaliações não podem ser editadas: para corrigir, registre uma nova.</p></form>
        </div>

        <div><h4 className="font-medium mb-2">Reavaliação</h4>
          <ul className="grid gap-2 mb-2">{d.reassessments.map((r) => <li key={r.id} className="hp-card p-3 text-sm"><p><Badge tone={r.decision === "alta" ? "success" : "info"}>{DECISION_LABEL[r.decision]}</Badge> <span className="text-muted-foreground">{fmtDate(r.decided_at)} · {r.author}{r.extra_sessions ? ` · +${r.extra_sessions} sessão(ões)` : ""}</span></p>
            {r.patient_message && <p className="mt-1"><span className="text-xs text-muted-foreground">Mensagem ao paciente: </span>{r.patient_message}</p>}{r.clinical_note && <p className="mt-1"><span className="text-xs text-muted-foreground">Nota clínica (só você vê): </span>{r.clinical_note}</p>}</li>)}</ul>
          {p?.status === "active" ? (
            <form onSubmit={reassess} className="hp-card p-3 grid gap-2 sm:grid-cols-4 items-end"><div><label htmlFor="jr-d" className="block text-xs mb-1">Decisão</label><select id="jr-d" value={rDecision} onChange={(e) => setRDecision(e.target.value as typeof rDecision)}><option value="continuidade">Continuidade</option><option value="manutencao">Manutenção</option><option value="alta">Alta</option></select></div>
              {rDecision !== "alta" && <div><label htmlFor="jr-x" className="block text-xs mb-1">{rDecision === "continuidade" ? "Sessões adicionais" : "Sessões adicionais (opcional)"}</label><input id="jr-x" type="number" min={1} max={200} value={rExtra} onChange={(e) => setRExtra(e.target.value)} /></div>}
              <div className="sm:col-span-2"><label htmlFor="jr-m" className="block text-xs mb-1">Mensagem ao paciente</label><input id="jr-m" value={rMsg} onChange={(e) => setRMsg(e.target.value)} maxLength={1000} /></div>
              <div className="sm:col-span-3"><label htmlFor="jr-c" className="block text-xs mb-1">Nota clínica (restrita a você)</label><input id="jr-c" value={rClin} onChange={(e) => setRClin(e.target.value)} maxLength={4000} /></div><button className={btnPrimary}>Registrar reavaliação</button></form>
          ) : <p className="text-sm text-muted-foreground">Crie um plano ativo para registrar uma reavaliação.</p>}
        </div>

        <div><h4 className="font-medium mb-2">Vídeos privados (Bunny)</h4>
          <ul className="grid gap-2 mb-2">{d.videos.map((v) => <li key={v.id} className="hp-card p-3 text-sm"><div className="flex flex-wrap items-center justify-between gap-2"><span><b>{v.title}</b> <span className="text-muted-foreground">· atribuído em {fmtDate(v.assigned_at)} · {v.views ?? 0} visualização(ões) do paciente</span></span>
            {v.revoked_at ? <Badge>Revogado</Badge> : <button className={btnDanger + " hp-btn-sm"} onClick={() => call("patient_video_revoke", { p_id: v.id }, "Acesso ao vídeo revogado.")}>Revogar</button>}</div>{!v.revoked_at && <div className="mt-2"><PrivateVideo video={v} /></div>}</li>)}
            {d.videos.length === 0 && <li className="text-sm text-muted-foreground">Nenhum vídeo atribuído.</li>}</ul>
          <form onSubmit={assignVideo} className="hp-card p-3 grid gap-2 sm:grid-cols-4 items-end"><div className="sm:col-span-2"><label htmlFor="jv-t" className="block text-xs mb-1">Título</label><input id="jv-t" value={vTitle} onChange={(e) => setVTitle(e.target.value)} maxLength={160} /></div>
            <div><label htmlFor="jv-l" className="block text-xs mb-1">ID da biblioteca {settings.data?.bunny_library_id ? `(padrão ${settings.data.bunny_library_id})` : ""}</label><input id="jv-l" value={vLib} onChange={(e) => setVLib(e.target.value)} placeholder={settings.data?.bunny_library_id ?? "ex.: 123456"} /></div>
            <div><label htmlFor="jv-i" className="block text-xs mb-1">ID do vídeo (Bunny)</label><input id="jv-i" value={vId} onChange={(e) => setVId(e.target.value)} /></div>
            <div className="sm:col-span-3"><label htmlFor="jv-d" className="block text-xs mb-1">Descrição (opcional)</label><input id="jv-d" value={vDesc} onChange={(e) => setVDesc(e.target.value)} maxLength={500} /></div><button className={btnPrimary}>Atribuir ao paciente</button>
            <p className="sm:col-span-4 text-[11px] text-muted-foreground">O vídeo só abre para este paciente e para você, por link assinado de curta duração gerado pelo servidor. Sem a proteção configurada, a reprodução fica indisponível (nunca pública).</p></form>
        </div>
      </>)}
    </section>
  );
};

export default JourneyPanel;
