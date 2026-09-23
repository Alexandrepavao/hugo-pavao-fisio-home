import { useCallback, useEffect, useState, type FormEvent } from "react";
import { useSearchParams } from "react-router-dom";
import { MoreHorizontal, Plus, Search, Users, X } from "lucide-react";
import { supabase } from "@/lib/supabase";
import { download, toCsv } from "@/lib/format";
import { Badge, EmptyState, FilterBar, FilterField, PageHead, State, Table, Td, type Tone } from "@/lib/ui";
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { DropdownMenu, DropdownMenuContent, DropdownMenuItem, DropdownMenuTrigger } from "@/components/ui/dropdown-menu";
import { useAuth } from "@/auth/AuthProvider";
import MergeDialog from "./people/MergeDialog";
import ImportDialog from "./people/ImportDialog";

export interface Person {
  id: string; full_name: string; unit_id: string | null; created_at: string;
  person_kinds: { kind: string }[]; person_contacts: { type: string; value: string; is_shared: boolean }[];
}
interface Unit { id: string; name: string }
interface Candidate { person_id: string; full_name: string | null; match_reason: string; visible: boolean }

const KINDS = [
  { value: "lead", label: "Lead" }, { value: "patient", label: "Paciente" }, { value: "student", label: "Aluno" },
  { value: "partner", label: "Parceiro" }, { value: "staff", label: "Equipe" }, { value: "contact", label: "Contato" },
];
const KIND_LABEL = Object.fromEntries(KINDS.map((k) => [k.value, k.label]));
const KIND_TONE: Record<string, Tone> = { lead: "info", patient: "success", student: "gold", partner: "warning", staff: "neutral", contact: "neutral" };
const REASON: Record<string, string> = {
  contato_igual: "mesmo e-mail/telefone (pode ser contato compartilhado)",
  nome_semelhante: "nome semelhante (possível homônimo)",
  "contato_igual+nome_semelhante": "mesmo contato e nome semelhante",
  "nome_semelhante+contato_igual": "mesmo contato e nome semelhante",
};
const PAGE = 20;

