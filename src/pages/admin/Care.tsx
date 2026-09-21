import { useState, type FormEvent } from "react";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { supabase } from "@/lib/supabase";
import { useAuth } from "@/auth/AuthProvider";
import { fmtDateTime } from "@/lib/format";
import { btnDanger, btnGhost, errText, inputCls, Msg, PageHead, State, Table, Tabs, Td, useMsg } from "@/lib/ui";

const KIND: Record<string, string> = { guidance: "Orientação", exercise_video: "Vídeo de exercício", questionnaire: "Questionário", program: "Programa" };

/** Acompanhamento de pacientes. Fisioterapeutas só veem pacientes com vínculo assistencial ativo; gestor NÃO lê conteúdo clínico. */
const Care = () => {
  const { hasRole } = useAuth(); const [tab, setTab] = useState(hasRole("physio") ? "pacientes" : "vinculos");
  return (<div>
    <PageHead eyebrow="Assistencial" title="Acompanhamento de pacientes" hint="Conteúdos individualizados são definidos e liberados por profissionais autorizados — o sistema não gera prescrição automática. Vínculos podem ser revogados a qualquer momento." />
    <Tabs tabs={[...(hasRole("physio") ? [["pacientes", "Meus pacientes"], ["conteudos", "Biblioteca de conteúdos"]] as [string, string][] : []), ...(hasRole("manager", "ops_admin", "unit_manager") ? [["vinculos", "Vínculos assistenciais"]] as [string, string][] : [])]} value={tab} onChange={setTab} />
    {tab === "pacientes" && <Patients />}{tab === "conteudos" && <Contents />}{tab === "vinculos" && <Links />}
  </div>);
};

