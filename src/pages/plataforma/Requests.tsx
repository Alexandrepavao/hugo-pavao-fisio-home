import { useState } from "react";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { Link, useParams } from "react-router-dom";
import { Badge, btnGhost, btnPrimary, Msg, PageHead, State, Table, Td, useMsg } from "@/lib/ui";
import { fmtDateTime } from "@/lib/format";
import { supabase } from "@/lib/supabase";
import { fmtMs, prpc, REQ_STATUS, STEP_LABEL } from "./api";

interface ReqRow { id: string; key: string; status: string; org_id: string | null; company: string | null; segment: string | null; created_at: string; finished_at: string | null; attempts: number }
interface ReqDetail {
  id: string; status: string; org_id: string | null; attempts: number; last_error: string | null; created_at: string; submitted_at: string | null; started_at: string | null; finished_at: string | null; internal_ms: number;
  steps: { step: string; status: string; attempts: number; error: string | null; ms: number | null }[]; pending: { key: string; label: string; external?: boolean }[]; admin_invite: { state: string; error?: string | null; at?: string };
  answers_summary: { company: string | null; segment: string | null; subdomain: string | null };
}
const INVITE_TEXT: Record<string, string> = { not_sent: "Convite ainda não enviado", sent: "Convite enviado — aguardando primeiro acesso", notified: "Administrador já tem conta — aviso enviado; ele aceita o vínculo ao entrar", failed: "Falha no envio do convite", accepted: "Administrador já acessou" };
const TERMINAL = ["available", "available_with_pending", "failed", "failed_recoverable", "draft"];

export const RequestList = () => {
  const q = useQuery({ queryKey: ["plat-requests"], queryFn: () => prpc<ReqRow[]>("provisioning_list"), refetchInterval: 8000 });
  return (
    <div>
      <PageHead eyebrow="Plataforma" title="Provisionamento" hint="Solicitações de criação de ambientes. Cada etapa é retomável e registra tempo e erro; falha em serviço externo não desfaz o que já foi criado." actions={<Link to="/plataforma/criar" className={btnPrimary}>Criar aplicativo</Link>} />
      <State loading={q.isLoading} error={q.error} empty={q.data?.length === 0} emptyText="Nenhuma solicitação ainda." />
      {q.data && q.data.length > 0 && (
        <Table head={["Empresa", "Segmento", "Estado", "Criada em", "Tentativas", ""]}>
          {q.data.map((r) => { const s = REQ_STATUS[r.status] ?? { label: r.status, tone: "neutral" as const };
            return (<tr key={r.id}><Td><strong>{r.company ?? "(rascunho)"}</strong></Td><Td>{r.segment ?? "—"}</Td><Td><Badge tone={s.tone}>{s.label}</Badge></Td><Td>{fmtDateTime(r.created_at)}</Td><Td num>{r.attempts}</Td>
              <Td>{r.status === "draft" ? <Link className={btnGhost + " h-8 text-xs"} to={`/plataforma/criar?rascunho=${encodeURIComponent(r.key)}`}>Continuar</Link> : <Link className={btnGhost + " h-8 text-xs"} to={`/plataforma/solicitacoes/${r.id}`}>Abrir</Link>}</Td></tr>); })}
        </Table>
      )}
    </div>
  );
};

