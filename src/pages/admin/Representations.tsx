import { useState, type FormEvent } from "react";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { supabase } from "@/lib/supabase";
import { useAuth } from "@/auth/AuthProvider";
import { fmtDate, fmtDateTime } from "@/lib/format";
import { Badge, btnGhost, btnPrimary, EmptyState, errText, inputCls, Msg, PageHead, State, Table, Tabs, Td, useAsk, useConfirm, useMsg } from "@/lib/ui";
import { Sheet, SheetContent, SheetDescription, SheetHeader, SheetTitle } from "@/components/ui/sheet";
import { EvolutionChart } from "@/pages/portal/Journey";
import { DECISION_LABEL, GOAL_STATUS, type JourneyData } from "@/lib/journeyTypes";
import { KIND_LABEL } from "@/portal/acting";

interface Row { id: string; patient_id: string; patient: string; birth_date: string | null; representative_id: string; representative: string; kind: string; status: string; active: boolean; suspended_reason: string | null; valid_until: string | null; accepted: boolean; minor_login: boolean; docs: number; note: string | null; created_at: string; scopes: Record<string, boolean> }
const DOCS: [string, string][] = [["doc_foto", "Documento com foto e CPF"], ["certidao_nascimento", "Certidão de nascimento / RG do menor"], ["termo_tutela_guarda", "Termo de tutela ou guarda"], ["termo_curatela", "Termo/certidão de curatela"], ["procuracao", "Procuração"], ["autorizacao", "Autorização assinada"], ["outro", "Outro"]];
const SCOPE_LABEL: Record<string, string> = { agenda: "Agenda", cancel: "Cancelar", train: "Treinos", evolution: "Evolução", billing: "Cobrança", consent: "Consentir", ticket: "Chamados" };

/** Busca simples no cadastro central (a RLS já limita às pessoas da unidade do usuário). */
const PersonPick = ({ label, value, onPick }: { label: string; value: { id: string; name: string } | null; onPick: (p: { id: string; name: string } | null) => void }) => {
  const [q, setQ] = useState("");
  const res = useQuery({ queryKey: ["rep-people", q], enabled: q.trim().length >= 2 && !value, queryFn: async () => (await supabase.from("people").select("id, full_name, birth_date").is("merged_into_id", null).ilike("full_name", `%${q.trim()}%`).limit(8)).data ?? [] });
  return (
    <div><label className="mb-1 block text-xs">{label}</label>
      {value ? <div className="flex items-center justify-between gap-2 rounded border border-border px-2 py-1.5 text-sm"><span>{value.name}</span><button type="button" className="text-xs text-accent" onClick={() => onPick(null)}>trocar</button></div> : (<>
        <input className={inputCls} placeholder="Digite 2 letras do nome…" value={q} onChange={(e) => setQ(e.target.value)} aria-label={label} />
        {(res.data ?? []).length > 0 && <ul className="mt-1 max-h-40 overflow-auto rounded border border-border text-sm">{(res.data as { id: string; full_name: string; birth_date: string | null }[]).map((p) => <li key={p.id}><button type="button" className="w-full px-2 py-1.5 text-left hover:bg-muted" onClick={() => onPick({ id: p.id, name: p.full_name })}>{p.full_name}{p.birth_date ? ` · ${fmtDate(p.birth_date + "T12:00:00Z")}` : " · sem data de nascimento"}</button></li>)}</ul>}</>)}
    </div>
  );
};

