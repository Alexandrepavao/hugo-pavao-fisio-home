import { useState, type FormEvent } from "react";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { supabase } from "@/lib/supabase";
import { brl, fmtDate } from "@/lib/format";
import { Badge, btnGhost, errText, Msg, PageHead, State, Table, Tabs, Td, useMsg } from "@/lib/ui";
import { PeriodFilter } from "@/lib/PeriodFilter";
import { fromInclusive, presetRange, toExclusive, usePeriodFilterState, useUnits } from "./shared";
import { SALE_LINE_FILTERS, saleLineLabel, saleLineMatches, useSaleLines, type SaleLineFilter } from "./saleLines";

interface Rule { id: string; name: string; product_id: string | null; beneficiary_user_id: string | null; percent_bp: number; active: boolean; product: { name: string } | null }
interface Member { user_id: string; display_name: string; email: string; roles: unknown[] }

const FinanceCommissions = () => {
  const [tab, setTab] = useState("lancamentos");
  return (
    <div>
      <PageHead eyebrow="Financeiro" title="Comissões e repasses" hint="Comissões são geradas automaticamente a cada recebimento, conforme as regras ativas; estornos geram lançamento negativo proporcional. A conferência abaixo recalcula cada lançamento e compara com a Visão geral." />
      <Tabs tabs={[["lancamentos", "Lançamentos"], ["regras", "Regras de comissão"]]} value={tab} onChange={setTab} />
      {tab === "lancamentos" && <Entries />}
      {tab === "regras" && <Rules />}
    </div>
  );
};

interface Entry {
  id: string; amount_cents: number; status: "pending" | "authorized" | "paid" | "reversed"; created_at: string; sale_id: string; beneficiary_user_id: string; percent_bp: number | null;
  rule: { name: string; percent_bp: number } | null; payment: { amount_cents: number; kind: "payment" | "refund"; paid_at: string; method: string | null };
}
interface Recon { entries: number; total_cents: number; recomputed_cents: number; mismatch_count: number; estimated_percent_count: number; pending_cents: number; authorized_cents: number; paid_cents: number; reversed_cents: number; finance_total_cents: number; diff_vs_finance_cents: number; ok: boolean }
const ST_LABEL: Record<Entry["status"], string> = { pending: "Pendente", authorized: "Autorizada", paid: "Paga", reversed: "Estornada" };
const pct = (bp: number | null | undefined) => (bp == null ? "—" : `${(bp / 100).toFixed(2).replace(".", ",")}%`);

