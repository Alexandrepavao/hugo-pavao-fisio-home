import { useEffect, useMemo, useRef, useState, type FormEvent } from "react";
import { useLocation, useSearchParams } from "react-router-dom";
import { Loader2, MessageCircle, Copy, Check } from "lucide-react";
import Header from "@/components/Header";
import Footer from "@/components/Footer";
import { supabase } from "@/lib/supabase";
import {
  CONTACT_CONSENT_TEXT, CONTACT_CONSENT_VERSION, HEALTH_CONSENT_TEXT, HEALTH_CONSENT_VERSION,
  JOURNEY_LABEL, JOURNEY_QUESTIONS, MARKETING_CONSENT_TEXT, MARKETING_CONSENT_VERSION, UF_LIST, buildAtendimentoMessage,
  buildParceriaMessage, totalSteps, waLink, type Journey, type Question,
} from "@/lib/quiz";

type AnswerValue = { value: string | string[]; label: string; detalhe?: string };
type Phase = "contact" | "location" | "health-consent" | "question" | "marketing" | "sending" | "done" | "error";

interface Props { journey: Journey; title: string; intro: string; pageSlug: string }

const errText = (e: unknown) => (e instanceof Error ? e.message : "Não foi possível concluir. Tente novamente em instantes.");

const QuizRunner = ({ journey, title, intro, pageSlug }: Props) => {
  const [params] = useSearchParams();
  const { pathname } = useLocation();
  const questions = JOURNEY_QUESTIONS[journey];
  const total = totalSteps(journey);

  const [phase, setPhase] = useState<Phase>("contact");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [leadId, setLeadId] = useState<string | null>(null);
  const [qIndex, setQIndex] = useState(0); // índice dentro de `questions`

  // etapa 1
  const [name, setName] = useState(""); const [email, setEmail] = useState(""); const [phone, setPhone] = useState("");
  const [contactOk, setContactOk] = useState(false);
  const honeypotRef = useRef<HTMLInputElement>(null);

  // etapa 2
  const [city, setCity] = useState(""); const [uf, setUf] = useState("");

  // respostas guardadas só em memória (nunca em localStorage — algumas são dado de saúde)
  const [answers, setAnswers] = useState<Record<string, AnswerValue>>({});
  const [marketingOk, setMarketingOk] = useState(false);

  // conclusão / WhatsApp
  const [protocol, setProtocol] = useState<string | null>(null);
  const [firstName, setFirstName] = useState<string>("");
  const [waNumber, setWaNumber] = useState<string | null | undefined>(undefined);
  const [includeHealth, setIncludeHealth] = useState(false);
  const [includeBudget, setIncludeBudget] = useState(false);
  const [waCopied, setWaCopied] = useState(false);
  const [waClicked, setWaClicked] = useState(false);

  const stepNumber = phase === "contact" ? 1 : phase === "location" ? 2 : Math.min(3 + qIndex, total);
  const currentQuestion: Question | undefined = questions[qIndex];

  useEffect(() => { document.title = `${title} | HP Group`; }, [title]);

  const utm = useMemo(() => {
    const o: Record<string, string> = {};
    ["utm_source", "utm_medium", "utm_campaign", "utm_content", "utm_term"].forEach((k) => { const v = params.get(k); if (v) o[k] = v; });
    return o;
  }, [params]);

  const submitContact = async (e: FormEvent) => {
    e.preventDefault(); setError(null);
    if (!name.trim() || name.trim().length < 2) return setError("Informe seu nome.");
    if (!/^[^@\s]+@[^@\s]+\.[^@\s]+$/.test(email.trim())) return setError("Informe um e-mail válido.");
    if (phone.replace(/\D/g, "").length < 10) return setError("Informe um WhatsApp válido, com DDD.");
    if (!contactOk) return setError("Autorize o contato para continuar.");
    setBusy(true);
    try {
      const { data, error: rpcError } = await supabase.rpc("quiz_start", {
        p_journey: journey, p_name: name.trim(), p_email: email.trim(), p_phone: phone,
        p_contact_consent_version: CONTACT_CONSENT_VERSION, p_origin_path: pathname, p_page_slug: pageSlug,
        p_referrer: document.referrer || null, p_utm: utm, p_honeypot: honeypotRef.current?.value || null,
      });
      if (rpcError) throw rpcError;
      setLeadId(data.id);
      setPhase("location");
    } catch (err) { setError(errText(err)); } finally { setBusy(false); }
  };

  const submitLocation = async (e: FormEvent) => {
    e.preventDefault(); setError(null);
    if (!leadId) return setError("Sessão expirada — recarregue a página.");
    if (!city.trim() || !uf) return setError("Informe a cidade e o estado.");
    setBusy(true);
    try {
      const { error: rpcError } = await supabase.rpc("quiz_save_progress", { p_id: leadId, p_step: 4, p_answers: {}, p_city: city.trim(), p_uf: uf });
      if (rpcError) throw rpcError;
      setPhase(journey === "atendimento" ? "health-consent" : "question");
    } catch (err) { setError(errText(err)); } finally { setBusy(false); }
  };

  const acceptHealthConsent = async () => {
    if (!leadId) return; setBusy(true); setError(null);
    try {
      const { error: rpcError } = await supabase.rpc("quiz_set_health_consent", { p_id: leadId, p_version: HEALTH_CONSENT_VERSION });
      if (rpcError) throw rpcError;
      setPhase("question");
    } catch (err) { setError(errText(err)); } finally { setBusy(false); }
  };

  const saveAnswer = async (key: string, value: AnswerValue) => {
    if (!leadId) return; setError(null); setBusy(true);
    try {
      const { error: rpcError } = await supabase.rpc("quiz_save_progress", { p_id: leadId, p_step: 4 + qIndex + 1, p_answers: { [key]: value } });
      if (rpcError) throw rpcError;
      setAnswers((a) => ({ ...a, [key]: value }));
      if (qIndex + 1 < questions.length) setQIndex((i) => i + 1);
      else setPhase("marketing");
    } catch (err) { setError(errText(err)); } finally { setBusy(false); }
  };

  const finish = async () => {
    if (!leadId) return; setBusy(true); setError(null); setPhase("sending");
    try {
      const { data, error: rpcError } = await supabase.rpc("quiz_complete", {
        p_id: leadId, p_marketing_consent: marketingOk, p_marketing_consent_version: marketingOk ? MARKETING_CONSENT_VERSION : null,
      });
      if (rpcError) throw rpcError;
      setProtocol(data.protocol); setFirstName(data.first_name);
      const { data: num } = await supabase.rpc("quiz_whatsapp_number", { p_journey: journey, p_unit: null });
      setWaNumber(num ?? null);
      setPhase("done");
    } catch (err) { setError(errText(err)); setPhase("marketing"); } finally { setBusy(false); }
  };

  const message = useMemo(() => {
    if (!protocol) return "";
    const f = { firstName, fullName: name.trim(), email: email.trim(), phone, city: city.trim(), uf, protocol };
    if (journey === "atendimento") {
      const interesse = answers.interesse_acompanhamento?.label ?? null;
      const healthLines = includeHealth
        ? [answers.dor_intensidade && `Dor/desconforto hoje: ${answers.dor_intensidade.value}/10`,
           answers.motivacao_melhora && `Desejo de melhora: ${answers.motivacao_melhora.value}/10`,
           answers.impacto_qualidade_vida && `Impacto esperado na qualidade de vida: ${answers.impacto_qualidade_vida.value}/10`]
          .filter((x): x is string => Boolean(x))
        : [];
      return buildAtendimentoMessage(f, interesse, includeHealth, healthLines, includeBudget, answers.faixa_investimento?.label ?? null);
    }
    const objetivos = answers.objetivos_parceria?.label ?? null;
    const interesses = answers.interesses_desenvolvimento?.label ?? null;
    return buildParceriaMessage(f, answers.momento_profissional?.label ?? null, answers.situacao_registro?.label ?? null,
      answers.area_atuacao?.label ?? null, answers.modelo_atendimento?.label ?? null, objetivos, interesses);
  }, [protocol, firstName, name, email, phone, city, uf, journey, answers, includeHealth, includeBudget]);

  const progressPct = Math.round((stepNumber / total) * 100);

  return (
    <div className="min-h-screen">
      <Header />
      <main className="px-6 sm:px-8 py-16 lg:py-24">
        <div className="container-hp max-w-xl">
          {phase !== "done" && (
            <div className="mb-8" aria-hidden="true">
              <div className="h-1 bg-border w-full"><div className="h-1 bg-accent transition-all" style={{ width: `${progressPct}%` }} /></div>
              <p className="text-[12px] uppercase tracking-[0.16em] text-navy-400 mt-2">Etapa {stepNumber} de {total}</p>
            </div>
          )}

          {phase === "contact" && (
            <form onSubmit={submitContact} noValidate>
              <p className="eyebrow">{JOURNEY_LABEL[journey]}</p>
              <h1 className="font-display text-3xl sm:text-4xl text-navy-900 mt-4">{title}</h1>
              <p className="text-navy-400 mt-4">{intro}</p>
              <div className="mt-8 space-y-4">
                <input type="text" name="website" ref={honeypotRef} tabIndex={-1} autoComplete="off" className="hidden" aria-hidden="true" />
                <div><label htmlFor="q-name" className="block text-sm text-navy-700 mb-1.5">Como podemos chamar você?</label>
                  <input id="q-name" value={name} onChange={(e) => setName(e.target.value)} className="hp-input" autoComplete="name" required /></div>
                <div><label htmlFor="q-email" className="block text-sm text-navy-700 mb-1.5">Qual é seu e-mail?</label>
                  <input id="q-email" type="email" value={email} onChange={(e) => setEmail(e.target.value)} className="hp-input" autoComplete="email" required /></div>
                <div><label htmlFor="q-phone" className="block text-sm text-navy-700 mb-1.5">Qual é seu WhatsApp com DDD?</label>
                  <input id="q-phone" type="tel" value={phone} onChange={(e) => setPhone(e.target.value)} className="hp-input" placeholder="(11) 99999-9999" autoComplete="tel" required /></div>
                <label className="flex items-start gap-2.5 text-[13px] text-navy-400 pt-2">
                  <input type="checkbox" checked={contactOk} onChange={(e) => setContactOk(e.target.checked)} className="mt-0.5" required />
                  <span>{CONTACT_CONSENT_TEXT}</span>
                </label>
              </div>
              {error && <p role="alert" className="text-sm text-red-600 mt-4">{error}</p>}
              <button type="submit" disabled={busy} className="mt-8 inline-flex items-center gap-2 bg-accent text-accent-foreground text-[13px] uppercase tracking-[0.16em] px-8 py-4 hover:opacity-90 transition-opacity disabled:opacity-50">
                {busy && <Loader2 className="w-4 h-4 animate-spin" aria-hidden="true" />}Continuar
              </button>
            </form>
          )}

          {phase === "location" && (
            <form onSubmit={submitLocation} noValidate>
              <h2 className="font-display text-2xl sm:text-3xl text-navy-900">Em qual cidade e estado {journey === "atendimento" ? "você busca atendimento" : "você atua"}?</h2>
              <div className="mt-8 grid sm:grid-cols-[2fr_1fr] gap-4">
                <div><label htmlFor="q-city" className="block text-sm text-navy-700 mb-1.5">Cidade</label>
                  <input id="q-city" value={city} onChange={(e) => setCity(e.target.value)} className="hp-input" required /></div>
                <div><label htmlFor="q-uf" className="block text-sm text-navy-700 mb-1.5">UF</label>
                  <select id="q-uf" value={uf} onChange={(e) => setUf(e.target.value)} className="hp-input" required>
                    <option value="">…</option>{UF_LIST.map((u) => <option key={u} value={u}>{u}</option>)}
                  </select></div>
              </div>
              {error && <p role="alert" className="text-sm text-red-600 mt-4">{error}</p>}
              <button type="submit" disabled={busy} className="mt-8 inline-flex items-center gap-2 bg-accent text-accent-foreground text-[13px] uppercase tracking-[0.16em] px-8 py-4 hover:opacity-90 transition-opacity disabled:opacity-50">
                {busy && <Loader2 className="w-4 h-4 animate-spin" aria-hidden="true" />}Continuar
              </button>
            </form>
          )}

          {phase === "health-consent" && (
            <div>
              <h2 className="font-display text-2xl sm:text-3xl text-navy-900">Antes de continuar</h2>
              <p className="text-navy-400 mt-4">{HEALTH_CONSENT_TEXT}</p>
              {error && <p role="alert" className="text-sm text-red-600 mt-4">{error}</p>}
              <button type="button" onClick={acceptHealthConsent} disabled={busy} className="mt-8 inline-flex items-center gap-2 bg-accent text-accent-foreground text-[13px] uppercase tracking-[0.16em] px-8 py-4 hover:opacity-90 transition-opacity disabled:opacity-50">
                {busy && <Loader2 className="w-4 h-4 animate-spin" aria-hidden="true" />}Concordo, continuar
              </button>
            </div>
          )}

          {phase === "question" && currentQuestion && (
            <QuestionStep key={currentQuestion.key} q={currentQuestion} busy={busy} error={error} onAnswer={saveAnswer} />
          )}

          {phase === "marketing" && (
            <div>
              <h2 className="font-display text-2xl sm:text-3xl text-navy-900">Quase lá</h2>
              {journey === "atendimento" && (
                <p className="text-[13px] text-navy-400 mt-4">
                  O plano de atendimento sempre depende de uma avaliação individual — não prometemos cura, eliminação
                  da dor ou resultado garantido.
                </p>
              )}
              <label className="flex items-start gap-2.5 text-[13px] text-navy-400 mt-6">
                <input type="checkbox" checked={marketingOk} onChange={(e) => setMarketingOk(e.target.checked)} className="mt-0.5" />
                <span>{MARKETING_CONSENT_TEXT}</span>
              </label>
              {error && <p role="alert" className="text-sm text-red-600 mt-4">{error}</p>}
              <button type="button" onClick={finish} disabled={busy} className="mt-8 inline-flex items-center gap-2 bg-accent text-accent-foreground text-[13px] uppercase tracking-[0.16em] px-8 py-4 hover:opacity-90 transition-opacity disabled:opacity-50">
                {busy && <Loader2 className="w-4 h-4 animate-spin" aria-hidden="true" />}Concluir
              </button>
            </div>
          )}

          {phase === "sending" && (
            <p role="status" className="text-navy-400 flex items-center gap-2"><Loader2 className="w-4 h-4 animate-spin" aria-hidden="true" />Enviando…</p>
          )}

          {phase === "done" && protocol && (
            <WhatsAppHandoff
              journey={journey} firstName={firstName} message={message} waNumber={waNumber} protocol={protocol}
              includeHealth={includeHealth} setIncludeHealth={setIncludeHealth} includeBudget={includeBudget} setIncludeBudget={setIncludeBudget}
              waCopied={waCopied} setWaCopied={setWaCopied} waClicked={waClicked} setWaClicked={setWaClicked} leadId={leadId}
            />
          )}
        </div>
      </main>
      <Footer />
    </div>
  );
};

