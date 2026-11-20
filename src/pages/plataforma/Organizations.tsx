import { useState } from "react";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { Link } from "react-router-dom";
import { Badge, btnGhost, btnPrimary, inputCls, Msg, PageHead, State, Td, useMsg } from "@/lib/ui";
import { ORG_STATUS, prpc, type Catalog, type OrgRow } from "./api";
import { supabase } from "@/lib/supabase";
import { fmtDateTime } from "@/lib/format";
import UsageView, { type UsageData } from "./UsageView";
import { HistoryList, limText, type HistoryRow } from "./CatalogPlans";

interface OrgModule { module_key: string; enabled: boolean; source: string }
interface Sub { subscription: { plan_key: string; status: string; enforcement: string; limits_override: Record<string, unknown>; implementation_status: string; notes: string | null }; plan: { key: string; name: string; status: string } }

/** Assinatura da organização no PLANO DA PLATAFORMA (não é o financeiro da clínica): plano, estado, imposição de novas criações e exceções de limite (vazio = usa o plano; "ilimitado"; 0). Com histórico. */
const SubscriptionPanel = ({ orgId, plans, onSaved }: { orgId: string; plans: Catalog["plans"]; onSaved: () => void }) => {
  const qc = useQueryClient(); const [msg, m] = useMsg(); const [busy, setBusy] = useState(false);
  const sub = useQuery({ queryKey: ["plat-sub", orgId], queryFn: () => prpc<Sub | null>("platform_org_subscription", { p_org: orgId }) });
  const hist = useQuery({ queryKey: ["plat-history", "subscription", orgId], queryFn: () => prpc<HistoryRow[]>("platform_history", { p_type: "subscription", p_id: orgId, p_limit: 20 }) });
  const [f, setF] = useState<{ plan: string; status: string; enforcement: string; units: string; prof: string } | null>(null);
  const cur = sub.data?.subscription;
  const form = f ?? (cur ? { plan: cur.plan_key, status: cur.status, enforcement: cur.enforcement, units: limText(cur.limits_override, "max_units"), prof: limText(cur.limits_override, "max_professionals") } : { plan: "", status: "trial", enforcement: "warn", units: "", prof: "" });
  const lim = (s: string): number | null | undefined => (s.trim() === "" ? undefined : /^ilimitad/i.test(s.trim()) ? null : Number(s));
  const save = async () => {
    setBusy(true);
    try {
      const override: Record<string, number | null> = {}; const u = lim(form.units), p = lim(form.prof); if (u !== undefined) override.max_units = u; if (p !== undefined) override.max_professionals = p;
      await prpc("platform_subscription_set", { p_org: orgId, p_patch: { plan_key: form.plan, status: form.status, enforcement: form.enforcement, limits_override: override } });
      m.ok("Assinatura salva. Nenhuma cobrança é gerada; o financeiro da clínica não é tocado."); setF(null); onSaved(); await qc.invalidateQueries({ queryKey: ["plat-sub", orgId] }); await qc.invalidateQueries({ queryKey: ["plat-history", "subscription", orgId] }); await qc.invalidateQueries({ queryKey: ["plat-orgs"] });
    } catch (e) { m.err((e as Error).message); } finally { setBusy(false); }
  };
  const set = (k: keyof typeof form, v: string) => setF({ ...form, [k]: v });
  return (
    <section aria-label="Plano e assinatura" className="hp-card p-4 lg:col-span-2" data-testid="assinatura">
      <h3 className="font-semibold text-foreground mb-1">Plano e assinatura</h3>
      <p className="text-xs text-muted-foreground mb-3">Plano do <strong>produto</strong> (plataforma). Separado do financeiro da clínica: nada aqui cria venda, recebível ou cobrança.</p>
      <Msg m={msg} /><State loading={sub.isLoading} error={sub.error} />
      <div className="grid gap-3 sm:grid-cols-5 items-end">
        <label className="text-sm"><span className="block text-xs text-muted-foreground mb-1">Plano</span><select className={inputCls} value={form.plan} onChange={(e) => set("plan", e.target.value)} data-testid="sub-plano"><option value="">Selecione…</option>{plans.map((p) => <option key={p.key} value={p.key}>{p.name} ({p.key}){p.status !== "active" ? ` · ${p.status === "draft" ? "rascunho" : p.status}` : ""}</option>)}</select></label>
        <label className="text-sm"><span className="block text-xs text-muted-foreground mb-1">Estado</span><select className={inputCls} value={form.status} onChange={(e) => set("status", e.target.value)}>{[["trial", "teste"], ["active", "ativa"], ["suspended", "suspensa"], ["cancelled", "cancelada"]].map(([v, l]) => <option key={v} value={v}>{l}</option>)}</select></label>
        <label className="text-sm"><span className="block text-xs text-muted-foreground mb-1">Novas criações acima do limite</span><select className={inputCls} value={form.enforcement} onChange={(e) => set("enforcement", e.target.value)} data-testid="sub-imposicao"><option value="warn">só avisar</option><option value="block_new">bloquear novas (unidades e profissionais)</option></select></label>
        <label className="text-sm"><span className="block text-xs text-muted-foreground mb-1">Exceção: unidades</span><input className={inputCls} value={form.units} placeholder="usa o plano" onChange={(e) => set("units", e.target.value)} data-testid="sub-unidades" /></label>
        <label className="text-sm"><span className="block text-xs text-muted-foreground mb-1">Exceção: profissionais</span><input className={inputCls} value={form.prof} placeholder="usa o plano" onChange={(e) => set("prof", e.target.value)} data-testid="sub-profissionais" /></label>
      </div>
      <div className="mt-3"><button className={btnPrimary} disabled={busy || !form.plan} onClick={() => void save()} data-testid="salvar-assinatura">Salvar assinatura</button></div>
      <div className="mt-4"><HistoryList rows={hist.data} testid="sub-history" /></div>
    </section>
  );
};

