import { useEffect, useMemo, useRef, useState, type FormEvent } from "react";
import { useLocation, useSearchParams } from "react-router-dom";
import { ArrowLeft, ArrowRight, Check, CheckCircle2, Clock, Copy, Info, Loader2, MessageCircle, ShieldCheck, Users } from "lucide-react";
import Header from "@/components/Header";
import Footer from "@/components/Footer";
import { supabase } from "@/lib/supabase";
import {
  CONTACT_CONSENT_TEXT, CONTACT_CONSENT_VERSION, HEALTH_CONSENT_TEXT, HEALTH_CONSENT_VERSION,
  JOURNEY_LABEL, JOURNEY_QUESTIONS, MARKETING_CONSENT_TEXT, MARKETING_CONSENT_VERSION, UF_LIST, buildAtendimentoMessage,
  buildParceriaMessage, isFullName, totalSteps, visibleQuestions, waLink, type AnswerMap, type Journey, type Question,
} from "@/lib/quiz";

type AnswerValue = AnswerMap[string];
type Phase = "contact" | "location" | "health-consent" | "question" | "marketing" | "sending" | "done" | "error";

interface Props { journey: Journey; title: string; intro: string; pageSlug: string }

const errText = (e: unknown) => (e instanceof Error ? e.message : "Não foi possível concluir. Tente novamente em instantes.");

const BENEFITS: Record<Journey, { icon: typeof Clock; text: string }[]> = {
  atendimento: [
    { icon: Clock, text: "Leva cerca de 2 minutos." },
    { icon: ShieldCheck, text: "Seus dados ficam protegidos e visíveis só para a equipe autorizada." },
    { icon: Users, text: "Sem compromisso: o plano de atendimento depende de uma avaliação individual." },
  ],
  parceria: [
    { icon: Clock, text: "Leva cerca de 2 minutos." },
    { icon: ShieldCheck, text: "Aprovação e verificação profissional acontecem depois, em um processo separado." },
    { icon: Users, text: "Rede nacional de fisioterapia domiciliar, com padrão clínico definido." },
  ],
};

const PRIMARY_BTN = "inline-flex items-center justify-center gap-2 bg-accent text-accent-foreground text-[13px] uppercase tracking-[0.16em] px-8 py-4 hover:opacity-90 transition-opacity disabled:opacity-40 w-full sm:w-auto";

