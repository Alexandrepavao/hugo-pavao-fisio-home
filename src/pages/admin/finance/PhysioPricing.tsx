import { useState, type FormEvent } from "react";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { supabase } from "@/lib/supabase";
import { brl, fmtDate, fmtDateTime, parseCents } from "@/lib/format";
import { useAuth } from "@/auth/AuthProvider";
import { Badge, btnGhost, btnPrimary, EmptyState, errText, inputCls, LevelSection, Msg, PageHead, State, Table, Tabs, Td, useAsk, useConfirm, useMsg, type Tone } from "@/lib/ui";

interface Prod { id: string; name: string; kind: string; price_cents: number; sessions_count: number | null; session_value_cents: number; share_cents: number | null; hp_cents: number | null; valid_from: string | null; history: number }
interface Payout { id: string; at: string; kind: string; amount_cents: number; status: "pending" | "authorized" | "paid" | "void"; reason: string | null; professional_id: string | null; professional: string | null; product: string | null; patient: string | null; package_id: string | null; covered: boolean }
interface Pkg { id: string; patient: string; product: string; total_sessions: number; remaining: number; consumed: number; responsible_id: string | null; responsible: string | null }
interface Missing { sessions_without_payout: { product_id: string; product: string; sessions: number; has_share: boolean }[]; packages_without_responsible: number }
const KIND: Record<string, string> = { service: "Sessão avulsa", package: "Pacote", plan: "Protocolo / plano" };
const PK: Record<string, string> = { session: "Sessão atendida", residual: "Sessões pagas e não atendidas", adjustment: "Ajuste", reversal: "Estorno de sessão devolvida" };
const ST: Record<Payout["status"], [string, Tone]> = { pending: ["Pendente", "warning"], authorized: ["Autorizado", "info"], paid: ["Pago", "success"], void: ["Anulado", "neutral"] };

/** Financeiro › Preços e repasses: o ADMIN define o valor final do produto e o repasse do fisio por sessão; autoriza e marca como pago os lançamentos gerados a cada sessão atendida. */
const PhysioPricing = () => {
  const [tab, setTab] = useState("precos");
  return (
    <>
      <PageHead eyebrow="Financeiro" title="Preços e repasses" hint="O valor cadastrado é o valor final da venda. O repasse do fisioterapeuta é por sessão atendida, igual para todos, definido por produto e congelado em cada lançamento. Cada fisio recebe pelas sessões que atendeu; sessões pagas e não atendidas vão ao fisio responsável pelo pacote." />
      <Tabs tabs={[["precos", "Preços e regra"], ["lancamentos", "Lançamentos"], ["pacotes", "Fisio responsável"]]} value={tab} onChange={setTab} />
      {tab === "precos" && <Prices />}{tab === "lancamentos" && <Payouts />}{tab === "pacotes" && <Packages />}
    </>
  );
};

