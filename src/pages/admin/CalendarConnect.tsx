import { useEffect, useState } from "react";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { useSearchParams } from "react-router-dom";
import { supabase } from "@/lib/supabase";
import { fmtDateTime } from "@/lib/format";
import { Badge, btnDanger, btnGhost, btnPrimary, confirmDialog, errText, Msg, useMsg } from "@/lib/ui";

type Detail = "minimal" | "names";
const FEED_BASE = `${import.meta.env.VITE_SUPABASE_URL}/functions/v1/calendar-feed`;
const DETAIL_TXT: Record<Detail, string> = { minimal: "Mínimo (“Atendimento HP” + unidade, sem nome de paciente) — recomendado", names: "Com primeiro nome do paciente e serviço" };
const GOOGLE_MSG: Record<string, [string, "ok" | "err"]> = {
  conectado: ["Google Calendar conectado. Clique em “Sincronizar agora” para a primeira sincronização.", "ok"], erro: ["Não foi possível concluir a conexão com o Google. Tente novamente.", "err"],
  permissao: ["A conexão exige a permissão de calendário solicitada. Autorize todas as permissões para conectar.", "err"], indisponivel: ["Conexão com o Google indisponível: as credenciais OAuth ainda não foram cadastradas no servidor.", "err"],
  estado: ["O pedido de conexão venceu ou já foi usado. Clique em “Conectar Google Calendar” para começar de novo.", "err"],
};

/** Conectar calendários do próprio usuário. (1) Assinatura somente leitura para Apple/iPhone e Google "por URL" — link secreto, revogável, mostrado UMA vez.
 *  (2) Google Calendar (OAuth): HP → Google num calendário "HP Group Hub" e Google → HP só como compromissos externos. Nada externo vira atendimento, cobrança ou sessão. */
