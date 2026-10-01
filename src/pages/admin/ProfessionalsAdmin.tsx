import { useState, type FormEvent } from "react";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { supabase } from "@/lib/supabase";
import { useAuth } from "@/auth/AuthProvider";
import { Badge, btnDanger, btnGhost, btnPrimary, confirmDialog, errText, Msg, State, Table, Td, useMsg } from "@/lib/ui";
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from "@/components/ui/dialog";

interface Unit { id: string; name: string }
interface Prof { id: string; display_name: string; council_registration: string | null; active: boolean; user_id: string | null; person_id: string | null; professional_units: { unit_id: string }[] }
interface Rule { id: string; professional_id: string; unit_id: string; weekday: number; start_time: string; end_time: string; valid_from: string | null; valid_until: string | null }
const DOW = ["Domingo", "Segunda", "Terça", "Quarta", "Quinta", "Sexta", "Sábado"];
const fmtD = (d: string) => new Date(d + "T12:00:00Z").toLocaleDateString("pt-BR");

/** Envia o e-mail de convite pelo mesmo caminho da tela Equipe (/api/send-email). Dependência externa (Resend): se falhar, o convite continua registrado. */
const sendInviteEmail = async (to: string): Promise<boolean> => {
  const { data: { session } } = await supabase.auth.getSession(); if (!session) return false;
  try {
    const link = `${window.location.origin}/primeiro-acesso`;
    const res = await fetch("/api/send-email", { method: "POST", headers: { "content-type": "application/json", authorization: `Bearer ${session.access_token}` }, body: JSON.stringify({ template: "invite", to, data: link.startsWith("https://") ? { link } : {} }) });
    return res.ok;
  } catch { return false; }
};

/** Profissionais e disponibilidade: cadastro reaproveita a PESSOA do cadastro central (ou cria uma), com registro no conselho, unidades, disponibilidade semanal e liberação de acesso.
 *  Escrita só para gestor/administrador operacional (o servidor confere); os demais papéis só consultam. */
