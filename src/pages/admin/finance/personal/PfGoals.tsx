import { useState, type FormEvent } from "react";
import { Link } from "react-router-dom";
import { useQuery } from "@tanstack/react-query";
import { Pencil, PiggyBank, Plus } from "lucide-react";
import { brl, newKey } from "@/lib/format";
import { EmptyState, Msg, PageHead, State, btnGhost, btnPrimary, errText, useMsg } from "@/lib/ui";
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { supabase } from "@/lib/supabase";
import { fmtYmd, pfRpc, todayYmd, type Kpi } from "./pf";
import { MoneyInput, centsFrom, centsToInput, useInvalidatePf, usePfRefs } from "./PfShared";

interface Goal { id: string; name: string; kind: "savings" | "emergency" | "objective"; target_cents: number; target_date: string | null; monthly_contribution_cents: number; account_id: string | null; active: boolean }
const KIND_LABEL = { savings: "Meta de economia", emergency: "Reserva de emergência", objective: "Objetivo com prazo" } as const;

/** Reserva e metas: a reserva considera só dinheiro realmente disponível (saldo das contas marcadas como reserva) — nunca limite de crédito nem renda prevista. Aportes são movimentações patrimoniais. */
const PfGoals = () => {
  const refs = usePfRefs(); const invalidate = useInvalidatePf(); const [msg, m] = useMsg(); const [dlg, setDlg] = useState<{ edit: Goal | null } | null>(null); const [contrib, setContrib] = useState<Goal | null>(null);
  const ov = useQuery({ queryKey: ["pf", "overview-reserve"], queryFn: () => pfRpc<Record<string, Kpi>>("pf_overview", { p_from: todayYmd().slice(0, 8) + "01", p_to: todayYmd() }) });
  const goals = useQuery({ queryKey: ["pf", "goals"], queryFn: async () => ((await supabase.from("pf_goals").select("id, name, kind, target_cents, target_date, monthly_contribution_cents, account_id, active").order("created_at")).data ?? []) as Goal[] });
  const prog = useQuery({ queryKey: ["pf", "goal-progress"], queryFn: async () => { const o = await pfRpc<{ goals: { items: { id: string; progress_cents: number }[] } }>("pf_overview", { p_from: todayYmd().slice(0, 8) + "01", p_to: todayYmd() }); return new Map(o.goals.items.map((g) => [g.id, g.progress_cents])); } });
  const settings = useQuery({ queryKey: ["pf", "settings"], queryFn: async () => ((await supabase.from("pf_settings").select("reminder_days_before, plan_next_month_with_income, reserve_target_months").maybeSingle()).data ?? { reminder_days_before: 3, plan_next_month_with_income: false, reserve_target_months: 6 }) as { reminder_days_before: number; plan_next_month_with_income: boolean; reserve_target_months: number } });
  const reserve = ov.data?.reserve as Kpi | undefined; const cover = ov.data?.reserve_coverage_months as Kpi | undefined; const cost = ov.data?.living_cost_monthly as Kpi | undefined;
  const target = settings.data && cost?.available && cost.value != null ? Math.round(cost.value * settings.data.reserve_target_months) : null;
  const reserveAccs = refs.accounts.filter((a) => a.active && a.counts_for_reserve);
  const archive = async (g: Goal) => { try { await pfRpc("pf_goal_save", { p_id: g.id, p_name: g.name, p_kind: g.kind, p_target_cents: g.target_cents, p_target_date: g.target_date, p_monthly_cents: g.monthly_contribution_cents, p_account: g.account_id, p_active: !g.active }); invalidate(); } catch (err) { m.err(errText(err as { message: string })); } };

  return (
    <div>
      <PageHead eyebrow="Finanças pessoais" title="Reserva e metas" hint="A reserva soma só o saldo das contas marcadas como reserva. Limite de cartão e renda prevista não contam. Aportes são movimentação patrimonial: não aumentam o custo de vida."
        actions={<button type="button" className={btnPrimary} onClick={() => setDlg({ edit: null })}><Plus size={16} aria-hidden />Nova meta</button>} />
      <Msg m={msg} />
      <section className="hp-card p-5 mb-6" data-testid="pf-reserva">
        <h2 className="text-lg font-semibold flex items-center gap-2"><PiggyBank size={18} aria-hidden />Reserva de emergência</h2>
        <State loading={ov.isLoading} error={ov.error} />
        {ov.data && (
          <div className="grid gap-4 sm:grid-cols-3 mt-3">
            <div><p className="text-xs text-muted-foreground">Reserva disponível</p><p className="text-2xl font-bold tabular" data-testid="pf-reserva-valor">{reserve?.available ? brl(reserve.value) : "Sem base para cálculo"}</p><p className="text-xs text-muted-foreground mt-1">{reserve?.available ? `soma dos saldos de ${reserveAccs.map((a) => a.name).join(", ")}` : "Marque, em Contas, quais contas compõem a reserva."}</p></div>
            <div><p className="text-xs text-muted-foreground">Meses de cobertura</p><p className="text-2xl font-bold tabular">{cover?.available && cover.value != null ? `${String(cover.value).replace(".", ",")}` : "—"}</p><p className="text-xs text-muted-foreground mt-1">{cover?.available ? "reserva ÷ custo de vida mensal projetado" : "Sem base para cálculo (sem reserva ou sem custo projetado)"}</p></div>
            <div><p className="text-xs text-muted-foreground">Meta de cobertura: {settings.data?.reserve_target_months ?? 6} meses</p><p className="text-2xl font-bold tabular">{target != null ? brl(target) : "—"}</p><p className="text-xs text-muted-foreground mt-1">{target != null && reserve?.available && reserve.value != null ? `${Math.min(100, Math.round(reserve.value * 100 / target))}% da meta` : "depende do custo de vida projetado"} · ajuste em Configurações</p></div>
          </div>)}
        <p className="text-xs text-muted-foreground mt-3">Contas da reserva: {reserveAccs.length ? reserveAccs.map((a) => a.name).join(", ") : "nenhuma"} · <Link className="text-accent hover:underline" to="/admin/financeiro/pessoal/contas">gerenciar contas</Link></p>
      </section>

      <h2 className="text-base font-medium mb-2">Metas</h2>
      <State loading={goals.isLoading} error={goals.error} />
      {goals.data && goals.data.length === 0 && <EmptyState title="Nenhuma meta">Crie metas de economia, uma reserva de emergência ou objetivos com valor-alvo e prazo.</EmptyState>}
      <ul className="grid gap-3 sm:grid-cols-2">
        {(goals.data ?? []).map((g) => { const p = prog.data?.get(g.id) ?? 0; const pc = Math.min(100, Math.round(p * 100 / g.target_cents));
          return (<li key={g.id} className={`hp-card p-4 ${g.active ? "" : "opacity-60"}`} data-testid="pf-meta">
            <div className="flex items-start justify-between gap-2"><div><p className="font-semibold">{g.name}</p><p className="text-xs text-muted-foreground">{KIND_LABEL[g.kind]}{g.target_date ? ` · até ${fmtYmd(g.target_date)}` : ""}{!g.active ? " · arquivada" : ""}</p></div><span className="tabular text-lg font-bold">{pc}%</span></div>
            <div className="hp-rank-bar mt-2" role="img" aria-label={`Progresso de ${g.name}: ${pc}%`}><i style={{ width: `${Math.max(2, pc)}%` }} /></div>
            <p className="text-sm mt-1.5 tabular">{brl(p)} de {brl(g.target_cents)}{g.monthly_contribution_cents > 0 ? ` · aporte planejado ${brl(g.monthly_contribution_cents)}/mês` : ""}</p>
            <p className="text-xs text-muted-foreground">{g.account_id ? `Progresso = saldo da conta ${refs.accounts.find((a) => a.id === g.account_id)?.name ?? ""}` : "Progresso = soma dos aportes registrados"}</p>
            <div className="flex gap-2 mt-3"><button type="button" className={btnGhost + " hp-btn-sm"} onClick={() => setContrib(g)} disabled={!g.active}>Aportar</button><button type="button" className={btnGhost + " hp-btn-sm"} onClick={() => setDlg({ edit: g })}><Pencil size={13} aria-hidden />Editar</button><button type="button" className={btnGhost + " hp-btn-sm"} onClick={() => void archive(g)}>{g.active ? "Arquivar" : "Reativar"}</button></div>
          </li>); })}
      </ul>
      {dlg && <GoalDialog edit={dlg.edit} accounts={refs.accounts} onClose={() => setDlg(null)} />}
      {contrib && <ContribDialog goal={contrib} accounts={refs.accounts.filter((a) => a.active)} onClose={() => setContrib(null)} />}
    </div>
  );
};

