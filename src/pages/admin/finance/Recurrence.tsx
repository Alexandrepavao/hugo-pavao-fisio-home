import { useState, type FormEvent } from "react";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { Area, AreaChart, CartesianGrid, ResponsiveContainer, Tooltip, XAxis, YAxis } from "recharts";
import { supabase } from "@/lib/supabase";
import { brl, fmtDate, parseCents } from "@/lib/format";
import { btnGhost, errText, FilterBar, FilterField, Msg, PageHead, promptText, State, StatCard, Table, Tabs, Td, useMsg } from "@/lib/ui";
import { axisBrl, mfmt, useUnits, type Metric } from "./shared";

interface Bridge { mrr_inicial_cents: number; novo_cents: number; expansao_cents: number; reativacao_cents: number; contracao_cents: number; cancelamento_cents: number; mrr_final_cents: number; fecha: boolean }
interface MrrReport { month: string; mrr_cents: Metric; arr_cents: Metric; bridge: Bridge; churn_clientes_pct: Metric; churn_receita_pct: Metric; retencao_bruta_pct: Metric; retencao_liquida_pct: Metric; receita_media_cliente_cents: Metric; clientes_recorrentes: number }
interface ForecastRow { person_id: string; person_name: string; product_name: string; projected_amount_cents: number; origin_paid_at: string; origin_competence: string }

const BridgeRow = ({ label, cents, tone }: { label: string; cents: number; tone?: "success" | "danger" }) => (
  <li className="flex items-center justify-between py-2 border-b border-border last:border-0 text-sm">
    <span className="text-muted-foreground">{label}</span>
    <span className={`tabular font-medium ${tone === "success" ? "text-[hsl(var(--success))]" : tone === "danger" ? "text-destructive" : ""}`}>{tone === "success" && cents > 0 ? "+" : ""}{brl(cents)}</span>
  </li>
);

const FinanceRecurrence = () => {
  const [tab, setTab] = useState("relatorio");
  return (
    <div>
      <PageHead eyebrow="Financeiro" title="Recorrência e forecast" hint="MRR vem de contratos recorrentes explícitos (com vigência por data efetiva) — nunca de parcela de venda avulsa nem de pagamento recebido. ARR = MRR × 12." />
      <Tabs tabs={[["relatorio", "Relatório"], ["contratos", "Contratos recorrentes"]]} value={tab} onChange={setTab} />
      {tab === "relatorio" && <Report />}
      {tab === "contratos" && <ContractsSection />}
    </div>
  );
};