const Patients = () => {
  const qc = useQueryClient(); const [msg, m] = useMsg(); const [sel, setSel] = useState<string | null>(null); const [content, setContent] = useState(""); const [phase, setPhase] = useState("program"); const [note, setNote] = useState(""); const [reply, setReply] = useState("");
  const rels = useQuery({ queryKey: ["my-rels"], queryFn: async () => (await supabase.from("care_relationships").select("id, person_id, unit_id").is("revoked_at", null)).data ?? [] });
  const names = useQuery({ queryKey: ["care-names", rels.data?.map((r) => r.person_id).join()], enabled: !!rels.data?.length, queryFn: async () => Object.fromEntries(((await supabase.rpc("care_patient_names")).data ?? []).map((r: { person_id: string; name: string }) => [r.person_id, r.name])) as Record<string, string> });
  const contents = useQuery({ queryKey: ["care-contents"], queryFn: async () => (await supabase.from("care_contents").select("id, title, kind").is("archived_at", null)).data ?? [] });
  const detail = useQuery({ queryKey: ["care-detail", sel], enabled: !!sel, queryFn: async () => {
    const [a, act, msgs] = await Promise.all([supabase.from("care_assignments").select("id, phase, released_at, revoked_at, content:care_contents(title)").eq("person_id", sel!).order("released_at", { ascending: false }), supabase.from("care_activity").select("id, done_at, pain_scale, note, needs_attention").eq("person_id", sel!).order("done_at", { ascending: false }).limit(30), supabase.from("care_messages").select("id, sender, body, created_at").eq("person_id", sel!).order("created_at")]);
    return { a: (a.data ?? []) as unknown as { id: string; phase: string; released_at: string; revoked_at: string | null; content: { title: string } }[], act: act.data ?? [], msgs: msgs.data ?? [] };
  } });
  const refresh = () => void qc.invalidateQueries({ queryKey: ["care-detail", sel] });
  const assign = async (e: FormEvent) => { e.preventDefault(); if (!sel || !content) return m.err("Selecione o conteúdo."); const { error } = await supabase.rpc("care_assign", { p_person: sel, p_content: content, p_phase: phase, p_valid_until: null, p_note: note || null }); error ? m.err(errText(error)) : (m.ok("Conteúdo liberado ao paciente."), setNote(""), refresh()); };
  const revoke = async (id: string) => { const { error } = await supabase.rpc("care_revoke_assignment", { p_id: id }); error ? m.err(errText(error)) : refresh(); };
  const send = async (e: FormEvent) => { e.preventDefault(); if (!sel || !reply.trim()) return; const { error } = await supabase.rpc("care_reply", { p_person: sel, p_body: reply }); error ? m.err(errText(error)) : (setReply(""), refresh()); };
  return (<><Msg m={msg} /><State loading={rels.isLoading} error={rels.error} empty={rels.data?.length === 0} emptyText="Você ainda não tem pacientes vinculados. O vínculo é criado pelo gestor da unidade." />
    {rels.data && rels.data.length > 0 && <div className="grid gap-6 lg:grid-cols-[16rem_1fr]">
      <ul className="border border-border bg-card divide-y divide-border">{rels.data.map((r) => <li key={r.id}><button className={`w-full text-left p-3 ${sel === r.person_id ? "bg-muted" : ""}`} onClick={() => setSel(r.person_id)}>{names.data?.[r.person_id] ?? "Paciente"}</button></li>)}</ul>
      {sel && detail.data && <div className="space-y-8">
        <form onSubmit={assign} className="bg-card border border-border p-4 grid gap-3 sm:grid-cols-3 items-end"><div><label htmlFor="cc" className="block text-xs mb-1">Conteúdo</label><select id="cc" className={inputCls} value={content} onChange={(e) => setContent(e.target.value)}><option value="">…</option>{contents.data?.map((c) => <option key={c.id} value={c.id}>{c.title} ({KIND[c.kind]})</option>)}</select></div>
          <div><label htmlFor="cp" className="block text-xs mb-1">Momento</label><select id="cp" className={inputCls} value={phase} onChange={(e) => setPhase(e.target.value)}><option value="before">Antes do atendimento</option><option value="after">Depois do atendimento</option><option value="program">Programa</option></select></div>
          <div><label htmlFor="cn" className="block text-xs mb-1">Nota ao paciente</label><input id="cn" className={inputCls} value={note} onChange={(e) => setNote(e.target.value)} /></div><button className={btnGhost + " sm:w-fit"}>Liberar</button></form>
        <section><h3 className="text-lg mb-2">Conteúdos liberados</h3><ul className="space-y-1">{detail.data.a.map((a) => <li key={a.id} className="flex justify-between text-sm bg-card border border-border p-2"><span>{a.content.title} · {fmtDateTime(a.released_at)} {a.revoked_at && "· revogado"}</span>{!a.revoked_at && <button className="text-destructive" onClick={() => revoke(a.id)}>Revogar</button>}</li>)}</ul></section>
        <section><h3 className="text-lg mb-2">Registros do paciente</h3><ul className="space-y-1 text-sm">{detail.data.act.map((x) => <li key={x.id} className={`p-2 border ${x.needs_attention ? "border-destructive" : "border-border"} bg-card`}>{fmtDateTime(x.done_at)} · dor {x.pain_scale ?? "—"} {x.needs_attention && <strong className="text-destructive">· PRECISA DE ATENDIMENTO </strong>}{x.note}</li>)}</ul></section>
        <section><h3 className="text-lg mb-2">Canal de dúvidas</h3><ul className="space-y-2 mb-3">{detail.data.msgs.map((x) => <li key={x.id} className={`p-2 border border-border max-w-lg ${x.sender === "professional" ? "bg-muted ml-auto" : "bg-card"}`}><span className="text-xs text-navy-400">{x.sender === "professional" ? "Você" : "Paciente"} · {fmtDateTime(x.created_at)}</span><br />{x.body}</li>)}</ul>
          <form onSubmit={send} className="flex gap-2"><label className="sr-only" htmlFor="rp">Resposta</label><textarea id="rp" rows={2} className={inputCls} value={reply} onChange={(e) => setReply(e.target.value)} /><button className={btnGhost}>Responder</button></form></section>
      </div>}</div>}</>);
};

