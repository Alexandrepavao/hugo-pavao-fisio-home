import { useEffect, useState } from "react";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { useSearchParams } from "react-router-dom";
import { supabase } from "@/lib/supabase";
import { fmtDateTime } from "@/lib/format";
import { Badge, btnDanger, btnGhost, btnPrimary, confirmDialog, errText, Msg, useMsg } from "@/lib/ui";

type Detail = "minimal" | "names";
const DETAIL_TXT: Record<Detail, string> = { minimal: "Mínimo (“Atendimento HP” + unidade, sem nome de paciente) — recomendado", names: "Com primeiro nome do paciente e serviço" };
const GOOGLE_MSG: Record<string, [string, "ok" | "err"]> = {
  conectado: ["Google Calendar conectado. Seus atendimentos já estão sendo enviados para o calendário “HP Group Hub”.", "ok"], erro: ["Não foi possível concluir a conexão com o Google. Tente novamente.", "err"],
  permissao: ["A conexão exige as permissões de calendário solicitadas. Autorize todas para conectar.", "err"], indisponivel: ["Conexão com o Google indisponível: as credenciais OAuth ainda não foram cadastradas no servidor.", "err"],
  estado: ["O pedido de conexão venceu ou já foi usado. Clique em “Conectar Google Calendar” para começar de novo.", "err"],
};
const STATUS: Record<string, [string, "success" | "warning" | "danger"]> = { active: ["Conectado", "success"], error: ["Conectado com erro na última sincronização", "warning"], revoked: ["Acesso revogado — conecte novamente", "danger"] };

/** Google Calendar do próprio usuário (Meu dia). Cada pessoa autoriza a SUA conta; os tokens ficam protegidos no servidor e o navegador só vê o status.
 *  HP → Google: criação, remarcação e cancelamento dos atendimentos da sua agenda vão sozinhos para o calendário “HP Group Hub” criado pelo app.
 *  Google → HP: seus compromissos aparecem no Meu dia só como “externos” (nunca viram atendimento, cobrança ou sessão). Tarefas pessoais e dados clínicos nunca saem do HP. */
