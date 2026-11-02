import { useEffect, useState, type FormEvent } from "react";
import { useQuery } from "@tanstack/react-query";
import { Plus } from "lucide-react";
import { supabase } from "@/lib/supabase";
import { Badge, Msg, PageHead, State, btnGhost, btnPrimary, errText, useMsg } from "@/lib/ui";
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { pfRpc, type PfCategory, type PfKind } from "./pf";
import { useInvalidatePf, usePfRefs } from "./PfShared";

interface Settings { reminder_days_before: number; plan_next_month_with_income: boolean; reserve_target_months: number }

/** Configurações pessoais: lembretes, planejamento, meta de cobertura da reserva e categorias próprias. Nada daqui é visível à equipe. */
const PfSettings = () => {
  const refs = usePfRefs(); const invalidate = useInvalidatePf(); const [msg, m] = useMsg(); const [dlg, setDlg] = useState<{ edit: PfCategory | null; kind: PfKind } | null>(null);
  const st = useQuery({ queryKey: ["pf", "settings"], queryFn: async () => ((await supabase.from("pf_settings").select("reminder_days_before, plan_next_month_with_income, reserve_target_months").maybeSingle()).data ?? { reminder_days_before: 3, plan_next_month_with_income: false, reserve_target_months: 6 }) as Settings });
  const [days, setDays] = useState("3"); const [plan, setPlan] = useState(false); const [months, setMonths] = useState("6");
  useEffect(() => { if (st.data) { setDays(String(st.data.reminder_days_before)); setPlan(st.data.plan_next_month_with_income); setMonths(String(st.data.reserve_target_months)); } }, [st.data]);
  const save = async (e: FormEvent) => {
    e.preventDefault();
    try { await pfRpc("pf_settings_save", { p_reminder_days: Number(days), p_plan_next_month: plan, p_reserve_months: Number(months) }); invalidate(); m.ok("Configurações salvas."); } catch (err) { m.err(errText(err as { message: string })); }
  };
  const tops = (k: PfKind) => refs.cats.filter((c) => c.kind === k && !c.parent_id);
  return (
    <div>
      <PageHead eyebrow="Finanças pessoais" title="Configurações pessoais" hint="Preferências e categorias só suas. Funcionários, comercial, financeiro e outros gestores não veem nada disto." />
      <Msg m={msg} />
      <form onSubmit={save} className="hp-card p-5 grid gap-4 max-w-2xl mb-8" data-testid="pf-config-form">
        <h2 className="text-base font-semibold">Preferências</h2>
        <State loading={st.isLoading} error={st.error} />
        <div className="grid gap-3 sm:grid-cols-2">
          <div><label htmlFor="cf-days" className="block text-xs mb-1">Lembrar vencimentos com antecedência de (dias)</label><input id="cf-days" type="number" min={0} max={30} value={days} onChange={(e) => setDays(e.target.value)} /><p className="text-[11px] text-muted-foreground mt-1">Cada ocorrência é lembrada uma única vez; os lembretes ficam só dentro do app.</p></div>
          <div><label htmlFor="cf-months" className="block text-xs mb-1">Meta de cobertura da reserva (meses)</label><input id="cf-months" type="number" min={0} max={60} step="0.5" value={months} onChange={(e) => setMonths(e.target.value)} /></div>
        </div>
        <label className="flex items-start gap-2 text-sm"><input type="checkbox" checked={plan} onChange={(e) => setPlan(e.target.checked)} className="!w-4 !h-4 mt-0.5" /><span>Planejar o próximo mês com a renda recebida neste mês (a renda de um mês orienta o orçamento do seguinte).</span></label>
        <div><button className={btnPrimary}>Salvar preferências</button></div>
      </form>

      <section className="max-w-3xl">
        <div className="flex items-center justify-between gap-2 mb-2"><h2 className="text-base font-semibold">Categorias</h2><div className="flex gap-2"><button type="button" className={btnGhost + " hp-btn-sm"} onClick={() => setDlg({ edit: null, kind: "expense" })}><Plus size={13} aria-hidden />Despesa</button><button type="button" className={btnGhost + " hp-btn-sm"} onClick={() => setDlg({ edit: null, kind: "income" })}><Plus size={13} aria-hidden />Receita</button></div></div>
        <div className="grid gap-4 sm:grid-cols-2">
          {(["expense", "income"] as PfKind[]).map((k) => (
            <div key={k} className="hp-card p-4"><h3 className="text-sm font-medium mb-2">{k === "expense" ? "Despesas" : "Receitas"}</h3>
              <ul className="grid gap-1.5 text-sm">{tops(k).map((c) => (
                <li key={c.id}><div className="flex items-center justify-between gap-2"><span className={c.active ? "" : "text-muted-foreground line-through"}>{c.name}{c.essential && <Badge tone="gold">Essencial</Badge>}</span><button type="button" className="text-accent hover:underline text-xs" onClick={() => setDlg({ edit: c, kind: k })}>Editar</button></div>
                  <ul className="ml-4 mt-0.5 grid gap-0.5">{refs.cats.filter((s) => s.parent_id === c.id).map((s) => <li key={s.id} className="flex items-center justify-between gap-2 text-[13px] text-muted-foreground"><span className={s.active ? "" : "line-through"}>{s.name}</span><button type="button" className="text-accent hover:underline text-xs" onClick={() => setDlg({ edit: s, kind: k })}>Editar</button></li>)}</ul></li>))}</ul></div>))}
        </div>
      </section>
      {dlg && <CategoryDialog edit={dlg.edit} kind={dlg.kind} cats={refs.cats} onClose={() => setDlg(null)} />}
    </div>
  );
};