const Contents = () => {
  const qc = useQueryClient(); const [msg, m] = useMsg(); const [title, setTitle] = useState(""); const [kind, setKind] = useState("guidance"); const [body, setBody] = useState(""); const [file, setFile] = useState<File | null>(null); const [unit, setUnit] = useState("");
  const units = useQuery({ queryKey: ["units"], queryFn: async () => (await supabase.from("units").select("id, name, org_id").eq("active", true)).data ?? [] });
  const list = useQuery({ queryKey: ["care-contents-all"], queryFn: async () => (await supabase.from("care_contents").select("id, title, kind, storage_path, created_at").is("archived_at", null).order("created_at", { ascending: false })).data ?? [] });
  const add = async (e: FormEvent) => { e.preventDefault(); const u = units.data?.find((x) => x.id === unit); if (!u || !title.trim()) return m.err("Informe título e unidade."); const { data: me } = await supabase.auth.getUser();
    const { data, error } = await supabase.from("care_contents").insert({ org_id: u.org_id, unit_id: u.id, title: title.trim(), kind, body: body || null, created_by: me.user?.id }).select("id").single(); if (error) return m.err(errText(error));
    if (file) { const path = `${data.id}/${crypto.randomUUID()}-${file.name.replace(/[^\w.-]/g, "_")}`; const up = await supabase.storage.from("care-private").upload(path, file); if (up.error) return m.err("Conteúdo criado, mas o envio do arquivo falhou."); await supabase.from("care_contents").update({ storage_path: path }).eq("id", data.id); }
    m.ok("Conteúdo criado."); setTitle(""); setBody(""); setFile(null); void qc.invalidateQueries({ queryKey: ["care-contents-all"] }); };
  return (<><Msg m={msg} /><form onSubmit={add} className="bg-card border border-border p-4 mb-4 grid gap-3 sm:grid-cols-2" noValidate>
    <div><label htmlFor="ct" className="block text-xs mb-1">Título</label><input id="ct" className={inputCls} value={title} onChange={(e) => setTitle(e.target.value)} /></div>
    <div><label htmlFor="ck" className="block text-xs mb-1">Tipo</label><select id="ck" className={inputCls} value={kind} onChange={(e) => setKind(e.target.value)}>{Object.entries(KIND).map(([k, l]) => <option key={k} value={k}>{l}</option>)}</select></div>
    <div><label htmlFor="cu" className="block text-xs mb-1">Unidade</label><select id="cu" className={inputCls} value={unit} onChange={(e) => setUnit(e.target.value)}><option value="">…</option>{units.data?.map((u) => <option key={u.id} value={u.id}>{u.name}</option>)}</select></div>
    <div><label htmlFor="cf" className="block text-xs mb-1">Vídeo/arquivo (bucket privado)</label><input id="cf" type="file" className={inputCls} onChange={(e) => setFile(e.target.files?.[0] ?? null)} /></div>
    <div className="sm:col-span-2"><label htmlFor="cb" className="block text-xs mb-1">Texto da orientação</label><textarea id="cb" rows={4} className={inputCls} value={body} onChange={(e) => setBody(e.target.value)} /></div><button className={btnGhost + " w-fit"}>Criar conteúdo</button></form>
    <State loading={list.isLoading} error={list.error} empty={list.data?.length === 0} emptyText="Biblioteca vazia." />
    {list.data && list.data.length > 0 && <Table head={["Título", "Tipo", "Arquivo"]}>{list.data.map((c) => <tr key={c.id}><Td>{c.title}</Td><Td>{KIND[c.kind]}</Td><Td>{c.storage_path ? "Sim (privado)" : "—"}</Td></tr>)}</Table>}</>);
};

