import { useState, type ReactNode } from "react";
import { Link } from "react-router-dom";
import { ArrowLeft, ArrowRight, CheckCircle2, Loader2, LogIn, MailCheck, ShieldCheck } from "lucide-react";
import Header from "@/components/Header";
import Footer from "@/components/Footer";
import { fmtCep, fmtCpf, fmtPhone, lookupCep, MIN_PASSWORD } from "@/lib/doc";
import { UF_LIST } from "@/lib/quiz";
import { LINK_BTN, PRIMARY_BTN, type Errors, type FormState } from "./shared";

export const Field = ({ id, label, error, hint, children, className = "" }: { id: string; label: string; error?: string; hint?: string; children: ReactNode; className?: string }) => (
  <div className={className}>
    <label htmlFor={id} className="block text-sm text-navy-700 mb-1.5">{label}</label>
    {children}
    {hint && !error && <p className="text-[12px] text-navy-400 mt-1">{hint}</p>}
    {error && <p id={`${id}-erro`} role="alert" className="text-[12px] text-red-600 mt-1">{error}</p>}
  </div>
);

/** Moldura das duas jornadas: texto de apoio à esquerda, etapas à direita (mesmo visual do quiz). */
export const OnboardingFrame = ({ eyebrow, title, intro, bullets, step, steps, onBack, children }: {
  eyebrow: string; title: string; intro: string; bullets: { icon: typeof ShieldCheck; text: string }[]; step: number; steps: string[]; onBack?: () => void; children: ReactNode;
}) => (
  <div className="min-h-screen">
    <Header />
    <main className="px-5 sm:px-8 py-10 lg:py-16">
      <div className="container-hp max-w-5xl">
        <div className="grid lg:grid-cols-[minmax(0,4fr)_minmax(0,8fr)] gap-8 lg:gap-14 items-start">
          <div className="lg:sticky lg:top-24">
            <p className="eyebrow">{eyebrow}</p>
            <h1 className="font-display text-3xl sm:text-4xl leading-[1.15] text-navy-900 mt-4">{title}</h1>
            <p className="text-navy-400 mt-4">{intro}</p>
            <ul className="mt-8 space-y-4 hidden lg:block">
              {bullets.map(({ icon: Icon, text }) => (
                <li key={text} className="flex items-start gap-3 text-[14px] text-navy-700">
                  <span className="grid place-items-center h-8 w-8 shrink-0 rounded-full bg-accent/10 text-accent"><Icon className="w-4 h-4" aria-hidden="true" strokeWidth={1.75} /></span>
                  <span className="pt-1">{text}</span>
                </li>
              ))}
            </ul>
          </div>
          <section className="border border-border bg-card shadow-sm p-6 sm:p-10" aria-label="Formulário de cadastro" data-testid="onboarding-form">
            <div className="mb-8">
              <div className="flex items-center justify-between min-h-6">
                {onBack && step > 0 ? <button type="button" onClick={onBack} className={LINK_BTN}><ArrowLeft className="w-4 h-4" aria-hidden="true" />Voltar</button> : <span />}
                <p className="text-[12px] uppercase tracking-[0.16em] text-navy-400" data-testid="onboarding-etapa">Etapa {step + 1} de {steps.length} · {steps[step]}</p>
              </div>
              <div className="h-1.5 bg-muted mt-3 overflow-hidden rounded-full" role="progressbar" aria-valuemin={0} aria-valuemax={100} aria-valuenow={Math.round(((step + 1) / steps.length) * 100)} aria-label="Progresso do cadastro">
                <div className="h-full bg-accent rounded-full transition-all duration-500" style={{ width: `${((step + 1) / steps.length) * 100}%` }} />
              </div>
            </div>
            <div key={step} className="animate-in fade-in slide-in-from-right-3 duration-300">{children}</div>
          </section>
        </div>
      </div>
    </main>
    <Footer showCta={false} />
  </div>
);

export const StepTitle = ({ title, hint }: { title: string; hint?: string }) => (<>
  <h2 className="font-display text-2xl sm:text-3xl text-navy-900">{title}</h2>
  {hint && <p className="text-[14px] text-navy-400 mt-2">{hint}</p>}
</>);

export const NextButton = ({ busy, label = "Continuar", last }: { busy?: boolean; label?: string; last?: boolean }) => (
  <button type="submit" disabled={busy} className={`${PRIMARY_BTN} mt-8`}>
    {busy ? <Loader2 className="w-4 h-4 animate-spin" aria-hidden="true" /> : null}{label}{!busy && !last && <ArrowRight className="w-4 h-4" aria-hidden="true" />}
  </button>
);

export const FormError = ({ text }: { text: string | null }) => (text ? <p role="alert" className="text-sm text-red-600 mt-4" data-testid="onboarding-erro">{text}</p> : null);

type SetFn = (k: string, v: string) => void;