const Entries = () => {
  const qc = useQueryClient(); const [msg, m] = useMsg();
  const { preset, custom, unit, onPreset, onFrom, onTo, onUnit, onClear } = usePeriodFilterState();
  const { from, to } = preset === "personalizado" ? custom : presetRange(preset); const rf = fromInclusive(from); const rt = toExclusive(to);
  const units = useUnits(); const [lineFilter, setLineFilter] = useState<SaleLineFilter>(""); const [benFilter, setBenFilter] = useState(""); const [stFilter, setStFilter] = useState("");
  const team = useQuery({ queryKey: ["comm-team"], queryFn: async () => ((await supabase.rpc("list_assignable_users", {})).data ?? []) as { user_id: string; name: string }[] });
  const list = useQuery({ queryKey: ["commissions", rf, rt, unit], queryFn: async () => {
    let q = supabase.from("commission_entries").select("id, amount_cents, status, created_at, sale_id, beneficiary_user_id, percent_bp, rule:commission_rules(name, percent_bp), payment:payments!inner(amount_cents, kind, paid_at, method)")
      .gte("payment.paid_at", rf).lt("payment.paid_at", rt).limit(500);
    if (unit) q = q.eq("unit_id", unit);
    const { data, error } = await q; if (error) throw error;
    return ((data ?? []) as unknown as Entry[]).sort((x, y) => y.payment.paid_at.localeCompare(x.payment.paid_at));
  } });
  const recon = useQuery({ queryKey: ["commission-recon", rf, rt, unit], retry: false, queryFn: async () => { const { data, error } = await supabase.rpc("commission_reconciliation", { p_from: rf, p_to: rt, p_unit: unit || null }); if (error) throw error; return data as Recon; } });
  const lines = useSaleLines((list.data ?? []).map((c) => c.sale_id));
  const nameOf = (id: string) => team.data?.find((t) => t.user_id === id)?.name ?? "—";
  const shown = (list.data ?? []).filter((c) => saleLineMatches(lines.data?.[c.sale_id], lineFilter) && (!benFilter || c.beneficiary_user_id === benFilter) && (!stFilter || c.status === stFilter));
  const refresh = () => { void qc.invalidateQueries({ queryKey: ["commissions"] }); void qc.invalidateQueries({ queryKey: ["commission-recon"] }); };
  const set = async (id: string, s: string) => { const { error } = await supabase.rpc("commission_set_status", { p_entry: id, p_status: s }); error ? m.err(errText(error)) : refresh(); };
  const clear = () => { onClear(); setLineFilter(""); setBenFilter(""); setStFilter(""); };
  const per = `${new Date(from + "T12:00:00Z").toLocaleDateString("pt-BR")} – ${new Date(to + "T12:00:00Z").toLocaleDateString("pt-BR")}`;
  const beneficiaries = [...new Set((list.data ?? []).map((c) => c.beneficiary_user_id))];
  const r = recon.data; const shownTotal = shown.reduce((a, c) => a + c.amount_cents, 0);
  return (<><Msg m={msg} />
    <div className="flex justify-end mb-4">
      <PeriodFilter preset={preset} from={custom.from} to={custom.to} onPreset={onPreset} onFrom={onFrom} onTo={onTo} unit={unit} units={units.data} onUnit={onUnit} onClear={clear}
        extraCount={(lineFilter ? 1 : 0) + (benFilter ? 1 : 0) + (stFilter ? 1 : 0)}
        extraSummary={[benFilter ? `Beneficiário: ${nameOf(benFilter)}` : "", stFilter ? `Estado: ${ST_LABEL[stFilter as Entry["status"]]}` : "", lineFilter ? "Linha filtrada" : ""].filter(Boolean).join(" · ") || undefined}
        extra={<div className="grid gap-3">
          <div><label htmlFor="comm-ben" className="block text-xs mb-1">Beneficiário</label><select id="comm-ben" value={benFilter} onChange={(e) => setBenFilter(e.target.value)}><option value="">Todos</option>{beneficiaries.map((id) => <option key={id} value={id}>{nameOf(id)}</option>)}</select></div>
          <div><label htmlFor="comm-st" className="block text-xs mb-1">Estado</label><select id="comm-st" value={stFilter} onChange={(e) => setStFilter(e.target.value)}><option value="">Todos</option>{Object.entries(ST_LABEL).map(([k, l]) => <option key={k} value={k}>{l}</option>)}</select></div>
          <div><label htmlFor="comm-line" className="block text-xs mb-1">Linha de negócio da venda</label><select id="comm-line" value={lineFilter} onChange={(e) => setLineFilter(e.target.value as SaleLineFilter)}>{SALE_LINE_FILTERS.map(([k, l]) => <option key={k} value={k}>{l}</option>)}</select></div>
        </div>} />
    </div>

    <section aria-label="Conferência das comissões" className="hp-card p-4 mb-6">
      <div className="flex flex-wrap items-center justify-between gap-2 mb-2"><h2 className="text-lg">Conferência do período <span className="text-xs font-normal text-muted-foreground">({per}, pela data do recebimento)</span></h2>
        {r && (r.ok ? <Badge tone="success">Conferido</Badge> : <Badge tone="danger">Divergência</Badge>)}</div>
      <State loading={recon.isLoading} error={recon.error} />
      {r && (<>
        <dl className="grid gap-3 sm:grid-cols-2 lg:grid-cols-4 text-sm">
          <div className="rounded-md border border-border p-3"><dt className="text-xs text-muted-foreground">Lançamentos no período</dt><dd className="text-xl font-bold tabular" aria-label="Lançamentos no período">{r.entries}</dd></div>
          <div className="rounded-md border border-border p-3"><dt className="text-xs text-muted-foreground">Total líquido de comissões</dt><dd className="text-xl font-bold tabular" aria-label="Total líquido de comissões">{brl(r.total_cents)}</dd><p className="text-[11px] text-muted-foreground">pendente + autorizada + paga − estornos</p></div>
          <div className="rounded-md border border-border p-3"><dt className="text-xs text-muted-foreground">Recálculo (base × percentual)</dt><dd className="text-xl font-bold tabular" aria-label="Recálculo">{brl(r.recomputed_cents)}</dd>
            <p className={`text-[11px] ${r.mismatch_count > 0 ? "text-destructive" : "text-muted-foreground"}`}>{r.mismatch_count === 0 ? "todos os lançamentos batem" : `${r.mismatch_count} lançamento(s) divergem`}{r.estimated_percent_count > 0 ? ` · ${r.estimated_percent_count} sem percentual guardado (usa o da regra atual)` : ""}</p></div>
          <div className="rounded-md border border-border p-3"><dt className="text-xs text-muted-foreground">Comissões na Visão geral (Financeiro)</dt><dd className="text-xl font-bold tabular" aria-label="Comissões na Visão geral">{brl(r.finance_total_cents)}</dd>
            <p className={`text-[11px] ${r.diff_vs_finance_cents !== 0 ? "text-destructive" : "text-muted-foreground"}`}>{r.diff_vs_finance_cents === 0 ? "diferença: R$ 0,00" : `diferença: ${brl(r.diff_vs_finance_cents)}`}</p></div>
        </dl>
        <p className="text-xs text-muted-foreground mt-3">Pendente {brl(r.pending_cents)} · Autorizada {brl(r.authorized_cents)} · Paga {brl(r.paid_cents)} · Estornos {brl(r.reversed_cents)}. O fluxo é pendente → autorizada → paga; estornada e paga são finais.</p>
      </>)}
    </section>

    <State loading={list.isLoading} error={list.error} empty={list.data?.length === 0} emptyText="Nenhuma comissão gerada neste período." />
    {shown.length > 0 && <Table head={["Recebimento", "Beneficiário", "Regra", "Base", "Percentual", "Valor", "Linha (da venda)", "Estado", ""]} right={[3, 5]}>{shown.map((c) => (
      <tr key={c.id}>
        <Td>{fmtDate(c.payment.paid_at)}{c.payment.kind === "refund" && <span className="block text-xs text-destructive">estorno</span>}</Td><Td>{nameOf(c.beneficiary_user_id)}</Td><Td>{c.rule?.name ?? "—"}</Td>
        <Td num>{brl(c.payment.amount_cents)}</Td><Td num>{pct(c.percent_bp ?? c.rule?.percent_bp)}{c.percent_bp == null && <span className="block text-[11px] text-muted-foreground">da regra atual</span>}</Td>
        <Td num>{brl(c.amount_cents)}</Td><Td>{saleLineLabel(lines.data?.[c.sale_id])}</Td><Td>{ST_LABEL[c.status]}</Td>
        <Td>{c.status === "pending" && <button className={btnGhost + " hp-btn-sm"} onClick={() => set(c.id, "authorized")}>Autorizar</button>}{c.status === "authorized" && <button className={btnGhost + " hp-btn-sm"} onClick={() => set(c.id, "paid")}>Marcar paga</button>}</Td>
      </tr>))}</Table>}
    {shown.length > 0 && <p className="text-sm mt-3 text-right">Total exibido: <b className="tabular" aria-label="Total exibido">{brl(shownTotal)}</b>{shown.length < (list.data?.length ?? 0) ? " (com os filtros aplicados)" : ""}</p>}
  </>);
};

