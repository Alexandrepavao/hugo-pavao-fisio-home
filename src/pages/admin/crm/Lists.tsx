import { useState, type FormEvent } from "react";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { supabase } from "@/lib/supabase";
import { PageHead, State, Table, Td, errText, Msg, useMsg, btnGhost } from "@/lib/ui";
import CompanyDialog from "./CompanyDialog";
import CrmImportDialog from "./CrmImportDialog";
import { LEAD_KINDS, LEAD_TYPE, isLeadKind, type LeadKind } from "./leadTypes";
import LeadTypeBadge from "./LeadTypeBadge";

interface ListRow { id: string; name: string; kind: string | null; created_at: string; n: number }
interface ListQ { id: string; name: string; kind: string | null; created_at: string; crm_lead_list_members: { count: number }[]; crm_lead_list_companies: { count: number }[] }
interface CompanyRow { id: string; legal_name: string; trade_name: string | null; city: string | null; state_uf: string | null }

/** Listas: um grupo estático e curado (não um filtro salvo) — agora COM TIPO: de pacientes, de fisioterapeutas que querem trabalhar conosco, de fisioterapeutas que querem a HP Academy
 *  ou de empresas (B2B). O tipo é escolhido ao criar e define o funil da importação CSV; lista de empresas guarda empresas, as demais guardam pessoas (nunca copia dados do cadastro central). */