const NewLink = ({ onDone }: { onDone: () => void }) => {
  const [msg, m] = useMsg(); const [patient, setPatient] = useState<{ id: string; name: string } | null>(null); const [rep, setRep] = useState<{ id: string; name: string } | null>(null);
  const [kind, setKind] = useState("responsavel_legal"); const [until, setUntil] = useState(""); const [minor, setMinor] = useState(false); const [note, setNote] = useState("");
  const short = kind === "cuidador" || kind === "delegado";
  const save = async (e: FormEvent) => { e.preventDefault(); if (!patient || !rep) return m.err("Escolha o paciente e a pessoa que vai representá-lo.");
    const { error } = await supabase.rpc("representation_save", { p_id: null, p_patient: patient.id, p_representative: rep.id, p_kind: kind, p_scopes: null, p_valid_until: until || null, p_minor_login: minor, p_note: note || null });
    if (error) return m.err(errText(error)); setPatient(null); setRep(null); setNote(""); setUntil(""); m.ok("Vínculo criado. Ele só passa a valer depois de verificado."); onDone(); };
  return (
    <form onSubmit={save} className="hp-card mb-5 grid gap-3 p-4 md:grid-cols-2" aria-label="Novo vínculo">
      <h3 className="md:col-span-2 text-base">Novo vínculo</h3><Msg m={msg} />
      <PersonPick label="Paciente (quem é representado)" value={patient} onPick={setPatient} /><PersonPick label="Responsável, cuidador ou representante" value={rep} onPick={setRep} />
      <div><label htmlFor="rk" className="mb-1 block text-xs">Tipo de vínculo</label><select id="rk" className={inputCls} value={kind} onChange={(e) => setKind(e.target.value)}>{Object.entries(KIND_LABEL).map(([k, l]) => <option key={k} value={k}>{l}</option>)}</select></div>
      {short ? <div><label htmlFor="ru" className="mb-1 block text-xs">Validade (obrigatória, até 1 ano)</label><input id="ru" type="date" className={inputCls} value={until} onChange={(e) => setUntil(e.target.value)} required /></div> : <div><label htmlFor="ru" className="mb-1 block text-xs">Validade (opcional)</label><input id="ru" type="date" className={inputCls} value={until} onChange={(e) => setUntil(e.target.value)} /></div>}
      {kind === "responsavel_legal" || kind === "tutor" ? <label className="flex items-center gap-2 text-sm md:col-span-2"><input type="checkbox" checked={minor} onChange={(e) => setMinor(e.target.checked)} />Autorizo o login próprio do adolescente (12 a 17 anos): agenda, treinos e evolução; sem cancelar, consentir ou cobrança.</label> : null}
      <div className="md:col-span-2"><label htmlFor="rn" className="mb-1 block text-xs">Observação (documentos conferidos etc.)</label><input id="rn" className={inputCls} value={note} onChange={(e) => setNote(e.target.value)} maxLength={500} /></div>
      <div className="md:col-span-2"><button className={btnPrimary}>Criar vínculo</button> <span className="text-xs text-muted-foreground">Cuidador e pessoa de confiança nunca consentem; criança com menos de 12 anos não tem login.</span></div>
    </form>
  );
};

const Docs = ({ row, onClose }: { row: Row; onClose: () => void }) => {
  const qc = useQueryClient(); const [msg, m] = useMsg(); const [type, setType] = useState("doc_foto"); const [busy, setBusy] = useState(false);
  const list = useQuery({ queryKey: ["rep-docs", row.id], queryFn: async () => (await supabase.from("representation_documents").select("id, doc_type, storage_path, created_at").eq("representation_id", row.id).order("created_at", { ascending: false })).data ?? [] });
  const upload = async (f: File | undefined) => {
    if (!f) return; if (f.size > 8 * 1024 * 1024) return m.err("Arquivo acima de 8 MB."); setBusy(true);
    const path = `${row.id}/${crypto.randomUUID()}-${f.name.replace(/[^\w.-]+/g, "_")}`;
    const up = await supabase.storage.from("representation-docs").upload(path, f, { upsert: false });
    if (up.error) { setBusy(false); return m.err(errText(up.error)); }
    const { error } = await supabase.rpc("representation_document_add", { p_representation: row.id, p_type: type, p_path: path }); setBusy(false);
    if (error) return m.err(errText(error)); m.ok("Documento anexado."); void qc.invalidateQueries({ queryKey: ["rep-docs", row.id] }); void qc.invalidateQueries({ queryKey: ["rep-admin"] });
  };
  const open = async (path: string) => { const r = await supabase.storage.from("representation-docs").createSignedUrl(path, 120); if (r.data?.signedUrl) window.open(r.data.signedUrl, "_blank", "noopener"); else m.err("Não foi possível abrir o arquivo."); };
  return (
    <Sheet open onOpenChange={(o) => { if (!o) onClose(); }}><SheetContent className="w-full overflow-y-auto sm:max-w-md">
      <SheetHeader><SheetTitle>Documentos do vínculo</SheetTitle><SheetDescription>{row.representative} → {row.patient} ({KIND_LABEL[row.kind] ?? row.kind}). Armazenamento privado; só a administração abre.</SheetDescription></SheetHeader>
      <Msg m={msg} />
      <div className="mt-4 grid gap-2"><label htmlFor="dt" className="text-xs">Tipo do documento</label><select id="dt" className={inputCls} value={type} onChange={(e) => setType(e.target.value)}>{DOCS.map(([k, l]) => <option key={k} value={k}>{l}</option>)}</select>
        <label htmlFor="df" className="text-xs">Arquivo (imagem ou PDF, até 8 MB)</label><input id="df" type="file" accept="image/*,application/pdf" disabled={busy} onChange={(e) => void upload(e.target.files?.[0])} /></div>
      <ul className="mt-4 grid gap-1 text-sm">{(list.data as { id: string; doc_type: string; storage_path: string; created_at: string }[] | undefined)?.map((d) => <li key={d.id} className="flex justify-between gap-2"><span>{DOCS.find(([k]) => k === d.doc_type)?.[1]} <span className="text-muted-foreground">· {fmtDateTime(d.created_at)}</span></span><button className="text-accent" onClick={() => void open(d.storage_path)}>Abrir</button></li>)}</ul>
    </SheetContent></Sheet>
  );
};

