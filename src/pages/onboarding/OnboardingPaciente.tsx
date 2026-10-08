import { useRef, useState, type FormEvent } from "react";
import { HeartPulse, Home, ShieldCheck, TrendingUp } from "lucide-react";
import { supabase } from "@/lib/supabase";
import { isValidCpf, isValidEmail, isValidPhone, MIN_PASSWORD, onlyDigits, fmtPhone } from "@/lib/doc";
import { isFullName } from "@/lib/quiz";
import {AccessFields, ContactAddressFields, DoneScreen, Field, FormError, IdentityFields, NextButton, OnboardingFrame, StepTitle } from "./parts";
import { ONBOARDING_CONSENT_VERSION, usePageMeta, type Errors, type FormState } from "./shared";

const STEPS = ["Seus dados", "Contato e endereço", "Emergência e saúde", "Acesso"];
const HOW_FOUND = ["Indicação de amigo ou familiar", "Indicação de médico ou profissional de saúde", "Instagram / redes sociais", "Google / busca na internet", "Já sou paciente da HP", "Outro"];
const CONSENT_TEXT = "Os dados informados (incluindo CPF e endereço) serão tratados pelo HP Group para o seu cadastro, o agendamento e o acompanhamento do atendimento, e ficam visíveis apenas para a equipe autorizada e para você. " +
  "Você pode pedir a correção ou a remoção dos seus dados a qualquer momento.";
const HEALTH_TEXT = "O motivo do atendimento é dado de saúde: fica visível só para a equipe autorizada do HP Group e ajuda a preparar a sua avaliação. Não substitui uma avaliação clínica.";
const HIGHLIGHTS = ["Suas sessões: quantas já fez e quantas ainda faltam no seu pacote", "A sua evolução: dor, funcionalidade e bem-estar ao longo do tempo", "Agendar, confirmar ou cancelar atendimentos pelo próprio sistema",
  "Metas definidas com o seu fisioterapeuta e vídeos de exercícios liberados para você", "Seus dados e sua senha sempre sob o seu controle"];

const EMPTY: FormState = { full_name: "", preferred_name: "", birth_date: "", cpf: "", email: "", phone: "", cep: "", street: "", street_number: "", complement: "", neighborhood: "", city: "", state_uf: "",
  address_reference: "", emergency_name: "", emergency_relation: "", emergency_phone: "", main_complaint: "", how_found: "", password: "", password2: "" };