const Prices = () => {
  const qc = useQueryClient(); const [msg, m] = useMsg(); const ask = useAsk(); const { hasRole } = useAuth(); const canEdit = hasRole("manager", "ops_admin");
  const q = useQuery({ queryKey: ["pricing"], retry: false, queryFn: async () => { const { data, error } = await supabase.rpc("physio_pricing_list"); if (error) throw error; return (data ?? []) as Prod[]; } });
  const miss = useQuery({ queryKey: ["payouts-missing"], retry: false, queryFn: async () => { const { data, error } = await supabase.rpc("physio_payouts_missing"); if (error) throw error; return data as Missing; } });
  const refresh = () => { void qc.invalidateQueries({ queryKey: ["pricing"] }); void qc.invalidateQueries({ queryKey: ["payouts-missing"] }); };
  const money = async (title: string, label: string, cur: number | null) => { const v = await ask({ title, label, kind: "text", defaultValue: cur != null ? (cur / 100).toFixed(2).replace(".", ",") : "" }); if (v === null) return null; const c = parseCents(v); if (c == null) { m.err("Informe um valor em reais (ex.: 100,00)."); return null; } return c; };
  const setShare = async (p: Prod) => { const c = await money(`Repasse por sessão — ${p.name}`, `Valor por sessão para o fisioterapeuta (a sessão vale ${brl(p.session_value_cents)})`, p.share_cents); if (c == null) return;
    const { error } = await supabase.rpc("product_share_set", { p_product: p.id, p_share_cents: c, p_valid_from: null }); if (error) return m.err(errText(error)); m.ok("Repasse salvo. Vale para as sessões atendidas a partir de hoje."); refresh(); };
  const setPrice = async (p: Prod) => { const c = await money(`Valor final — ${p.name}`, "Valor final da venda (R$)", p.price_cents); if (c == null) return;
    const { error } = await supabase.rpc("product_price_set", { p_product: p.id, p_price_cents: c }); if (error) return m.err(errText(error)); m.ok("Valor atualizado para as próximas vendas."); refresh(); };
  const backfill = async (id: string) => { const { data, error } = await supabase.rpc("physio_payouts_backfill", { p_product: id }); if (error) return m.err(errText(error)); m.ok(`${data} lançamento(s) gerado(s) a partir da vigência da regra.`); refresh(); };
  return (
    <>
      <Msg m={msg} />
      {miss.data && miss.data.sessions_without_payout.length > 0 && (
        <div className="hp-card mb-4 border-primary/50 p-3 text-sm" role="note" data-testid="missing-box"><b>Sessões atendidas sem lançamento de repasse</b>
          <ul className="mt-1 grid gap-1">{miss.data.sessions_without_payout.map((x) => <li key={x.product_id} className="flex flex-wrap items-center justify-between gap-2"><span>{x.product}: {x.sessions} sessão(ões)</span>{canEdit && <button className={btnGhost + " hp-btn-sm"} onClick={() => void backfill(x.product_id)}>Gerar lançamentos</button>}</li>)}</ul></div>)}
      <State loading={q.isLoading} error={q.error} empty={q.data?.length === 0} emptyText="Nenhum produto ativo." />
      {q.data && q.data.length > 0 && (
        <Table head={["Produto", "Tipo", "Valor final", "Sessões", "Valor da sessão", "Repasse ao fisio", "Parte da HP", ""]} right={[2, 4, 5, 6]}>{q.data.map((p) => (
          <tr key={p.id} data-testid="price-row"><Td><b>{p.name}</b></Td><Td>{KIND[p.kind] ?? p.kind}</Td><Td num>{brl(p.price_cents)}</Td><Td>{p.sessions_count ?? 1}</Td><Td num>{brl(p.session_value_cents)}</Td>
            <Td num>{p.share_cents == null ? <Badge tone="warning">Sem regra</Badge> : <>{brl(p.share_cents)}<span className="block text-xs text-muted-foreground">desde {p.valid_from ? fmtDate(p.valid_from + "T12:00:00Z") : "—"}</span></>}</Td>
            <Td num>{p.hp_cents == null ? "—" : brl(p.hp_cents)}</Td>
            <Td>{canEdit && <span className="flex flex-wrap gap-1"><button className={btnGhost + " hp-btn-sm"} onClick={() => void setShare(p)}>Definir repasse</button><button className={btnGhost + " hp-btn-sm"} onClick={() => void setPrice(p)}>Alterar valor</button></span>}</Td></tr>))}</Table>)}
      <p className="mt-3 text-xs text-muted-foreground">Alterar o valor vale para as próximas vendas. Alterar o repasse vale para as sessões atendidas a partir de hoje: lançamentos já feitos não mudam.</p>
    </>
  );
};