const CategoryDialog = ({ edit, kind, cats, onClose }: { edit: PfCategory | null; kind: PfKind; cats: PfCategory[]; onClose: () => void }) => {
  const invalidate = useInvalidatePf(); const [msg, m] = useMsg(); const [name, setName] = useState(edit?.name ?? ""); const [parent, setParent] = useState(edit?.parent_id ?? ""); const [ess, setEss] = useState(edit?.essential ?? false); const [active, setActive] = useState(edit?.active ?? true); const [busy, setBusy] = useState(false);
  const submit = async (e: FormEvent) => {
    e.preventDefault(); setBusy(true);
    try { await pfRpc("pf_category_save", { p_id: edit?.id ?? null, p_name: name, p_kind: kind, p_parent: parent || null, p_essential: ess, p_active: active }); invalidate(); onClose(); } catch (err) { m.err(errText(err as { message: string })); } finally { setBusy(false); }
  };
  return (
    <Dialog open onOpenChange={(o) => { if (!o) onClose(); }}><DialogContent className="sm:max-w-sm" data-testid="pf-categoria-dialog">
      <DialogHeader><DialogTitle>{edit ? "Editar categoria" : kind === "expense" ? "Nova categoria de despesa" : "Nova categoria de receita"}</DialogTitle><DialogDescription>Subcategorias ficam dentro de uma categoria principal; o orçamento da principal as inclui.</DialogDescription></DialogHeader>
      <form onSubmit={submit} className="grid gap-3" noValidate><Msg m={msg} />
        <div><label htmlFor="ct-name" className="block text-xs mb-1">Nome</label><input id="ct-name" value={name} onChange={(e) => setName(e.target.value)} maxLength={60} /></div>
        <div><label htmlFor="ct-parent" className="block text-xs mb-1">Subcategoria de</label><select id="ct-parent" value={parent} onChange={(e) => setParent(e.target.value)}><option value="">Categoria principal</option>{cats.filter((c) => c.kind === kind && !c.parent_id && c.id !== edit?.id).map((c) => <option key={c.id} value={c.id}>{c.name}</option>)}</select></div>
        {kind === "expense" && <label className="flex items-center gap-2 text-sm"><input type="checkbox" checked={ess} onChange={(e) => setEss(e.target.checked)} className="!w-4 !h-4" />Despesas desta categoria são essenciais</label>}
        {edit && <label className="flex items-center gap-2 text-sm"><input type="checkbox" checked={active} onChange={(e) => setActive(e.target.checked)} className="!w-4 !h-4" />Categoria ativa</label>}
        <DialogFooter><button type="button" className={btnGhost} onClick={onClose}>Cancelar</button><button className={btnPrimary} disabled={busy}>{busy ? "Salvando…" : "Salvar"}</button></DialogFooter></form>
    </DialogContent></Dialog>
  );
};
export default PfSettings;
