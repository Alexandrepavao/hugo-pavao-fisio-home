import { useCallback, useEffect, useMemo, useRef, useState, type ReactNode } from "react";
import { useQuery } from "@tanstack/react-query";
import { useNavigate, useSearchParams } from "react-router-dom";
import { Check, Plus, Trash2 } from "lucide-react";
import { btnGhost, btnPrimary, inputCls, Msg, PageHead, State, useMsg } from "@/lib/ui";
import { fmtMoney, prpc, type Catalog } from "./api";

type A = Record<string, any>; // eslint-disable-line @typescript-eslint/no-explicit-any
interface Issue { path: string; message: string }
interface Validation { ok: boolean; errors: Issue[]; warnings: Issue[]; modules_final: string[]; template_version: number | null }

const STEPS = ["Empresa", "Operação", "Equipe", "Clientes", "Módulos", "Marca", "Integrações", "Plano", "Revisão"];
const STEP_OF: Record<string, number> = { company: 0, operation: 1, team: 2, customers: 3, modules: 4, brand: 5, integrations: 6, plan: 7, other_segments_interest: 0 };
const MODES: [string, string][] = [["in_clinic", "Presencial (na clínica)"], ["home_visit", "Domiciliar"], ["remote", "Remoto"]];
const SALES: [string, string][] = [["single", "Venda avulsa"], ["package", "Pacotes de sessões"], ["subscription", "Assinatura"]];
const INTEGRATIONS: [string, string][] = [["email", "E-mail próprio"], ["calendar", "Calendário (Google)"], ["payments", "Pagamentos"], ["videos", "Vídeos de exercícios"], ["maps", "Mapas e rotas"], ["messages", "Mensagens (WhatsApp)"]];
const CUSTOMER_FLAGS: [string, string][] = [["crm", "Funil comercial (CRM)"], ["capture", "Captação de contatos (páginas e formulários)"], ["forms", "Formulários de avaliação"], ["proposals", "Propostas e pacotes"], ["portal", "Portal do paciente"]];

const slugify = (s: string) => s.normalize("NFD").replace(/[̀-ͯ]/g, "").toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/^-+|-+$/g, "").slice(0, 30).replace(/-+$/g, "");
const newKey = () => `q-${crypto.randomUUID()}`;
const get = (a: A, path: string) => path.split(".").reduce<any>((o, k) => (o == null ? undefined : o[k]), a); // eslint-disable-line @typescript-eslint/no-explicit-any
const setIn = (a: A, path: string, v: unknown): A => {
  const ks = path.split("."); const out: A = { ...a }; let cur: A = out;
  ks.slice(0, -1).forEach((k) => { cur[k] = { ...(cur[k] ?? {}) }; cur = cur[k]; });
  cur[ks[ks.length - 1]] = v; return out;
};

const Field = ({ id, label, hint, children }: { id: string; label: string; hint?: string; children: ReactNode }) => (
  <div className="mb-4"><label htmlFor={id} className="block text-sm font-medium text-foreground mb-1">{label}</label>{children}{hint && <p className="text-xs text-muted-foreground mt-1">{hint}</p>}</div>
);
const Checks = ({ name, options, value, onChange, locked = [] }: { name: string; options: [string, string][]; value: string[]; onChange: (v: string[]) => void; locked?: string[] }) => (
  <fieldset className="mb-4"><legend className="sr-only">{name}</legend>
    <div className="grid gap-1.5 sm:grid-cols-2">{options.map(([k, l]) => (
      <label key={k} className="flex items-center gap-2 text-sm"><input type="checkbox" checked={value.includes(k) || locked.includes(k)} disabled={locked.includes(k)}
        onChange={(e) => onChange(e.target.checked ? [...value, k] : value.filter((x) => x !== k))} />{l}{locked.includes(k) && <span className="text-xs text-muted-foreground">(incluído no modelo)</span>}</label>))}
    </div></fieldset>
);