const QuestionStep = ({ q, busy, error, onAnswer }: { q: Question; busy: boolean; error: string | null; onAnswer: (key: string, v: AnswerValue) => void }) => {
  const [value, setValue] = useState<string | null>(null);
  const [detalhe, setDetalhe] = useState("");
  const [multi, setMulti] = useState<string[]>([]);

  const submit = (e: FormEvent) => {
    e.preventDefault();
    if (q.kind === "multi") {
      if (multi.length === 0) return;
      const label = multi.map((v) => q.options?.find((o) => o.value === v)?.label ?? v).join(", ");
      onAnswer(q.key, { value: multi, label });
      return;
    }
    if (value === null) return;
    const label = q.kind === "scale" ? value : q.options?.find((o) => o.value === value)?.label ?? value;
    onAnswer(q.key, { value, label, ...(q.kind === "options-other" && value === (q.options?.at(-1)?.value) ? { detalhe: detalhe.trim() || undefined } : {}) });
  };

  const toggleMulti = (v: string) => {
    setMulti((cur) => {
      if (q.exclusiveValue && v === q.exclusiveValue) return cur.includes(v) ? [] : [v];
      const withoutExclusive = q.exclusiveValue ? cur.filter((x) => x !== q.exclusiveValue) : cur;
      return withoutExclusive.includes(v) ? withoutExclusive.filter((x) => x !== v) : [...withoutExclusive, v];
    });
  };

  return (
    <form onSubmit={submit} noValidate>
      <h2 className="font-display text-2xl sm:text-3xl text-navy-900">{q.question}</h2>

      {q.kind === "scale" && (
        <div className="mt-8">
          <div className="flex flex-wrap gap-2" role="radiogroup" aria-label={q.question}>
            {Array.from({ length: 11 }, (_, i) => i).map((n) => (
              <button type="button" key={n} role="radio" aria-checked={value === String(n)} onClick={() => setValue(String(n))}
                className={`h-11 w-11 border text-sm transition-colors ${value === String(n) ? "bg-accent text-accent-foreground border-accent" : "border-border text-navy-700 hover:border-accent"}`}>
                {n}
              </button>
            ))}
          </div>
          <div className="flex justify-between text-[12px] text-navy-400 mt-2 max-w-[26rem]"><span>0 = nenhum</span><span>10 = máximo</span></div>
        </div>
      )}

      {(q.kind === "options" || q.kind === "options-other") && (
        <div className="mt-8 grid gap-2.5" role="radiogroup" aria-label={q.question}>
          {q.options?.map((o) => (
            <button type="button" key={o.value} role="radio" aria-checked={value === o.value} onClick={() => setValue(o.value)}
              className={`text-left px-5 py-3.5 border text-[15px] transition-colors ${value === o.value ? "border-accent bg-accent/10 text-navy-900" : "border-border text-navy-700 hover:border-accent/60"}`}>
              {o.label}
            </button>
          ))}
          {q.kind === "options-other" && value === q.options?.at(-1)?.value && (
            <input value={detalhe} onChange={(e) => setDetalhe(e.target.value)} maxLength={200} placeholder="Complemento (opcional)" className="hp-input mt-1" />
          )}
        </div>
      )}

      {q.kind === "multi" && (
        <div className="mt-8 grid gap-2.5">
          {q.options?.map((o) => (
            <label key={o.value} className={`flex items-center gap-3 px-5 py-3.5 border text-[15px] cursor-pointer transition-colors ${multi.includes(o.value) ? "border-accent bg-accent/10 text-navy-900" : "border-border text-navy-700 hover:border-accent/60"}`}>
              <input type="checkbox" checked={multi.includes(o.value)} onChange={() => toggleMulti(o.value)} className="shrink-0" />
              {o.label}
            </label>
          ))}
        </div>
      )}

      {error && <p role="alert" className="text-sm text-red-600 mt-4">{error}</p>}
      <button type="submit" disabled={busy || (q.kind === "multi" ? multi.length === 0 : value === null)}
        className="mt-8 inline-flex items-center gap-2 bg-accent text-accent-foreground text-[13px] uppercase tracking-[0.16em] px-8 py-4 hover:opacity-90 transition-opacity disabled:opacity-40">
        {busy && <Loader2 className="w-4 h-4 animate-spin" aria-hidden="true" />}Continuar
      </button>
    </form>
  );
};

