import { useEffect, useRef, useState, type FormEvent } from "react";
import { useSearchParams } from "react-router-dom";
import { CalendarCheck, Loader2, ShieldCheck, Stethoscope, UserCheck } from "lucide-react";
import { supabase } from "@/lib/supabase";
import { fmtCnpj, isValidCnpj, isValidCpf, isValidEmail, isValidPhone, MIN_PASSWORD, onlyDigits } from "@/lib/doc";
import { isFullName, UF_LIST } from "@/lib/quiz";
import {AccessFields, ContactAddressFields, DoneScreen, Field, FormError, IdentityFields, NextButton, OnboardingFrame, StepTitle } from "./parts";
import { ONBOARDING_CONSENT_VERSION, usePageMeta, type Errors, type FormState } from "./shared";

const STEPS = ["Dados pessoais", "Contato e endereço", "Atuação profissional", "Pagamento", "Acesso"];
const SPECIALTIES = ["Ortopedia e traumatologia", "Neurologia", "Geriatria", "Respiratória", "Cardiovascular", "Pediatria", "Esportiva", "Saúde da mulher / uroginecologia", "Pós-operatório", "Oncologia", "Dor crônica", "Domiciliar / home care"];
const PIX_TYPES: [string, string][] = [["cpf", "CPF"], ["cnpj", "CNPJ"], ["email", "E-mail"], ["phone", "Celular"], ["random", "Chave aleatória"]];
const CONSENT_TEXT = "Os dados informados (incluindo CPF, endereço e dados de pagamento) serão tratados pelo HP Group para o seu cadastro, a contratação, o controle de repasses e o contato operacional. " +
  "Ficam visíveis apenas para a gestão autorizada e para você. Você pode pedir a correção ou a remoção dos seus dados a qualquer momento.";
const HIGHLIGHTS = ["Sua agenda de atendimentos, com confirmação e status de cada sessão", "Meu dia: tarefas e a integração com o Google Agenda", "Seus pacientes vinculados e o registro da evolução deles",
  "Seu resumo: atendimentos realizados, faltas e repasses", "Dados sensíveis (financeiro e documentos de outras pessoas) ficam restritos à gestão"];

const EMPTY: FormState = { full_name: "", preferred_name: "", birth_date: "", cpf: "", rg: "", email: "", phone: "", cep: "", street: "", street_number: "", complement: "", neighborhood: "", city: "", state_uf: "",
  council_number: "", council_uf: "", education: "", bio: "", service_regions: "", work_as: "pf", cnpj: "", legal_name: "", trade_name: "", pix_key_type: "cpf", pix_key: "", bank_name: "", bank_agency: "", bank_account: "", password: "", password2: "" };

type LinkInfo = { valid: boolean; reason?: string; email?: string | null; full_name?: string | null; unit?: string | null };
const REASON: Record<string, string> = {
  not_found: "Este link não foi reconhecido. Confira se copiou o endereço inteiro ou peça um novo convite à HP.",
  revoked: "Este convite foi cancelado. Peça um novo convite à HP.",
  used: "Este convite já foi usado. Se você já fez o cadastro, entre pelo login ou use “Primeiro acesso”.",
  expired: "Este convite expirou. Peça um novo convite à HP.",
};