/** Identificação (nome, preferência, nascimento, CPF e, opcionalmente, RG). */
export const IdentityFields = ({ v, set, errors, withRg }: { v: FormState; set: SetFn; errors: Errors; withRg?: boolean }) => (
  <div className="mt-8 grid gap-5 sm:grid-cols-2">
    <Field id="ob-name" label="Nome completo" error={errors.full_name} className="sm:col-span-2">
      <input id="ob-name" className="hp-input" value={v.full_name} onChange={(e) => set("full_name", e.target.value)} autoComplete="name" placeholder="Nome e sobrenome" autoFocus aria-invalid={!!errors.full_name} /></Field>
    <Field id="ob-pref" label="Como prefere ser chamado(a) (opcional)" error={errors.preferred_name}>
      <input id="ob-pref" className="hp-input" value={v.preferred_name} onChange={(e) => set("preferred_name", e.target.value)} autoComplete="nickname" maxLength={80} /></Field>
    <Field id="ob-birth" label="Data de nascimento" error={errors.birth_date}>
      <input id="ob-birth" type="date" className="hp-input" value={v.birth_date} onChange={(e) => set("birth_date", e.target.value)} autoComplete="bday" max={new Date().toISOString().slice(0, 10)} aria-invalid={!!errors.birth_date} /></Field>
    <Field id="ob-cpf" label="CPF" error={errors.cpf}>
      <input id="ob-cpf" className="hp-input" inputMode="numeric" value={v.cpf} onChange={(e) => set("cpf", fmtCpf(e.target.value))} placeholder="000.000.000-00" aria-invalid={!!errors.cpf} /></Field>
    {withRg && <Field id="ob-rg" label="RG (opcional)" error={errors.rg}>
      <input id="ob-rg" className="hp-input" value={v.rg} onChange={(e) => set("rg", e.target.value)} maxLength={30} /></Field>}
  </div>
);

/** Contato e endereço completo; o CEP preenche rua, bairro, cidade e UF quando o serviço público responde. */
export const ContactAddressFields = ({ v, set, errors, lockEmail, extra }: { v: FormState; set: SetFn; errors: Errors; lockEmail?: boolean; extra?: ReactNode }) => {
  const [cepBusy, setCepBusy] = useState(false);
  const onCep = async () => {
    if (v.cep.replace(/\D/g, "").length !== 8) return;
    setCepBusy(true); const r = await lookupCep(v.cep); setCepBusy(false);
    if (r) { if (r.street) set("street", r.street); if (r.neighborhood) set("neighborhood", r.neighborhood); if (r.city) set("city", r.city); if (r.state_uf) set("state_uf", r.state_uf); }
  };
  return (
    <div className="mt-8 grid gap-5 sm:grid-cols-6">
      <Field id="ob-email" label="E-mail" error={errors.email} className="sm:col-span-3" hint={lockEmail ? "Definido no seu convite." : "Será o seu login."}>
        <input id="ob-email" type="email" className="hp-input" value={v.email} onChange={(e) => set("email", e.target.value)} autoComplete="email" readOnly={lockEmail} aria-invalid={!!errors.email} style={lockEmail ? { background: "hsl(var(--muted))" } : undefined} /></Field>
      <Field id="ob-phone" label="WhatsApp / telefone com DDD" error={errors.phone} className="sm:col-span-3">
        <input id="ob-phone" type="tel" className="hp-input" value={v.phone} onChange={(e) => set("phone", fmtPhone(e.target.value))} autoComplete="tel" placeholder="(11) 99999-9999" aria-invalid={!!errors.phone} /></Field>
      <Field id="ob-cep" label="CEP" error={errors.cep} className="sm:col-span-2" hint={cepBusy ? "Buscando endereço…" : "Preenchemos o restante pelo CEP."}>
        <input id="ob-cep" className="hp-input" inputMode="numeric" value={v.cep} onChange={(e) => set("cep", fmtCep(e.target.value))} onBlur={() => void onCep()} autoComplete="postal-code" placeholder="00000-000" aria-invalid={!!errors.cep} /></Field>
      <Field id="ob-street" label="Rua" error={errors.street} className="sm:col-span-3">
        <input id="ob-street" className="hp-input" value={v.street} onChange={(e) => set("street", e.target.value)} autoComplete="address-line1" aria-invalid={!!errors.street} /></Field>
      <Field id="ob-number" label="Número" error={errors.street_number} className="sm:col-span-1">
        <input id="ob-number" className="hp-input" value={v.street_number} onChange={(e) => set("street_number", e.target.value)} placeholder="S/N" aria-invalid={!!errors.street_number} /></Field>
      <Field id="ob-compl" label="Complemento (opcional)" error={errors.complement} className="sm:col-span-2">
        <input id="ob-compl" className="hp-input" value={v.complement} onChange={(e) => set("complement", e.target.value)} autoComplete="address-line2" /></Field>
      <Field id="ob-neigh" label="Bairro" error={errors.neighborhood} className="sm:col-span-2">
        <input id="ob-neigh" className="hp-input" value={v.neighborhood} onChange={(e) => set("neighborhood", e.target.value)} aria-invalid={!!errors.neighborhood} /></Field>
      <Field id="ob-city" label="Cidade" error={errors.city} className="sm:col-span-3">
        <input id="ob-city" className="hp-input" value={v.city} onChange={(e) => set("city", e.target.value)} autoComplete="address-level2" aria-invalid={!!errors.city} /></Field>
      <Field id="ob-uf" label="UF" error={errors.state_uf} className="sm:col-span-1">
        <select id="ob-uf" className="hp-input" value={v.state_uf} onChange={(e) => set("state_uf", e.target.value)} aria-invalid={!!errors.state_uf}><option value="">—</option>{UF_LIST.map((u) => <option key={u} value={u}>{u}</option>)}</select></Field>
      {extra}
    </div>
  );
};

