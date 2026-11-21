import { useState } from "react";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { Badge, btnGhost, btnPrimary, inputCls, Msg, PageHead, State, Table, Td, useMsg } from "@/lib/ui";
import { fmtDateTime } from "@/lib/format";
import { fmtMoney, prpc, type Catalog, type Plan } from "./api";

const MOD_TONE = { available: "success", experimental: "warning", planned: "neutral" } as const;
const MOD_TEXT = { available: "disponível", experimental: "experimental", planned: "planejado" } as const;
const ENF: Record<string, string> = { rls_rpc: "servidor (RLS + funções)", rls: "servidor (RLS)", none: "somente por papel (sem bloqueio por módulo)" };

export const CatalogPage = () => {
  const q = useQuery({ queryKey: ["plat-catalog"], queryFn: () => prpc<Catalog>("platform_catalog") });
  const c = q.data;
  return (
    <div>
      <PageHead eyebrow="Plataforma" title="Modelos e módulos" hint="Segmentos têm modelos versionados (módulos, vocabulário, funções, funis, categorias e checklist). Atualizar um modelo não sobrescreve clientes já personalizados: cada organização guarda a versão aplicada." />
      <State loading={q.isLoading} error={q.error} />
      {c && <div className="grid gap-8">
        <section><h3 className="font-semibold mb-2">Segmentos</h3>
          <Table head={["Segmento", "Estado", "Modelo publicado", "Descrição"]}>{c.segments.map((s) => { const t = c.templates.find((x) => x.segment_key === s.key && x.status === "published");
            return <tr key={s.key}><Td><strong>{s.name}</strong></Td><Td><Badge tone={s.status === "available" ? "success" : "neutral"}>{s.status === "available" ? "disponível" : "planejado"}</Badge></Td><Td>{t ? `v${t.version}` : "—"}</Td><Td className="text-xs text-muted-foreground">{s.description}</Td></tr>; })}</Table></section>
        <section><h3 className="font-semibold mb-2">Módulos</h3>
          <Table head={["Módulo", "Estado", "Segmentos", "Depende de", "Aplicação no servidor"]}>{c.modules.map((x) => (
            <tr key={x.key}><Td><strong>{x.name}</strong>{x.core && <span className="text-xs text-muted-foreground"> · base</span>}<div className="text-xs text-muted-foreground max-w-md">{x.description}</div></Td><Td><Badge tone={MOD_TONE[x.status]}>{MOD_TEXT[x.status]}</Badge></Td>
              <Td className="text-xs">{x.segments.length ? x.segments.join(", ") : "todos"}</Td><Td className="text-xs">{x.requires.filter((r) => r !== "core").join(", ") || "—"}</Td><Td className="text-xs">{ENF[x.enforcement] ?? x.enforcement}</Td></tr>))}</Table></section>
        <section><h3 className="font-semibold mb-2">Modelos publicados</h3>
          <div className="grid gap-4 md:grid-cols-2">{c.templates.map((t) => (
            <div key={t.segment_key + t.version} className="hp-card p-4 text-sm"><p className="font-semibold">{t.segment_key} · v{t.version} <Badge tone={t.status === "published" ? "success" : "neutral"}>{t.status}</Badge></p>
              <p className="text-xs text-muted-foreground mt-1">Padrão: {t.default_modules.join(", ")}</p><p className="text-xs text-muted-foreground">Opcionais: {t.optional_modules.join(", ")}</p>
              <p className="text-xs text-muted-foreground">Vocabulário: {Object.entries(t.vocabulary).map(([k, v]) => `${k}=${v}`).join(" · ")}</p>
              {t.notes && <p className="text-xs mt-2">{t.notes}</p>}</div>))}</div></section>
      </div>}
    </div>
  );
};