/** Leitura do prontuário pelo admin (decisão do proprietário). Cada abertura é REGISTRADA e aparece para o paciente em “Quem acessou o prontuário”. */
const Chart = ({ person, name, onClose }: { person: string; name: string; onClose: () => void }) => {
  const q = useQuery({ queryKey: ["admin-journey", person], retry: false, queryFn: async () => { const { data, error } = await supabase.rpc("admin_patient_journey", { p_person: person }); if (error) throw error; return data as JourneyData; } });
  const d = q.data;
  return (
    <Sheet open onOpenChange={(o) => { if (!o) onClose(); }}><SheetContent className="w-full overflow-y-auto sm:max-w-xl" data-testid="admin-chart">
      <SheetHeader><SheetTitle>Prontuário — {name}</SheetTitle><SheetDescription>Leitura pela administração. Este acesso foi registrado e o paciente pode vê-lo.</SheetDescription></SheetHeader>
      <State loading={q.isLoading} error={q.error} />
      {d && <div className="mt-4 grid gap-5 text-sm">
        <div><h4 className="mb-1 font-medium">Objetivos</h4>{d.goals.length === 0 ? <p className="text-muted-foreground">Nenhum.</p> : <ul className="grid gap-1">{d.goals.map((g) => <li key={g.id}><b>{g.title}</b> <span className="text-muted-foreground">· {GOAL_STATUS[g.status]}</span></li>)}</ul>}</div>
        <div><h4 className="mb-1 font-medium">Plano</h4>{d.plan ? <p>{d.plan.attended} de {d.plan.planned_sessions} sessões · {d.plan.status === "completed" ? "encerrado" : d.plan.maintenance ? "manutenção" : "em andamento"}</p> : <p className="text-muted-foreground">Sem plano definido.</p>}</div>
        <div><h4 className="mb-1 font-medium">Evolução</h4><EvolutionChart items={d.assessments} /></div>
        <div><h4 className="mb-1 font-medium">Reavaliações</h4>{d.reassessments.length === 0 ? <p className="text-muted-foreground">Nenhuma.</p> : <ul className="grid gap-2">{d.reassessments.map((r) => <li key={r.id} className="hp-card p-2"><b>{DECISION_LABEL[r.decision]}</b> <span className="text-muted-foreground">· {fmtDate(r.decided_at)} · {r.author}</span>{r.patient_message && <p>Ao paciente: {r.patient_message}</p>}{(r as { clinical_note?: string }).clinical_note && <p className="text-muted-foreground">Nota clínica: {(r as { clinical_note?: string }).clinical_note}</p>}</li>)}</ul>}</div>
      </div>}
    </SheetContent></Sheet>
  );
};

const STATUS: [string, string][] = [["", "Todos"], ["pending", "Aguardando verificação"], ["verified", "Verificados"], ["revoked", "Revogados"]];

