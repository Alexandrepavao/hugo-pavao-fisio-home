import { useState, type FormEvent } from "react";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { supabase } from "@/lib/supabase";
import { brl, fmtDate, parseCents } from "@/lib/format";
import { btnGhost, btnPrimary, errText, Msg, PageHead, State, Table, Td, useMsg } from "@/lib/ui";
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import type { Account } from "./shared";

type Line = "unclassified" | "physio" | "academy" | "shared";
interface Alloc { line: "physio" | "academy"; basis_points: number }
interface PayRow { id: string; description: string; amount_cents: number; due_date: string; status: string; paid_at: string | null; business_line: Line; payable_allocations: Alloc[] }
const LINE_LABEL: Record<Line, string> = { unclassified: "Não classificado", physio: "HP Fisioterapia", academy: "HP Academy", shared: "Compartilhado" };
/** Texto da linha: rateio explícito aparece como “Compartilhado (60% Fisioterapia / 40% Academy)”; sem rateio, “não alocado”. */
const lineText = (p: PayRow) => {
  if (p.business_line !== "shared") return LINE_LABEL[p.business_line];
  if (!p.payable_allocations?.length) return "Compartilhado — sem rateio (não alocado)";
  const pct = (l: "physio" | "academy") => (p.payable_allocations.find((a) => a.line === l)?.basis_points ?? 0) / 100;
  return `Compartilhado (${pct("physio")}% Fisioterapia / ${pct("academy")}% Academy)`;
};