const GoalDialog = ({ edit, accounts, onClose }: { edit: Goal | null; accounts: { id: string; name: string; active: boolean }[]; onClose: () => void }) => {
  const invalidate = useInvalidatePf(); const [msg, m] = useMsg(); const [name, setName] = useState(edit?.name ?? ""); const [kind, setKind] = useState<Goal["kind"]>(edit?.kind ?? "savings"); const [target, setTarget] = useState(edit ? centsToInput(edit.target_cents) : "");
  const [date, setDate] = useState(edit?.target_date ?? ""); const [monthly, setMonthly] = useState(edit ? centsToInput(edit.monthly_contribution_cents) : "0,00"); const [acc, setAcc] = useState(edit?.account_id ?? ""); const [busy, setBusy] = useState(false);
  const submit = async (e: FormEvent) => {
    e.preventDefault(); const t = centsFrom(target); const mo = centsFrom(monthly); if (t == null || t <= 0) return m.err("Informe o valor-alvo."); if (mo == null) return m.err("Aporte mensal inválido.");
    setBusy(true); try { await pfRpc("pf_goal_save", { p_id: edit?.id ?? null, p_name: name, p_kind: kind, p_target_cents: t, p_target_date: date || null, p_monthly_cents: mo, p_account: acc || null, p_active: edit?.active ?? true }); invalidate(); onClose(); } catch (err) { m.err(errText(err as { message: string })); } finally { setBusy(false); }
  };
  return (
    <Dialog open onOpenChange={(o) => { if (!o) onClose(); }}><DialogContent className="sm:max-w-md" data-testid="pf-meta-dialog">
      <DialogHeader><DialogTitle>{edit ? "Editar meta" : "Nova meta"}</DialogTitle><DialogDescription>Valor-alvo, prazo e aporte mensal planejado (entra na necessidade de caixa, não no custo de vida).</DialogDescription></DialogHeader>
      <form onSubmit={submit} className="grid gap-3" noValidate><Msg m={msg} />
        <div><label htmlFor="mg-name" className="block text-xs mb-1">Nome</label><input id="mg-name" value={name} onChange={(e) => setName(e.target.value)} maxLength={80} /></div>
        <div className="grid grid-cols-2 gap-3"><div><label htmlFor="mg-kind" className="block text-xs mb-1">Tipo</label><select id="mg-kind" value={kind} onChange={(e) => setKind(e.target.value as Goal["kind"])}>{Object.entries(KIND_LABEL).map(([k, l]) => <option key={k} value={k}>{l}</option>)}</select></div><div><label htmlFor="mg-date" className="block text-xs mb-1">Prazo (opcional)</label><input id="mg-date" type="date" value={date} onChange={(e) => setDate(e.target.value)} /></div></div>
        <div className="grid grid-cols-2 gap-3"><MoneyInput id="mg-target" value={target} onChange={setTarget} label="Valor-alvo" /><MoneyInput id="mg-monthly" value={monthly} onChange={setMonthly} label="Aporte mensal planejado" /></div>
        <div><label htmlFor="mg-acc" className="block text-xs mb-1">Conta da meta (opcional)</label><select id="mg-acc" value={acc} onChange={(e) => setAcc(e.target.value)}><option value="">Somar os aportes registrados</option>{accounts.filter((a) => a.active).map((a) => <option key={a.id} value={a.id}>{a.name}</option>)}</select></div>
        <DialogFooter><button type="button" className={btnGhost} onClick={onClose}>Cancelar</button><button className={btnPrimary} disabled={busy}>{busy ? "Salvando…" : "Salvar meta"}</button></DialogFooter></form>
    </DialogContent></Dialog>
  );
};

