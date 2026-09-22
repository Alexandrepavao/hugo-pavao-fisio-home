import { useState, type FormEvent } from "react";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { supabase } from "@/lib/supabase";
import { fmtDateTime } from "@/lib/format";
import { btnGhost, btnPrimary, errText, inputCls, Msg, State, useMsg } from "@/lib/ui";
import PortalShell from "./PortalShell";

interface Appt { id: string; starts_at: string; status: string; service_name: string; professional_name: string; unit_name: string; timezone: string; survey_answered: boolean }
interface Assign { id: string; phase: string; note: string | null; released_at: string; content: { id: string; title: string; kind: string; body: string | null; storage_path: string | null; questions: unknown } | null }
interface Me { full_name: string; preferred_name: string | null; birth_date: string | null; city: string | null; state_uf: string | null }
interface Contact { type: string; value: string; is_primary: boolean }
const UFS = ["AC", "AL", "AP", "AM", "BA", "CE", "DF", "ES", "GO", "MA", "MT", "MS", "MG", "PA", "PB", "PR", "PE", "PI", "RJ", "RN", "RS", "RO", "RR", "SC", "SP", "SE", "TO"];
const ST: Record<string, string> = { scheduled: "Agendado", confirmed: "Confirmado", attended: "Realizado", no_show: "Faltou", cancelled_by_patient: "Cancelado", cancelled_by_clinic: "Cancelado pela clínica", rescheduled: "Remarcado" };
const PHASE: Record<string, string> = { before: "Antes do atendimento", after: "Depois do atendimento", program: "Programa de acompanhamento" };

const Patient = () => {
  const qc = useQueryClient(); const [msg, m] = useMsg();
  const appts = useQuery({ queryKey: ["my-appts"], queryFn: async () => ((await supabase.rpc("my_appointments")).data ?? []) as Appt[] });
  const pkgs = useQuery({ queryKey: ["my-pkgs"], queryFn: async () => ((await supabase.rpc("my_packages")).data ?? []) as { id: string; product_name: string; balance: number; total_sessions: number; valid_until: string | null; status: string }[] });
  const assigns = useQuery({ queryKey: ["my-care"], queryFn: async () => (await supabase.from("care_assignments").select("id, phase, note, released_at, content:care_contents(id, title, kind, body, storage_path, questions)").order("released_at", { ascending: false })).data as unknown as Assign[] });
  const survey = useQuery({ queryKey: ["survey"], queryFn: async () => (await supabase.from("surveys").select("id").eq("active", true).limit(1).maybeSingle()).data });

  const rate = async (a: Appt, score: number) => { const { error } = await supabase.rpc("survey_submit", { p_survey: survey.data!.id, p_appointment: a.id, p_score: score, p_comment: null });
    if (error) m.err(errText(error)); else { m.ok("Obrigado pela avaliação!"); void qc.invalidateQueries({ queryKey: ["my-appts"] }); } };

  return (
    <PortalShell title="Meu acompanhamento">
      <Msg m={msg} />
      <section className="mb-10"><h2 className="text-xl mb-3">Meus atendimentos</h2>
        <State loading={appts.isLoading} error={appts.error} empty={appts.data?.length === 0} emptyText="Você ainda não tem atendimentos agendados." />
        <ul className="space-y-2">{appts.data?.map((a) => <li key={a.id} className="hp-card p-3 flex flex-wrap justify-between gap-2"><span>{fmtDateTime(a.starts_at, a.timezone)} — {a.service_name} com {a.professional_name} <span className="text-muted-foreground">({a.unit_name})</span></span><span className="text-sm">{ST[a.status]}</span>
          {a.status === "attended" && !a.survey_answered && survey.data && <span className="basis-full text-sm">Como foi? {[...Array(11).keys()].map((n) => <button key={n} className="w-7 h-7 border border-border mx-0.5 text-xs hover:bg-primary hover:text-primary-foreground" onClick={() => rate(a, n)} aria-label={`Nota ${n}`}>{n}</button>)}</span>}</li>)}</ul></section>

      <section className="mb-10"><h2 className="text-xl mb-3">Meus pacotes</h2>
        {pkgs.data && pkgs.data.length > 0 ? <ul className="space-y-2">{pkgs.data.map((p) => <li key={p.id} className="hp-card p-3 flex justify-between"><span>{p.product_name}</span><span className="tabular">{p.balance} de {p.total_sessions} sessões {p.valid_until ? `· válido até ${new Date(p.valid_until + "T12:00:00Z").toLocaleDateString("pt-BR")}` : ""}</span></li>)}</ul> : <p className="text-muted-foreground">Nenhum pacote.</p>}</section>

      <section className="mb-10"><h2 className="text-xl mb-1">Orientações liberadas pela sua equipe</h2><p className="text-sm text-muted-foreground mb-3">Conteúdos definidos por profissionais autorizados. Em caso de dor intensa ou piora, procure atendimento — este espaço não substitui uma avaliação.</p>
        <State loading={assigns.isLoading} error={assigns.error} empty={assigns.data?.length === 0} emptyText="Nenhum conteúdo liberado no momento." />
        <ul className="space-y-4">{assigns.data?.map((a) => a.content && <Item key={a.id} a={a} onLogged={() => m.ok("Registro enviado.")} onError={(t) => m.err(t)} />)}</ul></section>
      <PersonalData />
      <Chat />
    </PortalShell>
  );
};