/** Regras: produto nulo = vale para todos; beneficiário nulo = responsável da oportunidade (definido no momento do pagamento). */
const Rules = () => {
  const qc = useQueryClient(); const [msg, m] = useMsg();
  const [name, setName] = useState(""); const [product, setProduct] = useState(""); const [beneficiary, setBeneficiary] = useState(""); const [pct, setPct] = useState("10");
  const products = useQuery({ queryKey: ["products-cr"], queryFn: async () => (await supabase.from("products").select("id, name").eq("active", true).order("name")).data ?? [] });
  const team = useQuery({ queryKey: ["team-cr"], queryFn: async () => ((await supabase.rpc("list_team")).data ?? []) as Member[] });
  const rules = useQuery({ queryKey: ["comm-rules"], queryFn: async () => (await supabase.from("commission_rules").select("id, name, product_id, beneficiary_user_id, percent_bp, active, product:products(name)").order("name")).data as unknown as Rule[] });
  const memberName = (uid: string | null) => uid ? (team.data?.find((t) => t.user_id === uid)?.display_name ?? "—") : "Responsável da oportunidade";

  const add = async (e: FormEvent) => {
    e.preventDefault(); const { data: org } = await supabase.from("organizations").select("id").single();
    const bp = Math.round(Number(pct.replace(",", ".")) * 100);
    if (!name.trim()) return m.err("Informe um nome para a regra."); if (!(bp >= 1 && bp <= 10000)) return m.err("Percentual deve ser entre 0,01% e 100%.");
    const { error } = await supabase.from("commission_rules").insert({ org_id: org?.id, name: name.trim(), product_id: product || null, beneficiary_user_id: beneficiary || null, percent_bp: bp });
    if (error) m.err(errText(error)); else { m.ok("Regra criada."); setName(""); setPct("10"); void qc.invalidateQueries({ queryKey: ["comm-rules"] }); }
  };
  const toggle = async (r: Rule) => { const { error } = await supabase.from("commission_rules").update({ active: !r.active }).eq("id", r.id); if (error) m.err(errText(error)); else void qc.invalidateQueries({ queryKey: ["comm-rules"] }); };

  return (<><Msg m={msg} />
    <p className="text-sm text-muted-foreground mb-3">Cada recebimento gera um lançamento para CADA regra ativa que casa com a venda (as regras se somam; cada uma vai ao seu beneficiário). O percentual incide sobre o valor recebido (não sobre o total da venda), é guardado no lançamento e, se a regra mudar depois, os lançamentos já gerados não são recalculados.</p>
    <form onSubmit={add} className="hp-card p-4 mb-6 grid gap-3 sm:grid-cols-5 items-end" noValidate>
      <div className="sm:col-span-2"><label htmlFor="crn" className="block text-xs mb-1">Nome da regra</label><input id="crn"   value={name} onChange={(e) => setName(e.target.value)} /></div>
      <div><label htmlFor="crp" className="block text-xs mb-1">Produto (opcional)</label><select id="crp"   value={product} onChange={(e) => setProduct(e.target.value)}><option value="">Todos os produtos</option>{products.data?.map((p) => <option key={p.id} value={p.id}>{p.name}</option>)}</select></div>
      <div><label htmlFor="crb" className="block text-xs mb-1">Beneficiário (opcional)</label><select id="crb"   value={beneficiary} onChange={(e) => setBeneficiary(e.target.value)}><option value="">Responsável da oportunidade</option>{team.data?.map((t) => <option key={t.user_id} value={t.user_id}>{t.display_name}</option>)}</select></div>
      <div><label htmlFor="crv" className="block text-xs mb-1">Percentual (%)</label><input id="crv" inputMode="decimal"   value={pct} onChange={(e) => setPct(e.target.value)} /></div>
      <div className="sm:col-span-5"><button className="hp-btn hp-btn-primary">Criar regra</button></div>
    </form>
    <State loading={rules.isLoading} error={rules.error} empty={rules.data?.length === 0} emptyText="Nenhuma regra de comissão cadastrada." />
    {rules.data && rules.data.length > 0 && <Table head={["Nome", "Produto", "Beneficiário", "Percentual", "Estado", ""]}>
      {rules.data.map((r) => <tr key={r.id}><Td>{r.name}</Td><Td>{r.product?.name ?? "Todos"}</Td><Td>{memberName(r.beneficiary_user_id)}</Td><Td num>{(r.percent_bp / 100).toFixed(2).replace(".", ",")}%</Td><Td>{r.active ? "Ativa" : "Inativa"}</Td>
        <Td><button className={btnGhost + " hp-btn-sm"} onClick={() => toggle(r)}>{r.active ? "Desativar" : "Ativar"}</button></Td></tr>)}</Table>}</>);
};

export default FinanceCommissions;