/** Cadastro do fisioterapeuta contratado: só abre com o link único que a HP gera (o servidor confere o link a cada envio). */
const OnboardingFisio = () => {
  usePageMeta("Cadastro de fisioterapeuta | HP Fisioterapia");
  const [params] = useSearchParams(); const token = params.get("convite") ?? "";
  const [info, setInfo] = useState<LinkInfo | "loading">("loading");
  const [step, setStep] = useState(0); const [v, setV] = useState<FormState>(EMPTY); const [specs, setSpecs] = useState<string[]>([]);
  const [errors, setErrors] = useState<Errors>({}); const [consent, setConsent] = useState(false);
  const [busy, setBusy] = useState(false); const [error, setError] = useState<string | null>(null);
  const [done, setDone] = useState<{ email: string; account: boolean } | null>(null);
  const honeypot = useRef<HTMLInputElement>(null);
  const set = (k: string, val: string) => { setV((s) => ({ ...s, [k]: val })); setErrors((e) => { if (!e[k]) return e; const n = { ...e }; delete n[k]; return n; }); };

  useEffect(() => {
    if (!token) { setInfo({ valid: false, reason: "no_token" }); return; }
    let live = true;
    void supabase.rpc("onboarding_link_info", { p_token: token }).then(({ data, error: e }) => {
      if (!live) return;
      if (e || !data) return setInfo({ valid: false, reason: e?.message.includes("rate_limited") ? "rate" : "error" });
      const i = data as LinkInfo; setInfo(i);
      if (i.valid) setV((s) => ({ ...s, email: i.email ?? s.email, full_name: s.full_name || i.full_name || "" }));
    });
    return () => { live = false; };
  }, [token]);

  const validate = (): Errors => {
    const e: Errors = {};
    if (step === 0) {
      if (!isFullName(v.full_name)) e.full_name = "Informe o nome completo (nome e sobrenome).";
      if (!v.birth_date) e.birth_date = "Informe a data de nascimento.";
      else { const age = (Date.now() - new Date(v.birth_date).getTime()) / 31557600000; if (!(age >= 18 && age <= 100)) e.birth_date = "Data de nascimento inválida para um profissional."; }
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
      if (v.council_number.replace(/[^0-9A-Za-z]/g, "").length < 3) e.council_number = "Informe o número do CREFITO.";
      if (!v.council_uf) e.council_uf = "Escolha a UF do CREFITO.";
      if (specs.length === 0) e.specialties = "Escolha ao menos uma especialidade.";
      if (v.work_as === "pj") {
        if (!isValidCnpj(v.cnpj)) e.cnpj = "CNPJ inválido.";
        if (v.legal_name.trim().length < 2) e.legal_name = "Informe a razão social.";
      }
    } else if (step === 3) {
      if (!v.pix_key.trim()) e.pix_key = "Informe a chave PIX para receber os repasses.";
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
    const data = { ...v, cpf: onlyDigits(v.cpf), cnpj: v.work_as === "pj" ? onlyDigits(v.cnpj) : "", specialties: specs, password: undefined, password2: undefined };
    const { data: res, error: rpcError } = await supabase.rpc("onboarding_submit_physio", { p_token: token, p_data: data, p_consent_version: ONBOARDING_CONSENT_VERSION, p_honeypot: honeypot.current?.value ?? "" });
    if (rpcError) {
      setBusy(false); const msg = rpcError.message;
      return setError(msg.includes("rate_limited") ? "Muitas tentativas. Aguarde alguns minutos e tente de novo." : /[a-záéíóúãõç]/i.test(msg) && !/violates|relation|column|syntax/i.test(msg) ? msg : "Não foi possível concluir o cadastro agora. Tente novamente em instantes.");
    }
    const email = ((res as { email?: string } | null)?.email ?? v.email).toLowerCase();
    const { error: signError } = await supabase.auth.signUp({ email, password: v.password, options: { emailRedirectTo: `${window.location.origin}/app` } });
    setBusy(false); setDone({ email, account: !signError });
  };

  if (info === "loading") return <OnboardingFrame eyebrow="Equipe HP Group" title="Cadastro de fisioterapeuta" intro="Verificando o seu convite…" bullets={[]} step={0} steps={STEPS}><p role="status" className="text-navy-400 flex items-center gap-2"><Loader2 className="w-4 h-4 animate-spin" aria-hidden="true" />Verificando o convite…</p></OnboardingFrame>;
  if (!info.valid) {
    const msg = info.reason === "no_token" ? "Esta página só abre com o link de convite enviado pela HP. Se você foi contratado(a) e não recebeu o link, fale com a gestão." : info.reason === "rate" ? "Muitas consultas em pouco tempo. Aguarde alguns minutos e tente de novo." : info.reason === "error" ? "Não foi possível verificar o convite agora. Tente novamente em instantes." : REASON[info.reason ?? ""] ?? REASON.not_found;
    return <OnboardingFrame eyebrow="Equipe HP Group" title="Cadastro de fisioterapeuta" intro="Convite necessário." bullets={[]} step={0} steps={STEPS}><div role="alert" data-testid="onboarding-link-invalido" className="border-l-2 border-red-500 bg-muted/50 px-5 py-4 text-[14px] text-navy-700">{msg}</div></OnboardingFrame>;
  }
  if (done) return <OnboardingFrame eyebrow="Equipe HP Group" title="Cadastro de fisioterapeuta" intro="Seu cadastro foi recebido." bullets={[]} step={STEPS.length - 1} steps={STEPS}><DoneScreen who="fisio" email={done.email} accountCreated={done.account} highlights={HIGHLIGHTS} /></OnboardingFrame>;

  const toggleSpec = (s: string) => { setSpecs((cur) => (cur.includes(s) ? cur.filter((x) => x !== s) : [...cur, s])); setErrors((e) => { const n = { ...e }; delete n.specialties; return n; }); };
  return (
    <OnboardingFrame eyebrow="Equipe HP Group" title="Bem-vindo(a)! Vamos fazer o seu cadastro" intro={`Preencha os seus dados para integrar a equipe${info.unit ? ` da unidade ${info.unit}` : ""}. Ao final você já cria o seu acesso ao sistema.`} step={step} steps={STEPS} onBack={() => { setStep(step - 1); setError(null); }}
      bullets={[{ icon: UserCheck, text: "Leva cerca de 5 minutos." }, { icon: ShieldCheck, text: "CPF, endereço e dados de pagamento ficam restritos à gestão e a você." }, { icon: CalendarCheck, text: "Ao final, você cria a senha e recebe um tutorial do sistema." }, { icon: Stethoscope, text: "Se atende como empresa (MEI, Ltda), informe o CNPJ e o cadastro será de pessoa jurídica." }]}>
      <form onSubmit={submit} noValidate>
        <input type="text" name="website" ref={honeypot} tabIndex={-1} autoComplete="off" className="hidden" aria-hidden="true" />
        {step === 0 && <><StepTitle title="Seus dados pessoais" hint="Como constam nos seus documentos." /><IdentityFields v={v} set={set} errors={errors} withRg /></>}
        {step === 1 && <><StepTitle title="Contato e endereço" hint="Usamos para contato operacional e para o seu cadastro." /><ContactAddressFields v={v} set={set} errors={errors} lockEmail={!!info.email} /></>}
        {step === 2 && (<>
          <StepTitle title="Atuação profissional" />
          <div className="mt-8 grid gap-5 sm:grid-cols-6">
            <Field id="ob-council" label="Nº do CREFITO" error={errors.council_number} className="sm:col-span-3"><input id="ob-council" className="hp-input" value={v.council_number} onChange={(e) => set("council_number", e.target.value)} placeholder="000000-F" aria-invalid={!!errors.council_number} /></Field>
            <Field id="ob-council-uf" label="UF do CREFITO" error={errors.council_uf} className="sm:col-span-3"><select id="ob-council-uf" className="hp-input" value={v.council_uf} onChange={(e) => set("council_uf", e.target.value)} aria-invalid={!!errors.council_uf}><option value="">—</option>{UF_LIST.map((u) => <option key={u} value={u}>{u}</option>)}</select></Field>
            <fieldset className="sm:col-span-6" aria-describedby={errors.specialties ? "ob-spec-erro" : undefined}>
              <legend className="block text-sm text-navy-700 mb-1.5">Especialidades (marque as que atende)</legend>
              <div className="grid sm:grid-cols-2 gap-x-6 gap-y-2">{SPECIALTIES.map((s) => (
                <label key={s} className="flex items-center gap-2.5 text-[14px] text-navy-700 cursor-pointer"><input type="checkbox" checked={specs.includes(s)} onChange={() => toggleSpec(s)} className="accent-accent" />{s}</label>))}</div>
              {errors.specialties && <p id="ob-spec-erro" role="alert" className="text-[12px] text-red-600 mt-1">{errors.specialties}</p>}
            </fieldset>
            <Field id="ob-edu" label="Formação (opcional)" className="sm:col-span-6" hint="Graduação, pós, cursos e instituições."><textarea id="ob-edu" className="hp-input" rows={2} maxLength={400} value={v.education} onChange={(e) => set("education", e.target.value)} /></Field>
            <Field id="ob-bio" label="Apresentação curta (opcional)" className="sm:col-span-6"><textarea id="ob-bio" className="hp-input" rows={3} maxLength={600} value={v.bio} onChange={(e) => set("bio", e.target.value)} /></Field>
            <Field id="ob-regions" label="Cidades/regiões em que atende (opcional)" className="sm:col-span-6"><input id="ob-regions" className="hp-input" maxLength={300} value={v.service_regions} onChange={(e) => set("service_regions", e.target.value)} placeholder="Ex.: Santo André, São Bernardo, São Caetano" /></Field>
            <fieldset className="sm:col-span-6">
              <legend className="block text-sm text-navy-700 mb-1.5">Você atende como</legend>
              <div className="flex flex-wrap gap-6">{[["pf", "Pessoa física (CPF)"], ["pj", "Pessoa jurídica (CNPJ: MEI, Ltda…)"]].map(([k, l]) => (
                <label key={k} className="flex items-center gap-2.5 text-[14px] text-navy-700 cursor-pointer"><input type="radio" name="work_as" checked={v.work_as === k} onChange={() => set("work_as", k)} className="accent-accent" />{l}</label>))}</div>
            </fieldset>
            {v.work_as === "pj" && (<>
              <Field id="ob-cnpj" label="CNPJ" error={errors.cnpj} className="sm:col-span-3"><input id="ob-cnpj" className="hp-input" inputMode="numeric" value={v.cnpj} onChange={(e) => set("cnpj", fmtCnpj(e.target.value))} placeholder="00.000.000/0000-00" aria-invalid={!!errors.cnpj} /></Field>
              <Field id="ob-legal" label="Razão social" error={errors.legal_name} className="sm:col-span-3"><input id="ob-legal" className="hp-input" value={v.legal_name} onChange={(e) => set("legal_name", e.target.value)} aria-invalid={!!errors.legal_name} /></Field>
              <Field id="ob-trade" label="Nome fantasia (opcional)" className="sm:col-span-6"><input id="ob-trade" className="hp-input" value={v.trade_name} onChange={(e) => set("trade_name", e.target.value)} /></Field>
            </>)}
          </div></>)}
        {step === 3 && (<>
          <StepTitle title="Pagamento dos repasses" hint="Dados guardados com restrição: só você e a gestão enxergam." />
          <div className="mt-8 grid gap-5 sm:grid-cols-3">
            <Field id="ob-pixtype" label="Tipo da chave PIX"><select id="ob-pixtype" className="hp-input" value={v.pix_key_type} onChange={(e) => set("pix_key_type", e.target.value)}>{PIX_TYPES.map(([k, l]) => <option key={k} value={k}>{l}</option>)}</select></Field>
            <Field id="ob-pix" label="Chave PIX" error={errors.pix_key} className="sm:col-span-2"><input id="ob-pix" className="hp-input" value={v.pix_key} onChange={(e) => set("pix_key", e.target.value)} aria-invalid={!!errors.pix_key} /></Field>
            <Field id="ob-bank" label="Banco (opcional)"><input id="ob-bank" className="hp-input" value={v.bank_name} onChange={(e) => set("bank_name", e.target.value)} /></Field>
            <Field id="ob-agency" label="Agência (opcional)"><input id="ob-agency" className="hp-input" value={v.bank_agency} onChange={(e) => set("bank_agency", e.target.value)} /></Field>
            <Field id="ob-account" label="Conta (opcional)"><input id="ob-account" className="hp-input" value={v.bank_account} onChange={(e) => set("bank_account", e.target.value)} /></Field>
          </div></>)}
        {step === 4 && (<><StepTitle title="Crie o seu acesso" /><AccessFields v={v} set={set} errors={errors} email={v.email} consentText={CONSENT_TEXT} consent={consent} setConsent={setConsent} /></>)}
        <FormError text={error} />
        <NextButton busy={busy} last={step === STEPS.length - 1} label={step === STEPS.length - 1 ? "Concluir cadastro" : "Continuar"} />
      </form>
    </OnboardingFrame>
  );
};

export default OnboardingFisio;