const PersonalData = () => {
  const qc = useQueryClient(); const [msg, m] = useMsg(); const [editing, setEditing] = useState(false); const [saving, setSaving] = useState(false);
  const [preferredName, setPreferredName] = useState(""); const [phone, setPhone] = useState(""); const [city, setCity] = useState(""); const [uf, setUf] = useState("");
  // RLS (can_read_person) só deixa a pessoa ler o próprio cadastro — sem filtro adicional, o único registro que volta é o dela mesma.
  const self = useQuery({ queryKey: ["my-person"], queryFn: async () => (await supabase.from("people").select("id, full_name, preferred_name, birth_date, city, state_uf").limit(1).maybeSingle()).data as (Me & { id: string }) | null });
  const contacts = useQuery({ queryKey: ["my-contacts", self.data?.id], enabled: !!self.data?.id, queryFn: async () => (await supabase.from("person_contacts").select("type, value, is_primary").eq("person_id", self.data!.id)).data as Contact[] ?? [] });
  const TYPE_LABEL: Record<string, string> = { email: "E-mail", phone: "Telefone/WhatsApp" };
  const primaryPhone = contacts.data?.find((c) => c.type === "phone" && c.is_primary)?.value ?? "";

  const startEdit = () => { setPreferredName(self.data?.preferred_name ?? ""); setPhone(primaryPhone); setCity(self.data?.city ?? ""); setUf(self.data?.state_uf ?? ""); setEditing(true); };

  const save = async (e: FormEvent) => {
    e.preventDefault(); setSaving(true);
    const { error } = await supabase.rpc("my_profile_update", { p_preferred_name: preferredName.trim() || null, p_phone: phone.trim() || null, p_city: city.trim() || null, p_state_uf: uf || null });
    setSaving(false);
    if (error) m.err(errText(error));
    else { m.ok("Dados atualizados."); setEditing(false); void qc.invalidateQueries({ queryKey: ["my-person"] }); void qc.invalidateQueries({ queryKey: ["my-contacts"] }); }
  };

  return (
    <section className="mb-10"><h2 className="text-xl mb-1">Dados pessoais</h2>
      <p className="text-sm text-muted-foreground mb-3">Nome, telefone e cidade/UF podem ser atualizados por você. Nome completo, unidade, documentos e demais dados do cadastro são mantidos pela equipe da clínica — para corrigi-los, fale com a recepção ou pelo canal de dúvidas abaixo.</p>
      <Msg m={msg} />
      <State loading={self.isLoading} error={self.error} empty={!self.isLoading && !self.data} emptyText="Cadastro não encontrado. Fale com a equipe se isso não for esperado." />
      {self.data && !editing && (
        <div className="hp-card p-4 grid gap-2 max-w-md text-sm">
          <div className="flex justify-between"><span className="text-muted-foreground">Nome completo</span><span>{self.data.full_name}</span></div>
          <div className="flex justify-between"><span className="text-muted-foreground">Nome de preferência</span><span>{self.data.preferred_name || "—"}</span></div>
          {self.data.birth_date && <div className="flex justify-between"><span className="text-muted-foreground">Nascimento</span><span>{new Date(self.data.birth_date + "T12:00:00Z").toLocaleDateString("pt-BR")}</span></div>}
          <div className="flex justify-between"><span className="text-muted-foreground">Cidade/UF</span><span>{self.data.city ? `${self.data.city}${self.data.state_uf ? "/" + self.data.state_uf : ""}` : "—"}</span></div>
          {contacts.data?.map((c) => <div key={c.type + c.value} className="flex justify-between"><span className="text-muted-foreground">{TYPE_LABEL[c.type] ?? c.type}</span><span>{c.value}{c.is_primary && " (principal)"}</span></div>)}
          <button className={btnGhost + " mt-2 justify-self-start"} onClick={startEdit}>Editar meus dados</button>
        </div>
      )}
      {self.data && editing && (
        <form onSubmit={save} className="hp-card p-4 grid gap-3 max-w-md text-sm">
          <div><label htmlFor="pd-nome" className="block text-xs mb-1">Nome de preferência</label><input id="pd-nome" className={inputCls} value={preferredName} onChange={(e) => setPreferredName(e.target.value)} maxLength={120} /></div>
          <div><label htmlFor="pd-fone" className="block text-xs mb-1">Telefone/WhatsApp</label><input id="pd-fone" className={inputCls} value={phone} onChange={(e) => setPhone(e.target.value)} placeholder="(11) 98888-7777" /></div>
          <div className="grid grid-cols-[1fr_5rem] gap-2">
            <div><label htmlFor="pd-cidade" className="block text-xs mb-1">Cidade</label><input id="pd-cidade" className={inputCls} value={city} onChange={(e) => setCity(e.target.value)} maxLength={120} /></div>
            <div><label htmlFor="pd-uf" className="block text-xs mb-1">UF</label><select id="pd-uf" className={inputCls} value={uf} onChange={(e) => setUf(e.target.value)}><option value="">—</option>{UFS.map((s) => <option key={s} value={s}>{s}</option>)}</select></div>
          </div>
          <div className="flex gap-2"><button className={btnPrimary} disabled={saving}>{saving ? "Salvando…" : "Salvar"}</button><button type="button" className={btnGhost} onClick={() => setEditing(false)} disabled={saving}>Cancelar</button></div>
        </form>
      )}
    </section>
  );
};