const Lists = () => {
  const qc = useQueryClient(); const [msg, m] = useMsg();
  const [name, setName] = useState(""); const [kind, setKind] = useState<LeadKind | "">(""); const [filter, setFilter] = useState<LeadKind | "sem" | "">("");
  const [openList, setOpenList] = useState<string | null>(null); const [search, setSearch] = useState("");
  const [importOpen, setImportOpen] = useState<{ listId?: string } | null>(null); const [companyOpen, setCompanyOpen] = useState(false);

  const lists = useQuery({ queryKey: ["crm-lists"], queryFn: async () => {
    const { data, error } = await supabase.from("crm_lead_lists").select("id, name, kind, created_at, crm_lead_list_members(count), crm_lead_list_companies(count)").order("created_at", { ascending: false });
    if (error) throw error;
    return (data as unknown as ListQ[]).map((l) => ({ id: l.id, name: l.name, kind: l.kind, created_at: l.created_at, n: l.kind === "companies" ? (l.crm_lead_list_companies[0]?.count ?? 0) : (l.crm_lead_list_members[0]?.count ?? 0) })) as ListRow[];
  } });
  const current = lists.data?.find((l) => l.id === openList) ?? null; const isCompanies = current?.kind === "companies";
  const members = useQuery({ queryKey: ["crm-list-members", openList], enabled: !!openList && !isCompanies, queryFn: async () => {
    const { data, error } = await supabase.from("crm_lead_list_members").select("person_id, added_at, person:people(full_name)").eq("list_id", openList!).order("added_at", { ascending: false });
    if (error) throw error; return data as unknown as { person_id: string; added_at: string; person: { full_name: string } | null }[];
  } });
  const companies = useQuery({ queryKey: ["crm-list-companies", openList], enabled: !!openList && isCompanies, queryFn: async () => {
    const { data, error } = await supabase.from("crm_lead_list_companies").select("legal_entity_id, added_at, company:legal_entities(id, legal_name, trade_name, city, state_uf)").eq("list_id", openList!).order("added_at", { ascending: false });
    if (error) throw error; return data as unknown as { legal_entity_id: string; added_at: string; company: CompanyRow | null }[];
  } });
  const q = search.replace(/[%_,()]/g, "");
  const found = useQuery({ queryKey: ["crm-list-search", search, isCompanies], enabled: !!openList && search.length >= 2, queryFn: async () => isCompanies
    ? ((await supabase.from("legal_entities").select("id, legal_name, trade_name").or(`legal_name.ilike.%${q}%,trade_name.ilike.%${q}%`).is("merged_into_id", null).limit(8)).data ?? []).map((c) => ({ id: c.id, label: c.trade_name || c.legal_name }))
    : ((await supabase.from("people").select("id, full_name").ilike("full_name", `%${q}%`).is("merged_into_id", null).limit(8)).data ?? []).map((p) => ({ id: p.id, label: p.full_name })) });

  const refreshLists = () => { void qc.invalidateQueries({ queryKey: ["crm-lists"] }); };
  const create = async (e: FormEvent) => {
    e.preventDefault(); if (!name.trim()) return m.err("Informe o nome da lista."); if (!kind) return m.err("Escolha o tipo da lista (paciente, fisioterapeuta ou empresa).");
    const { data: org } = await supabase.from("organizations").select("id").single();
    const { data: u } = await supabase.auth.getUser();
    const { error } = await supabase.from("crm_lead_lists").insert({ org_id: org?.id, name: name.trim(), kind, created_by: u.user?.id });
    if (error) return m.err(errText(error));
    m.ok("Lista criada."); setName(""); setKind(""); refreshLists();
  };
  const setListKind = async (id: string, k: string) => {
    if (!isLeadKind(k)) return; const { error } = await supabase.from("crm_lead_lists").update({ kind: k }).eq("id", id);
    if (error) return m.err(errText(error)); m.ok("Tipo da lista definido."); refreshLists();
  };
  const removeList = async (id: string) => {
    const { error } = await supabase.from("crm_lead_lists").delete().eq("id", id);
    if (error) return m.err(errText(error));
    m.ok("Lista removida (as pessoas e empresas continuam cadastradas)."); if (openList === id) setOpenList(null); refreshLists();
  };
  const addMember = async (id: string) => {
    const { data: u } = await supabase.auth.getUser();
    const { error } = isCompanies
      ? await supabase.from("crm_lead_list_companies").insert({ list_id: openList, legal_entity_id: id, added_by: u.user?.id })
      : await supabase.from("crm_lead_list_members").insert({ list_id: openList, person_id: id, added_by: u.user?.id });
    if (error) return m.err(errText(error));
    setSearch(""); void qc.invalidateQueries({ queryKey: [isCompanies ? "crm-list-companies" : "crm-list-members", openList] }); refreshLists();
  };
  const removeMember = async (id: string) => {
    const { error } = isCompanies
      ? await supabase.from("crm_lead_list_companies").delete().eq("list_id", openList!).eq("legal_entity_id", id)
      : await supabase.from("crm_lead_list_members").delete().eq("list_id", openList!).eq("person_id", id);
    if (error) return m.err(errText(error));
    void qc.invalidateQueries({ queryKey: [isCompanies ? "crm-list-companies" : "crm-list-members", openList] }); refreshLists();
  };

  const all = lists.data ?? [];
  const count = (k: LeadKind | "sem") => all.filter((l) => (k === "sem" ? !isLeadKind(l.kind) : l.kind === k)).length;
  const shown = all.filter((l) => (filter === "" ? true : filter === "sem" ? !isLeadKind(l.kind) : l.kind === filter));

  return (
    <div>
      <PageHead eyebrow="CRM" title="Listas" hint="Grupos estáticos para campanhas e segmentação, sempre com um tipo: paciente, fisioterapeuta (equipe), fisioterapeuta (HP Academy) ou empresa. Não substitui o cadastro central."
        actions={<button type="button" className="hp-btn hp-btn-outline" data-testid="lista-importar" onClick={() => setImportOpen({})}>Importar CSV</button>} />
      <Msg m={msg} />
      <form onSubmit={create} className="hp-card p-4 mb-6 grid gap-3 sm:grid-cols-[2fr_2fr_auto] items-end" noValidate>
        <div><label htmlFor="lst-name" className="block text-xs mb-1">Nome da lista</label><input id="lst-name" value={name} onChange={(e) => setName(e.target.value)} placeholder="Ex.: Campanha check-up outubro" /></div>
        <div><label htmlFor="lst-kind" className="block text-xs mb-1">Tipo da lista *</label>
          <select id="lst-kind" value={kind} onChange={(e) => setKind(e.target.value as LeadKind | "")}><option value="">Escolha o tipo…</option>{LEAD_KINDS.map((k) => <option key={k} value={k}>{LEAD_TYPE[k].label} — {LEAD_TYPE[k].description}</option>)}</select></div>
        <button className="hp-btn hp-btn-primary w-fit">Criar lista</button>
      </form>

      <div role="group" aria-label="Filtrar por tipo" className="flex flex-wrap gap-2 mb-4" data-testid="lista-filtros">
        {([["", "Todas", all.length], ...LEAD_KINDS.map((k) => [k, LEAD_TYPE[k].short, count(k)] as const), ["sem", "Sem tipo", count("sem")]] as const).filter(([k, , n]) => k === "" || n > 0 || k !== "sem").map(([k, label, n]) => (
          <button key={k} type="button" aria-pressed={filter === k} onClick={() => setFilter(k as LeadKind | "sem" | "")} className={`rounded-full border px-3 py-1 text-[13px] ${filter === k ? "border-primary bg-primary text-primary-foreground" : "border-input bg-card hover:border-primary/50"}`}>{label} <span className="opacity-70 tabular">{n}</span></button>))}
      </div>

      <State loading={lists.isLoading} error={lists.error} empty={shown.length === 0 && !lists.isLoading} emptyText={all.length === 0 ? "Nenhuma lista criada ainda." : "Nenhuma lista deste tipo."} />
      {shown.length > 0 && (
        <Table head={["Nome", "Tipo", "Itens", "Criada em", ""]}>
          {shown.map((l) => (
            <tr key={l.id} data-testid="lista-linha" data-kind={l.kind ?? ""}>
              <Td>{l.name}</Td>
              <Td>{isLeadKind(l.kind) ? <LeadTypeBadge kind={l.kind} /> : (
                <select aria-label={`Definir o tipo de ${l.name}`} className="!h-8 !py-0 text-xs w-auto" value="" onChange={(e) => void setListKind(l.id, e.target.value)}><option value="">Sem tipo — definir…</option>{LEAD_KINDS.map((k) => <option key={k} value={k}>{LEAD_TYPE[k].label}</option>)}</select>)}</Td>
              <Td>{l.n} {l.kind === "companies" ? (l.n === 1 ? "empresa" : "empresas") : (l.n === 1 ? "pessoa" : "pessoas")}</Td>
              <Td>{new Date(l.created_at).toLocaleDateString("pt-BR")}</Td>
              <Td><div className="flex flex-wrap gap-1 items-center">
                <button className={btnGhost + " hp-btn-sm"} onClick={() => setOpenList(openList === l.id ? null : l.id)}>{openList === l.id ? "Fechar" : "Abrir"}</button>
                {l.kind !== "companies" && <button className={btnGhost + " hp-btn-sm"} onClick={() => setImportOpen({ listId: l.id })}>Importar CSV</button>}
                <button className="text-destructive text-xs" onClick={() => removeList(l.id)}>Excluir</button>
              </div></Td>
            </tr>
          ))}
        </Table>
      )}

      {current && (
        <div className="mt-6 border-t border-border pt-4">
          <h3 className="text-base font-medium mb-2 flex flex-wrap items-center gap-2">{isCompanies ? "Empresas" : "Pessoas"} em "{current.name}" <LeadTypeBadge kind={current.kind} /></h3>
          <div className="mb-3 flex flex-wrap items-start gap-2">
            <div className="relative max-w-sm flex-1 min-w-[14rem]">
              <label htmlFor="lst-search" className="sr-only">{isCompanies ? "Adicionar empresa" : "Adicionar pessoa"}</label>
              <input id="lst-search" placeholder={isCompanies ? "Buscar empresa para adicionar" : "Buscar pessoa para adicionar"} value={search} onChange={(e) => setSearch(e.target.value)} />
              {found.data && found.data.length > 0 && (
                <ul className="hp-card mt-1 overflow-hidden absolute z-10 w-full">
                  {found.data.map((p) => <li key={p.id}><button type="button" className="w-full text-left px-3 py-2 hover:bg-muted" onClick={() => addMember(p.id)}>{p.label}</button></li>)}
                </ul>
              )}
            </div>
            {isCompanies && <button type="button" className="hp-btn hp-btn-outline" onClick={() => setCompanyOpen(true)}>Nova empresa</button>}
          </div>
          {!isCompanies && <>
            <State loading={members.isLoading} error={members.error} empty={members.data?.length === 0} emptyText="Nenhuma pessoa nesta lista ainda." />
            {members.data && members.data.length > 0 && (
              <Table head={["Pessoa", "Adicionada em", ""]}>
                {members.data.map((mb) => <tr key={mb.person_id}><Td>{mb.person?.full_name}</Td><Td>{new Date(mb.added_at).toLocaleDateString("pt-BR")}</Td><Td><button className="text-destructive text-xs" onClick={() => removeMember(mb.person_id)}>Remover</button></Td></tr>)}
              </Table>)}
          </>}
          {isCompanies && <>
            <State loading={companies.isLoading} error={companies.error} empty={companies.data?.length === 0} emptyText="Nenhuma empresa nesta lista ainda." />
            {companies.data && companies.data.length > 0 && (
              <Table head={["Empresa", "Cidade", "Adicionada em", ""]}>
                {companies.data.map((c) => <tr key={c.legal_entity_id}><Td>{c.company?.trade_name || c.company?.legal_name || "—"}</Td><Td>{c.company?.city ? `${c.company.city}/${c.company.state_uf ?? ""}` : "—"}</Td><Td>{new Date(c.added_at).toLocaleDateString("pt-BR")}</Td><Td><button className="text-destructive text-xs" onClick={() => removeMember(c.legal_entity_id)}>Remover</button></Td></tr>)}
              </Table>)}
          </>}
        </div>
      )}

      <CrmImportDialog open={!!importOpen} presetListId={importOpen?.listId} onOpenChange={(v) => { if (!v) setImportOpen(null); }}
        onDone={() => { refreshLists(); void qc.invalidateQueries({ queryKey: ["crm-list-members"] }); void qc.invalidateQueries({ queryKey: ["opps"] }); void qc.invalidateQueries({ queryKey: ["people"] }); }} />
      <CompanyDialog open={companyOpen} onOpenChange={setCompanyOpen} onDone={(r) => { setCompanyOpen(false); void addMember(r.id); }} />
    </div>
  );
};

export default Lists;