const Questionnaire = () => {
  const nav = useNavigate(); const [sp] = useSearchParams(); const [msg, m] = useMsg();
  const [key, setKey] = useState<string>(() => sp.get("rascunho") ?? newKey());
  const [step, setStep] = useState(0);
  const [a, setA] = useState<A>({ company: { units: [{ name: "Sede" }], state: "" }, operation: { modes: ["in_clinic"], sales_models: ["single"], services: [] }, team: { users_count: 5, roles: [] }, customers: { crm: true, capture: false, forms: true, proposals: false, portal: true, import: { needed: false } }, modules: [], brand: { color_primary: "#1b3350", color_accent: "#a6873f" }, integrations: [], plan: { plan_key: "essencial", implementation: "standard" } });
  const [servicesText, setServicesText] = useState("");
  const [validation, setValidation] = useState<Validation | null>(null);
  const [busy, setBusy] = useState(false); const [saved, setSaved] = useState<string>("");
  const catalog = useQuery({ queryKey: ["plat-catalog"], queryFn: () => prpc<Catalog>("platform_catalog") });
  const loaded = useRef(false);

  // retomar rascunho salvo (?rascunho=<chave>)
  useEffect(() => {
    if (!sp.get("rascunho") || loaded.current) return; loaded.current = true;
    void prpc<{ found: boolean; answers?: A; status?: string }>("provisioning_draft_get", { p_key: key }).then((r) => {
      if (r.found && r.answers && r.status === "draft") { setA((cur) => ({ ...cur, ...r.answers })); setServicesText(((r.answers.operation?.services as string[]) ?? []).join("\n")); m.ok("Rascunho retomado."); }
      else if (r.found) m.err("Esta solicitação já foi enviada e não pode mais ser editada.");
    }).catch((e: Error) => m.err(e.message));
  }, [sp, key, m]);

  const set = useCallback((path: string, v: unknown) => setA((cur) => setIn(cur, path, v)), []);
  const segment = get(a, "company.segment") as string | undefined;
  const template = catalog.data?.templates.find((t) => t.segment_key === segment && t.status === "published");
  const defaults = template?.default_modules ?? [];
  const candidates = useMemo(() => (catalog.data?.modules ?? []).filter((x) => !x.core && x.status !== "planned" && (!x.segments.length || (segment && x.segments.includes(segment)))), [catalog.data, segment]);

  // sugestões condicionais (nunca ativam sozinhas: só destacam o que as respostas indicam)
  const suggested = useMemo(() => {
    const s = new Set<string>();
    if ((get(a, "operation.modes") as string[] | undefined)?.includes("home_visit")) s.add("rota_domiciliar");
    if (get(a, "customers.capture")) { s.add("crm"); s.add("marketing"); }
    if (get(a, "customers.proposals")) s.add("financeiro");
    if (get(a, "plan.training")) s.add("academy");
    return s;
  }, [a]);

  const save = useCallback(async (quiet = false) => {
    try { const r = await prpc<{ saved: boolean }>("provisioning_draft_save", { p_key: key, p_answers: a }); if (!quiet) m.ok(r.saved ? "Rascunho salvo." : "Esta solicitação já foi enviada."); setSaved(new Date().toLocaleTimeString("pt-BR", { hour: "2-digit", minute: "2-digit" })); return true; }
    catch (e) { if (!quiet) m.err((e as Error).message); return false; }
  }, [key, a, m]);

  // salvamento automático ao trocar de etapa
  const go = async (n: number) => { await save(true); setStep(n); window.scrollTo({ top: 0 }); };
  const validate = useCallback(async () => {
    setBusy(true);
    try { if (!(await save(true))) throw new Error("Não foi possível salvar o rascunho."); setValidation(await prpc<Validation>("provisioning_validate", { p_key: key })); }
    catch (e) { m.err((e as Error).message); } finally { setBusy(false); }
  }, [save, key, m]);
  useEffect(() => { if (step === 8) void validate(); }, [step]); // eslint-disable-line react-hooks/exhaustive-deps

  const submit = async () => {
    setBusy(true);
    try {
      await save(true);
      const r = await prpc<{ id: string }>("provisioning_submit", { p_key: key });
      nav(`/plataforma/solicitacoes/${r.id}`);
    } catch (e) { m.err((e as Error).message); setBusy(false); }
  };

  const units = (get(a, "company.units") as A[]) ?? [];
  const roles = (get(a, "team.roles") as { role: string; count: number }[]) ?? [];
  const selected = (get(a, "modules") as string[]) ?? [];
  const planOpts = (catalog.data?.plans ?? []).filter((p) => p.key !== "interno" && p.status !== "retired");
  const name = (get(a, "company.name") as string) ?? "";

  return (
    <div>
      <PageHead eyebrow="Plataforma" title="Criar aplicativo" hint="Responda ao questionário: o ambiente da empresa é criado automaticamente, sem editar código nem rodar SQL. Selecionar uma integração não a conecta." />
      <ol className="flex flex-wrap gap-1.5 mb-6" aria-label="Etapas">
        {STEPS.map((s, i) => (
          <li key={s}><button type="button" onClick={() => void go(i)} aria-current={step === i ? "step" : undefined}
            className={`h-8 px-3 rounded-full text-xs font-medium border transition-colors ${step === i ? "bg-primary text-primary-foreground border-primary" : i < step ? "border-primary/40 text-foreground" : "border-border text-muted-foreground"}`}>{String.fromCharCode(65 + i)} · {s}</button></li>))}
      </ol>
      <Msg m={msg} />
      <State loading={catalog.isLoading} error={catalog.error} />
      {catalog.data && (
        <div className="hp-card p-5 max-w-3xl" data-testid={`step-${step}`}>
          {step === 0 && <>
            <h3 className="text-lg font-semibold mb-4">A · Empresa</h3>
            <Field id="q-name" label="Nome da empresa"><input id="q-name" className={inputCls} value={name} onChange={(e) => { set("company.name", e.target.value); if (!get(a, "brand.app_name")) { set("brand.app_name", e.target.value); } if (!get(a, "brand.subdomain")) set("brand.subdomain", slugify(e.target.value)); }} /></Field>
            <Field id="q-seg" label="Segmento" hint="Só segmentos disponíveis podem ser criados agora; os demais estão planejados.">
              <select id="q-seg" className={inputCls} value={segment ?? ""} onChange={(e) => { set("company.segment", e.target.value); set("modules", []); set("team.roles", []); }}>
                <option value="">Selecione…</option>
                {catalog.data.segments.map((s) => <option key={s.key} value={s.key} disabled={s.status !== "available"}>{s.name}{s.status !== "available" ? " — planejado" : ""}</option>)}
              </select></Field>
            <div className="grid gap-x-4 sm:grid-cols-2">
              <Field id="q-rn" label="Responsável (nome)"><input id="q-rn" className={inputCls} value={get(a, "company.responsible.name") ?? ""} onChange={(e) => set("company.responsible", { ...(get(a, "company.responsible") ?? {}), name: e.target.value })} /></Field>
              <Field id="q-re" label="Responsável (e-mail)" hint="Receberá o convite de administrador."><input id="q-re" type="email" className={inputCls} value={get(a, "company.responsible.email") ?? ""} onChange={(e) => set("company.responsible", { ...(get(a, "company.responsible") ?? {}), email: e.target.value })} /></Field>
              <Field id="q-city" label="Cidade"><input id="q-city" className={inputCls} value={get(a, "company.city") ?? ""} onChange={(e) => set("company.city", e.target.value)} /></Field>
              <Field id="q-uf" label="UF"><input id="q-uf" className={inputCls} maxLength={2} value={get(a, "company.state") ?? ""} onChange={(e) => set("company.state", e.target.value.toUpperCase())} /></Field>
            </div>
            <p className="text-sm font-medium mb-2">Unidades</p>
            {units.map((u, i) => (
              <div key={i} className="flex gap-2 mb-2"><input aria-label={`Nome da unidade ${i + 1}`} className={inputCls} placeholder="Nome da unidade" value={u.name ?? ""} onChange={(e) => set("company.units", units.map((x, j) => (j === i ? { ...x, name: e.target.value } : x)))} />
                <input aria-label={`Cidade da unidade ${i + 1}`} className={inputCls} placeholder="Cidade" value={u.city ?? ""} onChange={(e) => set("company.units", units.map((x, j) => (j === i ? { ...x, city: e.target.value } : x)))} />
                <button type="button" className={btnGhost} aria-label={`Remover unidade ${i + 1}`} disabled={units.length <= 1} onClick={() => set("company.units", units.filter((_, j) => j !== i))}><Trash2 size={15} /></button></div>))}
            <button type="button" className={btnGhost} onClick={() => set("company.units", [...units, { name: "" }])}><Plus size={15} className="mr-1" />Adicionar unidade</button>
          </>}

          {step === 1 && <>
            <h3 className="text-lg font-semibold mb-4">B · Operação</h3>
            <Field id="q-serv" label="Serviços oferecidos (um por linha)" hint="Os valores são cadastrados pela própria clínica depois: a plataforma não inventa preços."><textarea id="q-serv" rows={5} className={inputCls} value={servicesText} onChange={(e) => { setServicesText(e.target.value); set("operation.services", e.target.value.split("\n").map((x) => x.trim()).filter(Boolean)); }} /></Field>
            <p className="text-sm font-medium mb-1">Modalidades de atendimento</p>
            <Checks name="Modalidades" options={MODES} value={get(a, "operation.modes") ?? []} onChange={(v) => set("operation.modes", v)} />
            <p className="text-sm font-medium mb-1">Modelos de venda</p>
            <Checks name="Modelos de venda" options={SALES} value={get(a, "operation.sales_models") ?? []} onChange={(v) => set("operation.sales_models", v)} />
            <Field id="q-flow" label="Fluxo de atendimento (opcional)"><textarea id="q-flow" rows={3} className={inputCls} value={get(a, "operation.flow") ?? ""} onChange={(e) => set("operation.flow", e.target.value)} /></Field>
          </>}

          {step === 2 && <>
            <h3 className="text-lg font-semibold mb-4">C · Equipe</h3>
            <Field id="q-users" label="Quantidade de usuários da equipe"><input id="q-users" type="number" min={1} max={500} className={inputCls} value={get(a, "team.users_count") ?? ""} onChange={(e) => set("team.users_count", e.target.value)} /></Field>
            <p className="text-sm font-medium mb-2">Funções previstas {template ? "" : "(escolha o segmento na etapa A)"}</p>
            <div className="grid gap-2 sm:grid-cols-2 mb-4">{(template?.roles ?? []).filter((r) => r.role !== "member").map((r) => {
              const cur = roles.find((x) => x.role === r.role);
              return <label key={r.role} className="flex items-center gap-2 text-sm"><span className="flex-1">{r.label}</span>
                <input type="number" min={0} max={500} aria-label={`Quantidade: ${r.label}`} className={inputCls + " !w-20"} value={cur?.count ?? 0}
                  onChange={(e) => { const n = Number(e.target.value); set("team.roles", [...roles.filter((x) => x.role !== r.role), ...(n > 0 ? [{ role: r.role, count: n }] : [])]); }} /></label>;
            })}</div>
            <Field id="q-acc" label="Necessidades de acesso (opcional)"><textarea id="q-acc" rows={2} className={inputCls} value={get(a, "team.access_needs") ?? ""} onChange={(e) => set("team.access_needs", e.target.value)} /></Field>
          </>}

          {step === 3 && <>
            <h3 className="text-lg font-semibold mb-4">D · Relacionamento com clientes</h3>
            <fieldset className="mb-4"><legend className="sr-only">Recursos</legend><div className="grid gap-1.5">{CUSTOMER_FLAGS.map(([k, l]) => (
              <label key={k} className="flex items-center gap-2 text-sm"><input type="checkbox" checked={Boolean(get(a, `customers.${k}`))} onChange={(e) => set(`customers.${k}`, e.target.checked)} />{l}</label>))}</div></fieldset>
            <label className="flex items-center gap-2 text-sm mb-2"><input type="checkbox" checked={Boolean(get(a, "customers.import.needed"))} onChange={(e) => set("customers.import", { ...(get(a, "customers.import") ?? {}), needed: e.target.checked })} />Preciso importar clientes de outro sistema (revisão assistida; nada é importado automaticamente)</label>
            {get(a, "customers.import.needed") && <Field id="q-src" label="Origem dos dados"><input id="q-src" className={inputCls} value={get(a, "customers.import.source") ?? ""} onChange={(e) => set("customers.import", { ...(get(a, "customers.import") ?? {}), source: e.target.value })} /></Field>}
          </>}

          {step === 4 && <>
            <h3 className="text-lg font-semibold mb-1">E · Módulos</h3>
            <p className="text-sm text-muted-foreground mb-4">O modelo do segmento já inclui a base. Marque os opcionais; dependências são conferidas na revisão. Habilitar não conecta serviços externos.</p>
            <div className="grid gap-2">{candidates.map((x) => {
              const isDefault = defaults.includes(x.key);
              return (<label key={x.key} className="flex items-start gap-2 text-sm hp-card p-3">
                <input type="checkbox" className="mt-1" checked={isDefault || selected.includes(x.key)} disabled={isDefault} onChange={(e) => set("modules", e.target.checked ? [...selected, x.key] : selected.filter((k) => k !== x.key))} />
                <span><strong>{x.name}</strong>{isDefault && <span className="text-xs text-muted-foreground"> · incluído no modelo</span>}{x.status === "experimental" && <span className="hp-badge hp-badge-warning ml-2">experimental</span>}
                  {suggested.has(x.key) && !isDefault && !selected.includes(x.key) && <span className="hp-badge hp-badge-info ml-2">sugerido pelas suas respostas</span>}
                  <span className="block text-xs text-muted-foreground">{x.description}{x.requires.filter((r) => r !== "core").length ? ` Requer: ${x.requires.filter((r) => r !== "core").join(", ")}.` : ""}</span></span></label>);
            })}</div>
            {!candidates.length && <p className="text-sm text-muted-foreground">Escolha o segmento na etapa A.</p>}
          </>}

          {step === 5 && <>
            <h3 className="text-lg font-semibold mb-4">F · Marca e endereço</h3>
            <Field id="q-app" label="Nome do aplicativo"><input id="q-app" className={inputCls} value={get(a, "brand.app_name") ?? ""} onChange={(e) => set("brand.app_name", e.target.value)} /></Field>
            <div className="grid gap-x-4 sm:grid-cols-2">
              <Field id="q-c1" label="Cor principal"><input id="q-c1" type="color" className="h-10 w-full rounded border border-border" value={get(a, "brand.color_primary") ?? "#1b3350"} onChange={(e) => set("brand.color_primary", e.target.value)} /></Field>
              <Field id="q-c2" label="Cor de destaque"><input id="q-c2" type="color" className="h-10 w-full rounded border border-border" value={get(a, "brand.color_accent") ?? "#a6873f"} onChange={(e) => set("brand.color_accent", e.target.value)} /></Field>
            </div>
            <Field id="q-sub" label="Endereço (subdomínio)" hint="3 a 31 letras minúsculas, números ou hífen. No Dev o acesso é <subdomínio>.localhost."><input id="q-sub" className={inputCls} value={get(a, "brand.subdomain") ?? ""} onChange={(e) => set("brand.subdomain", e.target.value.toLowerCase())} /></Field>
            <Field id="q-dom" label="Domínio próprio (opcional)" hint="Fica pendente até a verificação de posse por DNS; nada é alterado no DNS público."><input id="q-dom" className={inputCls} value={get(a, "brand.custom_domain") ?? ""} onChange={(e) => { const v = e.target.value.trim().toLowerCase(); set("brand.custom_domain", v || undefined); }} /></Field>
            <p className="text-xs text-muted-foreground">O logotipo é enviado pelo administrador da clínica depois do primeiro acesso, em Configurações ▸ Marca.</p>
          </>}

          {step === 6 && <>
            <h3 className="text-lg font-semibold mb-1">G · Integrações</h3>
            <p className="text-sm text-muted-foreground mb-4">Marcar significa <strong>interesse</strong>: nada é conectado. A clínica cadastra as próprias credenciais depois, por canal seguro. Nenhuma credencial da HP é copiada.</p>
            <Checks name="Integrações" options={INTEGRATIONS} value={get(a, "integrations") ?? []} onChange={(v) => set("integrations", v)} />
          </>}

          {step === 7 && <>
            <h3 className="text-lg font-semibold mb-4">H · Plano e implantação</h3>
            <Field id="q-plan" label="Plano" hint="Valores e limites dos planos em rascunho ainda não foram definidos; nenhuma cobrança é gerada.">
              <select id="q-plan" className={inputCls} value={get(a, "plan.plan_key") ?? ""} onChange={(e) => set("plan.plan_key", e.target.value)}>
                {planOpts.map((p) => <option key={p.key} value={p.key}>{p.name}{p.status === "draft" ? " (rascunho)" : ""} — mensalidade {fmtMoney(p.monthly_fee_cents)}</option>)}
              </select></Field>
            <Field id="q-impl" label="Implantação"><select id="q-impl" className={inputCls} value={get(a, "plan.implementation") ?? "standard"} onChange={(e) => set("plan.implementation", e.target.value)}><option value="standard">Padrão (automática)</option><option value="assisted">Assistida (acompanhada pela equipe)</option></select></Field>
            <label className="flex items-center gap-2 text-sm"><input type="checkbox" checked={Boolean(get(a, "plan.training"))} onChange={(e) => set("plan.training", e.target.checked)} />Contratar treinamento (a agendar; item pendente após a criação)</label>
          </>}

          {step === 8 && <>
            <h3 className="text-lg font-semibold mb-4">I · Revisão</h3>
            <State loading={busy && !validation} />
            {validation && <>
              {validation.errors.length > 0 && <div role="alert" className="mb-4 rounded-md border border-destructive/40 p-3 text-sm" data-testid="val-errors"><p className="font-semibold text-destructive mb-1">Corrija antes de criar:</p>
                <ul className="grid gap-1">{validation.errors.map((e, i) => <li key={i}><button type="button" className="underline text-left" onClick={() => void go(STEP_OF[e.path.split(".")[0]] ?? 0)}>{e.message}</button></li>)}</ul></div>}
              {validation.warnings.length > 0 && <div className="mb-4 rounded-md border border-border p-3 text-sm bg-muted/40" data-testid="val-warnings"><p className="font-semibold mb-1">Avisos</p><ul className="list-disc pl-5">{validation.warnings.map((e, i) => <li key={i}>{e.message}</li>)}</ul></div>}
              <dl className="grid gap-x-6 gap-y-1.5 text-sm sm:grid-cols-[10rem_1fr] mb-4">
                <dt className="text-muted-foreground">Empresa</dt><dd>{name} · {segment}</dd>
                <dt className="text-muted-foreground">Responsável</dt><dd>{get(a, "company.responsible.name")} ({get(a, "company.responsible.email")})</dd>
                <dt className="text-muted-foreground">Unidades</dt><dd>{units.map((u) => u.name).join(", ")}</dd>
                <dt className="text-muted-foreground">Módulos</dt><dd>{validation.modules_final.join(", ")}</dd>
                <dt className="text-muted-foreground">Endereço</dt><dd>{get(a, "brand.subdomain")}.localhost (Dev)</dd>
                <dt className="text-muted-foreground">Plano</dt><dd>{get(a, "plan.plan_key")} · implantação {get(a, "plan.implementation") === "assisted" ? "assistida" : "padrão"}</dd>
                <dt className="text-muted-foreground">Modelo</dt><dd>{segment} v{validation.template_version ?? "?"}</dd>
              </dl>
              <p className="text-xs text-muted-foreground mb-4">Nenhum dado, paciente, credencial ou registro da HP é copiado. Repetir a criação não duplica o ambiente.</p>
              <button type="button" className={btnPrimary} disabled={busy || !validation.ok} onClick={() => void submit()} data-testid="criar-aplicativo"><Check size={16} className="mr-1" />{busy ? "Criando…" : "Criar aplicativo"}</button>
            </>}
          </>}

          <div className="flex flex-wrap items-center gap-2 mt-6 pt-4 border-t border-border">
            <button type="button" className={btnGhost} disabled={step === 0} onClick={() => void go(step - 1)}>Voltar</button>
            {step < 8 && <button type="button" className={btnPrimary} onClick={() => void go(step + 1)} data-testid="proximo">Próximo</button>}
            <button type="button" className={btnGhost + " ml-auto"} onClick={() => void save()} data-testid="salvar-rascunho">Salvar rascunho</button>
            <span className="text-xs text-muted-foreground" aria-live="polite">{saved ? `Salvo às ${saved}` : "Não salvo"} · chave <code>{key.slice(0, 10)}…</code></span>
          </div>
        </div>
      )}
    </div>
  );
};
export default Questionnaire;