const Item = ({ a, onLogged, onError }: { a: Assign; onLogged: () => void; onError: (t: string) => void }) => {
  const [pain, setPain] = useState(""); const [note, setNote] = useState(""); const [need, setNeed] = useState(false); const [open, setOpen] = useState(false);
  const c = a.content!;
  const url = useQuery({ queryKey: ["care-url", c.storage_path], enabled: !!c.storage_path && open, staleTime: 50 * 60_000, queryFn: async () => (await supabase.storage.from("care-private").createSignedUrl(c.storage_path!, 3600)).data?.signedUrl ?? null });
  const log = async (e: FormEvent) => { e.preventDefault(); const { error } = await supabase.rpc("care_log_activity", { p_assignment: a.id, p_pain: pain === "" ? null : Number(pain), p_answers: null, p_note: note || null, p_needs_attention: need });
    if (error) onError(errText(error)); else { onLogged(); setNote(""); setPain(""); setNeed(false); } };
  return (<li className="hp-card p-4"><p className="eyebrow mb-1">{PHASE[a.phase]}</p><h3 className="text-lg">{c.title}</h3>{a.note && <p className="text-sm text-muted-foreground">Nota do profissional: {a.note}</p>}
    <button className="text-accent text-sm mt-1" onClick={() => setOpen(!open)}>{open ? "Recolher" : "Abrir"}</button>
    {open && <div className="mt-3">{(c.body ?? "").split(/\n{2,}/).map((p, i) => <p key={i} className="mb-2 whitespace-pre-line">{p}</p>)}
      {url.data && (c.kind === "exercise_video" ? <video controls controlsList="nodownload" className="w-full max-w-xl bg-black mb-3" src={url.data} /> : <a className={btnGhost + " inline-block mb-3"} href={url.data} target="_blank" rel="noopener noreferrer">Abrir arquivo</a>)}
      <form onSubmit={log} className="grid gap-2 sm:grid-cols-3 items-end"><div><label htmlFor={`pn-${a.id}`} className="block text-xs mb-1">Dor (0–10)</label><input id={`pn-${a.id}`} inputMode="numeric"   value={pain} onChange={(e) => setPain(e.target.value)} /></div>
        <div className="sm:col-span-2"><label htmlFor={`nt-${a.id}`} className="block text-xs mb-1">Como foi? (opcional)</label><input id={`nt-${a.id}`}   value={note} onChange={(e) => setNote(e.target.value)} maxLength={1000} /></div>
        <label className="flex gap-2 text-sm sm:col-span-2"><input type="checkbox" checked={need} onChange={(e) => setNeed(e.target.checked)} /> Preciso de atendimento / contato da equipe</label><button className={btnGhost}>Registrar atividade</button></form></div>}</li>);
};

const Chat = () => {
  const qc = useQueryClient(); const [msg, m] = useMsg(); const [body, setBody] = useState("");
  const list = useQuery({ queryKey: ["my-msgs"], queryFn: async () => (await supabase.from("care_messages").select("id, sender, body, created_at").order("created_at")).data ?? [], refetchInterval: 30_000 });
  const send = async (e: FormEvent) => { e.preventDefault(); if (!body.trim()) return; const { error } = await supabase.rpc("care_send_message", { p_body: body });
    if (error) m.err(errText(error)); else { setBody(""); void qc.invalidateQueries({ queryKey: ["my-msgs"] }); } };
  return (<section><h2 className="text-xl mb-1">Canal de dúvidas</h2><p className="text-sm text-muted-foreground mb-3">Sua mensagem é vista apenas pelos profissionais vinculados ao seu acompanhamento. Não é um canal de urgência.</p><Msg m={msg} />
    <ul className="space-y-2 mb-3">{list.data?.map((x) => <li key={x.id} className={`p-3 border border-border max-w-lg ${x.sender === "patient" ? "bg-muted ml-auto" : "bg-card"}`}><p className="text-xs text-muted-foreground">{x.sender === "patient" ? "Você" : "Profissional"} · {fmtDateTime(x.created_at)}</p><p className="whitespace-pre-line">{x.body}</p></li>)}</ul>
    <form onSubmit={send} className="flex gap-2"><label htmlFor="cm" className="sr-only">Mensagem</label><textarea id="cm" rows={2}   value={body} onChange={(e) => setBody(e.target.value)} maxLength={2000} /><button className={btnGhost}>Enviar</button></form></section>);
};

export default Patient;