const CalendarConnect = () => {
  const qc = useQueryClient(); const [msg, m] = useMsg(); const [sp, setSp] = useSearchParams();
  const [detail, setDetail] = useState<Detail>("minimal"); const [link, setLink] = useState<string | null>(null); const [busy, setBusy] = useState(false);
  const feed = useQuery({ queryKey: ["calendar-feed"], retry: false, queryFn: async () => { const { data, error } = await supabase.rpc("calendar_feed_status"); if (error) throw error; return (data as { active: boolean; detail: Detail | null; created_at: string | null; last_accessed_at: string | null }[])[0]; } });
  const google = useQuery({ queryKey: ["google-conn"], retry: false, queryFn: async () => { const { data, error } = await supabase.rpc("google_connection_status"); if (error) throw error; return (data as { connected: boolean; google_email: string | null; status: string | null; detail: Detail | null; last_sync_at: string | null; last_error: string | null }[])[0]; } });

  useEffect(() => { const g = sp.get("google"); if (g && GOOGLE_MSG[g]) { const [t, k] = GOOGLE_MSG[g]; if (k === "ok") m.ok(t); else m.err(t); const n = new URLSearchParams(sp); n.delete("google"); setSp(n, { replace: true }); void qc.invalidateQueries({ queryKey: ["google-conn"] }); } }, []); // eslint-disable-line react-hooks/exhaustive-deps
  const copy = async (t: string, what: string) => { try { await navigator.clipboard.writeText(t); m.ok(`${what} copiado.`); } catch { m.err("Não foi possível copiar automaticamente; selecione o texto e copie."); } };

  const createLink = async () => {
    if (feed.data?.active && !(await confirmDialog("Gerar um novo link?", "O link anterior deixa de funcionar e você precisará assinar o novo no seu calendário.", "Gerar novo link"))) return;
    setBusy(true); const { data, error } = await supabase.rpc("calendar_feed_create", { p_detail: detail }); setBusy(false);
    if (error) return m.err(errText(error)); setLink(`${FEED_BASE}?t=${data as string}`); m.ok("Link criado. Copie agora: por segurança ele não será mostrado de novo."); void qc.invalidateQueries({ queryKey: ["calendar-feed"] });
  };
  const revokeLink = async () => { if (!(await confirmDialog("Revogar o link de assinatura?", "Os calendários que o usam deixam de receber atualizações.", "Revogar", true))) return;
    const { error } = await supabase.rpc("calendar_feed_revoke"); if (error) return m.err(errText(error)); setLink(null); m.ok("Link revogado."); void qc.invalidateQueries({ queryKey: ["calendar-feed"] }); };

  const callGoogle = async (path: string) => {
    setBusy(true); const { data, error } = await supabase.functions.invoke(`google-calendar/${path}`, { method: "POST" }); setBusy(false);
    if (error) { const status = (error as { context?: { status?: number } }).context?.status; m.err(status === 503 ? "Conexão com o Google indisponível por configuração: as credenciais OAuth ainda não foram cadastradas no servidor." : status === 404 ? "A função google-calendar não está publicada neste projeto." : `Não foi possível concluir (${errText(error as never)}).`); return null; }
    return data as Record<string, unknown>;
  };
  const connect = async () => { const d = await callGoogle("start"); if (d?.url) window.location.assign(d.url as string); };
  const sync = async () => { const d = await callGoogle("sync"); if (d) { m.ok(`Sincronizado: ${d.pushed ?? 0} atendimento(s) enviado(s), ${d.removed ?? 0} removido(s), ${d.imported ?? 0} compromisso(s) externo(s) lido(s).`); void qc.invalidateQueries(); } };
  const disconnect = async () => { if (!(await confirmDialog("Desconectar o Google Calendar?", "Removemos o calendário “HP Group Hub” criado pelo app, revogamos o acesso e apagamos os compromissos externos importados. Seus eventos do Google não são tocados.", "Desconectar", true))) return;
    if (await callGoogle("disconnect")) { m.ok("Google Calendar desconectado."); void qc.invalidateQueries(); } };
  const setGoogleDetail = async (d: Detail) => { const { error } = await supabase.rpc("google_connection_set_detail", { p_detail: d }); if (error) m.err(errText(error)); else { m.ok("Nível de detalhe atualizado (vale na próxima sincronização)."); void qc.invalidateQueries({ queryKey: ["google-conn"] }); } };

  if (feed.error && google.error) return null;    // migration ainda não aplicada: o bloco não aparece
  const g = google.data;
  return (
    <section className="hp-card p-4 grid gap-6" aria-label="Conectar calendários">
      <div><h2 className="text-xl">Conectar calendários</h2><p className="text-xs text-muted-foreground">Cada pessoa conecta o próprio calendário. Compromissos externos <b>nunca</b> viram atendimento, cobrança ou consumo de sessão, e tarefas pessoais privadas <b>nunca</b> saem do HP.</p></div>
      <Msg m={msg} />

      {!feed.error && (
        <div><h3 className="font-medium">Calendário da Apple / iPhone e Google (assinatura) <Badge tone="info">Somente leitura</Badge></h3>
          <p className="text-sm text-muted-foreground mt-1">Mostra no seu calendário os atendimentos da sua agenda. <b>É uma assinatura, não sincronização bidirecional</b>: o que você alterar lá não volta para o HP, e o calendário atualiza no ritmo do aparelho (o Google pode levar várias horas). Remarcações e cancelamentos chegam como atualização do mesmo evento, sem duplicar.</p>
          {feed.data?.active && <p className="text-sm mt-2">Link ativo desde {fmtDateTime(feed.data.created_at)} · conteúdo: {feed.data.detail === "names" ? "com primeiro nome e serviço" : "mínimo"}{feed.data.last_accessed_at ? ` · última leitura ${fmtDateTime(feed.data.last_accessed_at)}` : " · ainda não usado"}.</p>}
          <div className="flex flex-wrap items-end gap-2 mt-3">
            <div><label htmlFor="cf-detail" className="block text-xs mb-1">O que aparece no evento</label><select id="cf-detail" className="!w-auto" value={detail} onChange={(e) => setDetail(e.target.value as Detail)}>{(Object.keys(DETAIL_TXT) as Detail[]).map((k) => <option key={k} value={k}>{DETAIL_TXT[k]}</option>)}</select></div>
            <button className={btnPrimary} onClick={createLink} disabled={busy}>{feed.data?.active ? "Gerar novo link" : "Gerar link de assinatura"}</button>
            {feed.data?.active && <button className={btnDanger} onClick={revokeLink}>Revogar link</button>}
          </div>
          {detail === "names" && <p className="text-xs text-destructive mt-2" role="note">Atenção: o primeiro nome do paciente e o serviço ficarão armazenados no provedor do seu calendário (Apple/Google). Prefira o conteúdo mínimo.</p>}
          {link && (
            <div className="mt-3 grid gap-2" role="status">
              <p className="text-sm font-medium">Seu link (mostrado uma única vez):</p>
              <input readOnly value={link} onFocus={(e) => e.currentTarget.select()} aria-label="Link de assinatura (https)" />
              <div className="flex flex-wrap gap-2"><button className={btnGhost} onClick={() => copy(link, "Link https")}>Copiar link (Google)</button><button className={btnGhost} onClick={() => copy(link.replace(/^https:/, "webcal:"), "Link webcal")}>Copiar link para iPhone/Apple (webcal)</button></div>
              <ul className="text-xs text-muted-foreground list-disc pl-5 grid gap-1">
                <li><b>iPhone:</b> Ajustes › Calendário › Contas › Adicionar conta › Outra › Adicionar calendário assinado › cole o link webcal.</li>
                <li><b>Mac:</b> Calendário › Arquivo › Nova assinatura de calendário.</li>
                <li><b>Google Agenda (web):</b> Outras agendas › + › Por URL › cole o link https.</li>
                <li>Quem tiver este link lê a sua agenda: não compartilhe. Se vazar, clique em “Revogar link”.</li>
              </ul>
            </div>)}
        </div>)}

      {!google.error && (
        <div><h3 className="font-medium">Google Calendar (sincronização) {g?.connected && <Badge tone={g.status === "active" ? "success" : "warning"}>{g.status === "active" ? "Conectado" : g.status === "revoked" ? "Acesso revogado" : "Com erro"}</Badge>}</h3>
          <ul className="text-sm text-muted-foreground list-disc pl-5 mt-1 grid gap-1">
            <li><b>HP → Google:</b> seus atendimentos aparecem num calendário <b>“HP Group Hub”</b> criado pelo app (o app só escreve nesse calendário, nunca no principal). Criação, remarcação e cancelamento são refletidos, sem duplicar. Editar esses eventos no Google <b>não</b> altera o atendimento.</li>
            <li><b>Google → HP:</b> seus compromissos do Google aparecem no “Meu dia” como <b>compromissos externos</b> (só você vê, só leitura). Eles <b>não</b> criam atendimento, cobrança nem consomem sessão.</li>
          </ul>
          {g?.connected ? (<>
            <p className="text-sm mt-2">{g.google_email ? `Conta: ${g.google_email} · ` : ""}{g.last_sync_at ? `última sincronização ${fmtDateTime(g.last_sync_at)}` : "ainda não sincronizado"}</p>
            {g.last_error && <p className="text-sm text-destructive" role="alert">{g.last_error}</p>}
            <div className="flex flex-wrap items-end gap-2 mt-3">
              <div><label htmlFor="gc-detail" className="block text-xs mb-1">O que aparece no evento do Google</label><select id="gc-detail" className="!w-auto" value={g.detail ?? "minimal"} onChange={(e) => setGoogleDetail(e.target.value as Detail)}>{(Object.keys(DETAIL_TXT) as Detail[]).map((k) => <option key={k} value={k}>{DETAIL_TXT[k]}</option>)}</select></div>
              <button className={btnPrimary} onClick={sync} disabled={busy}>Sincronizar agora</button>{g.status === "revoked" && <button className={btnGhost} onClick={connect} disabled={busy}>Conectar novamente</button>}
              <button className={btnDanger} onClick={disconnect} disabled={busy}>Desconectar</button>
            </div></>) : <div className="mt-3"><button className={btnPrimary} onClick={connect} disabled={busy}>Conectar Google Calendar</button></div>}
        </div>)}
    </section>
  );
};

export default CalendarConnect;