/** Senha + termo. O e-mail mostrado é o do passo anterior (o login). */
export const AccessFields = ({ v, set, errors, email, consentText, consent, setConsent }: {
  v: FormState; set: SetFn; errors: Errors; email: string; consentText: string; consent: boolean; setConsent: (b: boolean) => void;
}) => (
  <div className="mt-8 space-y-5">
    <p className="text-[14px] text-navy-700">Seu login será <strong data-testid="onboarding-login-email">{email}</strong>. Crie uma senha para entrar no sistema.</p>
    <div className="grid gap-5 sm:grid-cols-2">
      <Field id="ob-pw" label="Crie uma senha" error={errors.password} hint={`Ao menos ${MIN_PASSWORD} caracteres.`}>
        <input id="ob-pw" type="password" className="hp-input" value={v.password} onChange={(e) => set("password", e.target.value)} autoComplete="new-password" aria-invalid={!!errors.password} /></Field>
      <Field id="ob-pw2" label="Confirme a senha" error={errors.password2}>
        <input id="ob-pw2" type="password" className="hp-input" value={v.password2} onChange={(e) => set("password2", e.target.value)} autoComplete="new-password" aria-invalid={!!errors.password2} /></Field>
    </div>
    <div className="border-l-2 border-accent bg-muted/50 px-5 py-4 flex gap-3">
      <ShieldCheck className="w-5 h-5 text-accent shrink-0 mt-0.5" aria-hidden="true" strokeWidth={1.75} />
      <p className="text-[13px] text-navy-700">{consentText}</p>
    </div>
    <label className="flex items-start gap-3 text-[13px] text-navy-700 cursor-pointer">
      <input id="ob-consent" type="checkbox" checked={consent} onChange={(e) => setConsent(e.target.checked)} className="mt-0.5 accent-accent" aria-invalid={!!errors.consent} />
      <span>Li e aceito o tratamento dos meus dados pessoais nos termos acima.</span>
    </label>
    {errors.consent && <p role="alert" className="text-[12px] text-red-600">{errors.consent}</p>}
  </div>
);

/** Tela final: o que fazer agora e o que o sistema oferece (o tutorial completo abre no primeiro login). */
export const DoneScreen = ({ email, accountCreated, highlights, who }: { email: string; accountCreated: boolean; highlights: string[]; who: "fisio" | "paciente" }) => (
  <div data-testid="onboarding-concluido">
    <div className="flex items-center gap-3 text-accent"><CheckCircle2 className="w-7 h-7" aria-hidden="true" /><span className="eyebrow !m-0">Cadastro recebido</span></div>
    <h2 className="font-display text-2xl sm:text-3xl text-navy-900 mt-3">Tudo certo{who === "fisio" ? ", bem-vindo(a) à equipe" : ""}!</h2>
    {accountCreated ? (
      <div className="mt-5 flex gap-3 border-l-2 border-accent bg-muted/50 px-5 py-4">
        <MailCheck className="w-5 h-5 text-accent shrink-0 mt-0.5" aria-hidden="true" />
        <p className="text-[14px] text-navy-700">Enviamos um e-mail de confirmação para <strong>{email}</strong>. <strong>Clique no link</strong> para ativar o seu acesso (olhe também o spam) e depois entre com o e-mail e a senha que você criou.</p>
      </div>
    ) : (
      <div className="mt-5 flex gap-3 border-l-2 border-red-500 bg-muted/50 px-5 py-4" role="alert" data-testid="onboarding-sem-conta">
        <MailCheck className="w-5 h-5 text-red-600 shrink-0 mt-0.5" aria-hidden="true" />
        <p className="text-[14px] text-navy-700">Seu cadastro foi salvo, mas não conseguimos criar a senha agora. Em instantes use <Link to="/primeiro-acesso" className="underline">Primeiro acesso</Link> com o e-mail <strong>{email}</strong> para criar a senha.</p>
      </div>
    )}
    <h3 className="font-display text-lg text-navy-900 mt-8">No primeiro acesso você verá um tutorial. Resumo do que o sistema oferece:</h3>
    <ul className="mt-3 space-y-2 text-[14px] text-navy-700">{highlights.map((h) => <li key={h} className="flex gap-2"><CheckCircle2 className="w-4 h-4 text-accent shrink-0 mt-0.5" aria-hidden="true" />{h}</li>)}</ul>
    <Link to="/login" className={`${PRIMARY_BTN} mt-8`}><LogIn className="w-4 h-4" aria-hidden="true" />Ir para o login</Link>
  </div>
);
