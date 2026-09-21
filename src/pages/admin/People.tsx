import { useCallback, useEffect, useState, type FormEvent } from "react";
import { supabase } from "@/lib/supabase";

interface Person {
  id: string; full_name: string; unit_id: string | null; created_at: string;
  person_kinds: { kind: string }[]; person_contacts: { type: string; value: string; is_shared: boolean }[];
}
interface Unit { id: string; name: string }
interface Candidate { person_id: string; full_name: string | null; match_reason: string; visible: boolean }

const KINDS = [
  { value: "lead", label: "Lead" }, { value: "patient", label: "Paciente" }, { value: "student", label: "Aluno" },
  { value: "partner", label: "Parceiro" }, { value: "contact", label: "Contato" },
];
const KIND_LABEL = Object.fromEntries(KINDS.map((k) => [k.value, k.label]));
const REASON: Record<string, string> = {
  contato_igual: "mesmo e-mail/telefone (pode ser contato compartilhado)",
  nome_semelhante: "nome semelhante (possível homônimo)",
  "contato_igual+nome_semelhante": "mesmo contato e nome semelhante",
  "nome_semelhante+contato_igual": "mesmo contato e nome semelhante",
};
const PAGE = 20;
const field = "w-full border border-input bg-card px-3 py-2 text-[15px] focus:outline-none focus:ring-2 focus:ring-ring";