const OrgDetail = ({ org, catalog }: { org: OrgRow; catalog: Catalog }) => {
  const qc = useQueryClient(); const [msg, m] = useMsg(); const [host, setHost] = useState(""); const [busy, setBusy] = useState(false);
  const usage = useQuery({ queryKey: ["plat-usage", org.id], queryFn: () => prpc<UsageData>("platform_org_usage", { p_org: org.id }) });
  const audit = useQuery({ queryKey: ["plat-audit", org.id], queryFn: () => prpc<{ id: number; at: string; action: string; entity_type: string; entity_id: string | null }[]>("platform_audit_list", { p_org: org.id, p_limit: 8 }) });
  const mods = useQuery({ queryKey: ["plat-org-modules", org.id], queryFn: async () => {
    // a plataforma lê só o ESTADO de habilitação (não dados da organização): vem do resumo de módulos por função própria
    const { data, error } = await supabase.rpc("platform_org_modules", { p_org: org.id }); if (error) throw error; return data as OrgModule[];
  } });
  const on = new Set((mods.data ?? []).filter((x) => x.enabled).map((x) => x.module_key));
  const toggle = async (key: string, enabled: boolean) => {
    setBusy(true);
    try { await prpc("platform_module_set", { p_org: org.id, p_module: key, p_enabled: enabled, p_reason: "painel da plataforma" }); m.ok(`${enabled ? "Habilitado" : "Desabilitado"}: ${key}. Os dados do módulo foram preservados.`); await qc.invalidateQueries({ queryKey: ["plat-org-modules", org.id] }); await qc.invalidateQueries({ queryKey: ["plat-orgs"] }); }
    catch (e) { m.err((e as Error).message); } finally { setBusy(false); }
  };
  const addDomain = async () => {
    setBusy(true);
    try {
      const d = await prpc<{ id: string; host: string; status: string }>("platform_domain_add", { p_org: org.id, p_host: host, p_kind: host.endsWith(".localhost") ? "dev" : "subdomain" });
      if (host.endsWith(".localhost")) await prpc("platform_domain_verify", { p_domain: d.id, p_method: "manual_dev" });
      m.ok(host.endsWith(".localhost") ? `Endereço de desenvolvimento ativado: ${host}` : `Endereço cadastrado (pendente de verificação de posse): ${host}`); setHost(""); await qc.invalidateQueries({ queryKey: ["plat-orgs"] });
    } catch (e) { m.err((e as Error).message); } finally { setBusy(false); }
  };
  const candidate = catalog.modules.filter((x) => !x.core && x.status !== "planned" && (!x.segments.length || (org.segment && x.segments.includes(org.segment))));
  return (
    <div className="grid gap-5 lg:grid-cols-2 p-4 bg-muted/40 border-t border-border">
      <div className="lg:col-span-2"><Msg m={msg} /></div>
      <section aria-label="Módulos" className="hp-card p-4">
        <h3 className="font-semibold text-foreground mb-1">Módulos</h3>
        <p className="text-xs text-muted-foreground mb-3">Desabilitar bloqueia o acesso no servidor, mas <strong>não apaga dados</strong>. Dependências são validadas.</p>
        <ul className="grid gap-1.5">
          {candidate.map((x) => (
            <li key={x.key} className="flex items-center gap-2 text-sm">
              <label className="flex items-center gap-2 flex-1 min-w-0"><input type="checkbox" checked={on.has(x.key)} disabled={busy || mods.isLoading} onChange={(e) => void toggle(x.key, e.target.checked)} aria-label={`Módulo ${x.name}`} />
                <span className="truncate">{x.name}</span></label>
              {x.status === "experimental" && <Badge tone="warning">experimental</Badge>}
              {x.requires.filter((r) => r !== "core").length > 0 && <span className="text-xs text-muted-foreground hidden md:inline">requer {x.requires.filter((r) => r !== "core").join(", ")}</span>}
            </li>))}
        </ul>
      </section>
      <section aria-label="Consumo" className="hp-card p-4">
        <h3 className="font-semibold text-foreground mb-1">Consumo e limites</h3>
        <State loading={usage.isLoading} error={usage.error} />
        {usage.data && <UsageView data={usage.data} />}
      </section>
      <SubscriptionPanel orgId={org.id} plans={catalog.plans} onSaved={() => void qc.invalidateQueries({ queryKey: ["plat-usage", org.id] })} />
      <section aria-label="Endereços" className="hp-card p-4">
        <h3 className="font-semibold text-foreground mb-2">Endereços de acesso</h3>
        <p className="text-sm mb-2">{org.domains.length ? org.domains.join(", ") : "Nenhum endereço verificado."}</p>
        <div className="flex gap-2"><input className={inputCls} value={host} onChange={(e) => setHost(e.target.value)} placeholder="ex.: clinica.localhost" aria-label="Novo endereço" /><button className={btnGhost} disabled={busy || !host.trim()} onClick={() => void addDomain()}>Adicionar</button></div>
        <p className="text-xs text-muted-foreground mt-2">No Dev só endereços <code>.localhost</code> são ativados (verificação manual). Domínio público exige verificação de posse por DNS (ainda não implementada).</p>
      </section>
      <section aria-label="Auditoria recente" className="hp-card p-4">
        <h3 className="font-semibold text-foreground mb-2">Auditoria recente</h3>
        <State loading={audit.isLoading} error={audit.error} empty={audit.data?.length === 0} emptyText="Sem registros." />
        <ul className="grid gap-1 text-sm">{(audit.data ?? []).map((a) => <li key={a.id}><span className="text-muted-foreground tabular">{fmtDateTime(a.at)}</span> · {a.action}{a.entity_id ? ` · ${a.entity_id}` : ""}</li>)}</ul>
      </section>
    </div>
  );
};