const Payouts = () => {
  const qc = useQueryClient(); const [msg, m] = useMsg(); const ask = useAsk(); const confirm = useConfirm(); const { hasRole } = useAuth(); const canEdit = hasRole("manager", "ops_admin");
  const [status, setStatus] = useState("pending");
  const q = useQuery({ queryKey: ["payouts", status], retry: false, queryFn: async () => { const { data, error } = await supabase.rpc("physio_payouts_list", { p_status: status || null, p_from: null, p_to: null, p_professional: null }); if (error) throw error; return (data ?? []) as Payout[]; } });
  const profs = useQuery({ queryKey: ["profs-active"], queryFn: async () => (await supabase.from("professionals").select("id, display_name").eq("active", true).order("display_name")).data ?? [] });
  const refresh = () => void qc.invalidateQueries({ queryKey: ["payouts"] });
  const call = async (fn: string, args: Record<string, unknown>, ok: string) => { const { error } = await supabase.rpc(fn, args); if (error) return m.err(errText(error)); m.ok(ok); refresh(); };
  const [adjP, setAdjP] = useState(""); const [adjV, setAdjV] = useState(""); const [adjR, setAdjR] = useState("");
  const adjust = async (e: FormEvent) => { e.preventDefault(); const c = parseCents(adjV.replace("-", "")); if (c == null || !adjP) return m.err("Escolha o fisioterapeuta e o valor."); await call("physio_payout_adjust", { p_professional: adjP, p_amount_cents: adjV.trim().startsWith("-") ? -c : c, p_reason: adjR, p_package: null }, "Ajuste registrado (pendente)."); setAdjV(""); setAdjR(""); };
  const total = (q.data ?? []).filter((x) => x.status !== "void").reduce((a, x) => a + x.amount_cents, 0);
  return (
    <>
      <Msg m={msg} />
      <div className="mb-3 flex flex-wrap items-center gap-3 text-sm"><label htmlFor="po-st" className="text-xs">Situação</label>
        <select id="po-st" className={inputCls + " w-auto"} value={status} onChange={(e) => setStatus(e.target.value)}><option value="">Todas</option><option value="pending">Pendentes</option><option value="authorized">Autorizados</option><option value="paid">Pagos</option><option value="void">Anulados</option></select>
        <span className="text-muted-foreground">Total listado: <b className="tabular">{brl(total)}</b></span></div>
      <State loading={q.isLoading} error={q.error} empty={q.data?.length === 0} emptyText="Nenhum lançamento nesta situação." />
      {q.data && q.data.length > 0 && (
        <Table head={["Quando", "Fisioterapeuta", "Produto / paciente", "Origem", "Valor", "Situação", ""]} right={[4]}>{q.data.map((x) => { const [l, tone] = ST[x.status];
          return <tr key={x.id} data-testid="payout-row"><Td>{fmtDateTime(x.at)}</Td><Td>{x.professional ?? <Badge tone="warning">Sem fisio</Badge>}</Td><Td>{x.product ?? "—"}<span className="block text-xs text-muted-foreground">{x.patient ?? ""}</span></Td>
            <Td>{PK[x.kind] ?? x.kind}{x.reason && <span className="block text-xs text-muted-foreground">{x.reason}</span>}</Td><Td num>{brl(x.amount_cents)}</Td>
            <Td><Badge tone={tone}>{l}</Badge>{!x.covered && x.status === "pending" && <span className="block text-xs text-destructive">pacote ainda não pago o suficiente</span>}</Td>
            <Td>{canEdit && <span className="flex flex-wrap gap-1">
              {x.status === "pending" && <button className={btnPrimary + " hp-btn-sm"} onClick={() => void call("physio_payout_authorize", { p_id: x.id }, "Autorizado.")}>Autorizar</button>}
              {x.status === "authorized" && <button className={btnPrimary + " hp-btn-sm"} onClick={async () => { if (await confirm("Marcar como pago?", "Isto registra a decisão da administração; não faz transferência nem gera despesa no contas a pagar.", "Marcar como pago")) await call("physio_payout_pay", { p_id: x.id }, "Marcado como pago."); }}>Marcar pago</button>}
              {x.status === "pending" && <button className={btnGhost + " hp-btn-sm"} onClick={async () => { const t = await ask({ title: "Anular lançamento", label: "Motivo", multiline: true }); if (t) await call("physio_payout_void", { p_id: x.id, p_reason: t }, "Anulado."); }}>Anular</button>}
              {x.status === "pending" && <select aria-label="Mudar de fisioterapeuta" className={inputCls + " w-auto text-xs"} value="" onChange={(e) => e.target.value && void call("physio_payout_reassign", { p_id: x.id, p_professional: e.target.value }, "Fisioterapeuta alterado.")}><option value="">Atribuir a…</option>{(profs.data as { id: string; display_name: string }[] | undefined)?.map((p) => <option key={p.id} value={p.id}>{p.display_name}</option>)}</select>}
            </span>}</Td></tr>; })}</Table>)}
      {canEdit && <LevelSection level="analysis" title="Ajuste manual" hint="Para sessão avulsa, protocolo ou correção de um lançamento já autorizado/pago. Nasce pendente e exige motivo. Use valor negativo para descontar.">
        <form onSubmit={adjust} className="hp-card grid gap-2 p-3 text-sm sm:grid-cols-4 items-end" aria-label="Ajuste manual">
          <div><label htmlFor="aj-p" className="mb-1 block text-xs">Fisioterapeuta</label><select id="aj-p" className={inputCls} value={adjP} onChange={(e) => setAdjP(e.target.value)}><option value="">Escolha…</option>{(profs.data as { id: string; display_name: string }[] | undefined)?.map((p) => <option key={p.id} value={p.id}>{p.display_name}</option>)}</select></div>
          <div><label htmlFor="aj-v" className="mb-1 block text-xs">Valor (R$; negativo desconta)</label><input id="aj-v" className={inputCls} value={adjV} onChange={(e) => setAdjV(e.target.value)} placeholder="100,00" /></div>
          <div><label htmlFor="aj-r" className="mb-1 block text-xs">Motivo</label><input id="aj-r" className={inputCls} value={adjR} onChange={(e) => setAdjR(e.target.value)} maxLength={500} /></div>
          <button className={btnGhost}>Registrar ajuste</button></form></LevelSection>}
    </>
  );
};

