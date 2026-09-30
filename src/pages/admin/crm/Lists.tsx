import { useState, type FormEvent } from "react";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { supabase } from "@/lib/supabase";
import { PageHead, State, Table, Td, errText, Msg, useMsg, btnGhost } from "@/lib/ui";

interface ListRow { id: string; name: string; created_at: string; n: number }

/** Listas: um grupo estático e curado de pessoas (não um filtro salvo/dinâmico) — útil para separar quem vai
 *  entrar numa campanha específica sem duplicar o cadastro (referencia public.people, nunca copia dados). */
const Lists = () => {
  const qc = useQueryClient(); const [msg, m] = useMsg();
  const [name, setName] = useState(""); const [openList, setOpenList] = useState<string | null>(null);
  const [search, setSearch] = useState("");

  const lists = useQuery({ queryKey: ["crm-lists"], queryFn: async () => {
    const { data, error } = await supabase.from("crm_lead_lists").select("id, name, created_at, crm_lead_list_members(count)").order("created_at", { ascending: false });
    if (error) throw error;
    return (data as unknown as { id: string; name: string; created_at: string; crm_lead_list_members: { count: number }[] }[]).map((l) => ({ id: l.id, name: l.name, created_at: l.created_at, n: l.crm_lead_list_members[0]?.count ?? 0 })) as ListRow[];
  } });
  const members = useQuery({ queryKey: ["crm-list-members", openList], enabled: !!openList, queryFn: async () => {
    const { data, error } = await supabase.from("crm_lead_list_members").select("person_id, added_at, person:people(full_name)").eq("list_id", openList!).order("added_at", { ascending: false });
    if (error) throw error; return data as unknown as { person_id: string; added_at: string; person: { full_name: string } | null }[];
  } });
  const found = useQuery({ queryKey: ["crm-list-search", search], enabled: search.length >= 2, queryFn: async () => (await supabase.from("people").select("id, full_name").ilike("full_name", `%${search.replace(/[%_]/g, "")}%`).is("merged_into_id", null).limit(8)).data ?? [] });

  const create = async (e: FormEvent) => {
    e.preventDefault(); if (!name.trim()) return m.err("Informe o nome da lista.");
    const { data: org } = await supabase.from("organizations").select("id").single();
    const { data: u } = await supabase.auth.getUser();
    const { error } = await supabase.from("crm_lead_lists").insert({ org_id: org?.id, name: name.trim(), created_by: u.user?.id });
    if (error) return m.err(errText(error));
    m.ok("Lista criada."); setName(""); void qc.invalidateQueries({ queryKey: ["crm-lists"] });
  };
  const removeList = async (id: string) => {
    const { error } = await supabase.from("crm_lead_lists").delete().eq("id", id);
    if (error) return m.err(errText(error));
    m.ok("Lista removida (as pessoas continuam cadastradas)."); if (openList === id) setOpenList(null);
    void qc.invalidateQueries({ queryKey: ["crm-lists"] });
  };
  const addMember = async (personId: string) => {
    const { data: u } = await supabase.auth.getUser();
    const { error } = await supabase.from("crm_lead_list_members").insert({ list_id: openList, person_id: personId, added_by: u.user?.id });
    if (error) return m.err(errText(error));
    setSearch(""); void qc.invalidateQueries({ queryKey: ["crm-list-members", openList] }); void qc.invalidateQueries({ queryKey: ["crm-lists"] });
  };
  const removeMember = async (personId: string) => {
    const { error } = await supabase.from("crm_lead_list_members").delete().eq("list_id", openList!).eq("person_id", personId);
    if (error) return m.err(errText(error));
    void qc.invalidateQueries({ queryKey: ["crm-list-members", openList] }); void qc.invalidateQueries({ queryKey: ["crm-lists"] });
  };

  return (
    <div>
      <PageHead eyebrow="CRM" title="Listas" hint="Grupos estáticos de pessoas para campanhas e segmentação — não substitui o cadastro central de Pessoas." />
      <Msg m={msg} />
      <form onSubmit={create} className="hp-card p-4 mb-6 grid gap-3 sm:grid-cols-4 items-end" noValidate>
        <div className="sm:col-span-3"><label htmlFor="lst-name" className="block text-xs mb-1">Nome da lista</label><input id="lst-name" value={name} onChange={(e) => setName(e.target.value)} placeholder="Ex.: Campanha check-up outubro" /></div>
        <button className="hp-btn hp-btn-primary w-fit">Criar lista</button>
      </form>
      <State loading={lists.isLoading} error={lists.error} empty={lists.data?.length === 0} emptyText="Nenhuma lista criada ainda." />
      {lists.data && lists.data.length > 0 && (
        <Table head={["Nome", "Pessoas", "Criada em", ""]}>
          {lists.data.map((l) => (
            <tr key={l.id}>
              <Td>{l.name}</Td><Td>{l.n}</Td><Td>{new Date(l.created_at).toLocaleDateString("pt-BR")}</Td>
              <Td><div className="flex gap-1">
                <button className={btnGhost + " hp-btn-sm"} onClick={() => setOpenList(openList === l.id ? null : l.id)}>{openList === l.id ? "Fechar" : "Abrir"}</button>
                <button className="text-destructive text-xs" onClick={() => removeList(l.id)}>Excluir</button>
              </div></Td>
            </tr>
          ))}
        </Table>
      )}

      {openList && (
        <div className="mt-6 border-t border-border pt-4">
          <h3 className="text-base font-medium mb-2">Pessoas em "{lists.data?.find((l) => l.id === openList)?.name}"</h3>
          <div className="mb-3 relative max-w-sm">
            <label htmlFor="lst-search" className="sr-only">Adicionar pessoa</label>
            <input id="lst-search" placeholder="Buscar pessoa para adicionar" value={search} onChange={(e) => setSearch(e.target.value)} />
            {found.data && found.data.length > 0 && (
              <ul className="hp-card mt-1 overflow-hidden absolute z-10 w-full">
                {found.data.map((p) => <li key={p.id}><button type="button" className="w-full text-left px-3 py-2 hover:bg-muted" onClick={() => addMember(p.id)}>{p.full_name}</button></li>)}
              </ul>
            )}
          </div>
          <State loading={members.isLoading} error={members.error} empty={members.data?.length === 0} emptyText="Nenhuma pessoa nesta lista ainda." />
          {members.data && members.data.length > 0 && (
            <Table head={["Pessoa", "Adicionada em", ""]}>
              {members.data.map((mb) => <tr key={mb.person_id}><Td>{mb.person?.full_name}</Td><Td>{new Date(mb.added_at).toLocaleDateString("pt-BR")}</Td><Td><button className="text-destructive text-xs" onClick={() => removeMember(mb.person_id)}>Remover</button></Td></tr>)}
            </Table>
          )}
        </div>
      )}
    </div>
  );
};

export default Lists;