const Report = () => {
  const [month, setMonth] = useState(new Date().toISOString().slice(0, 7));
  const [unit, setUnit] = useState("");
  const units = useUnits();
  const report = useQuery({ queryKey: ["mrr", month, unit], queryFn: async () => {
    const { data, error } = await supabase.rpc("mrr_report", { p_month: `${month}-01`, p_unit: unit || null }); if (error) throw error; return data as MrrReport;
  } });
  const history = useQuery({ queryKey: ["mrr-hist", unit], queryFn: async () => {
    const { data, error } = await supabase.rpc("mrr_history", { p_months: 12, p_unit: unit || null }); if (error) throw error;
    // mrr_history() devolve generate_series(..., interval) → timestamp completo (não uma data pura); nada de concatenar hora de novo.
    return (data as { month: string; mrr_cents: number }[]).map((r) => ({ mes: fmtDate(r.month).slice(0, 5), MRR: r.mrr_cents / 100 }));
  } });
  const forecast = useQuery({ queryKey: ["forecast-rec"], queryFn: async () => {
    const next = new Date(); next.setMonth(next.getMonth() + 1);
    const { data, error } = await supabase.rpc("subscription_forecast", { p_month: next.toISOString().slice(0, 10) }); if (error) throw error; return data as ForecastRow[];
  } });
  const forecastTotal = (forecast.data ?? []).reduce((a, r) => a + r.projected_amount_cents, 0);

  return (
    <>
      <FilterBar>
        <FilterField label="Mês" htmlFor="rm"><input id="rm" type="month" value={month} onChange={(e) => setMonth(e.target.value)} /></FilterField>
        <FilterField label="Unidade" htmlFor="ru"><select id="ru" value={unit} onChange={(e) => setUnit(e.target.value)}><option value="">Todas</option>{units.data?.map((u) => <option key={u.id} value={u.id}>{u.name}</option>)}</select></FilterField>
      </FilterBar>
      <State loading={report.isLoading} error={report.error} />
      {report.data && (<>
        <ul className="grid gap-3 sm:grid-cols-2 lg:grid-cols-4 mb-6">
          <StatCard label="MRR do mês" value={mfmt(report.data.mrr_cents)} basis={report.data.mrr_cents.basis} />
          <StatCard label="ARR" value={mfmt(report.data.arr_cents)} basis={report.data.arr_cents.basis} />
          <StatCard label="Clientes recorrentes" value={report.data.clientes_recorrentes.toLocaleString("pt-BR")} />
          <StatCard label="Receita média por cliente" value={mfmt(report.data.receita_media_cliente_cents)} basis={report.data.receita_media_cliente_cents.basis} />
          <StatCard label="Retenção bruta de receita" value={mfmt(report.data.retencao_bruta_pct, "pct")} basis={report.data.retencao_bruta_pct.basis} />
          <StatCard label="Retenção líquida de receita" value={mfmt(report.data.retencao_liquida_pct, "pct")} basis={report.data.retencao_liquida_pct.basis} />
          <StatCard label="Churn de clientes" value={mfmt(report.data.churn_clientes_pct, "pct")} basis={report.data.churn_clientes_pct.basis} tone={report.data.churn_clientes_pct.available && Number(report.data.churn_clientes_pct.value) > 0 ? "danger" : undefined} />
          <StatCard label="Churn de receita" value={mfmt(report.data.churn_receita_pct, "pct")} basis={report.data.churn_receita_pct.basis} tone={report.data.churn_receita_pct.available && Number(report.data.churn_receita_pct.value) > 0 ? "danger" : undefined} />
        </ul>

        <section className="mb-8"><h2 className="text-xl mb-3">MRR — últimos 12 meses</h2>
          {history.data && history.data.length > 0 && (
            <div className="hp-card p-4" style={{ height: 240 }}><ResponsiveContainer width="100%" height="100%">
              <AreaChart data={history.data}><CartesianGrid strokeDasharray="3 3" stroke="hsl(var(--border))" /><XAxis dataKey="mes" fontSize={12} /><YAxis fontSize={12} tickFormatter={axisBrl} />
                <Tooltip formatter={(v: number) => brl(Math.round(v * 100))} /><Area type="monotone" dataKey="MRR" stroke="hsl(var(--primary))" fill="hsl(var(--primary) / .15)" strokeWidth={2} /></AreaChart></ResponsiveContainer></div>
          )}
        </section>

        <section className="mb-8 grid gap-6 lg:grid-cols-[1fr_20rem]">
          <div><h2 className="text-xl mb-3">Ponte de movimentação do MRR</h2>
            <div className="hp-card p-4">
              <ul>
                <BridgeRow label="MRR inicial (mês anterior)" cents={report.data.bridge.mrr_inicial_cents} />
                <BridgeRow label="+ Novo" cents={report.data.bridge.novo_cents} tone="success" />
                <BridgeRow label="+ Expansão" cents={report.data.bridge.expansao_cents} tone="success" />
                <BridgeRow label="+ Reativação" cents={report.data.bridge.reativacao_cents} tone="success" />
                <BridgeRow label="− Contração" cents={report.data.bridge.contracao_cents} tone="danger" />
                <BridgeRow label="− Cancelamento" cents={report.data.bridge.cancelamento_cents} tone="danger" />
              </ul>
              <div className="flex items-center justify-between pt-3 mt-1 border-t-2 border-border">
                <span className="font-semibold">MRR final</span>
                <span className="tabular font-bold text-lg">{brl(report.data.bridge.mrr_final_cents)}</span>
              </div>
              {!report.data.bridge.fecha && <p role="alert" className="text-xs text-destructive mt-2">A ponte não fechou matematicamente — reporte este caso (não deveria acontecer).</p>}
            </div>
          </div>
          <div className="hp-card p-4 self-start"><p className="text-xs text-muted-foreground leading-relaxed">
            <strong>Novo</strong>: contrato nunca esteve ativo antes.<br /><strong>Reativação</strong>: esteve ativo antes, ficou pausado/cancelado, voltou agora.<br />
            <strong>Expansão/Contração</strong>: mesmo contrato, valor mensal mudou.<br /><strong>Cancelamento</strong>: estava ativo no mês anterior e não está mais (pausa ou cancelamento). Inadimplência não cancela — só uma mudança explícita muda o MRR.</p></div>
        </section>
      </>)}

      <section><h2 className="text-xl mb-1">Projeção de mensalidades (mês seguinte)</h2>
        <p className="bg-accent/10 border border-accent/40 p-3 text-sm mb-4"><strong>Forecast por pagamentos — não é MRR contratual nem conta a receber.</strong> É uma projeção heurística baseada em quem pagou a mensalidade na competência anterior, separada do MRR contratual acima. Mensalidade paga na competência anterior contribui para a projeção do próximo mês; quem pagou só antes disso não entra; estornos e cancelamentos saem; já contratado no mês não é duplicado.</p>
        <State loading={forecast.isLoading} error={forecast.error} empty={forecast.data?.length === 0} emptyText="Sem mensalidades pagas no mês anterior para projetar." />
        {forecast.data && forecast.data.length > 0 && <><p className="mb-3">Total projetado: <strong className="tabular">{brl(forecastTotal)}</strong></p>
          <Table head={["Pessoa", "Produto", "Valor projetado", "Origem (pagamento em)", "Competência de origem"]} right={[2]}>{forecast.data.map((r) => <tr key={r.person_id + r.product_name}><Td>{r.person_name}</Td><Td>{r.product_name}</Td><Td num>{brl(r.projected_amount_cents)}</Td><Td>{fmtDate(r.origin_paid_at)}</Td><Td>{fmtDate(r.origin_competence + "T12:00:00Z").slice(3)}</Td></tr>)}</Table></>}
      </section>
    </>
  );
};