const Links = () => {
  const qc = useQueryClient(); const [msg, m] = useMsg(); const [search, setSearch] = useState(""); const [person, setPerson] = useState<{ id: string; full_name: string; unit_id: string | null } | null>(null); const [prof, setProf] = useState("");
  const found = useQuery({ queryKey: ["ppl-c", search], enabled: search.length >= 2 && !person, queryFn: async () => (await supabase.from("people").select("id, full_name, unit_id").ilike("full_name", `%${search.replace(/[%_]/g, "")}%`).limit(6)).data ?? [] });
  const users = useQuery({ queryKey: ["assignable-physio", person?.unit_id], enabled: !!person?.unit_id, queryFn: async () => ((await supabase.rpc("list_assignable_users", { p_unit: person!.unit_id })).data ?? []).filter((u: { roles: string[] }) => u.roles.includes("physio")) as { user_id: string; name: string }[] });
  const rels = useQuery({ queryKey: ["all-rels"], queryFn: async () => ((await supabase.rpc("list_care_links")).data ?? []) as { id: string; patient_name: string; professional_name: string; unit_name: string; created_at: string }[] });
  const link = async (e: FormEvent) => { e.preventDefault(); if (!person?.unit_id || !prof) return m.err("Selecione paciente (com unidade) e profissional."); const { error } = await supabase.rpc("care_link", { p_person: person.id, p_professional: prof, p_unit: person.unit_id }); error ? m.err(errText(error)) : (m.ok("Vínculo criado."), setPerson(null), setSearch(""), void qc.invalidateQueries({ queryKey: ["all-rels"] })); };
  const unlink = async (id: string) => { if (!window.confirm("Revogar vínculo? O profissional perde o acesso e os conteúdos liberados por ele ao paciente são revogados.")) return; const { error } = await supabase.rpc("care_unlink", { p_id: id }); error ? m.err(errText(error)) : (m.ok("Vínculo revogado."), void qc.invalidateQueries({ queryKey: ["all-rels"] })); };
  return (<><Msg m={msg} /><form onSubmit={link} className="bg-card border border-border p-4 mb-4 grid gap-3 sm:grid-cols-3 items-end">
    <div><label htmlFor="lp" className="block text-xs mb-1">Paciente</label><input id="lp" className={inputCls} value={person ? person.full_name : search} onChange={(e) => { setPerson(null); setSearch(e.target.value); }} />{found.data?.map((p) => <button type="button" key={p.id} className="block w-full text-left p-2 border border-border hover:bg-muted" onClick={() => setPerson(p)}>{p.full_name}</button>)}</div>
    <div><label htmlFor="lf" className="block text-xs mb-1">Fisioterapeuta</label><select id="lf" className={inputCls} value={prof} onChange={(e) => setProf(e.target.value)}><option value="">…</option>{users.data?.map((u) => <option key={u.user_id} value={u.user_id}>{u.name}</option>)}</select></div><button className={btnGhost + " sm:w-fit"}>Vincular</button></form>
    <p className="text-sm text-navy-400 mb-3">Este vínculo autoriza o profissional a acompanhar o paciente. Gestores não ganham acesso clínico por criar vínculos.</p>
    <State loading={rels.isLoading} error={rels.error} empty={rels.data?.length === 0} emptyText="Nenhum vínculo ativo." />
    {rels.data && rels.data.length > 0 && <Table head={["Paciente", "Fisioterapeuta", "Unidade", "Desde", ""]}>{rels.data.map((r) => <tr key={r.id}><Td>{r.patient_name}</Td><Td>{r.professional_name}</Td><Td>{r.unit_name}</Td><Td>{fmtDateTime(r.created_at)}</Td><Td><button className={btnDanger + " !py-1"} onClick={() => unlink(r.id)}>Revogar</button></Td></tr>)}</Table>}</>);
};

export default Care;