export const RequestDetailPage = () => {
  const { id = "" } = useParams(); const qc = useQueryClient(); const [msg, m] = useMsg(); const [busy, setBusy] = useState(false);
  const q = useQuery({ queryKey: ["plat-request", id], queryFn: () => prpc<ReqDetail>("provisioning_get", { p_id: id }), refetchInterval: (query) => (query.state.data && TERMINAL.includes(query.state.data.status) ? false : 2000) });
  const d = q.data;
  const retry = async () => { setBusy(true); try { await prpc("provisioning_retry", { p_id: id }); m.ok("Nova tentativa executada."); await qc.invalidateQueries({ queryKey: ["plat-request", id] }); } catch (e) { m.err((e as Error).message); } finally { setBusy(false); } };
  const invite = async () => {
    setBusy(true);
    try {
      const { data, error } = await supabase.functions.invoke("provisioning-invite", { body: { request_id: id } });
      if (error) {
        let text = "Não foi possível enviar o convite."; try { const body = await (error as { context?: Response }).context?.json(); if (body?.message) text = body.message; } catch { /* mantém o texto padrão */ }
        m.err(text);
      } else m.ok(data?.status === "sent" ? "Convite enviado ao administrador." : data?.status === "notified" ? "Aviso enviado: o administrador já tem conta e aceita o vínculo ao entrar." : `Resultado: ${data?.status}`);
      await qc.invalidateQueries({ queryKey: ["plat-request", id] });
    } finally { setBusy(false); }
  };
  const s = d ? REQ_STATUS[d.status] ?? { label: d.status, tone: "neutral" as const } : null;
  return (
    <div>
      <PageHead eyebrow="Provisionamento" title={d?.answers_summary.company ?? "Solicitação"} hint={d ? `${d.answers_summary.segment ?? ""} · endereço ${d.answers_summary.subdomain ?? "—"}.localhost` : undefined} actions={<Link to="/plataforma/solicitacoes" className={btnGhost}>Todas as solicitações</Link>} />
      <Msg m={msg} /><State loading={q.isLoading} error={q.error} />
      {d && s && (
        <div className="grid gap-5 lg:grid-cols-2">
          <section className="hp-card p-4" aria-label="Estado" data-testid="request-state">
            <div className="flex items-center gap-2 mb-3"><Badge tone={s.tone}>{s.label}</Badge><span className="text-xs text-muted-foreground">tentativa(s): {d.attempts}</span></div>
            {d.last_error && <p role="alert" className="text-sm text-destructive mb-3">{d.last_error}</p>}
            <dl className="grid gap-1 text-sm grid-cols-[10rem_1fr]">
              <dt className="text-muted-foreground">Tempo interno</dt><dd className="tabular" data-testid="internal-ms">{fmtMs(d.internal_ms)} <span className="text-xs text-muted-foreground">(soma das etapas)</span></dd>
              <dt className="text-muted-foreground">Concluída em</dt><dd className="tabular">{d.finished_at ? fmtDateTime(d.finished_at) : "—"}</dd>
              <dt className="text-muted-foreground">Espera externa</dt><dd>não medida aqui (e-mail, aceite do convite, DNS)</dd>
              <dt className="text-muted-foreground">Convite</dt><dd data-testid="invite-state">{INVITE_TEXT[d.admin_invite?.state] ?? d.admin_invite?.state}{d.admin_invite?.error ? ` (${d.admin_invite.error})` : ""}</dd>
            </dl>
            <div className="flex flex-wrap gap-2 mt-4">
              {["failed_recoverable", "failed", "queued"].includes(d.status) && <button className={btnPrimary} disabled={busy} onClick={() => void retry()} data-testid="retry">Tentar de novo</button>}
              {["available", "available_with_pending"].includes(d.status) && d.admin_invite?.state !== "accepted" && <button className={btnGhost} disabled={busy} onClick={() => void invite()} data-testid="enviar-convite">{d.admin_invite?.state === "sent" ? "Reenviar convite" : "Enviar convite ao administrador"}</button>}
            </div>
          </section>
          <section className="hp-card p-4" aria-label="Etapas">
            <h3 className="font-semibold mb-2">Etapas</h3>
            <ol className="grid gap-1.5 text-sm" data-testid="steps">{d.steps.map((st) => (
              <li key={st.step} className="flex items-center gap-2"><Badge tone={st.status === "done" ? "success" : st.status === "failed" ? "danger" : st.status === "running" ? "info" : "neutral"}>{st.status === "done" ? "ok" : st.status === "failed" ? "falhou" : st.status === "running" ? "em curso" : "pendente"}</Badge>
                <span className="flex-1">{STEP_LABEL[st.step] ?? st.step}</span><span className="tabular text-xs text-muted-foreground">{fmtMs(st.ms)}</span>{st.error && <span className="text-xs text-destructive">{st.error}</span>}</li>))}
              {!d.steps.length && <li className="text-muted-foreground">Ainda não iniciada.</li>}</ol>
          </section>
          {d.pending.length > 0 && <section className="hp-card p-4 lg:col-span-2" aria-label="Pendências" data-testid="pendencias"><h3 className="font-semibold mb-2">Pendências após a criação</h3>
            <ul className="grid gap-1 text-sm">{d.pending.map((p) => <li key={p.key} className="flex gap-2"><Badge tone={p.external ? "warning" : "neutral"}>{p.external ? "externa" : "da clínica"}</Badge>{p.label}</li>)}</ul></section>}
        </div>
      )}
    </div>
  );
};