const People = () => {
  const { hasRole } = useAuth();
  const [sp, setSp] = useSearchParams();
  const [rows, setRows] = useState<Person[]>([]);
  const [units, setUnits] = useState<Unit[]>([]);
  const [total, setTotal] = useState(0);
  const [page, setPage] = useState(0);
  const [q, setQ] = useState(sp.get("q") ?? "");
  const [kind, setKind] = useState(""); const [unit, setUnit] = useState("");
  const [state, setState] = useState<"loading" | "ok" | "error">("loading");
  const [showForm, setShowForm] = useState(false); const [showImport, setShowImport] = useState(false);
  const [mergeFrom, setMergeFrom] = useState<Person | null>(null);
  const [note, setNote] = useState<string | null>(null);

  const load = useCallback(async () => {
    setState("loading");
    let query = supabase
      .from("people")
      .select(`id, full_name, unit_id, created_at, person_kinds${kind ? "!inner" : ""}(kind), person_contacts(type, value, is_shared)`, { count: "exact" })
      .is("merged_into_id", null).is("archived_at", null)
      .order("created_at", { ascending: false })
      .range(page * PAGE, page * PAGE + PAGE - 1);
    if (q.trim()) query = query.ilike("full_name", `%${q.trim().replace(/[%_]/g, "")}%`);
    if (kind) query = query.eq("person_kinds.kind", kind);
    if (unit) query = query.eq("unit_id", unit);
    const { data, count, error } = await query;
    if (error) return setState("error");
    setRows((data ?? []) as unknown as Person[]); setTotal(count ?? 0); setState("ok");
  }, [page, q, kind, unit]);

  useEffect(() => { const t = setTimeout(() => void load(), 200); return () => clearTimeout(t); }, [load]);
  useEffect(() => { supabase.from("units").select("id, name").eq("active", true).order("name").then(({ data }) => setUnits(data ?? [])); }, []);
  useEffect(() => { const v = sp.get("q"); if (v !== null && v !== q) { setQ(v); setPage(0); } /* busca global */ }, [sp]); // eslint-disable-line react-hooks/exhaustive-deps

  const exportCsv = async () => {
    const { data, error } = await supabase.from("people").select("full_name, created_at, unit_id, person_kinds(kind), person_contacts(type, value)").is("merged_into_id", null).is("archived_at", null).order("full_name").limit(5000);
    if (error) return setNote("Não foi possível exportar (verifique sua permissão).");
    const out = (data ?? []).map((p) => ({
      nome: p.full_name, tipos: (p.person_kinds as { kind: string }[]).map((k) => KIND_LABEL[k.kind] ?? k.kind).join(" | "),
      email: (p.person_contacts as { type: string; value: string }[]).filter((c) => c.type === "email").map((c) => c.value).join(" | "),
      telefone: (p.person_contacts as { type: string; value: string }[]).filter((c) => c.type !== "email").map((c) => c.value).join(" | "),
      unidade: units.find((u) => u.id === p.unit_id)?.name ?? "", criado_em: p.created_at.slice(0, 10),
    }));
    download(`pessoas-${new Date().toISOString().slice(0, 10)}.csv`, toCsv(out));
    setNote(`${out.length} pessoa(s) exportada(s). O arquivo contém dados pessoais: guarde com cuidado.`);
  };
  const invitePortal = async (p: Person) => {
    const email = p.person_contacts.find((c) => c.type === "email")?.value; if (!email) return setNote("Esta pessoa não tem e-mail cadastrado.");
    const { data: u } = await supabase.auth.getUser(); const { data: org } = await supabase.from("organizations").select("id").single();
    const { error } = await supabase.from("invitations").insert({ org_id: org?.id, email, role: "member", person_id: p.id, invited_by: u.user?.id });
    setNote(error ? "Não foi possível criar o convite (permissão ou convite já existente)." : `Convite ao portal registrado para ${email}. A pessoa deve usar “Primeiro acesso” com este e-mail.`);
  };

  const clearFilters = () => { setQ(""); setKind(""); setUnit(""); setPage(0); setSp({}); };
  const hasFilters = !!(q || kind || unit);
  const canMerge = hasRole("manager", "ops_admin", "unit_manager");

  return (
    <div>
      <PageHead eyebrow="HP Core" title="Pessoas" hint="Cadastro central de leads, pacientes, alunos e parceiros — independente de ter conta de acesso."
        actions={<>
          <button className="hp-btn hp-btn-outline" onClick={exportCsv}>Exportar CSV</button>
          <button className="hp-btn hp-btn-outline" onClick={() => setShowImport(true)}>Importar</button>
          <button className="hp-btn hp-btn-primary" onClick={() => setShowForm(true)}><Plus size={16} aria-hidden />Nova pessoa</button></>} />
      {note && <p role="status" className="mb-4 rounded-md border border-border bg-card px-3 py-2 text-sm">{note} <button className="underline ml-1" onClick={() => setNote(null)}>Fechar</button></p>}

      <FilterBar>
        <FilterField label="Buscar por nome" htmlFor="p-q" className="min-w-[16rem]">
          <div className="relative"><Search size={14} aria-hidden className="absolute left-2.5 top-1/2 -translate-y-1/2 text-muted-foreground" />
            <input id="p-q" type="search" style={{ paddingLeft: "2rem" }} placeholder="Nome…" value={q} onChange={(e) => { setPage(0); setQ(e.target.value); }} onKeyDown={(e) => e.key === "Escape" && clearFilters()} /></div>
        </FilterField>
        <FilterField label="Tipo" htmlFor="p-kind"><select id="p-kind" value={kind} onChange={(e) => { setPage(0); setKind(e.target.value); }}><option value="">Todos</option>{KINDS.map((k) => <option key={k.value} value={k.value}>{k.label}</option>)}</select></FilterField>
        <FilterField label="Unidade" htmlFor="p-unit"><select id="p-unit" value={unit} onChange={(e) => { setPage(0); setUnit(e.target.value); }}><option value="">Todas</option>{units.map((u) => <option key={u.id} value={u.id}>{u.name}</option>)}</select></FilterField>
        {hasFilters && <button className="hp-btn hp-btn-ghost" onClick={clearFilters}><X size={14} aria-hidden />Limpar filtros</button>}
      </FilterBar>

      <State loading={state === "loading" && rows.length === 0} error={state === "error"} />
      {state === "ok" && rows.length === 0 && <EmptyState icon={Users} title={hasFilters ? "Nenhuma pessoa encontrada" : "Nenhuma pessoa cadastrada ainda"} action={!hasFilters ? <button className="hp-btn hp-btn-primary mt-2" onClick={() => setShowForm(true)}>Cadastrar a primeira pessoa</button> : undefined}>{hasFilters ? "Ajuste ou limpe os filtros." : "Cadastre manualmente, importe uma planilha ou aguarde os envios dos formulários das páginas."}</EmptyState>}
      {rows.length > 0 && (
        <Table head={["Nome", "Tipo", "Contato", "Unidade", ""]}>
          {rows.map((p) => (
            <tr key={p.id}>
              <Td><span className="font-medium text-foreground">{p.full_name}</span></Td>
              <Td><div className="flex flex-wrap gap-1">{p.person_kinds.length ? p.person_kinds.map((k) => <Badge key={k.kind} tone={KIND_TONE[k.kind]}>{KIND_LABEL[k.kind] ?? k.kind}</Badge>) : <span className="text-muted-foreground">—</span>}</div></Td>
              <Td className="text-muted-foreground">{p.person_contacts.map((c) => c.value + (c.is_shared ? " (compartilhado)" : "")).join(" · ") || "—"}</Td>
              <Td className="text-muted-foreground">{units.find((u) => u.id === p.unit_id)?.name ?? "—"}</Td>
              <Td className="text-right">
                <DropdownMenu><DropdownMenuTrigger asChild><button className="hp-btn hp-btn-ghost hp-btn-sm" style={{ width: "1.875rem", padding: 0 }} aria-label={`Ações de ${p.full_name}`}><MoreHorizontal size={16} /></button></DropdownMenuTrigger>
                  <DropdownMenuContent align="end"><DropdownMenuItem onSelect={() => invitePortal(p)}>Convidar ao portal</DropdownMenuItem>
                    {canMerge && <DropdownMenuItem onSelect={() => setMergeFrom(p)}>Mesclar com outro cadastro…</DropdownMenuItem>}</DropdownMenuContent></DropdownMenu>
              </Td>
            </tr>
          ))}
        </Table>
      )}
      {total > PAGE && (
        <div className="flex items-center justify-between mt-3 text-sm text-muted-foreground">
          <span className="tabular">{page * PAGE + 1}–{Math.min((page + 1) * PAGE, total)} de {total}</span>
          <div className="flex gap-2"><button className="hp-btn hp-btn-outline hp-btn-sm" disabled={page === 0} onClick={() => setPage(page - 1)}>Anterior</button><button className="hp-btn hp-btn-outline hp-btn-sm" disabled={(page + 1) * PAGE >= total} onClick={() => setPage(page + 1)}>Próxima</button></div>
        </div>
      )}
      <NewPerson open={showForm} onOpenChange={setShowForm} units={units} onCreated={() => { setShowForm(false); setPage(0); void load(); }} />
      <ImportDialog open={showImport} onOpenChange={setShowImport} units={units} onDone={() => { void load(); }} />
      <MergeDialog from={mergeFrom} onClose={() => setMergeFrom(null)} onDone={() => { setMergeFrom(null); setNote("Cadastros mesclados. O histórico foi preservado no cadastro mantido."); void load(); }} />
    </div>
  );
};