const People = () => {
  const [rows, setRows] = useState<Person[]>([]);
  const [units, setUnits] = useState<Unit[]>([]);
  const [total, setTotal] = useState(0);
  const [page, setPage] = useState(0);
  const [q, setQ] = useState("");
  const [state, setState] = useState<"loading" | "ok" | "error">("loading");
  const [showForm, setShowForm] = useState(false);

  const load = useCallback(async () => {
    setState("loading");
    let query = supabase
      .from("people")
      .select("id, full_name, unit_id, created_at, person_kinds(kind), person_contacts(type, value, is_shared)", { count: "exact" })
      .is("merged_into_id", null).is("archived_at", null)
      .order("created_at", { ascending: false })
      .range(page * PAGE, page * PAGE + PAGE - 1);
    if (q.trim()) query = query.ilike("full_name", `%${q.trim().replace(/[%_]/g, "")}%`);
    const { data, count, error } = await query;
    if (error) return setState("error");
    setRows((data ?? []) as Person[]); setTotal(count ?? 0); setState("ok");
  }, [page, q]);

  useEffect(() => { void load(); }, [load]);
  useEffect(() => { supabase.from("units").select("id, name").eq("active", true).order("name").then(({ data }) => setUnits(data ?? [])); }, []);

  return (
    <div>
      <div className="flex flex-wrap items-end justify-between gap-4 mb-6">
        <div><p className="eyebrow mb-2">HP Core</p><h1 className="text-3xl text-navy-900">Pessoas</h1></div>
        <button onClick={() => setShowForm((s) => !s)} className="btn-primary !py-3">{showForm ? "Fechar" : "Nova pessoa"}</button>
      </div>

      {showForm && <NewPerson units={units} onCreated={() => { setShowForm(false); setPage(0); void load(); }} />}

      <div className="mb-4">
        <label htmlFor="q" className="sr-only">Buscar por nome</label>
        <input id="q" type="search" placeholder="Buscar por nome…" value={q}
          onChange={(e) => { setPage(0); setQ(e.target.value); }} className={field + " max-w-sm"} />
      </div>

      {state === "loading" && <p role="status" className="text-navy-400">Carregando…</p>}
      {state === "error" && <p role="alert" className="text-destructive">Não foi possível carregar. Verifique sua permissão e tente novamente.</p>}
      {state === "ok" && rows.length === 0 && <p className="text-navy-400 bg-card border border-border p-6">{q ? "Nenhuma pessoa encontrada para esta busca." : "Nenhuma pessoa cadastrada ainda."}</p>}
      {state === "ok" && rows.length > 0 && (
        <div className="overflow-x-auto bg-card border border-border">
          <table className="w-full text-[15px]">
            <thead><tr className="text-left text-xs uppercase tracking-wider text-navy-400 border-b border-border">
              <th className="p-3">Nome</th><th className="p-3">Tipo</th><th className="p-3">Contato</th><th className="p-3">Unidade</th>
            </tr></thead>
            <tbody>
              {rows.map((p) => (
                <tr key={p.id} className="border-b border-border last:border-0">
                  <td className="p-3 text-navy-900">{p.full_name}</td>
                  <td className="p-3">{p.person_kinds.map((k) => KIND_LABEL[k.kind] ?? k.kind).join(", ") || "—"}</td>
                  <td className="p-3 text-navy-400">
                    {p.person_contacts.map((c) => c.value + (c.is_shared ? " (compartilhado)" : "")).join(" · ") || "—"}
                  </td>
                  <td className="p-3 text-navy-400">{units.find((u) => u.id === p.unit_id)?.name ?? "—"}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
      {total > PAGE && (
        <div className="flex items-center justify-between mt-4 text-sm text-navy-400">
          <span>{page * PAGE + 1}–{Math.min((page + 1) * PAGE, total)} de {total}</span>
          <div className="flex gap-2">
            <button disabled={page === 0} onClick={() => setPage(page - 1)} className="px-3 py-1 border border-border disabled:opacity-40">Anterior</button>
            <button disabled={(page + 1) * PAGE >= total} onClick={() => setPage(page + 1)} className="px-3 py-1 border border-border disabled:opacity-40">Próxima</button>
          </div>
        </div>
      )}
    </div>
  );
};

const NewPerson = ({ units, onCreated }: { units: Unit[]; onCreated: () => void }) => {
  const [name, setName] = useState(""); const [email, setEmail] = useState(""); const [phone, setPhone] = useState("");
  const [unitId, setUnitId] = useState(""); const [kinds, setKinds] = useState<string[]>(["lead"]);
  const [busy, setBusy] = useState(false); const [error, setError] = useState<string | null>(null);
  const [dups, setDups] = useState<Candidate[] | null>(null);

  const submit = async (e: FormEvent | null, force = false) => {
    e?.preventDefault();
    setError(null);
    if (name.trim().length < 2) return setError("Informe o nome completo.");
    if (!unitId) return setError("Selecione a unidade.");
    if (!email.trim() && !phone.trim()) return setError("Informe ao menos um contato (e-mail ou telefone).");
    setBusy(true);
    const { data, error: err } = await supabase.rpc("create_person", {
      p_full_name: name, p_unit_id: unitId, p_kinds: kinds, p_email: email || null, p_phone: phone || null, p_force: force,
    });
    setBusy(false);
    if (err) return setError("Não foi possível salvar. Verifique sua permissão para esta unidade.");
    const res = data as { status: string; candidates?: Candidate[] };
    if (res.status === "duplicates") return setDups(res.candidates ?? []);
    onCreated();
  };

  const toggle = (k: string) => setKinds((cur) => cur.includes(k) ? cur.filter((x) => x !== k) : [...cur, k]);

  return (
    <form onSubmit={(e) => submit(e)} className="bg-card border border-border p-6 mb-8 grid gap-4 sm:grid-cols-2" noValidate>
      <div className="sm:col-span-2"><label htmlFor="n" className="block text-sm mb-1">Nome completo *</label>
        <input id="n" value={name} onChange={(e) => { setName(e.target.value); setDups(null); }} className={field} /></div>
      <div><label htmlFor="e" className="block text-sm mb-1">E-mail</label>
        <input id="e" type="email" value={email} onChange={(e) => { setEmail(e.target.value); setDups(null); }} className={field} /></div>
      <div><label htmlFor="t" className="block text-sm mb-1">Telefone / WhatsApp</label>
        <input id="t" type="tel" value={phone} onChange={(e) => { setPhone(e.target.value); setDups(null); }} className={field} /></div>
      <div><label htmlFor="u" className="block text-sm mb-1">Unidade *</label>
        <select id="u" value={unitId} onChange={(e) => setUnitId(e.target.value)} className={field}>
          <option value="">Selecione…</option>{units.map((u) => <option key={u.id} value={u.id}>{u.name}</option>)}
        </select></div>
      <fieldset><legend className="text-sm mb-1">Tipo</legend>
        <div className="flex flex-wrap gap-3">{KINDS.map((k) => (
          <label key={k.value} className="flex items-center gap-2 text-[15px]">
            <input type="checkbox" checked={kinds.includes(k.value)} onChange={() => toggle(k.value)} /> {k.label}
          </label>))}</div></fieldset>

      {error && <p role="alert" className="sm:col-span-2 text-sm text-destructive">{error}</p>}

      {dups && (
        <div role="alert" className="sm:col-span-2 border border-accent bg-accent/5 p-4 text-[15px]">
          <p className="font-medium text-navy-900 mb-2">Possível cadastro já existente — decida antes de continuar:</p>
          <ul className="list-disc pl-5 mb-3 text-navy-700">
            {dups.map((d) => (
              <li key={d.person_id}>
                {d.visible ? d.full_name : "Cadastro em outra unidade (sem acesso)"} — {REASON[d.match_reason] ?? d.match_reason}
              </li>))}
          </ul>
          <p className="text-navy-400 mb-3">Contatos compartilhados (familiares) e homônimos são possíveis. Só crie um novo cadastro se tiver certeza de que é outra pessoa.</p>
          <button type="button" disabled={busy} onClick={() => submit(null, true)} className="btn-primary !py-2">É outra pessoa — criar mesmo assim</button>
        </div>
      )}
      <div className="sm:col-span-2"><button type="submit" disabled={busy} className="btn-primary !py-3 disabled:opacity-60">{busy ? "Salvando…" : "Salvar pessoa"}</button></div>
    </form>
  );
};

export default People;