const Packages = () => {
  const qc = useQueryClient(); const [msg, m] = useMsg(); const [only, setOnly] = useState(true); const { hasRole } = useAuth(); const canEdit = hasRole("manager", "ops_admin");
  const q = useQuery({ queryKey: ["pkgs-open", only], retry: false, queryFn: async () => { const { data, error } = await supabase.rpc("physio_packages_open", { p_only_without: only }); if (error) throw error; return (data ?? []) as Pkg[]; } });
  const profs = useQuery({ queryKey: ["profs-active"], queryFn: async () => (await supabase.from("professionals").select("id, display_name").eq("active", true).order("display_name")).data ?? [] });
  const set = async (id: string, prof: string) => { const { error } = await supabase.rpc("package_responsible_set", { p_package: id, p_professional: prof || null }); if (error) return m.err(errText(error)); m.ok("Fisioterapeuta responsável atualizado."); void qc.invalidateQueries({ queryKey: ["pkgs-open"] }); };
  const close = async (id: string) => { const { data, error } = await supabase.rpc("physio_package_close", { p_package: id }); if (error) return m.err(errText(error)); m.ok(data ? "Resíduo lançado ao fisioterapeuta responsável." : "Nada a lançar (sem sessões pagas pendentes, sem regra de repasse ou resíduo já lançado)."); void qc.invalidateQueries({ queryKey: ["payouts"] }); };
  return (
    <>
      <p className="mb-3 text-sm text-muted-foreground">O fisio responsável pelo pacote recebe o repasse das sessões <b>pagas e não atendidas</b> quando o pacote vence ou o paciente para. Quem atende cada sessão recebe por ela.</p>
      <Msg m={msg} /><label className="mb-3 flex items-center gap-2 text-sm"><input type="checkbox" checked={only} onChange={(e) => setOnly(e.target.checked)} />Mostrar só pacotes sem responsável</label>
      <State loading={q.isLoading} error={q.error} />
      {q.data && q.data.length === 0 ? <EmptyState title="Nenhum pacote nesta lista" /> : q.data && (
        <Table head={["Paciente", "Pacote", "Sessões", "Responsável", ""]}>{q.data.map((p) => (
          <tr key={p.id} data-testid="pkg-row"><Td>{p.patient}</Td><Td>{p.product}</Td><Td>{p.consumed} de {p.total_sessions} atendidas · {p.remaining} restantes</Td>
            <Td>{canEdit ? <select aria-label={`Responsável por ${p.patient}`} className={inputCls + " w-auto text-sm"} value={p.responsible_id ?? ""} onChange={(e) => void set(p.id, e.target.value)}><option value="">— sem responsável —</option>{(profs.data as { id: string; display_name: string }[] | undefined)?.map((x) => <option key={x.id} value={x.id}>{x.display_name}</option>)}</select> : (p.responsible ?? "—")}</Td>
            <Td>{canEdit && <button className={btnGhost + " hp-btn-sm"} onClick={() => void close(p.id)}>Encerrar e lançar resíduo</button>}</Td></tr>))}</Table>)}
    </>
  );
};
export default PhysioPricing;
