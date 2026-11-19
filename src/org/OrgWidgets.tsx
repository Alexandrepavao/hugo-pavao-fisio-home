import { useState } from "react";
import { useQuery } from "@tanstack/react-query";
import { Link } from "react-router-dom";
import { Check } from "lucide-react";
import { DropdownMenuItem, DropdownMenuLabel, DropdownMenuSeparator } from "@/components/ui/dropdown-menu";
import { supabase } from "@/lib/supabase";
import { getActiveOrg, switchOrganization } from "@/lib/org";
import { btnPrimary, errText } from "@/lib/ui";
import { useOrg } from "./OrgProvider";

interface Invite { id: string; org_name: string; role: string; expires_at: string }

/** Convites pendentes para quem JÁ tem conta: o vínculo é aceito com o login atual (sem duplicar conta e sem tocar na senha). */
export const PendingInvitations = () => {
  const [err, setErr] = useState(""); const [busy, setBusy] = useState(false);
  const q = useQuery({ queryKey: ["my-pending-invitations"], queryFn: async () => { const { data, error } = await supabase.rpc("my_pending_invitations"); if (error) throw error; return data as Invite[]; } });
  if (!q.data?.length) return null;
  const accept = async (i: Invite) => {
    setBusy(true); setErr("");
    const { data, error } = await supabase.rpc("invitation_accept", { p_id: i.id }); setBusy(false);
    if (error) return setErr(errText(error));
    const orgId = (data as { org_id?: string } | null)?.org_id; if (orgId) switchOrganization(orgId); else window.location.assign("/admin");
  };
  return (
    <div className="mt-6 text-left" data-testid="convites-pendentes"><p className="font-semibold mb-2">Convites para você</p>
      {err && <p role="alert" className="text-sm text-destructive mb-2">{err}</p>}
      <ul className="grid gap-2">{q.data.map((i) => <li key={i.id} className="hp-card p-3 flex items-center gap-3"><span className="flex-1 text-sm"><strong>{i.org_name}</strong><span className="block text-xs text-muted-foreground">função: {i.role}</span></span>
        <button className={btnPrimary + " h-8 text-xs"} disabled={busy} onClick={() => void accept(i)}>Aceitar convite</button></li>)}</ul></div>
  );
};

/** Itens do menu do perfil: trocar de organização (quando há mais de uma), gestão da organização e área da plataforma. A troca recarrega tudo (nada da anterior fica em memória). */
export const OrgMenuItems = () => {
  const org = useOrg(); const active = org.ctx?.org?.id ?? getActiveOrg();
  const invites = useQuery({ queryKey: ["my-pending-invitations"], queryFn: async () => { const { data } = await supabase.rpc("my_pending_invitations"); return (data ?? []) as Invite[]; } });
  const many = org.memberships.length > 1;
  if (!many && !org.platformAdmin && !invites.data?.length) return null;
  return (<>
    <DropdownMenuSeparator />
    {many && <><DropdownMenuLabel>Organização</DropdownMenuLabel>
      {org.memberships.map((m) => <DropdownMenuItem key={m.org_id} onSelect={() => { if (m.org_id !== active) switchOrganization(m.org_id); }} data-testid={`switch-${m.slug}`}>
        <span className="flex-1">{m.name}</span>{m.org_id === active && <Check size={14} aria-label="organização ativa" />}</DropdownMenuItem>)}</>}
    {!!invites.data?.length && <DropdownMenuItem asChild><Link to="/admin/convites">Convites pendentes ({invites.data.length})</Link></DropdownMenuItem>}
    {org.platformAdmin && <DropdownMenuItem asChild><Link to="/plataforma">Plataforma</Link></DropdownMenuItem>}
  </>);
};

export const InvitationsPage = () => (
  <div className="max-w-xl"><h2 className="text-2xl font-extrabold mb-4">Convites</h2><PendingInvitations />
    <p className="text-sm text-muted-foreground mt-4">Aceitar um convite adiciona a organização à sua conta; você continua com a mesma senha e escolhe a organização no menu do perfil.</p></div>
);