const ProfessionalsAdmin = () => {
  const qc = useQueryClient(); const [msg, m] = useMsg(); const { hasRole } = useAuth(); const canEdit = hasRole("manager", "ops_admin");
  const units = useQuery({ queryKey: ["pa-units"], queryFn: async () => ((await supabase.from("units").select("id, name").eq("active", true).order("name")).data ?? []) as Unit[] });
  const profs = useQuery({ queryKey: ["pa-profs"], queryFn: async () => ((await supabase.from("professionals").select("id, display_name, council_registration, active, user_id, person_id, professional_units(unit_id)").order("display_name")).data ?? []) as unknown as Prof[] });
  const rules = useQuery({ queryKey: ["pa-rules"], queryFn: async () => ((await supabase.from("availability_rules").select("id, professional_id, unit_id, weekday, start_time, end_time, valid_from, valid_until").order("weekday").order("start_time")).data ?? []) as Rule[] });
  const refresh = () => { void qc.invalidateQueries({ queryKey: ["pa-profs"] }); void qc.invalidateQueries({ queryKey: ["pa-rules"] }); void qc.invalidateQueries({ queryKey: ["all-profs"] }); void qc.invalidateQueries({ queryKey: ["profs"] }); void qc.invalidateQueries({ queryKey: ["rules"] }); };
  const unitName = (id: string) => units.data?.find((u) => u.id === id)?.name ?? "—";
  const profName = (id: string) => profs.data?.find((p) => p.id === id)?.display_name ?? "—";

  // ---- novo profissional
  const [mode, setMode] = useState<"pessoa" | "nova">("pessoa"); const [search, setSearch] = useState(""); const [person, setPerson] = useState<{ id: string; full_name: string } | null>(null);
  const [newName, setNewName] = useState(""); const [reg, setReg] = useState(""); const [selUnits, setSelUnits] = useState<string[]>([]);
  const found = useQuery({ queryKey: ["pa-people", search], enabled: mode === "pessoa" && search.trim().length >= 2 && !person, queryFn: async () => ((await supabase.from("people").select("id, full_name").ilike("full_name", `%${search.trim().replace(/[%_]/g, "")}%`).is("merged_into_id", null).limit(6)).data ?? []) as { id: string; full_name: string }[] });
  const toggleUnit = (id: string) => setSelUnits((cur) => (cur.includes(id) ? cur.filter((x) => x !== id) : [...cur, id]));
  const create = async (e: FormEvent) => {
    e.preventDefault();
    if (mode === "pessoa" && !person) return m.err("Escolha uma pessoa já cadastrada (ou use “Nova pessoa”).");
    if (mode === "nova" && newName.trim().length < 2) return m.err("Informe o nome da pessoa.");
    if (selUnits.length === 0) return m.err("Marque ao menos uma unidade de atendimento.");
    const { error } = await supabase.rpc("professional_save", { p_id: null, p_person: mode === "pessoa" ? person!.id : null, p_name: mode === "nova" ? newName : null, p_registration: reg || null, p_units: selUnits, p_active: true });
    if (error) return m.err(errText(error));
    m.ok("Profissional cadastrado. Cadastre a disponibilidade e libere o acesso."); setPerson(null); setSearch(""); setNewName(""); setReg(""); setSelUnits([]); refresh();
  };

  // ---- editar
  const [edit, setEdit] = useState<Prof | null>(null); const [eReg, setEReg] = useState(""); const [eUnits, setEUnits] = useState<string[]>([]); const [eActive, setEActive] = useState(true);
  const openEdit = (p: Prof) => { setEdit(p); setEReg(p.council_registration ?? ""); setEUnits(p.professional_units.map((x) => x.unit_id)); setEActive(p.active); };
  const saveEdit = async (e: FormEvent) => {
    e.preventDefault(); if (!edit) return;
    if (eUnits.length === 0) return m.err("Mantenha ao menos uma unidade.");
    const { error } = await supabase.rpc("professional_save", { p_id: edit.id, p_person: edit.person_id, p_name: null, p_registration: eReg || null, p_units: eUnits, p_active: eActive });
    if (error) return m.err(errText(error));
    m.ok("Profissional atualizado."); setEdit(null); refresh();
  };

  // ---- liberar acesso
  const [grant, setGrant] = useState<Prof | null>(null); const [gEmail, setGEmail] = useState("");
  const openGrant = async (p: Prof) => {
    setGrant(p); setGEmail("");
    if (p.person_id) { const { data } = await supabase.from("person_contacts").select("value").eq("person_id", p.person_id).eq("type", "email").order("is_primary", { ascending: false }).limit(1); if (data?.[0]?.value) setGEmail(data[0].value as string); }
  };
  const doGrant = async (e: FormEvent) => {
    e.preventDefault(); if (!grant) return;
    const { data, error } = await supabase.rpc("professional_grant_access", { p_professional: grant.id, p_email: gEmail });
    if (error) return m.err(errText(error));
    const r = data as { status: "invited" | "linked" }; const to = gEmail.trim();
    if (r.status === "linked") m.ok(`${grant.display_name} já tinha conta: o acesso de fisioterapeuta foi liberado e ligado ao cadastro na hora.`);
    else { const sent = await sendInviteEmail(to); m.ok(sent ? `Convite registrado e e-mail enviado para ${to}.` : `Convite registrado, mas o envio automático do e-mail não está disponível agora. Peça à pessoa para abrir “Primeiro acesso” com ${to}, criar a senha e confirmar o e-mail.`); }
    setGrant(null); refresh();
  };

  // ---- disponibilidade
  const [rp, setRp] = useState(""); const [editRule, setEditRule] = useState<Rule | null>(null);
  const [dUnit, setDUnit] = useState(""); const [dow, setDow] = useState("1"); const [st, setSt] = useState("08:00"); const [en, setEn] = useState("18:00"); const [vf, setVf] = useState(""); const [vu, setVu] = useState("");
  const selProf = profs.data?.find((p) => p.id === rp);
  const profRules = (rules.data ?? []).filter((r) => r.professional_id === rp);
  const startRule = (r: Rule | null) => { setEditRule(r); if (r) { setDUnit(r.unit_id); setDow(String(r.weekday)); setSt(r.start_time.slice(0, 5)); setEn(r.end_time.slice(0, 5)); setVf(r.valid_from ?? ""); setVu(r.valid_until ?? ""); } else { setDow("1"); setSt("08:00"); setEn("18:00"); setVf(""); setVu(""); } };
  const saveRule = async (e: FormEvent) => {
    e.preventDefault(); const unit = dUnit || selProf?.professional_units[0]?.unit_id; if (!rp || !unit) return m.err("Escolha o profissional e a unidade.");
    const { error } = await supabase.rpc("professional_availability_save", { p_id: editRule?.id ?? null, p_professional: rp, p_unit: unit, p_weekday: Number(dow), p_start: st, p_end: en, p_valid_from: vf || null, p_valid_until: vu || null });
    if (error) return m.err(errText(error));
    m.ok(editRule ? "Disponibilidade atualizada." : "Disponibilidade cadastrada."); startRule(null); refresh();
  };
  const removeRule = async (r: Rule) => {
    if (!(await confirmDialog("Remover esta disponibilidade?", `${DOW[r.weekday]} ${r.start_time.slice(0, 5)}–${r.end_time.slice(0, 5)} em ${unitName(r.unit_id)}. Atendimentos já agendados não são afetados; só novos horários deixam de ser oferecidos.`, "Remover", true))) return;
    const { error } = await supabase.rpc("professional_availability_remove", { p_id: r.id }); if (error) return m.err(errText(error)); m.ok("Disponibilidade removida."); refresh();
  };

  return (<>
    <Msg m={msg} />
    {canEdit && (
      <form onSubmit={create} className="hp-card p-5 mb-6 grid gap-3" noValidate aria-label="Novo profissional">
        <h2 className="text-xl">Novo profissional</h2>
        <div role="group" aria-label="Origem do cadastro" className="inline-flex rounded-full border border-input overflow-hidden w-fit">
          {([["pessoa", "Pessoa já cadastrada"], ["nova", "Nova pessoa"]] as const).map(([k, l]) => <button key={k} type="button" aria-pressed={mode === k} onClick={() => { setMode(k); setPerson(null); }} className={`hp-btn hp-btn-sm rounded-none border-0 ${mode === k ? "hp-btn-primary" : "hp-btn-outline"}`}>{l}</button>)}
        </div>
        <div className="grid gap-3 sm:grid-cols-2">
          {mode === "pessoa"
            ? <div><label htmlFor="pa-search" className="block text-xs mb-1">Buscar no cadastro central (Pessoas)</label>
                <input id="pa-search" value={person ? person.full_name : search} onChange={(e) => { setPerson(null); setSearch(e.target.value); }} autoComplete="off" />
                {found.data?.map((p) => <button type="button" key={p.id} className="block w-full text-left p-2 border border-border bg-card hover:bg-muted" onClick={() => setPerson(p)}>{p.full_name}</button>)}
                {search.trim().length >= 2 && !person && found.data?.length === 0 && <p className="text-xs text-muted-foreground mt-1">Ninguém encontrado: use “Nova pessoa”.</p>}</div>
            : <div><label htmlFor="pa-name" className="block text-xs mb-1">Nome completo</label><input id="pa-name" value={newName} onChange={(e) => setNewName(e.target.value)} /><p className="text-[11px] text-muted-foreground mt-1">A pessoa é criada no cadastro central (Pessoas) e ligada ao profissional.</p></div>}
          <div><label htmlFor="pa-reg" className="block text-xs mb-1">Registro no conselho (ex.: CREFITO-3 123456-F)</label><input id="pa-reg" value={reg} onChange={(e) => setReg(e.target.value)} maxLength={40} /></div>
        </div>
        <fieldset><legend className="text-xs mb-1">Unidades de atendimento *</legend><div className="flex flex-wrap gap-3">{units.data?.map((u) => <label key={u.id} className="flex items-center gap-2 text-sm !font-normal"><input type="checkbox" checked={selUnits.includes(u.id)} onChange={() => toggleUnit(u.id)} />{u.name}</label>)}</div></fieldset>
        <button className={btnPrimary + " w-fit"}>Cadastrar profissional</button>
      </form>)}

    <h2 className="text-xl mb-2">Profissionais</h2>
    <State loading={profs.isLoading} error={profs.error} empty={profs.data?.length === 0} emptyText="Nenhum profissional cadastrado." />
    {profs.data && profs.data.length > 0 && (
      <Table head={["Profissional", "Registro", "Unidades", "Acesso", "Situação", ""]}>
        {profs.data.map((p) => (
          <tr key={p.id}>
            <Td><strong>{p.display_name}</strong>{!p.person_id && <span className="block text-xs text-muted-foreground">sem pessoa no cadastro central</span>}</Td>
            <Td>{p.council_registration ?? <span className="text-muted-foreground">não informado</span>}</Td>
            <Td>{p.professional_units.map((x) => unitName(x.unit_id)).join(", ") || "—"}</Td>
            <Td>{p.user_id ? <Badge tone="success">Conta ligada</Badge> : <Badge tone="warning">Sem acesso</Badge>}</Td>
            <Td>{p.active ? "Ativo" : "Inativo"}</Td>
            <Td>{canEdit && <span className="flex flex-wrap gap-1"><button className={btnGhost + " hp-btn-sm"} onClick={() => openEdit(p)}>Editar</button>{p.active && <button className={btnGhost + " hp-btn-sm"} onClick={() => void openGrant(p)}>{p.user_id ? "Reenviar acesso" : "Liberar acesso"}</button>}<button className={btnGhost + " hp-btn-sm"} onClick={() => { setRp(p.id); startRule(null); }}>Disponibilidade</button></span>}</Td>
          </tr>))}
      </Table>)}

    <section className="mt-8" aria-label="Disponibilidade semanal">
      <h2 className="text-xl mb-2">Disponibilidade semanal</h2>
      <div className="grid gap-3 sm:grid-cols-3 mb-3"><div><label htmlFor="rp" className="block text-xs mb-1">Profissional</label><select id="rp" value={rp} onChange={(e) => { setRp(e.target.value); startRule(null); }}><option value="">Selecione…</option>{profs.data?.filter((p) => p.active).map((p) => <option key={p.id} value={p.id}>{p.display_name}</option>)}</select></div></div>
      {rp && canEdit && (
        <form onSubmit={saveRule} className="hp-card p-4 mb-4 grid gap-3 sm:grid-cols-6 items-end" noValidate aria-label={editRule ? "Editar disponibilidade" : "Nova disponibilidade"}>
          <div><label htmlFor="rd-unit" className="block text-xs mb-1">Unidade</label><select id="rd-unit" value={dUnit || selProf?.professional_units[0]?.unit_id || ""} onChange={(e) => setDUnit(e.target.value)}>{selProf?.professional_units.map((x) => <option key={x.unit_id} value={x.unit_id}>{unitName(x.unit_id)}</option>)}</select></div>
          <div><label htmlFor="rd" className="block text-xs mb-1">Dia</label><select id="rd" value={dow} onChange={(e) => setDow(e.target.value)}>{DOW.map((d, i) => <option key={d} value={i}>{d}</option>)}</select></div>
          <div><label htmlFor="rs" className="block text-xs mb-1">Início</label><input id="rs" type="time" value={st} onChange={(e) => setSt(e.target.value)} /></div>
          <div><label htmlFor="re" className="block text-xs mb-1">Fim</label><input id="re" type="time" value={en} onChange={(e) => setEn(e.target.value)} /></div>
          <div><label htmlFor="rvf" className="block text-xs mb-1">Vale a partir de</label><input id="rvf" type="date" value={vf} onChange={(e) => setVf(e.target.value)} /></div>
          <div><label htmlFor="rvu" className="block text-xs mb-1">Vale até</label><input id="rvu" type="date" value={vu} onChange={(e) => setVu(e.target.value)} /></div>
          <div className="sm:col-span-6 flex gap-2"><button className={btnPrimary}>{editRule ? "Salvar alteração" : "Adicionar"}</button>{editRule && <button type="button" className={btnGhost} onClick={() => startRule(null)}>Cancelar edição</button>}</div>
        </form>)}
      {!rp && <p className="text-sm text-muted-foreground">Escolha um profissional para ver e cadastrar a disponibilidade.</p>}
      {rp && <State loading={rules.isLoading} error={rules.error} empty={profRules.length === 0} emptyText={`${profName(rp)} ainda não tem disponibilidade cadastrada: sem ela não há horários livres para agendar.`} />}
      {rp && profRules.length > 0 && (
        <Table head={["Dia", "Horário", "Unidade", "Validade", ""]}>
          {profRules.map((r) => <tr key={r.id}><Td>{DOW[r.weekday]}</Td><Td>{r.start_time.slice(0, 5)}–{r.end_time.slice(0, 5)}</Td><Td>{unitName(r.unit_id)}</Td>
            <Td>{r.valid_from || r.valid_until ? `${r.valid_from ? "de " + fmtD(r.valid_from) : ""} ${r.valid_until ? "até " + fmtD(r.valid_until) : ""}`.trim() : "sem prazo"}</Td>
            <Td>{canEdit && <span className="flex gap-1"><button className={btnGhost + " hp-btn-sm"} onClick={() => startRule(r)}>Editar</button><button className={btnDanger + " hp-btn-sm"} onClick={() => void removeRule(r)}>Remover</button></span>}</Td></tr>)}
        </Table>)}
      {!canEdit && <p className="text-xs text-muted-foreground mt-3">Somente gestor e administrador operacional alteram profissionais e disponibilidade.</p>}
    </section>

    <Dialog open={!!edit} onOpenChange={(o) => !o && setEdit(null)}>
      <DialogContent className="max-w-lg"><DialogHeader><DialogTitle>Editar {edit?.display_name}</DialogTitle><DialogDescription>Registro no conselho, unidades e situação. Para retirar uma unidade não pode haver atendimento futuro nela.</DialogDescription></DialogHeader>
        <form onSubmit={saveEdit} className="grid gap-3" noValidate>
          <div><label htmlFor="pe-reg" className="block text-xs mb-1">Registro no conselho</label><input id="pe-reg" value={eReg} onChange={(e) => setEReg(e.target.value)} maxLength={40} /></div>
          <fieldset><legend className="text-xs mb-1">Unidades de atendimento</legend><div className="flex flex-wrap gap-3">{units.data?.map((u) => <label key={u.id} className="flex items-center gap-2 text-sm !font-normal"><input type="checkbox" checked={eUnits.includes(u.id)} onChange={() => setEUnits((c) => (c.includes(u.id) ? c.filter((x) => x !== u.id) : [...c, u.id]))} />{u.name}</label>)}</div></fieldset>
          <label className="flex items-center gap-2 text-sm !font-normal"><input type="checkbox" checked={eActive} onChange={(e) => setEActive(e.target.checked)} />Profissional ativo (aparece na agenda)</label>
          <DialogFooter><button type="button" className={btnGhost} onClick={() => setEdit(null)}>Cancelar</button><button className={btnPrimary}>Salvar</button></DialogFooter>
        </form></DialogContent>
    </Dialog>

    <Dialog open={!!grant} onOpenChange={(o) => !o && setGrant(null)}>
      <DialogContent className="max-w-md"><DialogHeader><DialogTitle>Liberar acesso — {grant?.display_name}</DialogTitle><DialogDescription>Se a pessoa já tem conta, o acesso de fisioterapeuta é ligado na hora. Se não, um convite é registrado e ela cria a senha em “Primeiro acesso” com este e-mail (o papel só vale depois de confirmar o e-mail).</DialogDescription></DialogHeader>
        <form onSubmit={doGrant} className="grid gap-3" noValidate>
          <div><label htmlFor="pg-email" className="block text-xs mb-1">E-mail da pessoa</label><input id="pg-email" type="email" value={gEmail} onChange={(e) => setGEmail(e.target.value)} /></div>
          <DialogFooter><button type="button" className={btnGhost} onClick={() => setGrant(null)}>Cancelar</button><button className={btnPrimary}>Liberar acesso</button></DialogFooter>
        </form></DialogContent>
    </Dialog>
  </>);
};
export default ProfessionalsAdmin;