const FinancePayables = () => {
  const qc = useQueryClient(); const [msg, m] = useMsg();
  const [desc, setDesc] = useState(""); const [amount, setAmount] = useState(""); const [due, setDue] = useState(new Date().toISOString().slice(0, 10)); const [unit, setUnit] = useState(""); const [cat, setCat] = useState(""); const [product, setProduct] = useState(""); const [newLine, setNewLine] = useState<Line>("unclassified");
  const [filterLine, setFilterLine] = useState<"" | Line>(""); const [edit, setEdit] = useState<PayRow | null>(null); const [editLine, setEditLine] = useState<Line>("unclassified"); const [editPhysio, setEditPhysio] = useState("50"); const [editSplit, setEditSplit] = useState(false);
  const units = useQuery({ queryKey: ["units"], queryFn: async () => (await supabase.from("units").select("id, name").eq("active", true)).data ?? [] });
  const cats = useQuery({ queryKey: ["cats"], queryFn: async () => (await supabase.from("finance_categories").select("id, name, dre_classification").eq("kind", "expense")).data ?? [] });
  const products = useQuery({ queryKey: ["products-payables"], queryFn: async () => (await supabase.from("products").select("id, name").eq("active", true).order("name")).data ?? [] });
  const accounts = useQuery({ queryKey: ["accounts"], queryFn: async () => (await supabase.from("financial_accounts").select("id, name").eq("active", true)).data as Account[] });
  const list = useQuery({ queryKey: ["payables"], queryFn: async () => (await supabase.from("payables").select("id, description, amount_cents, due_date, status, paid_at").order("due_date").limit(200)).data ?? [] });
  // Linha de negócio e rateio: consulta à parte e tolerante (se a migration de linhas ainda não foi aplicada, a tela segue funcionando sem a coluna)
  const lineInfo = useQuery({ queryKey: ["payables-lines"], retry: false, queryFn: async () => {
    const { data, error } = await supabase.from("payables").select("id, business_line, payable_allocations(line, basis_points)").limit(1000); if (error) throw error;
    return Object.fromEntries((data as unknown as { id: string; business_line: Line; payable_allocations: Alloc[] }[]).map((r) => [r.id, r]));
  } });
  const rows: PayRow[] = (list.data ?? []).map((p) => ({ ...p, business_line: lineInfo.data?.[p.id]?.business_line ?? "unclassified", payable_allocations: lineInfo.data?.[p.id]?.payable_allocations ?? [] }));
  const add = async (e: FormEvent) => {
    e.preventDefault(); const cents = parseCents(amount); const { data: u } = await supabase.auth.getUser();
    if (!desc.trim() || !unit || cents == null) return m.err("Preencha descrição, unidade e valor.");
    const { data: org } = await supabase.from("units").select("org_id").eq("id", unit).single();
    const { error } = await supabase.from("payables").insert({ org_id: org?.org_id, unit_id: unit, category_id: cat || null, product_id: product || null, description: desc.trim(), amount_cents: cents, due_date: due, competence_month: due.slice(0, 8) + "01", created_by: u.user?.id, ...(newLine !== "unclassified" ? { business_line: newLine } : {}) });
    if (error) m.err(errText(error)); else { m.ok("Conta cadastrada."); setDesc(""); setAmount(""); setProduct(""); void qc.invalidateQueries({ queryKey: ["payables"] }); }
  };
  const openEdit = (p: PayRow) => {
    setEdit(p); setEditLine(p.business_line); const phy = p.payable_allocations?.find((a) => a.line === "physio")?.basis_points;
    setEditSplit(p.business_line === "shared" && (p.payable_allocations?.length ?? 0) > 0); setEditPhysio(phy != null ? String(phy / 100) : "50");
  };
  const saveLine = async () => {
    if (!edit) return;
    const phy = Math.round(Number(editPhysio.replace(",", ".")) * 100);
    if (editLine === "shared" && editSplit && (!Number.isFinite(phy) || phy < 1 || phy > 9999)) return m.err("Informe o percentual da Fisioterapia entre 0,01% e 99,99% (o restante vai para a Academy).");
    const allocations = editLine === "shared" && editSplit ? [{ line: "physio", basis_points: phy }, { line: "academy", basis_points: 10000 - phy }] : null;
    const { error } = await supabase.rpc("payable_set_line", { p_payable: edit.id, p_line: editLine, p_allocations: allocations });
    if (error) return m.err(errText(error));
    m.ok("Linha de negócio atualizada."); setEdit(null); void qc.invalidateQueries({ queryKey: ["payables"] });
  };
  const shown = rows.filter((p) => !filterLine || p.business_line === filterLine);
  return (
    <div>
      <PageHead eyebrow="Financeiro" title="Contas a pagar" hint="Obrigações, vencimentos e pagamentos. Marcar como paga registra a baixa, a competência e a classificação para a DRE." />
      <Msg m={msg} />
      <form onSubmit={add} className="hp-card p-5 mb-6 grid gap-3 sm:grid-cols-6 items-end" noValidate>
        <div className="sm:col-span-2"><label htmlFor="pd" className="block text-xs mb-1">Descrição</label><input id="pd"   value={desc} onChange={(e) => setDesc(e.target.value)} /></div>
        <div><label htmlFor="pv" className="block text-xs mb-1">Valor (R$)</label><input id="pv"   value={amount} onChange={(e) => setAmount(e.target.value)} /></div>
        <div><label htmlFor="pdue" className="block text-xs mb-1">Vencimento</label><input id="pdue" type="date"   value={due} onChange={(e) => setDue(e.target.value)} /></div>
        <div><label htmlFor="pun" className="block text-xs mb-1">Unidade</label><select id="pun"   value={unit} onChange={(e) => setUnit(e.target.value)}><option value="">…</option>{units.data?.map((u) => <option key={u.id} value={u.id}>{u.name}</option>)}</select></div>
        <div><label htmlFor="pcat" className="block text-xs mb-1">Categoria (define a classificação DRE)</label><select id="pcat"   value={cat} onChange={(e) => setCat(e.target.value)}><option value="">…</option>{cats.data?.map((c) => <option key={c.id} value={c.id}>{c.name}{!c.dre_classification && " (sem classificar)"}</option>)}</select></div>
        <div className="sm:col-span-2"><label htmlFor="pprod" className="block text-xs mb-1">Produto/serviço (opcional — só se este custo for de fato dele, para habilitar a margem por produto)</label><select id="pprod"   value={product} onChange={(e) => setProduct(e.target.value)}><option value="">Nenhum (custo geral)</option>{products.data?.map((p) => <option key={p.id} value={p.id}>{p.name}</option>)}</select></div>
        <div><label htmlFor="pline" className="block text-xs mb-1">Linha de negócio</label><select id="pline" value={newLine} onChange={(e) => setNewLine(e.target.value as Line)}>{(Object.keys(LINE_LABEL) as Line[]).map((k) => <option key={k} value={k}>{LINE_LABEL[k]}</option>)}</select></div>
        <button className="hp-btn hp-btn-primary">Cadastrar</button>
      </form>
      <div className="flex flex-wrap items-center gap-2 mb-3 text-sm"><label htmlFor="pfilter" className="text-xs text-muted-foreground">Filtrar por linha</label>
        <select id="pfilter" className="!w-auto" value={filterLine} onChange={(e) => setFilterLine(e.target.value as "" | Line)}><option value="">Todas</option>{(Object.keys(LINE_LABEL) as Line[]).map((k) => <option key={k} value={k}>{LINE_LABEL[k]}</option>)}</select></div>
      <State loading={list.isLoading} error={list.error} empty={shown.length === 0 && !list.isLoading} emptyText="Nenhuma conta a pagar neste filtro." />
      {shown.length > 0 && <Table head={["Descrição", "Vencimento", "Valor", "Linha", "Estado", ""]} right={[2]}>
        {shown.map((p) => <tr key={p.id}><Td>{p.description}</Td><Td>{fmtDate(p.due_date + "T12:00:00Z")}</Td><Td num>{brl(p.amount_cents)}</Td><Td><button className="text-accent text-left hover:underline" onClick={() => openEdit(p)} title="Classificar / ratear">{lineText(p)}</button></Td><Td>{p.status === "paid" ? `Paga em ${fmtDate(p.paid_at)}` : p.status === "open" ? "Em aberto" : "Cancelada"}</Td>
          <Td>{p.status === "open" && <button className={btnGhost + " hp-btn-sm"} onClick={async () => { const { error } = await supabase.rpc("payable_pay", { p_id: p.id, p_account: accounts.data?.[0]?.id ?? null }); if (error) m.err(errText(error)); else { m.ok("Baixa registrada."); void qc.invalidateQueries({ queryKey: ["payables"] }); } }}>Marcar como paga</button>}</Td></tr>)}</Table>}
      <Dialog open={!!edit} onOpenChange={(o) => { if (!o) setEdit(null); }}>
        <DialogContent>
          <DialogHeader><DialogTitle>Linha de negócio da despesa</DialogTitle>
            <DialogDescription>{edit?.description}. “Compartilhado” só é dividido entre as linhas se você informar o rateio; sem rateio, fica como compartilhado/não alocado.</DialogDescription></DialogHeader>
          <div className="grid gap-3">
            <div><label htmlFor="el" className="block text-xs mb-1">Linha</label><select id="el" value={editLine} onChange={(e) => setEditLine(e.target.value as Line)}>{(Object.keys(LINE_LABEL) as Line[]).map((k) => <option key={k} value={k}>{LINE_LABEL[k]}</option>)}</select></div>
            {editLine === "shared" && (<>
              <label className="flex items-center gap-2 text-sm !font-normal"><input type="checkbox" checked={editSplit} onChange={(e) => setEditSplit(e.target.checked)} />Ratear entre as linhas</label>
              {editSplit && <div className="grid grid-cols-2 gap-2 items-end"><div><label htmlFor="ep" className="block text-xs mb-1">% HP Fisioterapia</label><input id="ep" inputMode="decimal" value={editPhysio} onChange={(e) => setEditPhysio(e.target.value)} /></div>
                <p className="text-sm pb-2">HP Academy: {Number.isFinite(Number(editPhysio.replace(",", "."))) ? (100 - Number(editPhysio.replace(",", "."))).toLocaleString("pt-BR", { maximumFractionDigits: 2 }) : "—"}%</p></div>}
            </>)}
          </div>
          <DialogFooter><button className={btnGhost} onClick={() => setEdit(null)}>Cancelar</button><button className={btnPrimary} onClick={saveLine}>Salvar</button></DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  );
};

export default FinancePayables;