export interface HistoryRow { at: string; action: string; before: Record<string, unknown> | null; after: Record<string, unknown> | null }
export const limText = (limits: Record<string, unknown>, k: string) => (!(k in limits) ? "" : limits[k] === null ? "ilimitado" : String(limits[k]));
const DIFF_KEYS = ["name", "status", "monthly_fee_cents", "implementation_fee_cents", "included_modules", "limits", "plan_key", "enforcement", "limits_override", "implementation_status", "notes"];
/** Histórico antes → depois (só os campos que mudaram). */
export const HistoryList = ({ rows, testid }: { rows?: HistoryRow[]; testid: string }) => (
  <section aria-label="Histórico de alterações" data-testid={testid}>
    <h4 className="text-xs font-semibold text-muted-foreground mb-1">Histórico de alterações</h4>
    {!rows?.length ? <p className="text-xs text-muted-foreground">Sem alterações registradas.</p> : <ul className="grid gap-1 text-xs">{rows.map((r, i) => {
      const ch = DIFF_KEYS.filter((k) => JSON.stringify(r.before?.[k] ?? null) !== JSON.stringify(r.after?.[k] ?? null));
      return <li key={i}><span className="tabular text-muted-foreground">{fmtDateTime(r.at)}</span> · {r.before ? "alterado" : "criado"}{ch.length ? `: ${ch.map((k) => `${k} ${r.before ? JSON.stringify(r.before[k] ?? null) + " → " : ""}${JSON.stringify(r.after?.[k] ?? null)}`).join("; ")}` : ""}</li>;
    })}</ul>}
  </section>
);

const PlanEditor = ({ plan, modules, onDone }: { plan: Plan; modules: { key: string; name: string }[]; onDone: () => void }) => {
  const [msg, m] = useMsg(); const [busy, setBusy] = useState(false);
  const [f, setF] = useState({ name: plan.name, status: plan.status, impl: plan.implementation_fee_cents == null ? "" : String(plan.implementation_fee_cents / 100), month: plan.monthly_fee_cents == null ? "" : String(plan.monthly_fee_cents / 100),
    users: limText(plan.limits, "max_staff_users"), prof: limText(plan.limits, "max_professionals"), units: limText(plan.limits, "max_units"), patients: limText(plan.limits, "max_active_patients"), storage: limText(plan.limits, "storage_mb") });
  const [inc, setInc] = useState<string[]>(plan.included_modules);
  // campo vazio = NÃO CONFIGURADO (a chave não existe); "ilimitado" = sem teto (nulo explícito); número (inclusive 0) = limite
  const num = (s: string): number | null | undefined => (s.trim() === "" ? undefined : /^ilimitad/i.test(s.trim()) ? null : Number(s.replace(",", ".")));
  const hist = useQuery({ queryKey: ["plat-history", "plan", plan.key], queryFn: () => prpc<HistoryRow[]>("platform_history", { p_type: "plan", p_id: plan.key, p_limit: 20 }) });
  const save = async () => {
    setBusy(true);
    try {
      const limits: Record<string, number | null> = {}; const put = (k: string, v?: number | null) => { if (v === null || (v !== undefined && !Number.isNaN(v))) limits[k] = v; };
      put("max_staff_users", num(f.users)); put("max_professionals", num(f.prof)); put("max_units", num(f.units)); put("max_active_patients", num(f.patients)); put("storage_mb", num(f.storage));
      const cents = (s: string) => { const v = num(s); return v == null ? null : Math.round(v * 100); };
      if (Object.values(limits).some((v) => v !== null && (v < 0 || !Number.isInteger(v)))) throw new Error("Limites precisam ser números inteiros não negativos, ou “ilimitado”.");
      await prpc("platform_plan_save", { p_key: plan.key, p_patch: { name: f.name, status: f.status, implementation_fee_cents: cents(f.impl), monthly_fee_cents: cents(f.month), included_modules: inc, limits } });
      m.ok("Plano salvo (nenhuma cobrança é gerada)."); onDone(); await hist.refetch();
    } catch (e) { m.err((e as Error).message); } finally { setBusy(false); }
  };
  const fld = (k: keyof typeof f, label: string, ph?: string) => <label className="text-sm block"><span className="block text-xs text-muted-foreground mb-1">{label}</span><input className={inputCls} value={f[k]} placeholder={ph} onChange={(e) => setF({ ...f, [k]: e.target.value })} /></label>;
  return (
    <div className="p-4 border-t border-border bg-muted/40 grid gap-3"><Msg m={msg} />
      <div className="grid gap-3 sm:grid-cols-3">{fld("name", "Nome")}<label className="text-sm block"><span className="block text-xs text-muted-foreground mb-1">Estado</span><select className={inputCls} value={f.status} onChange={(e) => setF({ ...f, status: e.target.value as Plan["status"] })}><option value="draft">Rascunho</option><option value="active">Ativo</option><option value="retired">Encerrado</option></select></label>
        {fld("impl", "Implantação (R$)", "a definir")}{fld("month", "Mensalidade (R$)", "a definir")}</div>
      <div className="grid gap-3 sm:grid-cols-5">{fld("users", "Usuários da equipe", "não configurado")}{fld("prof", "Profissionais", "não configurado")}{fld("units", "Unidades", "não configurado")}{fld("patients", "Pacientes ativos", "não configurado")}{fld("storage", "Armazenamento (MB)", "não configurado")}</div>
      <p className="text-xs text-muted-foreground">Vazio = <strong>não configurado</strong> (sem limite definido) · <strong>ilimitado</strong> = sem teto, definido de propósito · <strong>0</strong> = nenhum. Só unidades e profissionais podem bloquear novas criações (com imposição ligada na organização); usuários, pacientes e armazenamento são medidos e avisados.</p>
      <fieldset><legend className="text-xs text-muted-foreground mb-1">Módulos incluídos</legend><div className="flex flex-wrap gap-x-4 gap-y-1">{modules.map((x) => <label key={x.key} className="text-sm flex items-center gap-1.5"><input type="checkbox" checked={inc.includes(x.key)} onChange={(e) => setInc(e.target.checked ? [...inc, x.key] : inc.filter((k) => k !== x.key))} />{x.name}</label>)}</div></fieldset>
      <div><button className={btnPrimary} disabled={busy} onClick={() => void save()}>Salvar plano</button></div>
      <HistoryList rows={hist.data} testid="plan-history" />
    </div>
  );
};