const CalendarConnect = () => {
  const qc = useQueryClient(); const [msg, m] = useMsg(); const [sp, setSp] = useSearchParams(); const [busy, setBusy] = useState(false);
  const google = useQuery({ queryKey: ["google-conn"], retry: false, queryFn: async () => { const { data, error } = await supabase.rpc("google_connection_status"); if (error) throw error; return (data as { connected: boolean; google_email: string | null; status: string | null; detail: Detail | null; last_sync_at: string | null; last_error: string | null }[])[0]; } });

  useEffect(() => { const g = sp.get("google"); if (g && GOOGLE_MSG[g]) { const [t, k] = GOOGLE_MSG[g]; if (k === "ok") m.ok(t); else m.err(t); const n = new URLSearchParams(sp); n.delete("google"); setSp(n, { replace: true }); void qc.invalidateQueries({ queryKey: ["google-conn"] }); } }, []); // eslint-disable-line react-hooks/exhaustive-deps

  const callGoogle = async (path: string) => {
    setBusy(true); const { data, error } = await supabase.functions.invoke(`google-calendar/${path}`, { method: "POST" }); setBusy(false);
    if (error) { const status = (error as { context?: { status?: number } }).context?.status; m.err(status === 503 ? "Conexão com o Google indisponível por configuração: as credenciais OAuth ainda não foram cadastradas no servidor." : status === 404 ? "A função google-calendar não está publicada neste projeto." : `Não foi possível concluir agora (${status ?? "sem resposta"}). Tente novamente em instantes.`); return null; }
    return data as Record<string, unknown>;
  };
  const connect = async () => { const d = await callGoogle("start"); if (d?.url) window.location.assign(d.url as string); };
  const sync = async () => { const d = await callGoogle("sync"); if (d) { m.ok(`Sincronizado: ${d.pushed ?? 0} atendimento(s) enviado(s), ${d.removed ?? 0} removido(s), ${d.imported ?? 0} compromisso(s) externo(s) lido(s).`); void qc.invalidateQueries(); } };
  const disconnect = async () => { if (!(await confirmDialog("Desconectar o Google Calendar?", "Removemos o calendário “HP Group Hub” criado pelo app, revogamos o acesso e apagamos os compromissos externos importados. Seus eventos do Google não são tocados.", "Desconectar", true))) return;
    if (await callGoogle("disconnect")) { m.ok("Google Calendar desconectado."); void qc.invalidateQueries(); } };
  const setDetail = async (d: Detail) => { const { error } = await supabase.rpc("google_connection_set_detail", { p_detail: d }); if (error) m.err(errText(error)); else { m.ok("Nível de detalhe atualizado (vale na próxima sincronização)."); void qc.invalidateQueries({ queryKey: ["google-conn"] }); } };

  if (google.error) return null;    // migration ainda não aplicada: o bloco não aparece
  const g = google.data; const st = g?.status ? STATUS[g.status] : null;
  return (
    <section className="hp-card p-4 grid gap-4" aria-label="Google Calendar">
      <div><h2 className="text-xl">Google Calendar</h2><p className="text-xs text-muted-foreground">Cada pessoa conecta a própria conta Google e autoriza individualmente. Compromissos externos <b>nunca</b> viram atendimento, cobrança ou consumo de sessão, e tarefas pessoais e dados clínicos <b>nunca</b> saem do HP.</p></div>
      <Msg m={msg} />
      <ul className="text-sm text-muted-foreground list-disc pl-5 grid gap-1">
        <li><b>HP → Google:</b> seus atendimentos aparecem num calendário <b>“HP Group Hub”</b> criado pelo app (o app só escreve nele, nunca no seu calendário principal). <b>Criação, remarcação e cancelamento são enviados automaticamente</b>, sem duplicar. Editar esses eventos no Google <b>não</b> altera o atendimento.</li>
        <li><b>Google → HP:</b> seus compromissos do Google aparecem no “Meu dia” como <b>compromissos externos</b> (só você vê, só leitura).</li>
        <li>Por padrão o evento mostra só “Atendimento HP” e a unidade — sem nome de paciente.</li>
      </ul>
      {g?.connected ? (<>
        <div className="flex flex-wrap items-center gap-2 text-sm">{st && <Badge tone={st[1]}>{st[0]}</Badge>}<span>{g.google_email ? `Conta: ${g.google_email} · ` : ""}{g.last_sync_at ? `última sincronização ${fmtDateTime(g.last_sync_at)}` : "ainda não sincronizado"}</span></div>
        {g.last_error && <p className="text-sm text-destructive" role="alert">{g.last_error}</p>}
        <div className="flex flex-wrap items-end gap-2">
          <div><label htmlFor="gc-detail" className="block text-xs mb-1">O que aparece no evento do Google</label><select id="gc-detail" className="!w-auto" value={g.detail ?? "minimal"} onChange={(e) => setDetail(e.target.value as Detail)}>{(Object.keys(DETAIL_TXT) as Detail[]).map((k) => <option key={k} value={k}>{DETAIL_TXT[k]}</option>)}</select></div>
          {g.status === "revoked" ? <button className={btnPrimary} onClick={connect} disabled={busy}>Conectar novamente</button> : <button className={btnGhost} onClick={sync} disabled={busy}>Sincronizar agora</button>}
          <button className={btnDanger} onClick={disconnect} disabled={busy}>Desconectar</button>
        </div>
        {g.detail === "names" && <p className="text-xs text-destructive" role="note">Atenção: o primeiro nome do paciente e o serviço ficam guardados no Google. Prefira o conteúdo mínimo.</p>}
      </>) : <div><button className={btnPrimary} onClick={connect} disabled={busy}>Conectar Google Calendar</button><p className="text-xs text-muted-foreground mt-2">Você será levado ao Google para escolher sua conta e autorizar; depois volta para cá.</p></div>}
    </section>
  );
};

export default CalendarConnect;