interface HandoffProps {
  journey: Journey; firstName: string; message: string; waNumber: string | null | undefined; protocol: string;
  includeHealth: boolean; setIncludeHealth: (v: boolean) => void; includeBudget: boolean; setIncludeBudget: (v: boolean) => void;
  waCopied: boolean; setWaCopied: (v: boolean) => void; waClicked: boolean; setWaClicked: (v: boolean) => void; leadId: string | null;
}

const WhatsAppHandoff = ({ journey, firstName, message, waNumber, protocol, includeHealth, setIncludeHealth, includeBudget, setIncludeBudget, waCopied, setWaCopied, waClicked, setWaClicked, leadId }: HandoffProps) => {
  const copy = async () => { try { await navigator.clipboard.writeText(message); setWaCopied(true); setTimeout(() => setWaCopied(false), 2500); } catch { /* área de transferência indisponível — usuário pode selecionar o texto manualmente */ } };
  const openWhatsApp = async () => {
    setWaClicked(true);
    if (leadId) { try { await supabase.rpc("quiz_log_whatsapp_click", { p_id: leadId }); } catch { /* clique é best-effort: não bloqueia a experiência */ } }
    if (waNumber) window.open(waLink(waNumber, message), "_blank", "noopener,noreferrer");
  };
  return (
    <div>
      <h2 className="font-display text-2xl sm:text-3xl text-navy-900">Recebemos suas respostas, {firstName}.</h2>
      <p className="text-navy-400 mt-3">Se preferir, continue agora pelo WhatsApp.</p>
      <p className="text-[12px] uppercase tracking-[0.16em] text-navy-400 mt-6">Protocolo {protocol}</p>

      {journey === "atendimento" && (
        <label className="flex items-start gap-2.5 text-[13px] text-navy-400 mt-6">
          <input type="checkbox" checked={includeHealth} onChange={(e) => setIncludeHealth(e.target.checked)} className="mt-0.5" />
          <span>Incluir minhas respostas sobre dor e qualidade de vida nesta mensagem.</span>
        </label>
      )}
      {journey === "atendimento" && (
        <label className="flex items-start gap-2.5 text-[13px] text-navy-400 mt-3">
          <input type="checkbox" checked={includeBudget} onChange={(e) => setIncludeBudget(e.target.checked)} className="mt-0.5" />
          <span>Incluir a faixa de investimento que considerei.</span>
        </label>
      )}

      <div className="mt-6"><label htmlFor="wa-preview" className="block text-sm text-navy-700 mb-1.5">Prévia da mensagem (você pode editar)</label>
        <textarea id="wa-preview" value={message} readOnly rows={9} className="hp-input font-mono text-[13px] leading-relaxed" /></div>

      <div className="flex flex-wrap gap-3 mt-6">
        {waNumber ? (
          <button type="button" onClick={openWhatsApp} className="inline-flex items-center gap-2 bg-accent text-accent-foreground text-[13px] uppercase tracking-[0.16em] px-8 py-4 hover:opacity-90 transition-opacity">
            <MessageCircle className="w-4 h-4" aria-hidden="true" />Continuar pelo WhatsApp
          </button>
        ) : (
          <p className="text-sm text-navy-400 border border-border px-5 py-3.5">Seus dados foram salvos. O contato pelo WhatsApp será feito pela nossa equipe em breve.</p>
        )}
        <button type="button" onClick={copy} className="inline-flex items-center gap-2 border border-border text-navy-700 text-[13px] uppercase tracking-[0.16em] px-8 py-4 hover:border-accent transition-colors">
          {waCopied ? <Check className="w-4 h-4" aria-hidden="true" /> : <Copy className="w-4 h-4" aria-hidden="true" />}{waCopied ? "Copiado" : "Copiar mensagem"}
        </button>
      </div>
      {waClicked && <p className="text-[12px] text-navy-400 mt-3">Conversa aberta no WhatsApp — confirme o envio por lá.</p>}
    </div>
  );
};

export default QuizRunner;