export const PlansPage = () => {
  const qc = useQueryClient(); const [open, setOpen] = useState<string | null>(null);
  const q = useQuery({ queryKey: ["plat-catalog"], queryFn: () => prpc<Catalog>("platform_catalog") });
  const [msgNew, mNew] = useMsg(); const [nk, setNk] = useState(""); const [nn, setNn] = useState("");
  const createPlan = async () => {
    try { await prpc("platform_plan_save", { p_key: nk.trim(), p_patch: { name: nn.trim() || nk.trim(), status: "draft" } }); mNew.ok("Plano criado em rascunho, sem preço. Defina módulos e limites em “Editar”."); setNk(""); setNn(""); await qc.invalidateQueries({ queryKey: ["plat-catalog"] }); setOpen(nk.trim()); }
    catch (e) { mNew.err((e as Error).message); }
  };
  const orgs = useQuery({ queryKey: ["plat-orgs"], queryFn: () => prpc<{ id: string; name: string; plan: string | null; units: number; staff_users: number; modules: number; implementation: string | null }[]>("platform_orgs_list") });
  return (
    <div>
      <PageHead eyebrow="Plataforma" title="Planos e consumo" hint="Plano da plataforma (cobrança do produto) é separado do financeiro da clínica. Valores e limites são definidos por você: nada é inventado nem cobrado automaticamente; limites nunca apagam dados nem bloqueiam histórico ou exportação." />
      <State loading={q.isLoading} error={q.error} />
      <section className="hp-card p-4 mb-4" aria-label="Novo plano"><Msg m={msgNew} />
        <div className="flex flex-wrap items-end gap-2"><label className="text-sm"><span className="block text-xs text-muted-foreground mb-1">Chave (letras minúsculas, números e _; ex.: qa_teste)</span><input className={inputCls} value={nk} onChange={(e) => setNk(e.target.value)} data-testid="novo-plano-chave" /></label>
          <label className="text-sm"><span className="block text-xs text-muted-foreground mb-1">Nome</span><input className={inputCls} value={nn} onChange={(e) => setNn(e.target.value)} data-testid="novo-plano-nome" /></label>
          <button className={btnPrimary} disabled={!/^[a-z][a-z0-9_]{1,40}$/.test(nk.trim())} onClick={() => void createPlan()} data-testid="criar-plano">Criar plano (rascunho, sem preço)</button></div>
        <p className="text-xs text-muted-foreground mt-2">Use o prefixo <code>qa_</code> em planos de teste. Plano novo nasce sem valores: preços só existem se você os informar, e nada é cobrado.</p></section>
      {q.data && <div className="hp-card overflow-x-auto mb-8"><table className="hp-table" data-testid="plans-table"><thead><tr className="text-left"><th scope="col">Plano</th><th scope="col">Estado</th><th scope="col">Implantação</th><th scope="col">Mensalidade</th><th scope="col">Limites</th><th scope="col"><span className="sr-only">Editar</span></th></tr></thead><tbody>
        {q.data.plans.map((p) => (<><tr key={p.key}><Td><strong>{p.name}</strong><div className="text-xs text-muted-foreground max-w-xs">{p.description}</div></Td><Td><Badge tone={p.status === "active" ? "success" : "neutral"}>{p.status === "active" ? "ativo" : p.status === "draft" ? "rascunho" : "encerrado"}</Badge></Td>
          <Td>{fmtMoney(p.implementation_fee_cents)}</Td><Td>{fmtMoney(p.monthly_fee_cents)}</Td><Td className="text-xs">{Object.keys(p.limits).length ? Object.entries(p.limits).map(([k, v]) => `${k}: ${String(v)}`).join(" · ") : "sem limites definidos"}</Td>
          <Td><button className={btnGhost + " h-8 text-xs"} onClick={() => setOpen(open === p.key ? null : p.key)}>{open === p.key ? "Fechar" : "Editar"}</button></Td></tr>
          {open === p.key && <tr key={p.key + "e"}><td colSpan={6} className="!p-0"><PlanEditor plan={p} modules={q.data!.modules.filter((x) => !x.core && x.status !== "planned")} onDone={() => { void qc.invalidateQueries({ queryKey: ["plat-catalog"] }); }} /></td></tr>}</>))}
      </tbody></table></div>}
      <h3 className="font-semibold mb-2">Consumo por organização</h3>
      <State loading={orgs.isLoading} error={orgs.error} />
      {orgs.data && <Table head={["Organização", "Plano", "Unidades", "Usuários", "Módulos", "Implantação"]} right={[2, 3, 4]}>{orgs.data.map((o) => <tr key={o.id}><Td><strong>{o.name}</strong></Td><Td>{o.plan ?? "—"}</Td><Td num>{o.units}</Td><Td num>{o.staff_users}</Td><Td num>{o.modules}</Td><Td>{o.implementation ?? "—"}</Td></tr>)}</Table>}
      <p className="text-xs text-muted-foreground mt-2">Detalhes de consumo e limites por organização: Organizações ▸ Detalhes.</p>
    </div>
  );
};

export const PlatformAuditPage = () => {
  const q = useQuery({ queryKey: ["plat-audit-all"], queryFn: () => prpc<{ id: number; at: string; action: string; org_id: string | null; entity_type: string; entity_id: string | null; actor: string | null }[]>("platform_audit_list", { p_limit: 200 }) });
  return (
    <div>
      <PageHead eyebrow="Plataforma" title="Auditoria da plataforma" hint="Ações administrativas da plataforma (criação de organizações, módulos, planos, endereços, exportações). Sem conteúdo de pacientes nem segredos." />
      <State loading={q.isLoading} error={q.error} empty={q.data?.length === 0} emptyText="Sem registros." />
      {q.data && q.data.length > 0 && <Table head={["Quando", "Ação", "Entidade", "Organização"]}>{q.data.map((a) => <tr key={a.id}><Td className="whitespace-nowrap tabular">{fmtDateTime(a.at)}</Td><Td>{a.action}</Td><Td className="text-xs">{a.entity_type}{a.entity_id ? ` · ${a.entity_id}` : ""}</Td><Td className="text-xs">{a.org_id ?? "—"}</Td></tr>)}</Table>}
    </div>
  );
};
