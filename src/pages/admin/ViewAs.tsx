import { useState } from "react";
import { useQuery } from "@tanstack/react-query";
import { useSearchParams } from "react-router-dom";
import { Eye } from "lucide-react";
import { supabase } from "@/lib/supabase";
import { fmtDateTime } from "@/lib/format";
import { Badge, Msg, PageHead, State, Table, Td, Tabs, errText, useMsg } from "@/lib/ui";
import { setViewAsSession, viewAsHome, type ViewAsInfo, VIEW_AS_KIND_LABEL } from "@/lib/viewAs";

interface Target { user_id: string; person_id: string | null; name: string | null; email: string | null; last_sign_in_at: string | null }
interface SessionRow { id: string; viewer: string; target: string | null; kind: "physio" | "patient"; started_at: string; ended_at: string | null; ended_reason: string | null; expires_at: string }

/** Ver como (só o gestor): abre o app do fisioterapeuta ou do paciente exatamente como essa pessoa vê, SOMENTE LEITURA. Cada sessão fica registrada. */
const ViewAs = () => {
  const [kind, setKind] = useState<"physio" | "patient">("physio"); const [q, setQ] = useState(""); const [busy, setBusy] = useState<string | null>(null);
  const [msg, m] = useMsg(); const [sp] = useSearchParams();
  const targets = useQuery({ queryKey: ["view-as-targets", kind, q], queryFn: async () => {
    const { data, error } = await supabase.rpc("view_as_targets", { p_kind: kind, p_q: q || null, p_limit: 100 }); if (error) throw error; return (data ?? []) as Target[];
  } });
  const recent = useQuery({ queryKey: ["view-as-recent"], queryFn: async () => {
    const { data, error } = await supabase.rpc("view_as_sessions_recent", { p_limit: 20 }); if (error) throw error; return (data ?? []) as SessionRow[];
  } });
  const start = async (t: Target) => {
    setBusy(t.user_id);
    const { data, error } = await supabase.rpc("view_as_start", { p_target: t.user_id });
    if (error) { setBusy(null); return m.err(errText(error)); }
    const info = data as ViewAsInfo; setViewAsSession(info.session_id);
    window.location.assign(viewAsHome(info.kind));   // recarrega já como a pessoa vista
  };
  const sem = (v: string | null) => v ?? "—";

  return (
    <div>
      <PageHead eyebrow="Gestão" title="Ver como" hint="Veja o app do fisioterapeuta ou do paciente exatamente como essa pessoa vê. Somente leitura: nada é gravado em nome dela. Cada sessão fica registrada." />
      {sp.get("sessao") === "expirada" && <p role="alert" className="hp-card p-3 text-sm mb-4" data-testid="view-as-expirou">A sessão de “ver como” terminou ou foi encerrada. Abra outra se precisar.</p>}
      <Msg m={msg} />
      <div className="hp-card p-4 mb-5 text-sm grid gap-1.5" data-testid="view-as-regras">
        <p><b>Como funciona:</b> você entra no app da pessoa e vê as mesmas telas e os mesmos dados, mas <b>nenhuma ação é gravada</b> (agendar, registrar sessão, responder check-in e outras ficam bloqueadas pelo servidor).</p>
        <p><b>Quem aparece:</b> só fisioterapeutas e pacientes que já têm acesso ao app. A sessão dura até 4 horas e vale só nesta aba; o botão laranja no topo volta para este painel.</p>
        <p><b>Paciente:</b> você vê tudo o que o paciente vê, inclusive dor, evolução e treinos (dado de saúde); o acesso fica registrado no histórico de acessos clínicos.</p>
      </div>
      <Tabs tabs={[["physio", "Fisioterapeutas"], ["patient", "Pacientes"]]} value={kind} onChange={(v) => setKind(v as "physio" | "patient")} />
      <div className="my-3 max-w-sm"><label htmlFor="va-q" className="sr-only">Buscar por nome ou e-mail</label><input id="va-q" value={q} onChange={(e) => setQ(e.target.value)} placeholder="Buscar por nome ou e-mail" /></div>
      <State loading={targets.isLoading} error={targets.error} empty={targets.data?.length === 0} emptyText={`Nenhum ${kind === "physio" ? "fisioterapeuta" : "paciente"} com acesso ao app${q ? " para essa busca" : ""}.`} />
      {targets.data && targets.data.length > 0 && (
        <Table head={["Nome", "E-mail", "Último acesso", ""]}>
          {targets.data.map((t) => (
            <tr key={t.user_id} data-testid="view-as-alvo">
              <Td><span className="font-medium">{sem(t.name)}</span></Td><Td>{sem(t.email)}</Td><Td>{t.last_sign_in_at ? fmtDateTime(t.last_sign_in_at) : "Nunca entrou"}</Td>
              <Td><button type="button" className="hp-btn hp-btn-outline hp-btn-sm" disabled={busy !== null} onClick={() => void start(t)} aria-label={`Ver como ${t.name ?? t.email ?? "pessoa"}`}><Eye size={14} aria-hidden />Ver como</button></Td>
            </tr>))}
        </Table>)}

      <h2 className="text-base font-medium mt-8 mb-2">Últimas sessões de “ver como”</h2>
      <State loading={recent.isLoading} error={recent.error} empty={recent.data?.length === 0} emptyText="Nenhuma sessão ainda." />
      {recent.data && recent.data.length > 0 && (
        <Table head={["Quem viu", "Como quem", "Tipo", "Início", "Fim"]}>
          {recent.data.map((s) => (
            <tr key={s.id} data-testid="view-as-sessao">
              <Td>{s.viewer}</Td><Td>{sem(s.target)}</Td><Td>{VIEW_AS_KIND_LABEL[s.kind]}</Td><Td>{fmtDateTime(s.started_at)}</Td>
              <Td>{s.ended_at ? <>{fmtDateTime(s.ended_at)} <span className="text-xs text-muted-foreground">({s.ended_reason})</span></> : new Date(s.expires_at) > new Date() ? <Badge tone="warning">Em andamento</Badge> : <Badge>Expirada</Badge>}</Td>
            </tr>))}
        </Table>)}
    </div>
  );
};
export default ViewAs;
