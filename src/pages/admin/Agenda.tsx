import { useState, type FormEvent } from "react";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { supabase } from "@/lib/supabase";
import { fmtDateTime } from "@/lib/format";
import { btnDanger, btnGhost, errText, inputCls, Msg, PageHead, State, Table, Tabs, Td, useMsg } from "@/lib/ui";

interface Unit { id: string; name: string; timezone: string }
interface Prof { id: string; display_name: string }
interface Svc { id: string; name: string; duration_min: number }
interface Appt { id: string; period: string; status: string; person_id: string; opportunity_id: string | null; client_package_id: string | null; person: { full_name: string } | null; service: { name: string } | null; professional: { display_name: string } | null }
const ST: Record<string, string> = { scheduled: "Agendado", confirmed: "Confirmado", attended: "Compareceu", no_show: "Faltou", cancelled_by_patient: "Cancelado (paciente)", cancelled_by_clinic: "Cancelado (clínica)", rescheduled: "Remarcado" };
const DOW = ["Domingo", "Segunda", "Terça", "Quarta", "Quinta", "Sexta", "Sábado"];
const parsePeriod = (p: string): [string, string] => { const [a, b] = p.replace(/[[\]()"]/g, "").split(","); return [a.trim(), b.trim()]; };

const Agenda = () => {
  const [tab, setTab] = useState("dia");
  return (<div>
    <PageHead eyebrow="Operação" title="Agenda" hint="Horários seguem o fuso de cada unidade. O banco impede sobreposição de profissional e de paciente, mesmo com requisições simultâneas." />
    <Tabs tabs={[["dia", "Agenda do dia"], ["pacotes", "Pacotes e sessões"], ["espera", "Lista de espera"], ["prof", "Profissionais e disponibilidade"]]} value={tab} onChange={setTab} />
    {tab === "dia" && <Day />}{tab === "pacotes" && <Packages />}{tab === "espera" && <Waitlist />}{tab === "prof" && <Professionals />}
  </div>);
};

const useBase = () => {
  const units = useQuery({ queryKey: ["units-tz"], queryFn: async () => (await supabase.from("units").select("id, name, timezone").eq("active", true)).data as Unit[] });
  const services = useQuery({ queryKey: ["services"], queryFn: async () => (await supabase.from("services").select("id, name, duration_min").eq("active", true)).data as Svc[] });
  return { units, services };
};

const Day = () => {
  const qc = useQueryClient(); const [msg, m] = useMsg(); const { units, services } = useBase();
  const [unitId, setUnitId] = useState(""); const [date, setDate] = useState(new Date().toISOString().slice(0, 10)); const [profId, setProfId] = useState(""); const [svcId, setSvcId] = useState("");
  const [search, setSearch] = useState(""); const [person, setPerson] = useState<{ id: string; full_name: string } | null>(null); const [slot, setSlot] = useState(""); const [pkg, setPkg] = useState(""); const [busy, setBusy] = useState(false);
  const unit = units.data?.find((u) => u.id === (unitId || units.data?.[0]?.id));
  const uid = unit?.id ?? "";
  const profs = useQuery({ queryKey: ["profs", uid], enabled: !!uid, queryFn: async () => (await supabase.from("professional_units").select("professional:professionals(id, display_name, active)").eq("unit_id", uid)).data?.map((r) => (r as unknown as { professional: Prof & { active: boolean } }).professional).filter((p) => p?.active) ?? [] });
  const found = useQuery({ queryKey: ["ppl-a", search], enabled: search.length >= 2 && !person, queryFn: async () => (await supabase.from("people").select("id, full_name").ilike("full_name", `%${search.replace(/[%_]/g, "")}%`).is("merged_into_id", null).limit(6)).data ?? [] });
  const pkgs = useQuery({ queryKey: ["pkgs-p", person?.id], enabled: !!person, queryFn: async () => (await supabase.from("client_packages").select("id, total_sessions, status, product:products(name)").eq("person_id", person!.id).eq("status", "active")).data as unknown as { id: string; total_sessions: number; product: { name: string } }[] });
  const opps = useQuery({ queryKey: ["opps-p", person?.id], enabled: !!person, queryFn: async () => (await supabase.from("opportunities").select("id, title").eq("person_id", person!.id).eq("status", "open")).data ?? [] });
  const [oppId, setOppId] = useState("");
  const dayStart = new Date(`${date}T00:00:00`); const dayEnd = new Date(dayStart.getTime() + 864e5 * 1);
  const day = useQuery({ queryKey: ["appts", uid, date], enabled: !!uid, queryFn: async () => (await supabase.from("appointments").select("id, period, status, person_id, opportunity_id, client_package_id, person:people(full_name), service:services(name), professional:professionals(display_name)").eq("unit_id", uid).overlaps("period", `[${new Date(dayStart.getTime() - 864e5).toISOString()},${new Date(dayEnd.getTime() + 864e5).toISOString()})`).limit(500)).data as unknown as Appt[] });
  const inDay = (day.data ?? []).filter((a) => { const [s] = parsePeriod(a.period); const t = new Date(s).getTime(); return t >= dayStart.getTime() - 864e5 && t < dayEnd.getTime() + 864e5 && new Date(s).toLocaleDateString("sv-SE", { timeZone: unit?.timezone }) === date; }).sort((a, b) => parsePeriod(a.period)[0].localeCompare(parsePeriod(b.period)[0]));
  const slots = useQuery({ queryKey: ["slots", profId, uid, svcId, date], enabled: !!profId && !!uid && !!svcId, queryFn: async () => { const { data, error } = await supabase.rpc("available_slots", { p_professional: profId, p_unit: uid, p_service: svcId, p_date: date }); if (error) throw error; return (data as { slot_start: string }[]).map((r) => r.slot_start); } });

  const book = async (e: FormEvent) => {
    e.preventDefault(); if (!person || !slot || !profId || !svcId) return m.err("Selecione paciente, profissional, serviço e horário."); setBusy(true);
    const { error } = await supabase.rpc("book_appointment", { p_person: person.id, p_unit: uid, p_professional: profId, p_service: svcId, p_start: slot, p_package: pkg || null, p_opportunity: oppId || null });
    setBusy(false); if (error) return m.err(errText(error)); m.ok("Agendamento criado."); setSlot(""); void qc.invalidateQueries({ queryKey: ["appts"] }); void qc.invalidateQueries({ queryKey: ["slots"] });
  };
  const setStatus = async (a: Appt, s: string) => {
    const reason = s.startsWith("cancelled") ? window.prompt("Motivo do cancelamento:") ?? "" : null; if (s.startsWith("cancelled") && !reason) return;
    const { error } = await supabase.rpc("set_appointment_status", { p_id: a.id, p_status: s, p_reason: reason }); error ? m.err(errText(error)) : (m.ok("Status atualizado."), void qc.invalidateQueries({ queryKey: ["appts"] }));
  };
  const resched = async (a: Appt) => {
    const v = window.prompt("Novo horário (AAAA-MM-DD HH:MM, no fuso da unidade):"); if (!v) return; const d = new Date(v.replace(" ", "T") + ":00");
    const { error } = await supabase.rpc("reschedule_appointment", { p_id: a.id, p_new_start: d.toISOString() }); error ? m.err(errText(error)) : (m.ok("Remarcado."), void qc.invalidateQueries({ queryKey: ["appts"] }));
  };

  return (<>
    <Msg m={msg} />
    <div className="flex flex-wrap gap-3 mb-6 items-end">
      <div><label htmlFor="au" className="block text-xs mb-1">Unidade</label><select id="au" className={inputCls} value={uid} onChange={(e) => { setUnitId(e.target.value); setProfId(""); }}>{units.data?.map((u) => <option key={u.id} value={u.id}>{u.name}</option>)}</select></div>
      <div><label htmlFor="ad" className="block text-xs mb-1">Data</label><input id="ad" type="date" className={inputCls} value={date} onChange={(e) => setDate(e.target.value)} /></div>
      <div><label htmlFor="ap" className="block text-xs mb-1">Profissional</label><select id="ap" className={inputCls} value={profId} onChange={(e) => setProfId(e.target.value)}><option value="">Selecione…</option>{profs.data?.map((p) => <option key={p.id} value={p.id}>{p.display_name}</option>)}</select></div>
      <div><label htmlFor="as" className="block text-xs mb-1">Serviço</label><select id="as" className={inputCls} value={svcId} onChange={(e) => setSvcId(e.target.value)}><option value="">Selecione…</option>{services.data?.map((s) => <option key={s.id} value={s.id}>{s.name} ({s.duration_min} min)</option>)}</select></div>
    </div>
    <form onSubmit={book} className="bg-card border border-border p-5 mb-6 grid gap-3 sm:grid-cols-3" noValidate>
      <div><label htmlFor="apn" className="block text-sm mb-1">Paciente</label><input id="apn" className={inputCls} value={person ? person.full_name : search} onChange={(e) => { setPerson(null); setSearch(e.target.value); }} />
        {found.data?.map((p) => <button type="button" key={p.id} className="block w-full text-left p-2 border border-border bg-card hover:bg-muted" onClick={() => setPerson(p)}>{p.full_name}</button>)}</div>
      <div><label htmlFor="ash" className="block text-sm mb-1">Horários livres {unit ? `(${unit.timezone})` : ""}</label>
        <select id="ash" className={inputCls} value={slot} onChange={(e) => setSlot(e.target.value)}><option value="">{profId && svcId ? (slots.isLoading ? "Carregando…" : slots.data?.length ? "Selecione…" : "Sem horários livres") : "Escolha profissional e serviço"}</option>
          {slots.data?.map((s) => <option key={s} value={s}>{new Date(s).toLocaleTimeString("pt-BR", { timeZone: unit?.timezone, hour: "2-digit", minute: "2-digit" })}</option>)}</select></div>
      <div className="grid gap-2">
        {pkgs.data && pkgs.data.length > 0 && <div><label htmlFor="apk" className="block text-sm mb-1">Usar pacote</label><select id="apk" className={inputCls} value={pkg} onChange={(e) => setPkg(e.target.value)}><option value="">Sem pacote</option>{pkgs.data.map((p) => <option key={p.id} value={p.id}>{p.product.name}</option>)}</select></div>}
        {opps.data && opps.data.length > 0 && <div><label htmlFor="aop" className="block text-sm mb-1">Oportunidade</label><select id="aop" className={inputCls} value={oppId} onChange={(e) => setOppId(e.target.value)}><option value="">Nenhuma</option>{opps.data.map((o) => <option key={o.id} value={o.id}>{o.title}</option>)}</select></div>}
      </div>
      <div className="sm:col-span-3"><button disabled={busy} className="btn-primary !py-3 disabled:opacity-60">{busy ? "Agendando…" : "Agendar"}</button></div>
    </form>
    <State loading={day.isLoading} error={day.error} empty={inDay.length === 0} emptyText="Nenhum agendamento neste dia." />
    {inDay.length > 0 && <Table head={["Horário", "Paciente", "Profissional", "Serviço", "Estado", "Ações"]}>
      {inDay.map((a) => <tr key={a.id}><Td>{new Date(parsePeriod(a.period)[0]).toLocaleTimeString("pt-BR", { timeZone: unit?.timezone, hour: "2-digit", minute: "2-digit" })}</Td><Td>{a.person?.full_name}</Td><Td>{a.professional?.display_name}</Td><Td>{a.service?.name}</Td><Td>{ST[a.status]}</Td>
        <Td>{["scheduled", "confirmed"].includes(a.status) && <div className="flex flex-wrap gap-1 text-sm">
          {a.status === "scheduled" && <button className={btnGhost + " !py-1 !px-2"} onClick={() => setStatus(a, "confirmed")}>Confirmar</button>}
          <button className={btnGhost + " !py-1 !px-2"} onClick={() => setStatus(a, "attended")}>Compareceu</button><button className={btnGhost + " !py-1 !px-2"} onClick={() => setStatus(a, "no_show")}>Faltou</button>
          <button className={btnGhost + " !py-1 !px-2"} onClick={() => resched(a)}>Remarcar</button>
          <button className={btnDanger + " !py-1 !px-2"} onClick={() => setStatus(a, "cancelled_by_patient")}>Cancelou</button><button className={btnDanger + " !py-1 !px-2"} onClick={() => setStatus(a, "cancelled_by_clinic")}>Clínica cancelou</button></div>}</Td></tr>)}</Table>}
  </>);
};

const Packages = () => {
  const qc = useQueryClient(); const [msg, m] = useMsg();
  const pk = useQuery({ queryKey: ["all-pkgs"], queryFn: async () => {
    const [p, l] = await Promise.all([supabase.from("client_packages").select("id, total_sessions, status, valid_until, person:people(full_name), product:products(name)").order("created_at", { ascending: false }).limit(200), supabase.from("session_ledger").select("client_package_id, delta, reason, note, created_at").order("created_at", { ascending: false }).limit(1000)]);
    return { pkgs: (p.data ?? []) as unknown as { id: string; total_sessions: number; status: string; valid_until: string | null; person: { full_name: string }; product: { name: string } }[], ledger: l.data ?? [] };
  } });
  const bal = (id: string) => (pk.data?.ledger ?? []).filter((x) => x.client_package_id === id).reduce((a, x) => a + x.delta, 0);
  const adjust = async (id: string) => { const d = Number(window.prompt("Ajuste de sessões (+/-):")); if (!d) return; const n = window.prompt("Motivo do ajuste (obrigatório):"); if (!n) return;
    const { error } = await supabase.rpc("adjust_package", { p_pkg: id, p_delta: d, p_note: n }); error ? m.err(errText(error)) : (m.ok("Ajuste registrado no livro."), void qc.invalidateQueries({ queryKey: ["all-pkgs"] })); };
  return (<><Msg m={msg} /><p className="text-sm text-navy-400 mb-3">Regras: comparecimento consome 1 sessão; falta consome conforme o produto; cancelamento tardio consome; cancelamento com antecedência e da clínica não consome. Cada agendamento consome no máximo uma vez.</p>
    <State loading={pk.isLoading} error={pk.error} empty={pk.data?.pkgs.length === 0} emptyText="Nenhum pacote vendido." />
    {pk.data && pk.data.pkgs.length > 0 && <Table head={["Paciente", "Pacote", "Saldo", "Total", "Validade", "Estado", ""]} right={[2, 3]}>
      {pk.data.pkgs.map((p) => <tr key={p.id}><Td>{p.person.full_name}</Td><Td>{p.product.name}</Td><Td num>{bal(p.id)}</Td><Td num>{p.total_sessions}</Td><Td>{p.valid_until ? new Date(p.valid_until + "T12:00:00Z").toLocaleDateString("pt-BR") : "—"}</Td><Td>{{ active: "Ativo", exhausted: "Esgotado", expired: "Vencido", cancelled: "Cancelado" }[p.status]}</Td><Td><button className="text-accent text-sm" onClick={() => adjust(p.id)}>Ajustar saldo</button></Td></tr>)}</Table>}</>);
};

const Waitlist = () => {
  const qc = useQueryClient(); const [msg, m] = useMsg(); const { units, services } = useBase();
  const [search, setSearch] = useState(""); const [person, setPerson] = useState<{ id: string; full_name: string } | null>(null); const [unit, setUnit] = useState(""); const [svc, setSvc] = useState(""); const [pref, setPref] = useState("");
  const found = useQuery({ queryKey: ["ppl-w", search], enabled: search.length >= 2 && !person, queryFn: async () => (await supabase.from("people").select("id, full_name").ilike("full_name", `%${search.replace(/[%_]/g, "")}%`).limit(6)).data ?? [] });
  const list = useQuery({ queryKey: ["waitlist"], queryFn: async () => (await supabase.from("waitlist").select("id, status, preference, created_at, person:people(full_name), service:services(name)").order("created_at")).data as unknown as { id: string; status: string; preference: string | null; created_at: string; person: { full_name: string }; service: { name: string } }[] });
  const add = async (e: FormEvent) => { e.preventDefault(); if (!person || !unit || !svc) return m.err("Selecione paciente, unidade e serviço."); const { data: u } = await supabase.auth.getUser(); const { data: org } = await supabase.from("units").select("org_id").eq("id", unit).single();
    const { error } = await supabase.from("waitlist").insert({ org_id: org?.org_id, unit_id: unit, person_id: person.id, service_id: svc, preference: pref || null, created_by: u.user?.id }); error ? m.err(errText(error)) : (m.ok("Adicionado à lista de espera."), setPerson(null), setSearch(""), void qc.invalidateQueries({ queryKey: ["waitlist"] })); };
  return (<><Msg m={msg} />
    <form onSubmit={add} className="bg-card border border-border p-5 mb-6 grid gap-3 sm:grid-cols-4 items-end" noValidate>
      <div><label htmlFor="wp" className="block text-xs mb-1">Paciente</label><input id="wp" className={inputCls} value={person ? person.full_name : search} onChange={(e) => { setPerson(null); setSearch(e.target.value); }} />{found.data?.map((p) => <button type="button" key={p.id} className="block w-full text-left p-2 border border-border hover:bg-muted" onClick={() => setPerson(p)}>{p.full_name}</button>)}</div>
      <div><label htmlFor="wu" className="block text-xs mb-1">Unidade</label><select id="wu" className={inputCls} value={unit} onChange={(e) => setUnit(e.target.value)}><option value="">…</option>{units.data?.map((u) => <option key={u.id} value={u.id}>{u.name}</option>)}</select></div>
      <div><label htmlFor="ws" className="block text-xs mb-1">Serviço</label><select id="ws" className={inputCls} value={svc} onChange={(e) => setSvc(e.target.value)}><option value="">…</option>{services.data?.map((s) => <option key={s.id} value={s.id}>{s.name}</option>)}</select></div>
      <div><label htmlFor="wf" className="block text-xs mb-1">Preferência</label><input id="wf" className={inputCls} value={pref} onChange={(e) => setPref(e.target.value)} placeholder="ex.: manhãs" /></div>
      <button className="btn-primary !py-2">Adicionar</button></form>
    <State loading={list.isLoading} error={list.error} empty={list.data?.length === 0} emptyText="Lista de espera vazia." />
    {list.data && list.data.length > 0 && <Table head={["Paciente", "Serviço", "Preferência", "Desde", "Estado"]}>{list.data.map((w) => <tr key={w.id}><Td>{w.person.full_name}</Td><Td>{w.service.name}</Td><Td>{w.preference ?? "—"}</Td><Td>{fmtDateTime(w.created_at)}</Td><Td>{w.status}</Td></tr>)}</Table>}</>);
};

const Professionals = () => {
  const qc = useQueryClient(); const [msg, m] = useMsg(); const { units } = useBase();
  const [name, setName] = useState(""); const [unit, setUnit] = useState(""); const [prof, setProf] = useState(""); const [dow, setDow] = useState("1"); const [st, setSt] = useState("08:00"); const [en, setEn] = useState("18:00");
  const profs = useQuery({ queryKey: ["all-profs"], queryFn: async () => (await supabase.from("professionals").select("id, display_name, active").order("display_name")).data ?? [] });
  const rules = useQuery({ queryKey: ["rules"], queryFn: async () => (await supabase.from("availability_rules").select("id, weekday, start_time, end_time, professional:professionals(display_name), unit:units(name)").order("weekday")).data as unknown as { id: string; weekday: number; start_time: string; end_time: string; professional: { display_name: string }; unit: { name: string } }[] });
  const addProf = async (e: FormEvent) => { e.preventDefault(); if (!name.trim() || !unit) return m.err("Informe nome e unidade."); const { data: org } = await supabase.from("units").select("org_id").eq("id", unit).single();
    const { data, error } = await supabase.from("professionals").insert({ org_id: org?.org_id, display_name: name.trim() }).select("id").single(); if (error) return m.err(errText(error));
    const l = await supabase.from("professional_units").insert({ professional_id: data.id, unit_id: unit }); l.error ? m.err(errText(l.error)) : (m.ok("Profissional cadastrado."), setName(""), void qc.invalidateQueries({ queryKey: ["all-profs"] })); };
  const addRule = async (e: FormEvent) => { e.preventDefault(); if (!prof || !unit) return m.err("Selecione profissional e unidade."); const { data: org } = await supabase.from("units").select("org_id").eq("id", unit).single();
    const { error } = await supabase.from("availability_rules").insert({ org_id: org?.org_id, professional_id: prof, unit_id: unit, weekday: Number(dow), start_time: st, end_time: en }); error ? m.err(errText(error)) : (m.ok("Disponibilidade cadastrada."), void qc.invalidateQueries({ queryKey: ["rules"] })); };
  return (<><Msg m={msg} />
    <div className="grid gap-6 lg:grid-cols-2 mb-8">
      <form onSubmit={addProf} className="bg-card border border-border p-5 grid gap-3" noValidate><h2 className="text-xl">Novo profissional</h2>
        <div><label htmlFor="pn" className="block text-xs mb-1">Nome</label><input id="pn" className={inputCls} value={name} onChange={(e) => setName(e.target.value)} /></div>
        <div><label htmlFor="pun2" className="block text-xs mb-1">Unidade</label><select id="pun2" className={inputCls} value={unit} onChange={(e) => setUnit(e.target.value)}><option value="">…</option>{units.data?.map((u) => <option key={u.id} value={u.id}>{u.name}</option>)}</select></div><button className="btn-primary !py-2">Cadastrar</button></form>
      <form onSubmit={addRule} className="bg-card border border-border p-5 grid gap-3 sm:grid-cols-2" noValidate><h2 className="text-xl sm:col-span-2">Disponibilidade semanal</h2>
        <div><label htmlFor="rp" className="block text-xs mb-1">Profissional</label><select id="rp" className={inputCls} value={prof} onChange={(e) => setProf(e.target.value)}><option value="">…</option>{profs.data?.map((p) => <option key={p.id} value={p.id}>{p.display_name}</option>)}</select></div>
        <div><label htmlFor="rd" className="block text-xs mb-1">Dia</label><select id="rd" className={inputCls} value={dow} onChange={(e) => setDow(e.target.value)}>{DOW.map((d, i) => <option key={d} value={i}>{d}</option>)}</select></div>
        <div><label htmlFor="rs" className="block text-xs mb-1">Início</label><input id="rs" type="time" className={inputCls} value={st} onChange={(e) => setSt(e.target.value)} /></div>
        <div><label htmlFor="re" className="block text-xs mb-1">Fim</label><input id="re" type="time" className={inputCls} value={en} onChange={(e) => setEn(e.target.value)} /></div>
        <p className="text-xs text-navy-400 sm:col-span-2">Usa a unidade selecionada em “Novo profissional”.</p><button className="btn-primary !py-2 sm:col-span-2">Adicionar</button></form>
    </div>
    <State loading={rules.isLoading} error={rules.error} empty={rules.data?.length === 0} emptyText="Nenhuma disponibilidade cadastrada." />
    {rules.data && rules.data.length > 0 && <Table head={["Profissional", "Unidade", "Dia", "Horário"]}>{rules.data.map((r) => <tr key={r.id}><Td>{r.professional.display_name}</Td><Td>{r.unit.name}</Td><Td>{DOW[r.weekday]}</Td><Td>{r.start_time.slice(0, 5)}–{r.end_time.slice(0, 5)}</Td></tr>)}</Table>}</>);
};

export default Agenda;