/** Gestão › Responsáveis e cuidadores: cria, verifica (só o admin), suspende e revoga vínculos de acesso; anexa documentos; abre o prontuário com registro. */
const Representations = () => {
  const qc = useQueryClient(); const { hasRole } = useAuth(); const ask = useAsk(); const confirm = useConfirm(); const [msg, m] = useMsg(); const [tab, setTab] = useState("");
  const [docs, setDocs] = useState<Row | null>(null); const [chart, setChart] = useState<Row | null>(null);
  const isAdmin = hasRole("manager", "ops_admin"); const isOwner = hasRole("manager");
  const q = useQuery({ queryKey: ["rep-admin", tab], retry: false, queryFn: async () => { const { data, error } = await supabase.rpc("representations_admin_list", { p_status: tab || null }); if (error) throw error; return (data ?? []) as Row[]; } });
  const refresh = () => void qc.invalidateQueries({ queryKey: ["rep-admin"] });
  const call = async (fn: string, args: Record<string, unknown>, ok: string) => { const { error } = await supabase.rpc(fn, args); if (error) return m.err(errText(error)); m.ok(ok); refresh(); };
  const verify = async (r: Row) => {
    if (r.docs === 0 && r.kind !== "delegado") { if (!(await confirm("Conferiu o original?", "Não há documento anexado. Só verifique se você conferiu o documento original em mãos.", "Conferi o original")) ) return; return call("representation_verify", { p_id: r.id, p_checked_in_person: true }, "Vínculo verificado."); }
    return call("representation_verify", { p_id: r.id, p_checked_in_person: false }, "Vínculo verificado.");
  };
  const reason = async (title: string) => (await ask({ title, label: "Motivo", multiline: true }));
  return (
    <>
      <PageHead eyebrow="Gestão" title="Responsáveis e cuidadores" hint="Quem pode agir em nome de um paciente. O vínculo só vale depois de verificado pelo administrador, dentro da validade e sem suspensão. Responsável legal vale só enquanto o paciente é menor de 18 anos." />
      <Msg m={msg} />
      <NewLink onDone={refresh} />
      <Tabs tabs={STATUS} value={tab} onChange={setTab} />
      <State loading={q.isLoading} error={q.error} />
      {q.data && q.data.length === 0 ? <EmptyState title="Nenhum vínculo">Crie o primeiro no formulário acima.</EmptyState> : q.data && (
        <Table head={["Paciente", "Representante", "Tipo", "Situação", "Validade", "Docs", "Ações"]}>{q.data.map((r) => (
          <tr key={r.id} data-testid="rep-row">
            <Td><b>{r.patient}</b>{r.birth_date ? <span className="block text-xs text-muted-foreground">nasc. {fmtDate(r.birth_date + "T12:00:00Z")}</span> : <span className="block text-xs text-destructive">sem data de nascimento</span>}</Td>
            <Td>{r.representative}</Td><Td>{KIND_LABEL[r.kind] ?? r.kind}<span className="block text-xs text-muted-foreground">{Object.entries(r.scopes).filter(([, v]) => v).map(([k]) => SCOPE_LABEL[k]).join(", ")}</span></Td>
            <Td>{r.status === "revoked" ? <Badge tone="neutral">Revogado</Badge> : r.suspended_reason ? <Badge tone="danger">Suspenso</Badge> : r.active ? <Badge tone="success">Ativo</Badge> : r.status === "pending" ? <Badge tone="warning">Aguardando verificação</Badge> : !r.accepted && (r.kind === "cuidador" || r.kind === "delegado") ? <Badge tone="warning">Aguardando aceite do paciente</Badge> : <Badge>Inativo</Badge>}{r.suspended_reason && <span className="block text-xs text-muted-foreground">{r.suspended_reason}</span>}</Td>
            <Td>{r.valid_until ? fmtDate(r.valid_until + "T12:00:00Z") : "—"}</Td><Td>{r.docs}</Td>
            <Td><span className="flex flex-wrap gap-1">
              {isAdmin && r.status === "pending" && <button className={btnPrimary + " hp-btn-sm"} onClick={() => void verify(r)}>Verificar</button>}
              {isAdmin && r.status !== "revoked" && <button className={btnGhost + " hp-btn-sm"} onClick={() => setDocs(r)}>Documentos</button>}
              {isAdmin && r.status !== "revoked" && (r.suspended_reason ? <button className={btnGhost + " hp-btn-sm"} onClick={() => void call("representation_unsuspend", { p_id: r.id }, "Vínculo reativado.")}>Reativar</button> : <button className={btnGhost + " hp-btn-sm"} onClick={async () => { const t = await reason("Suspender vínculo"); if (t) await call("representation_suspend", { p_id: r.id, p_reason: t }, "Vínculo suspenso."); }}>Suspender</button>)}
              {isAdmin && r.status !== "revoked" && <button className={btnGhost + " hp-btn-sm"} onClick={async () => { const t = await reason("Revogar vínculo"); if (t) await call("representation_revoke", { p_id: r.id, p_reason: t }, "Vínculo revogado."); }}>Revogar</button>}
              {isOwner && <button className={btnGhost + " hp-btn-sm"} onClick={() => setChart(r)}>Ver prontuário</button>}
            </span></Td>
          </tr>))}</Table>)}
      {docs && <Docs row={docs} onClose={() => setDocs(null)} />}
      {chart && <Chart person={chart.patient_id} name={chart.patient} onClose={() => setChart(null)} />}
    </>
  );
};
export default Representations;
