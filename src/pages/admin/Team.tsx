import { useState, type FormEvent } from "react";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { supabase } from "@/lib/supabase";
import { fmtDate } from "@/lib/format";
import { btnDanger, btnGhost, confirmDialog, promptText, errText, inputCls, Msg, PageHead, State, Table, Td, useMsg } from "@/lib/ui";

interface Member { user_id: string; email: string; display_name: string; status: string; roles: { id: string; role: string; unit_id: string | null; unit: string | null; valid_until: string | null }[] }
const ROLES: Record<string, string> = { manager: "Gestor", ops_admin: "Administrador operacional", unit_manager: "Gestor de unidade", sales: "Comercial", finance: "Financeiro", physio: "Fisioterapeuta", teacher: "Professor/mentor", partner: "Parceiro", member: "Paciente/aluno" };
const ORG_WIDE = ["manager", "ops_admin", "member", "partner"];

const Team = () => {
  const qc = useQueryClient(); const [msg, m] = useMsg();
  const [email, setEmail] = useState(""); const [role, setRole] = useState("sales"); const [unit, setUnit] = useState("");
  const team = useQuery({ queryKey: ["team"], queryFn: async () => { const { data, error } = await supabase.rpc("list_team"); if (error) throw error; return data as Member[]; } });
  const units = useQuery({ queryKey: ["units"], queryFn: async () => (await supabase.from("units").select("id, name").eq("active", true)).data ?? [] });
  const invites = useQuery({ queryKey: ["invites"], queryFn: async () => (await supabase.from("invitations").select("id, email, role, expires_at, accepted_at, revoked_at").is("accepted_at", null).is("revoked_at", null).order("created_at", { ascending: false })).data ?? [] });

  const invite = async (e: FormEvent) => {
    e.preventDefault(); const orgWide = ORG_WIDE.includes(role);
    if (!/^[^@\s]+@[^@\s]+\.[^@\s]+$/.test(email.trim())) return m.err("Informe um e-mail válido."); if (!orgWide && !unit) return m.err("Selecione a unidade para este papel.");
    const { data: u } = await supabase.auth.getUser(); const { data: org } = await supabase.from("organizations").select("id").single();
    const { error } = await supabase.from("invitations").insert({ org_id: org?.id, email: email.trim(), role, unit_id: orgWide ? null : unit, invited_by: u.user?.id });
    if (error) m.err(errText(error)); else { m.ok(`Convite registrado. Peça à pessoa para acessar “Primeiro acesso” com ${email.trim()} e confirmar o e-mail. O envio automático do convite por e-mail depende do SMTP (ver docs/integrations.md).`); setEmail(""); void qc.invalidateQueries({ queryKey: ["invites"] }); }
  };
  const revokeRole = async (id: string) => { if (!(await confirmDialog("Revogar este papel?", "O efeito é imediato: a pessoa perde o acesso vinculado a este papel.", "Revogar", true))) return; const { error } = await supabase.from("role_assignments").update({ revoked_at: new Date().toISOString() }).eq("id", id); if (error) m.err(errText(error)); else { m.ok("Papel revogado."); void qc.invalidateQueries({ queryKey: ["team"] }); } };
  const revokeInvite = async (id: string) => { const { error } = await supabase.from("invitations").update({ revoked_at: new Date().toISOString() }).eq("id", id); error ? m.err(errText(error)) : void qc.invalidateQueries({ queryKey: ["invites"] }); };
  const rename = async (u: Member) => { const n = await promptText("Nome de exibição", "Nome", { defaultValue: u.display_name }); if (!n) return; const { error } = await supabase.from("user_accounts").update({ display_name: n }).eq("user_id", u.user_id); error ? m.err(errText(error)) : void qc.invalidateQueries({ queryKey: ["team"] }); };
  const toggle = async (u: Member) => { const { error } = await supabase.from("user_accounts").update({ status: u.status === "active" ? "suspended" : "active" }).eq("user_id", u.user_id); error ? m.err(errText(error)) : void qc.invalidateQueries({ queryKey: ["team"] }); };

  return (<div>
    <PageHead eyebrow="Acessos" title="Equipe e convites" hint="Papéis são atribuídos por escopo (organização ou unidade) e podem ser combinados. Acesso só nasce de convite para e-mail verificado; não há senha padrão." />
    <Msg m={msg} />
    <form onSubmit={invite} className="hp-card p-5 mb-6 grid gap-3 sm:grid-cols-4 items-end" noValidate>
      <div className="sm:col-span-2"><label htmlFor="ie" className="block text-xs mb-1">E-mail da pessoa</label><input id="ie" type="email"   value={email} onChange={(e) => setEmail(e.target.value)} /></div>
      <div><label htmlFor="ir" className="block text-xs mb-1">Papel</label><select id="ir"   value={role} onChange={(e) => setRole(e.target.value)}>{Object.entries(ROLES).map(([k, l]) => <option key={k} value={k}>{l}</option>)}</select></div>
      <div><label htmlFor="iu" className="block text-xs mb-1">Unidade {ORG_WIDE.includes(role) ? "(não se aplica)" : ""}</label><select id="iu" disabled={ORG_WIDE.includes(role)}   value={unit} onChange={(e) => setUnit(e.target.value)}><option value="">…</option>{units.data?.map((u) => <option key={u.id} value={u.id}>{u.name}</option>)}</select></div>
      <button className="hp-btn hp-btn-primary sm:w-fit">Convidar</button></form>
    {invites.data && invites.data.length > 0 && <section className="mb-8"><h2 className="text-xl mb-2">Convites abertos</h2><Table head={["E-mail", "Papel", "Expira em", ""]}>{invites.data.map((i) => <tr key={i.id}><Td>{i.email}</Td><Td>{ROLES[i.role]}</Td><Td>{fmtDate(i.expires_at)}</Td><Td><button className={btnDanger + " hp-btn-sm"} onClick={() => revokeInvite(i.id)}>Revogar</button></Td></tr>)}</Table></section>}
    <h2 className="text-xl mb-2">Pessoas com acesso</h2>
    <State loading={team.isLoading} error={team.error} empty={team.data?.length === 0} emptyText="Ninguém com acesso." />
    {team.data && team.data.length > 0 && <Table head={["Pessoa", "Papéis", "Estado", ""]}>{team.data.map((u) => <tr key={u.user_id}><Td><strong>{u.display_name}</strong><br /><span className="text-sm text-muted-foreground">{u.email}</span></Td>
      <Td><ul className="space-y-1">{u.roles.map((r) => <li key={r.id} className="text-sm">{ROLES[r.role]}{r.unit ? ` · ${r.unit}` : " · todas as unidades"} <button className="text-destructive ml-1" onClick={() => revokeRole(r.id)} aria-label={`Revogar ${ROLES[r.role]}`}>×</button></li>)}</ul></Td>
      <Td>{u.status === "active" ? "Ativo" : "Suspenso"}</Td><Td><button className={btnGhost + " hp-btn-sm mr-1"} onClick={() => rename(u)}>Renomear</button><button className={btnGhost + " hp-btn-sm"} onClick={() => toggle(u)}>{u.status === "active" ? "Suspender" : "Reativar"}</button></Td></tr>)}</Table>}
  </div>);
};
export default Team;