/** Cadastro do paciente: rota aberta. Cria o cadastro em Pessoas e o acesso ao portal (depois de confirmar o e-mail). */
const OnboardingPaciente = () => {
  usePageMeta("Cadastro de paciente | HP Fisioterapia");
  const [step, setStep] = useState(0); const [v, setV] = useState<FormState>(EMPTY);
  const [errors, setErrors] = useState<Errors>({}); const [consent, setConsent] = useState(false); const [health, setHealth] = useState(false);
  const [busy, setBusy] = useState(false); const [error, setError] = useState<string | null>(null);
  const [done, setDone] = useState<{ email: string; account: boolean } | null>(null);
  const honeypot = useRef<HTMLInputElement>(null);
  const set = (k: string, val: string) => { setV((s) => ({ ...s, [k]: val })); setErrors((e) => { if (!e[k]) return e; const n = { ...e }; delete n[k]; return n; }); };

  const validate = (): Errors => {
    const e: Errors = {};
    if (step === 0) {
      if (!isFullName(v.full_name)) e.full_name = "Informe o nome completo (nome e sobrenome).";
      if (!v.birth_date) e.birth_date = "Informe a data de nascimento.";
      else if (new Date(v.birth_date).getTime() > Date.now()) e.birth_date = "A data de nascimento não pode ser futura.";
      if (!isValidCpf(v.cpf)) e.cpf = "CPF inválido.";
    } else if (step === 1) {
      if (!isValidEmail(v.email)) e.email = "E-mail inválido.";
      if (!isValidPhone(v.phone)) e.phone = "Informe o telefone com DDD.";
      if (onlyDigits(v.cep).length !== 8) e.cep = "CEP inválido (8 números).";
      if (!v.street.trim()) e.street = "Informe a rua.";
      if (!v.street_number.trim()) e.street_number = "Informe o número (ou S/N).";
      if (!v.neighborhood.trim()) e.neighborhood = "Informe o bairro.";
      if (!v.city.trim()) e.city = "Informe a cidade.";
      if (!v.state_uf) e.state_uf = "Escolha a UF.";
    } else if (step === 2) {
      if (!v.emergency_name.trim()) e.emergency_name = "Informe o nome do contato de emergência.";
      if (!v.emergency_relation.trim()) e.emergency_relation = "Informe o parentesco ou a relação.";
      if (!isValidPhone(v.emergency_phone)) e.emergency_phone = "Informe o telefone do contato com DDD.";
      if (v.main_complaint.trim() && !health) e.health = "Para informar o motivo do atendimento, autorize o uso de dado de saúde (ou apague o texto).";
    } else {
      if (v.password.length < MIN_PASSWORD) e.password = `Use ao menos ${MIN_PASSWORD} caracteres.`;
      if (v.password !== v.password2) e.password2 = "As senhas não coincidem.";
      if (!consent) e.consent = "É preciso aceitar para concluir o cadastro.";
    }
    return e;
  };

  const submit = async (ev: FormEvent) => {
    ev.preventDefault(); if (busy) return; setError(null);
    const e = validate(); setErrors(e);
    if (Object.keys(e).length) return;
    if (step < STEPS.length - 1) { setStep(step + 1); window.scrollTo({ top: 0, behavior: "smooth" }); return; }
    setBusy(true);
    const data = { ...v, cpf: onlyDigits(v.cpf), password: undefined, password2: undefined };
    const { data: res, error: rpcError } = await supabase.rpc("onboarding_submit_patient", { p_data: data, p_consent_version: ONBOARDING_CONSENT_VERSION, p_health_consent: health && !!v.main_complaint.trim(), p_honeypot: honeypot.current?.value ?? "" });
    if (rpcError) {
      setBusy(false); const msg = rpcError.message;
      return setError(msg.includes("rate_limited") ? "Muitas tentativas. Aguarde alguns minutos e tente de novo." : /[a-záéíóúãõç]/i.test(msg) && !/violates|relation|column|syntax/i.test(msg) ? msg : "Não foi possível concluir o cadastro agora. Tente novamente em instantes.");
    }
    const email = ((res as { email?: string } | null)?.email ?? v.email).toLowerCase();
    const { error: signError } = await supabase.auth.signUp({ email, password: v.password, options: { emailRedirectTo: `${window.location.origin}/app` } });
    setBusy(false); setDone({ email, account: !signError });
  };

  const bullets = [{ icon: HeartPulse, text: "Leva cerca de 4 minutos." }, { icon: ShieldCheck, text: "Seus dados ficam protegidos e visíveis só para a equipe autorizada." }, { icon: TrendingUp, text: "Com o acesso você acompanha as suas sessões e a sua evolução." }, { icon: Home, text: "O endereço é para o atendimento em casa." }];
  if (done) return <OnboardingFrame eyebrow="Paciente HP" title="Cadastro de paciente" intro="Seu cadastro foi recebido." bullets={bullets} step={STEPS.length - 1} steps={STEPS}><DoneScreen who="paciente" email={done.email} accountCreated={done.account} highlights={HIGHLIGHTS} /></OnboardingFrame>;
  return (
    <OnboardingFrame eyebrow="Paciente HP" title="Vamos fazer o seu cadastro" intro="Com o cadastro você cria o seu login e passa a acompanhar as suas sessões, o quanto falta no seu pacote e a sua evolução." step={step} steps={STEPS} onBack={() => { setStep(step - 1); setError(null); }} bullets={bullets}>
      <form onSubmit={submit} noValidate>
        <input type="text" name="website" ref={honeypot} tabIndex={-1} autoComplete="off" className="hidden" aria-hidden="true" />
        {step === 0 && <><StepTitle title="Seus dados" hint="Como constam no seu documento." /><IdentityFields v={v} set={set} errors={errors} /></>}
        {step === 1 && <><StepTitle title="Contato e endereço" hint="O endereço é onde você será atendido(a)." /><ContactAddressFields v={v} set={set} errors={errors}
          extra={<Field id="ob-ref" label="Ponto de referência (opcional)" className="sm:col-span-6" hint="Ajuda o profissional a chegar: portão, prédio, interfone…"><input id="ob-ref" className="hp-input" value={v.address_reference} onChange={(e) => set("address_reference", e.target.value)} maxLength={160} /></Field>} /></>}
        {step === 2 && (<>
          <StepTitle title="Emergência e saúde" hint="Alguém que possamos avisar se for preciso." />
          <div className="mt-8 grid gap-5 sm:grid-cols-2">
            <Field id="ob-em-name" label="Nome do contato" error={errors.emergency_name}><input id="ob-em-name" className="hp-input" value={v.emergency_name} onChange={(e) => set("emergency_name", e.target.value)} aria-invalid={!!errors.emergency_name} /></Field>
            <Field id="ob-em-rel" label="Parentesco / relação" error={errors.emergency_relation}><input id="ob-em-rel" className="hp-input" value={v.emergency_relation} onChange={(e) => set("emergency_relation", e.target.value)} placeholder="Ex.: filha, esposo, vizinha" aria-invalid={!!errors.emergency_relation} /></Field>
            <Field id="ob-em-phone" label="Telefone do contato" error={errors.emergency_phone} className="sm:col-span-2"><input id="ob-em-phone" type="tel" className="hp-input" value={v.emergency_phone} onChange={(e) => set("emergency_phone", fmtPhone(e.target.value))} placeholder="(11) 99999-9999" aria-invalid={!!errors.emergency_phone} /></Field>
            <Field id="ob-complaint" label="Motivo do atendimento (opcional)" className="sm:col-span-2" hint="Conte, em poucas palavras, o que você precisa tratar."><textarea id="ob-complaint" className="hp-input" rows={3} maxLength={800} value={v.main_complaint} onChange={(e) => set("main_complaint", e.target.value)} /></Field>
            {v.main_complaint.trim() && (
              <div className="sm:col-span-2 space-y-3">
                <div className="border-l-2 border-accent bg-muted/50 px-5 py-4 flex gap-3"><ShieldCheck className="w-5 h-5 text-accent shrink-0 mt-0.5" aria-hidden="true" strokeWidth={1.75} /><p className="text-[13px] text-navy-700">{HEALTH_TEXT}</p></div>
                <label className="flex items-start gap-3 text-[13px] text-navy-700 cursor-pointer"><input id="ob-health" type="checkbox" checked={health} onChange={(e) => { setHealth(e.target.checked); setErrors((x) => { const n = { ...x }; delete n.health; return n; }); }} className="mt-0.5 accent-accent" />Autorizo o uso desta informação de saúde nos termos acima.</label>
                {errors.health && <p role="alert" className="text-[12px] text-red-600">{errors.health}</p>}
              </div>)}
            <Field id="ob-how" label="Como conheceu a HP? (opcional)" className="sm:col-span-2"><select id="ob-how" className="hp-input" value={v.how_found} onChange={(e) => set("how_found", e.target.value)}><option value="">—</option>{HOW_FOUND.map((h) => <option key={h} value={h}>{h}</option>)}</select></Field>
          </div></>)}
        {step === 3 && (<><StepTitle title="Crie o seu acesso" /><AccessFields v={v} set={set} errors={errors} email={v.email} consentText={CONSENT_TEXT} consent={consent} setConsent={setConsent} /></>)}
        <FormError text={error} />
        <NextButton busy={busy} last={step === STEPS.length - 1} label={step === STEPS.length - 1 ? "Concluir cadastro" : "Continuar"} />
      </form>
    </OnboardingFrame>
  );
};

export default OnboardingPaciente;