const ContribDialog = ({ goal, accounts, onClose }: { goal: Goal; accounts: { id: string; name: string }[]; onClose: () => void }) => {
  const invalidate = useInvalidatePf(); const [msg, m] = useMsg(); const [from, setFrom] = useState(""); const [to, setTo] = useState(goal.account_id ?? ""); const [amount, setAmount] = useState(centsToInput(goal.monthly_contribution_cents || 0)); const [date, setDate] = useState(todayYmd()); const [key] = useState(() => newKey("pfg")); const [busy, setBusy] = useState(false);
  const submit = async (e: FormEvent) => {
    e.preventDefault(); const c = centsFrom(amount); if (c == null || c <= 0) return m.err("Informe o valor."); if (!from || !to) return m.err("Escolha as duas contas.");
    setBusy(true); try { await pfRpc("pf_goal_contribute", { p_goal: goal.id, p_from: from, p_to: to, p_amount_cents: c, p_date: date, p_key: key }); invalidate(); onClose(); } catch (err) { m.err(errText(err as { message: string })); } finally { setBusy(false); }
  };
  return (
    <Dialog open onOpenChange={(o) => { if (!o) onClose(); }}><DialogContent className="sm:max-w-md" data-testid="pf-aporte-dialog">
      <DialogHeader><DialogTitle>Aportar em “{goal.name}”</DialogTitle><DialogDescription>O dinheiro sai de uma conta sua e vai para outra (patrimônio): não é despesa.</DialogDescription></DialogHeader>
      <form onSubmit={submit} className="grid gap-3" noValidate><Msg m={msg} />
        <div className="grid grid-cols-2 gap-3"><div><label htmlFor="ap-from" className="block text-xs mb-1">De</label><select id="ap-from" value={from} onChange={(e) => setFrom(e.target.value)}><option value="">Escolha…</option>{accounts.map((a) => <option key={a.id} value={a.id}>{a.name}</option>)}</select></div><div><label htmlFor="ap-to" className="block text-xs mb-1">Para</label><select id="ap-to" value={to} onChange={(e) => setTo(e.target.value)}><option value="">Escolha…</option>{accounts.map((a) => <option key={a.id} value={a.id}>{a.name}</option>)}</select></div></div>
        <div className="grid grid-cols-2 gap-3"><MoneyInput id="ap-amount" value={amount} onChange={setAmount} label="Valor" /><div><label htmlFor="ap-date" className="block text-xs mb-1">Data</label><input id="ap-date" type="date" max={todayYmd()} value={date} onChange={(e) => setDate(e.target.value)} /></div></div>
        <DialogFooter><button type="button" className={btnGhost} onClick={onClose}>Cancelar</button><button className={btnPrimary} disabled={busy}>{busy ? "Salvando…" : "Registrar aporte"}</button></DialogFooter></form>
    </DialogContent></Dialog>
  );
};
export default PfGoals;