const PERIOD_LABEL: Record<string, string> = { monthly: "Mensal", quarterly: "Trimestral", semiannual: "Semestral", annual: "Anual" };
const PERIOD_MONTHS: Record<string, number> = { monthly: 1, quarterly: 3, semiannual: 6, annual: 12 };
interface ContractRow { id: string; person_id: string; billing_period: string; created_at: string; person: { full_name: string } | null; product: { name: string } | null }
interface ContractState { contract_id: string; status: string; monthly_cents: number }

/** Registro do contrato recorrente e de suas mudanças de vigência — a única fonte do MRR/ARR (ver aba Relatório). */
const ContractsSection = () => {
  const qc = useQueryClient(); const [msg, m] = useMsg();
  const [search, setSearch] = useState(""); const [person, setPerson] = useState<{ id: string; full_name: string; unit_id: string | null } | null>(null);
  const [product, setProduct] = useState(""); const [period, setPeriod] = useState("monthly"); const [amount, setAmount] = useState(""); const [discount, setDiscount] = useState("0,00");
  const [starts, setStarts] = useState(new Date().toISOString().slice(0, 10)); const [busy, setBusy] = useState(false);

  const found = useQuery({ queryKey: ["ppl-rc", search], enabled: search.length >= 2 && !person, queryFn: async () => (await supabase.from("people").select("id, full_name, unit_id").ilike("full_name", `%${search.replace(/[%_]/g, "")}%`).is("merged_into_id", null).limit(6)).data ?? [] });
  const products = useQuery({ queryKey: ["products-rc"], queryFn: async () => (await supabase.from("products").select("id, name").eq("active", true).order("name")).data ?? [] });
  const contracts = useQuery({ queryKey: ["rc-list"], queryFn: async () => (await supabase.from("recurring_contracts").select("id, person_id, billing_period, created_at, person:people(full_name), product:products(name)").order("created_at", { ascending: false })).data as unknown as ContractRow[] });
  // Estado atual de cada contrato = última mudança com effective_on <= hoje (mesma regra de private.contract_state_at no banco).
  const currentStates = useQuery({ queryKey: ["rc-current-states"], queryFn: async () => {
    const { data, error } = await supabase.from("recurring_contract_changes").select("contract_id, effective_on, change_type, gross_monthly_cents, discount_monthly_cents").lte("effective_on", new Date().toISOString().slice(0, 10)).order("effective_on", { ascending: false }).order("created_at", { ascending: false });
    if (error) throw error;
    const latest = new Map<string, { change_type: string; gross_monthly_cents: number; discount_monthly_cents: number }>();
    for (const row of data ?? []) if (!latest.has(row.contract_id)) latest.set(row.contract_id, row);
    const out: ContractState[] = [];
    latest.forEach((v, contract_id) => out.push({ contract_id, status: v.change_type === "pause" ? "paused" : v.change_type === "cancel" ? "cancelled" : "active", monthly_cents: v.gross_monthly_cents - v.discount_monthly_cents }));
    return out;
  } });
  const stateOf = (id: string) => currentStates.data?.find((s) => s.contract_id === id);

  const create = async (e: FormEvent) => {
    e.preventDefault(); if (!person?.unit_id) return m.err("Selecione a pessoa (com unidade)."); if (!amount) return m.err("Informe o valor do período.");
    const cents = parseCents(amount); const discCents = parseCents(discount) ?? 0;
    if (cents == null) return m.err("Valor inválido.");
    setBusy(true);
    const { error } = await supabase.rpc("recurring_contract_start", { p_person: person.id, p_unit: person.unit_id, p_product: product || null, p_billing_period: period, p_period_amount_cents: cents, p_period_discount_cents: discCents, p_starts_on: starts, p_source_sale: null, p_notes: null });
    setBusy(false);
    if (error) return m.err(errText(error));
    m.ok("Contrato recorrente criado."); setPerson(null); setSearch(""); setAmount(""); setDiscount("0,00");
    void qc.invalidateQueries({ queryKey: ["rc-list"] }); void qc.invalidateQueries({ queryKey: ["rc-current-states"] });
  };

  const recordChange = async (contract: ContractRow, type: "expansion" | "contraction" | "pause" | "resume" | "cancel") => {
    let periodAmount: number | null = null; const periodDiscount = 0; let reason: string | null = null;
    if (type === "expansion" || type === "contraction" || type === "resume") {
      const label = type === "resume" ? "Retomar contrato" : type === "expansion" ? "Expandir contrato" : "Reduzir contrato";
      const v = await promptText(label, `Novo valor do período (${PERIOD_LABEL[contract.billing_period]}, em R$)`, { kind: "number" });
      if (!v) return; const cents = parseCents(v); if (cents == null || cents <= 0) return m.err("Valor inválido.");
      periodAmount = cents;
    }
    if (type === "contraction" || type === "cancel") {
      reason = await promptText(type === "cancel" ? "Cancelar contrato" : "Motivo da redução", "Motivo (obrigatório)", { multiline: true, confirmLabel: type === "cancel" ? "Cancelar" : "Confirmar", danger: type === "cancel" });
      if (!reason) return;
    }
    const effDefault = new Date().toISOString().slice(0, 10);
    const eff = type === "cancel" ? (await promptText("Data efetiva do cancelamento", "AAAA-MM-DD (pode ser uma data futura)", { defaultValue: effDefault })) : effDefault;
    if (!eff) return;
    const { error } = await supabase.rpc("recurring_contract_change", { p_contract: contract.id, p_change_type: type, p_effective_on: eff, p_period_amount_cents: periodAmount, p_period_discount_cents: periodDiscount, p_reason: reason });
    if (error) return m.err(errText(error));
    m.ok("Mudança registrada."); void qc.invalidateQueries({ queryKey: ["rc-current-states"] });
  };

  return (<>
    <Msg m={msg} />
    <p className="text-sm text-muted-foreground mb-3">Cada linha aqui é um compromisso contratual com vigência própria — não uma venda nem uma parcela. O valor é sempre informado no período contratado (ex.: anual = valor do ano) e convertido para mensal no servidor.</p>
    <form onSubmit={create} className="hp-card p-4 mb-6 grid gap-3 sm:grid-cols-6 items-end" noValidate>
      <div className="sm:col-span-2"><label htmlFor="rcp" className="block text-xs mb-1">Pessoa</label><input id="rcp"   value={person ? person.full_name : search} onChange={(e) => { setPerson(null); setSearch(e.target.value); }} />
        {!person && found.data?.map((p) => <button type="button" key={p.id} className="block w-full text-left p-2 border border-border bg-card hover:bg-muted" onClick={() => setPerson(p)}>{p.full_name}</button>)}</div>
      <div><label htmlFor="rcprod" className="block text-xs mb-1">Produto (opcional)</label><select id="rcprod"   value={product} onChange={(e) => setProduct(e.target.value)}><option value="">Nenhum</option>{products.data?.map((p) => <option key={p.id} value={p.id}>{p.name}</option>)}</select></div>
      <div><label htmlFor="rcper" className="block text-xs mb-1">Periodicidade</label><select id="rcper"   value={period} onChange={(e) => setPeriod(e.target.value)}>{Object.entries(PERIOD_LABEL).map(([k, l]) => <option key={k} value={k}>{l}</option>)}</select></div>
      <div><label htmlFor="rcam" className="block text-xs mb-1">Valor do período (R$)</label><input id="rcam" inputMode="decimal"   value={amount} onChange={(e) => setAmount(e.target.value)} /></div>
      <div><label htmlFor="rcds" className="block text-xs mb-1">Desconto do período (R$)</label><input id="rcds" inputMode="decimal"   value={discount} onChange={(e) => setDiscount(e.target.value)} /></div>
      <div><label htmlFor="rcst" className="block text-xs mb-1">Início</label><input id="rcst" type="date"   value={starts} onChange={(e) => setStarts(e.target.value)} /></div>
      <div className="sm:col-span-6"><button disabled={busy} className="hp-btn hp-btn-primary disabled:opacity-60">{busy ? "Criando…" : "Criar contrato"}</button></div>
    </form>
    <State loading={contracts.isLoading} error={contracts.error} empty={contracts.data?.length === 0} emptyText="Nenhum contrato recorrente cadastrado." />
    {contracts.data && contracts.data.length > 0 && <Table head={["Pessoa", "Produto", "Periodicidade", "Mensal (líquido)", "Estado", ""]} right={[3]}>
      {contracts.data.map((c) => { const st = stateOf(c.id); return (
        <tr key={c.id}><Td>{c.person?.full_name}</Td><Td>{c.product?.name ?? "—"}</Td><Td>{PERIOD_LABEL[c.billing_period]}</Td>
          <Td num>{st ? brl(st.monthly_cents) : "—"}</Td>
          <Td>{st?.status === "active" ? "Ativo" : st?.status === "paused" ? "Pausado" : st?.status === "cancelled" ? "Cancelado" : "—"}</Td>
          <Td>{st?.status === "active" && <div className="flex flex-wrap gap-1 text-xs">
            <button className={btnGhost + " hp-btn-sm"} onClick={() => recordChange(c, "expansion")}>Expandir</button>
            <button className={btnGhost + " hp-btn-sm"} onClick={() => recordChange(c, "contraction")}>Reduzir</button>
            <button className={btnGhost + " hp-btn-sm"} onClick={() => recordChange(c, "pause")}>Pausar</button>
            <button className={btnGhost + " hp-btn-sm"} onClick={() => recordChange(c, "cancel")}>Cancelar</button></div>}
            {st?.status === "paused" && <button className={btnGhost + " hp-btn-sm"} onClick={() => recordChange(c, "resume")}>Retomar</button>}</Td>
        </tr>); })}</Table>}
  </>);
};

export default FinanceRecurrence;