const Organizations = () => {
  const [open, setOpen] = useState<string | null>(null);
  const orgs = useQuery({ queryKey: ["plat-orgs"], queryFn: () => prpc<OrgRow[]>("platform_orgs_list") });
  const catalog = useQuery({ queryKey: ["plat-catalog"], queryFn: () => prpc<Catalog>("platform_catalog") });
  return (
    <div>
      <PageHead eyebrow="Plataforma" title="Organizações" hint="Cada organização é uma empresa cliente com dados separados. A HP é uma organização como as demais, configurada na plataforma." actions={<Link to="/plataforma/criar" className={btnPrimary}>Criar aplicativo</Link>} />
      <State loading={orgs.isLoading} error={orgs.error} empty={orgs.data?.length === 0} emptyText="Nenhuma organização." />
      {orgs.data && orgs.data.length > 0 && catalog.data && (
        <div className="hp-card overflow-x-auto">
          <table className="hp-table" data-testid="orgs-table">
            <thead><tr className="text-left"><th scope="col">Organização</th><th scope="col">Segmento</th><th scope="col">Estado</th><th scope="col">Plano</th><th scope="col" className="text-right">Unid.</th><th scope="col" className="text-right">Usuários</th><th scope="col" className="text-right">Módulos</th><th scope="col"><span className="sr-only">Detalhes</span></th></tr></thead>
            <tbody>
              {orgs.data.map((o) => (<>
                <tr key={o.id} data-testid={`org-${o.slug}`}>
                  <Td><strong className="text-foreground">{o.name}</strong><div className="text-xs text-muted-foreground">{o.slug}{o.domains.length ? ` · ${o.domains[0]}` : ""}</div></Td>
                  <Td>{o.segment ?? "—"}{o.template_version ? ` v${o.template_version}` : ""}</Td>
                  <Td><Badge tone={o.status === "active" ? "success" : o.status === "provisioning" ? "info" : "warning"}>{ORG_STATUS[o.status] ?? o.status}</Badge></Td>
                  <Td>{o.plan ?? "—"}</Td><Td num>{o.units}</Td><Td num>{o.staff_users}</Td><Td num>{o.modules}</Td>
                  <Td><button className={btnGhost + " h-8 text-xs"} aria-expanded={open === o.id} onClick={() => setOpen(open === o.id ? null : o.id)}>{open === o.id ? "Fechar" : "Detalhes"}</button></Td>
                </tr>
                {open === o.id && <tr key={o.id + "d"}><td colSpan={8} className="!p-0"><OrgDetail org={o} catalog={catalog.data!} /></td></tr>}
              </>))}
            </tbody>
          </table>
        </div>
      )}
    </div>
  );
};
export default Organizations;