const QuizRunner = ({ journey, title, intro, pageSlug }: Props) => {
  const [params] = useSearchParams();
  const { pathname } = useLocation();
  const questions = JOURNEY_QUESTIONS[journey];

  const [phase, setPhase] = useState<Phase>("contact");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [leadId, setLeadId] = useState<string | null>(null);
  const [qKey, setQKey] = useState<string>(questions[0].key); // pergunta atual

  // etapa 1
  const [name, setName] = useState(""); const [email, setEmail] = useState(""); const [phone, setPhone] = useState("");
  const [contactOk, setContactOk] = useState(false);
  const honeypotRef = useRef<HTMLInputElement>(null);

  // etapa 2
  const [city, setCity] = useState(""); const [uf, setUf] = useState("");

  // respostas guardadas só em memória (nunca em localStorage — algumas são dado de saúde)
  const [answers, setAnswers] = useState<AnswerMap>({});
  const [marketingOk, setMarketingOk] = useState(false);

  // conclusão / WhatsApp
  const [protocol, setProtocol] = useState<string | null>(null);
  const [firstName, setFirstName] = useState<string>("");
  const [waNumber, setWaNumber] = useState<string | null | undefined>(undefined);
  const [includeHealth, setIncludeHealth] = useState(false);
  const [includeBudget, setIncludeBudget] = useState(false);
  const [waCopied, setWaCopied] = useState(false);
  const [waClicked, setWaClicked] = useState(false);

  const visible = useMemo(() => visibleQuestions(journey, answers), [journey, answers]);
  const total = totalSteps(journey, answers);
  const qPos = Math.max(0, visible.findIndex((q) => q.key === qKey));
  const currentQuestion: Question | undefined = questions.find((q) => q.key === qKey);
  const stepNumber = phase === "contact" ? 1 : phase === "location" || phase === "health-consent" ? 2 : phase === "question" ? 3 + qPos : total;

  useEffect(() => { document.title = `${title} | HP Group`; }, [title]);

  const utm = useMemo(() => {
    const o: Record<string, string> = {};
    ["utm_source", "utm_medium", "utm_campaign", "utm_content", "utm_term", "ref"].forEach((k) => { const v = params.get(k); if (v) o[k] = v; });
    return o;
  }, [params]);
  // `from` = a landing page de origem (registrada pelo CTA que trouxe o visitante até aqui); sem ela,
  // cai no comportamento anterior (rota do próprio quiz).
  const fromPage = params.get("from");

  const submitContact = async (e: FormEvent) => {
    e.preventDefault(); setError(null);
    if (!isFullName(name)) return setError("Informe seu nome completo (nome e sobrenome).");
    if (!/^[^@\s]+@[^@\s]+\.[^@\s]+$/.test(email.trim())) return setError("Informe um e-mail válido.");
    if (phone.replace(/\D/g, "").length < 10) return setError("Informe um WhatsApp válido, com DDD.");
    if (!contactOk) return setError("Autorize o contato para continuar.");
    setBusy(true);
    try {
      const { data, error: rpcError } = await supabase.rpc("quiz_start", {
        p_journey: journey, p_name: name.trim(), p_email: email.trim(), p_phone: phone,
        p_contact_consent_version: CONTACT_CONSENT_VERSION,
        p_origin_path: fromPage || pathname, p_page_slug: fromPage ? (fromPage.replace(/^\//, "") || "home") : pageSlug,
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
      setQKey(visible[0].key);
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
      const { error: rpcError } = await supabase.rpc("quiz_save_progress", { p_id: leadId, p_step: 4 + qPos + 1, p_answers: { [key]: value } });
      if (rpcError) throw rpcError;
      const next = { ...answers, [key]: value };
      setAnswers(next);
      const list = visibleQuestions(journey, next); const at = list.findIndex((q) => q.key === key);
      if (at >= 0 && at + 1 < list.length) setQKey(list[at + 1].key); else setPhase("marketing");
    } catch (err) { setError(errText(err)); } finally { setBusy(false); }
  };

  // Voltar: reabre a etapa anterior com a resposta já dada (a etapa de contato não volta: o cadastro já foi gravado).
  const canGoBack = phase === "question" || phase === "marketing" || phase === "health-consent";
  const goBack = () => {
    setError(null);
    if (phase === "marketing") { setQKey(visible[visible.length - 1].key); setPhase("question"); return; }
    if (phase === "health-consent") { setPhase("location"); return; }
    if (qPos > 0) { setQKey(visible[qPos - 1].key); return; }
    setPhase(journey === "atendimento" ? "health-consent" : "location");
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
      answers.area_atuacao?.label ?? null, answers.modelo_atendimento?.label ?? null, objetivos, interesses,
      answers.interesse_programa_clinica?.label ?? null, answers.prazo_programa_clinica?.label ?? null);
  }, [protocol, firstName, name, email, phone, city, uf, journey, answers, includeHealth, includeBudget]);

  const progressPct = Math.round((stepNumber / total) * 100);
  const stepKey = phase === "question" ? `q-${qKey}` : phase;

  return (
    <div className="min-h-screen">
      <Header />
      <main className="px-5 sm:px-8 py-10 lg:py-16">
        <div className="container-hp max-w-5xl">
          {phase === "done" && protocol ? (
            <WhatsAppHandoff
              journey={journey} firstName={firstName} message={message} waNumber={waNumber} protocol={protocol}
              includeHealth={includeHealth} setIncludeHealth={setIncludeHealth} includeBudget={includeBudget} setIncludeBudget={setIncludeBudget}
              waCopied={waCopied} setWaCopied={setWaCopied} waClicked={waClicked} setWaClicked={setWaClicked} leadId={leadId}
            />
          ) : (
            <div className="grid lg:grid-cols-[minmax(0,5fr)_minmax(0,7fr)] gap-8 lg:gap-14 items-start">
              <aside className={`lg:sticky lg:top-28 ${phase === "contact" ? "" : "hidden lg:block"}`}>
                <p className="eyebrow">{JOURNEY_LABEL[journey]}</p>
                <h1 className="font-display text-3xl sm:text-4xl lg:text-[2.6rem] leading-[1.15] text-navy-900 mt-4">{title}</h1>
                <p className="text-navy-400 mt-4">{intro}</p>
                <ul className="mt-8 space-y-4 hidden lg:block">
                  {BENEFITS[journey].map(({ icon: Icon, text }) => (
                    <li key={text} className="flex items-start gap-3 text-[14px] text-navy-700">
                      <span className="grid place-items-center h-8 w-8 shrink-0 rounded-full bg-accent/10 text-accent"><Icon className="w-4 h-4" aria-hidden="true" strokeWidth={1.75} /></span>
                      <span className="pt-1">{text}</span>
                    </li>
                  ))}
                </ul>
              </aside>

              <section className="border border-border bg-card shadow-sm p-6 sm:p-10" aria-label="Formulário">
                <div className="mb-8">
                  <div className="flex items-center justify-between min-h-6">
                    {canGoBack ? (
                      <button type="button" onClick={goBack} disabled={busy} className="inline-flex items-center gap-1.5 text-[13px] text-navy-400 hover:text-navy-900 transition-colors disabled:opacity-40">
                        <ArrowLeft className="w-4 h-4" aria-hidden="true" />Voltar
                      </button>
                    ) : <span />}
                    {phase !== "sending" && <p className="text-[12px] uppercase tracking-[0.16em] text-navy-400">Etapa {stepNumber} de {total}</p>}
                  </div>
                  <div className="h-1.5 bg-muted mt-3 overflow-hidden rounded-full" role="progressbar" aria-valuemin={0} aria-valuemax={100} aria-valuenow={progressPct} aria-label="Progresso do formulário">
                    <div className="h-full bg-accent rounded-full transition-all duration-500" style={{ width: `${progressPct}%` }} />
                  </div>
                </div>

                <div key={stepKey} className="animate-in fade-in slide-in-from-right-3 duration-300">
                  {phase === "contact" && (
                    <form onSubmit={submitContact} noValidate>
                      <h2 className="font-display text-2xl sm:text-3xl text-navy-900">Primeiro, seus dados de contato</h2>
                      <p className="text-[14px] text-navy-400 mt-2">Assim a nossa equipe sabe com quem falar.</p>
                      <div className="mt-8 space-y-5">
                        <input type="text" name="website" ref={honeypotRef} tabIndex={-1} autoComplete="off" className="hidden" aria-hidden="true" />
                        <div><label htmlFor="q-name" className="block text-sm text-navy-700 mb-1.5">Nome completo</label>
                          <input id="q-name" value={name} onChange={(e) => setName(e.target.value)} className="hp-input" autoComplete="name" placeholder="Nome e sobrenome" required autoFocus /></div>
                        <div><label htmlFor="q-email" className="block text-sm text-navy-700 mb-1.5">E-mail</label>
                          <input id="q-email" type="email" value={email} onChange={(e) => setEmail(e.target.value)} className="hp-input" autoComplete="email" placeholder="voce@email.com" required /></div>
                        <div><label htmlFor="q-phone" className="block text-sm text-navy-700 mb-1.5">WhatsApp com DDD</label>
                          <input id="q-phone" type="tel" value={phone} onChange={(e) => setPhone(e.target.value)} className="hp-input" placeholder="(11) 99999-9999" autoComplete="tel" required /></div>
                        <label className="flex items-start gap-3 text-[13px] text-navy-400 pt-1 cursor-pointer">
                          <input type="checkbox" checked={contactOk} onChange={(e) => setContactOk(e.target.checked)} className="mt-0.5 accent-accent" required />
                          <span>{CONTACT_CONSENT_TEXT}</span>
                        </label>
                      </div>
                      {error && <p role="alert" className="text-sm text-red-600 mt-4">{error}</p>}
                      <button type="submit" disabled={busy} className={`${PRIMARY_BTN} mt-8`}>
                        {busy ? <Loader2 className="w-4 h-4 animate-spin" aria-hidden="true" /> : null}Continuar{!busy && <ArrowRight className="w-4 h-4" aria-hidden="true" />}
                      </button>
                    </form>
                  )}

                  {phase === "location" && (
                    <form onSubmit={submitLocation} noValidate>
                      <h2 className="font-display text-2xl sm:text-3xl text-navy-900">Em qual cidade e estado {journey === "atendimento" ? "você busca atendimento" : "você atua"}?</h2>
                      <div className="mt-8 grid sm:grid-cols-[2fr_1fr] gap-4">
                        <div><label htmlFor="q-city" className="block text-sm text-navy-700 mb-1.5">Cidade</label>
                          <input id="q-city" value={city} onChange={(e) => setCity(e.target.value)} className="hp-input" required autoFocus /></div>
                        <div><label htmlFor="q-uf" className="block text-sm text-navy-700 mb-1.5">UF</label>
                          <select id="q-uf" value={uf} onChange={(e) => setUf(e.target.value)} className="hp-input" required>
                            <option value="">…</option>{UF_LIST.map((u) => <option key={u} value={u}>{u}</option>)}
                          </select></div>
                      </div>
                      {error && <p role="alert" className="text-sm text-red-600 mt-4">{error}</p>}
                      <button type="submit" disabled={busy} className={`${PRIMARY_BTN} mt-8`}>
                        {busy ? <Loader2 className="w-4 h-4 animate-spin" aria-hidden="true" /> : null}Continuar{!busy && <ArrowRight className="w-4 h-4" aria-hidden="true" />}
                      </button>
                    </form>
                  )}

                  {phase === "health-consent" && (
                    <div>
                      <h2 className="font-display text-2xl sm:text-3xl text-navy-900">Antes de continuar</h2>
                      <div className="mt-5 border-l-2 border-accent bg-muted/50 px-5 py-4 flex gap-3">
                        <ShieldCheck className="w-5 h-5 text-accent shrink-0 mt-0.5" aria-hidden="true" strokeWidth={1.75} />
                        <p className="text-[14px] text-navy-700">{HEALTH_CONSENT_TEXT}</p>
                      </div>
                      {error && <p role="alert" className="text-sm text-red-600 mt-4">{error}</p>}
                      <button type="button" onClick={acceptHealthConsent} disabled={busy} className={`${PRIMARY_BTN} mt-8`}>
                        {busy && <Loader2 className="w-4 h-4 animate-spin" aria-hidden="true" />}Concordo, continuar
                      </button>
                    </div>
                  )}

                  {phase === "question" && currentQuestion && (
                    <QuestionStep key={currentQuestion.key} q={currentQuestion} initial={answers[currentQuestion.key]} busy={busy} error={error} onAnswer={saveAnswer} />
                  )}

                  {phase === "marketing" && (
                    <div>
                      <h2 className="font-display text-2xl sm:text-3xl text-navy-900">Quase lá</h2>
                      {journey === "atendimento" && (
                        <p className="text-[14px] text-navy-400 mt-4">
                          O plano de atendimento sempre depende de uma avaliação individual — não prometemos cura, eliminação
                          da dor ou resultado garantido.
                        </p>
                      )}
                      <label className="flex items-start gap-3 text-[13px] text-navy-400 mt-6 cursor-pointer">
                        <input type="checkbox" checked={marketingOk} onChange={(e) => setMarketingOk(e.target.checked)} className="mt-0.5 accent-accent" />
                        <span>{MARKETING_CONSENT_TEXT}</span>
                      </label>
                      {error && <p role="alert" className="text-sm text-red-600 mt-4">{error}</p>}
                      <button type="button" onClick={finish} disabled={busy} className={`${PRIMARY_BTN} mt-8`}>
                        {busy && <Loader2 className="w-4 h-4 animate-spin" aria-hidden="true" />}Concluir
                      </button>
                    </div>
                  )}

                  {phase === "sending" && (
                    <p role="status" className="text-navy-400 flex items-center gap-2"><Loader2 className="w-4 h-4 animate-spin" aria-hidden="true" />Enviando…</p>
                  )}
                </div>
              </section>
            </div>
          )}
        </div>
      </main>
      <Footer highlightJourney={journey} showCta={false} />
    </div>
  );
};

const ContinueButton = ({ busy, disabled }: { busy: boolean; disabled: boolean }) => (
  <button type="submit" disabled={busy || disabled} className={`${PRIMARY_BTN} mt-8`}>
    {busy ? <Loader2 className="w-4 h-4 animate-spin" aria-hidden="true" /> : null}Continuar{!busy && <ArrowRight className="w-4 h-4" aria-hidden="true" />}
  </button>
);

const Choice = ({ selected, label, onClick }: { selected: boolean; label: string; onClick: () => void }) => (
  <button type="button" role="radio" aria-checked={selected} onClick={onClick}
    className={`flex w-full items-center gap-4 text-left px-5 py-4 border text-[15px] transition-all ${selected ? "border-accent bg-accent/10 text-navy-900 shadow-sm" : "border-border text-navy-700 hover:border-accent/60 hover:bg-muted/40"}`}>
    <span aria-hidden="true" className={`grid place-items-center h-5 w-5 shrink-0 rounded-full border transition-colors ${selected ? "border-accent bg-accent text-accent-foreground" : "border-navy-400/40"}`}>
      {selected && <Check className="w-3 h-3" strokeWidth={3} />}
    </span>
    <span>{label}</span>
  </button>
);

const QuestionStep = ({ q, initial, busy, error, onAnswer }: { q: Question; initial?: AnswerValue; busy: boolean; error: string | null; onAnswer: (key: string, v: AnswerValue) => void }) => {
  const [value, setValue] = useState<string | null>(typeof initial?.value === "string" ? initial.value : null);
  const [detalhe, setDetalhe] = useState(initial?.detalhe ?? "");
  const [multi, setMulti] = useState<string[]>(Array.isArray(initial?.value) ? initial.value : []);

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
      <h2 className="font-display text-2xl sm:text-3xl text-navy-900 leading-snug">{q.question}</h2>

      {(q.intro || q.bullets || q.note) && (
        <div className="mt-5 border-l-2 border-accent bg-muted/50 px-5 py-4 space-y-3" data-testid="quiz-explicacao">
          {q.intro && <p className="text-[14px] leading-relaxed text-navy-700">{q.intro}</p>}
          {q.bullets && (
            <ul className="space-y-2">
              {q.bullets.map((b) => (
                <li key={b} className="flex items-start gap-2.5 text-[14px] text-navy-700">
                  <Check className="w-4 h-4 text-accent shrink-0 mt-0.5" aria-hidden="true" strokeWidth={2.25} />{b}
                </li>
              ))}
            </ul>
          )}
          {q.note && <p className="flex items-start gap-2 text-[12px] leading-relaxed text-navy-400"><Info className="w-3.5 h-3.5 shrink-0 mt-0.5" aria-hidden="true" />{q.note}</p>}
        </div>
      )}

      {q.kind === "scale" && (
        <div className="mt-8">
          <div className="grid grid-cols-11 gap-1" role="radiogroup" aria-label={q.question}>
            {Array.from({ length: 11 }, (_, i) => i).map((n) => {
              const sel = value === String(n);
              return (
                <button type="button" key={n} role="radio" aria-checked={sel} onClick={() => setValue(String(n))}
                  style={sel ? undefined : { backgroundColor: `hsl(var(--accent) / ${0.04 + n * 0.035})` }}
                  className={`h-12 min-w-0 border text-sm font-medium transition-all ${sel ? "bg-accent text-accent-foreground border-accent scale-110 shadow-md z-10" : "border-border text-navy-700 hover:border-accent"}`}>
                  {n}
                </button>
              );
            })}
          </div>
          <div className="flex justify-between text-[12px] text-navy-400 mt-3"><span>0 = nenhum</span><span>10 = máximo</span></div>
        </div>
      )}

      {(q.kind === "options" || q.kind === "options-other") && (
        <div className="mt-8 grid gap-2.5" role="radiogroup" aria-label={q.question}>
          {q.options?.map((o) => <Choice key={o.value} selected={value === o.value} label={o.label} onClick={() => setValue(o.value)} />)}
          {q.kind === "options-other" && value === q.options?.at(-1)?.value && (
            <input value={detalhe} onChange={(e) => setDetalhe(e.target.value)} maxLength={200} placeholder="Complemento (opcional)" className="hp-input mt-1" />
          )}
        </div>
      )}

      {q.kind === "multi" && (
        <div className="mt-8 grid gap-2.5">
          <p className="text-[12px] text-navy-400 -mb-1">Você pode marcar mais de uma opção.</p>
          {q.options?.map((o) => (
            <label key={o.value} className={`flex items-center gap-4 px-5 py-4 border text-[15px] cursor-pointer transition-all ${multi.includes(o.value) ? "border-accent bg-accent/10 text-navy-900 shadow-sm" : "border-border text-navy-700 hover:border-accent/60 hover:bg-muted/40"}`}>
              <input type="checkbox" checked={multi.includes(o.value)} onChange={() => toggleMulti(o.value)} className="shrink-0 h-4 w-4 accent-accent" />
              {o.label}
            </label>
          ))}
        </div>
      )}

      {error && <p role="alert" className="text-sm text-red-600 mt-4">{error}</p>}
      <ContinueButton busy={busy} disabled={q.kind === "multi" ? multi.length === 0 : value === null} />
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
    <div className="mx-auto max-w-2xl border border-border bg-card shadow-sm p-6 sm:p-10 animate-in fade-in slide-in-from-bottom-3 duration-300">
      <div className="flex items-center gap-4">
        <span className="grid place-items-center h-12 w-12 shrink-0 rounded-full bg-accent/10 text-accent"><CheckCircle2 className="w-7 h-7" aria-hidden="true" strokeWidth={1.75} /></span>
        <div>
          <h2 className="font-display text-2xl sm:text-3xl text-navy-900">Recebemos suas respostas, {firstName}.</h2>
          <p className="text-navy-400 mt-1">
            {journey === "atendimento" ? "Nossa equipe entra em contato pelo WhatsApp informado. Se preferir, continue agora." : "A aprovação e a verificação profissional acontecem depois, em um processo separado. Se preferir, continue agora pelo WhatsApp."}
          </p>
        </div>
      </div>
      <p className="inline-block text-[12px] uppercase tracking-[0.16em] text-navy-400 border border-border px-3 py-1.5 mt-6">Protocolo {protocol}</p>

      {journey === "atendimento" && (
        <label className="flex items-start gap-3 text-[13px] text-navy-400 mt-6 cursor-pointer">
          <input type="checkbox" checked={includeHealth} onChange={(e) => setIncludeHealth(e.target.checked)} className="mt-0.5 accent-accent" />
          <span>Incluir minhas respostas sobre dor e qualidade de vida nesta mensagem.</span>
        </label>
      )}
      {journey === "atendimento" && (
        <label className="flex items-start gap-3 text-[13px] text-navy-400 mt-3 cursor-pointer">
          <input type="checkbox" checked={includeBudget} onChange={(e) => setIncludeBudget(e.target.checked)} className="mt-0.5 accent-accent" />
          <span>Incluir a faixa de investimento que considerei.</span>
        </label>
      )}

      <div className="mt-6"><label htmlFor="wa-preview" className="block text-sm text-navy-700 mb-1.5">Prévia da mensagem (você pode editar)</label>
        <textarea id="wa-preview" value={message} readOnly rows={9} className="hp-input font-mono text-[13px] leading-relaxed" /></div>

      <div className="flex flex-col sm:flex-row flex-wrap gap-3 mt-6">
        {waNumber ? (
          <button type="button" onClick={openWhatsApp} className={PRIMARY_BTN}>
            <MessageCircle className="w-4 h-4" aria-hidden="true" />Continuar pelo WhatsApp
          </button>
        ) : (
          <p className="text-sm text-navy-400 border border-border px-5 py-3.5">Seus dados foram salvos. O contato pelo WhatsApp será feito pela nossa equipe em breve.</p>
        )}
        <button type="button" onClick={copy} className="inline-flex items-center justify-center gap-2 border border-border text-navy-700 text-[13px] uppercase tracking-[0.16em] px-8 py-4 hover:border-accent transition-colors w-full sm:w-auto">
          {waCopied ? <Check className="w-4 h-4" aria-hidden="true" /> : <Copy className="w-4 h-4" aria-hidden="true" />}{waCopied ? "Copiado" : "Copiar mensagem"}
        </button>
      </div>
      {waClicked && <p className="text-[12px] text-navy-400 mt-3">Conversa aberta no WhatsApp — confirme o envio por lá.</p>}
    </div>
  );
};

export default QuizRunner;