const NewPerson = ({ open, onOpenChange, units, onCreated }: { open: boolean; onOpenChange: (v: boolean) => void; units: Unit[]; onCreated: () => void }) => {
  const [name, setName] = useState(""); const [email, setEmail] = useState(""); const [phone, setPhone] = useState("");
  const [unitId, setUnitId] = useState(""); const [kinds, setKinds] = useState<string[]>(["lead"]);
  const [busy, setBusy] = useState(false); const [error, setError] = useState<string | null>(null);
  const [dups, setDups] = useState<Candidate[] | null>(null);
  useEffect(() => { if (units.length === 1) setUnitId(units[0].id); }, [units]);

  const submit = async (e: FormEvent | null, force = false) => {
    e?.preventDefault(); setError(null);
    if (name.trim().length < 2) return setError("Informe o nome completo.");
    if (!unitId) return setError("Selecione a unidade.");
    if (!email.trim() && !phone.trim()) return setError("Informe ao menos um contato (e-mail ou telefone).");
    setBusy(true);
    const { data, error: err } = await supabase.rpc("create_person", { p_full_name: name, p_unit_id: unitId, p_kinds: kinds, p_email: email || null, p_phone: phone || null, p_force: force });
    setBusy(false);
    if (err) return setError("Não foi possível salvar. Verifique sua permissão para esta unidade.");
    const res = data as { status: string; candidates?: Candidate[] };
    if (res.status === "duplicates") return setDups(res.candidates ?? []);
    setName(""); setEmail(""); setPhone(""); setDups(null); onCreated();
  };
  const toggle = (k: string) => setKinds((cur) => cur.includes(k) ? cur.filter((x) => x !== k) : [...cur, k]);

  return (
    <Dialog open={open} onOpenChange={(o) => { onOpenChange(o); if (!o) setDups(null); }}>
      <DialogContent className="sm:max-w-lg">
        <DialogHeader><DialogTitle>Nova pessoa</DialogTitle><DialogDescription>O cadastro existe mesmo sem conta de acesso. Verificamos duplicidades antes de salvar.</DialogDescription></DialogHeader>
        <form id="new-person" onSubmit={(e) => submit(e)} className="grid gap-3 sm:grid-cols-2" noValidate>
          <div className="sm:col-span-2"><label htmlFor="np-n" className="block mb-1">Nome completo *</label><input id="np-n" value={name} onChange={(e) => { setName(e.target.value); setDups(null); }} /></div>
          <div><label htmlFor="np-e" className="block mb-1">E-mail</label><input id="np-e" type="email" value={email} onChange={(e) => { setEmail(e.target.value); setDups(null); }} /></div>
          <div><label htmlFor="np-t" className="block mb-1">Telefone / WhatsApp</label><input id="np-t" type="tel" value={phone} onChange={(e) => { setPhone(e.target.value); setDups(null); }} /></div>
          <div><label htmlFor="np-u" className="block mb-1">Unidade *</label><select id="np-u" value={unitId} onChange={(e) => setUnitId(e.target.value)}><option value="">Selecione…</option>{units.map((u) => <option key={u.id} value={u.id}>{u.name}</option>)}</select></div>
          <fieldset><legend className="text-[0.8125rem] font-medium mb-1">Tipo</legend>
            <div className="flex flex-wrap gap-x-3 gap-y-1">{KINDS.filter((k) => k.value !== "staff").map((k) => <label key={k.value} className="flex items-center gap-1.5 !font-normal"><input type="checkbox" checked={kinds.includes(k.value)} onChange={() => toggle(k.value)} />{k.label}</label>)}</div></fieldset>
          {error && <p role="alert" className="sm:col-span-2 text-sm text-destructive">{error}</p>}
          {dups && (
            <div role="alert" className="sm:col-span-2 rounded-md border p-3 text-sm" style={{ borderColor: "hsl(var(--warning) / .5)", background: "hsl(var(--warning-soft))" }}>
              <p className="font-medium mb-1">Possível cadastro já existente — decida antes de continuar:</p>
              <ul className="list-disc pl-5 mb-2">{dups.map((d) => <li key={d.person_id}>{d.visible ? d.full_name : "Cadastro em outra unidade (sem acesso)"} — {REASON[d.match_reason] ?? d.match_reason}</li>)}</ul>
              <p className="text-muted-foreground mb-2">Contatos compartilhados (familiares) e homônimos são possíveis. Só crie um novo cadastro se tiver certeza de que é outra pessoa.</p>
              <button type="button" disabled={busy} onClick={() => submit(null, true)} className="hp-btn hp-btn-outline hp-btn-sm">É outra pessoa — criar mesmo assim</button>
            </div>
          )}
        </form>
        <DialogFooter><button type="button" className="hp-btn hp-btn-outline" onClick={() => onOpenChange(false)}>Cancelar</button><button form="new-person" disabled={busy} className="hp-btn hp-btn-primary">{busy ? "Salvando…" : "Salvar pessoa"}</button></DialogFooter>
      </DialogContent>
    </Dialog>
  );
};

export default People;
