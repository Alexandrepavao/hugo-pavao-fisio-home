import { useState } from "react";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { supabase } from "@/lib/supabase";
import { fmtDate, fmtDateTime } from "@/lib/format";
import { Badge, btnGhost, confirmDialog, Msg, State, useMsg } from "@/lib/ui";
import { rpcReauth } from "./reauth";
import { KIND_LABEL, useActing } from "./acting";

interface Rep { id: string; name: string; kind: string; status: string; active: boolean; suspended: boolean; valid_until: string | null; accepted: boolean; can_revoke: boolean }
interface Consent { kind: "saude" | "imagem_video" | "comunicacao_comercial"; granted: boolean; version: string | null; at: string | null; in_name_of: boolean }
interface ConsentText { kind: Consent["kind"]; version: string; body: string; is_draft: boolean }
interface Access { at: string; role: "admin" | "professional"; scope: string; who: string }
const CONSENT_LABEL: Record<Consent["kind"], string> = { saude: "Tratamento dos meus dados de saúde", imagem_video: "Uso de fotos e vídeos do meu acompanhamento", comunicacao_comercial: "Receber propostas de programas e serviços" };

/** Quem tem acesso à conta/aos dados desta pessoa (cuidadores, pessoa de confiança, responsáveis) e como encerrar ou aceitar. */
export const RepresentativesSection = () => {
  const qc = useQueryClient(); const [msg, m] = useMsg(); const { acting } = useActing();
  const q = useQuery({ queryKey: ["my-representatives", acting], retry: false, queryFn: async () => { const { data, error } = await supabase.rpc("my_representatives"); if (error) throw error; return (data ?? []) as Rep[]; } });
  const act = async (fn: string, id: string, ok: string, args: Record<string, unknown> = {}) => {
    const r = await rpcReauth(fn, { p_id: id, ...args }); if (r.error) return m.err(r.error); m.ok(ok); void qc.invalidateQueries({ queryKey: ["my-representatives"] });
  };
  return (
    <section className="mb-10" aria-label="Quem tem acesso">
      <h2 className="mb-1 text-xl">Quem tem acesso ao acompanhamento</h2>
      <p className="mb-3 text-sm text-muted-foreground">Responsáveis, cuidadores e pessoas de confiança que a clínica cadastrou. Cuidadores e pessoas de confiança só passam a valer depois do <b>seu aceite</b> e podem ser encerrados por você a qualquer momento.</p>
      <Msg m={msg} /><State loading={q.isLoading} error={q.error} empty={q.data?.length === 0} emptyText="Ninguém além de você tem acesso." />
      <ul className="grid gap-2">{q.data?.map((r) => (
        <li key={r.id} className="hp-card flex flex-wrap items-center justify-between gap-2 p-3 text-sm">
          <span><b>{r.name}</b> <span className="text-muted-foreground">· {KIND_LABEL[r.kind] ?? r.kind}{r.valid_until ? ` · até ${fmtDate(r.valid_until + "T12:00:00Z")}` : ""}</span></span>
          <span className="flex flex-wrap items-center gap-2">
            {r.suspended ? <Badge tone="danger">Suspenso</Badge> : r.active ? <Badge tone="success">Ativo</Badge> : r.status === "pending" ? <Badge tone="warning">Aguardando verificação da clínica</Badge> : !r.accepted && r.can_revoke ? <Badge tone="warning">Aguardando seu aceite</Badge> : <Badge>Inativo</Badge>}
            {r.can_revoke && !r.accepted && r.status !== "pending" && <button className={btnGhost + " hp-btn-sm"} onClick={() => act("my_representation_accept", r.id, "Aceite registrado.")}>Aceitar</button>}
            {r.can_revoke && <button className={btnGhost + " hp-btn-sm"} onClick={async () => { if (await confirmDialog("Encerrar este acesso?", `${r.name} deixará de ver e de agir em seu nome imediatamente.`, "Encerrar", true)) await act("representation_revoke", r.id, "Acesso encerrado.", { p_reason: "encerrado pelo titular" }); }}>Encerrar acesso</button>}
          </span>
        </li>))}</ul>
    </section>
  );
};

/** Consentimentos separados e revogáveis; cada mudança pede a senha e fica registrada com texto, versão e (se for o caso) “em nome de”. */
export const ConsentsSection = () => {
  const qc = useQueryClient(); const [msg, m] = useMsg(); const { acting } = useActing(); const [open, setOpen] = useState<string | null>(null);
  const cs = useQuery({ queryKey: ["my-consents", acting], retry: false, queryFn: async () => { const { data, error } = await supabase.rpc("my_consents"); if (error) throw error; return (data ?? []) as Consent[]; } });
  const tx = useQuery({ queryKey: ["consent-texts"], staleTime: 10 * 60_000, queryFn: async () => ((await supabase.rpc("consent_texts_current")).data ?? []) as ConsentText[] });
  const set = async (c: Consent, granted: boolean) => {
    const t = tx.data?.find((x) => x.kind === c.kind); if (!t) return m.err("Texto de consentimento indisponível.");
    const r = await rpcReauth("consent_set", { p_kind: c.kind, p_granted: granted, p_version: t.version }); if (r.error) return m.err(r.error);
    m.ok(granted ? "Consentimento registrado." : "Consentimento revogado."); void qc.invalidateQueries({ queryKey: ["my-consents"] });
  };
  return (
    <section className="mb-10" aria-label="Consentimentos">
      <h2 className="mb-1 text-xl">Meus consentimentos</h2>
      <p className="mb-3 text-sm text-muted-foreground">Você decide o que autoriza e pode mudar de ideia quando quiser. Cada escolha fica registrada com data, versão do texto e quem a fez.</p>
      <Msg m={msg} /><State loading={cs.isLoading} error={cs.error} />
      <ul className="grid gap-2">{cs.data?.map((c) => { const t = tx.data?.find((x) => x.kind === c.kind); return (
        <li key={c.kind} className="hp-card p-3 text-sm" data-testid={`consent-${c.kind}`}>
          <div className="flex flex-wrap items-center justify-between gap-2">
            <span><b>{CONSENT_LABEL[c.kind]}</b>{c.at && <span className="text-muted-foreground"> · {c.granted ? "concedido" : "revogado"} em {fmtDateTime(c.at)}{c.in_name_of ? " (por um responsável)" : ""}</span>}</span>
            <span className="flex items-center gap-2"><Badge tone={c.granted ? "success" : "neutral"}>{c.granted ? "Concedido" : "Não concedido"}</Badge>
              <button className={btnGhost + " hp-btn-sm"} onClick={() => set(c, !c.granted)}>{c.granted ? "Revogar" : "Conceder"}</button>
              <button className="text-accent text-xs" onClick={() => setOpen(open === c.kind ? null : c.kind)}>{open === c.kind ? "Ocultar texto" : "Ler texto"}</button></span>
          </div>
          {open === c.kind && t && <p className="mt-2 whitespace-pre-line rounded bg-muted p-2 text-xs">{t.body}{t.is_draft && "\n\n(Texto em revisão jurídica — versão provisória.)"}</p>}
        </li>); })}</ul>
    </section>
  );
};

/** Quem abriu o prontuário (administração e fisioterapeutas), com data e hora. */
export const AccessLogSection = () => {
  const { acting } = useActing();
  const q = useQuery({ queryKey: ["my-access-log", acting], retry: false, queryFn: async () => { const { data, error } = await supabase.rpc("my_access_log"); if (error) throw error; return (data ?? []) as Access[]; } });
  return (
    <section className="mb-10" aria-label="Quem acessou meu prontuário">
      <h2 className="mb-1 text-xl">Quem acessou o prontuário</h2>
      <p className="mb-3 text-sm text-muted-foreground">Toda leitura do seu registro clínico pela administração ou por fisioterapeutas fica anotada aqui.</p>
      <State loading={q.isLoading} error={q.error} empty={q.data?.length === 0} emptyText="Nenhum acesso registrado ainda." />
      <ul className="grid gap-1 text-sm">{q.data?.map((a, i) => <li key={a.at + i} className="hp-card flex flex-wrap justify-between gap-2 px-3 py-2"><span>{a.who} <span className="text-muted-foreground">· {a.role === "admin" ? "administração" : "fisioterapeuta"}</span></span><span className="text-muted-foreground">{fmtDateTime(a.at)}</span></li>)}</ul>
    </section>
  );
};

/** Para quem representa outras pessoas: situação de cada vínculo (a escolha de “quem está usando” fica no menu da conta). */
export const RepresentedSection = () => {
  const { reps, acting, switchTo } = useActing();
  if (reps.length === 0) return null;
  return (
    <section className="mb-10" aria-label="Pessoas que eu represento">
      <h2 className="mb-1 text-xl">Pessoas que eu represento</h2>
      <p className="mb-3 text-sm text-muted-foreground">Você pode usar o aplicativo em nome destas pessoas enquanto o vínculo estiver ativo.</p>
      <ul className="grid gap-2">{reps.map((r) => (
        <li key={r.id} className="hp-card flex flex-wrap items-center justify-between gap-2 p-3 text-sm"><span><b>{r.patient_name}</b> <span className="text-muted-foreground">· {KIND_LABEL[r.kind] ?? r.kind}</span></span>
          <span className="flex items-center gap-2">{r.suspended ? <Badge tone="danger">Suspenso pela clínica</Badge> : r.active ? <Badge tone="success">Ativo</Badge> : <Badge tone="warning">{r.status === "pending" ? "Aguardando verificação da clínica" : "Inativo"}</Badge>}
            {r.active && acting !== r.patient_person_id && <button className={btnGhost + " hp-btn-sm"} onClick={() => switchTo(r.patient_person_id)}>Usar em nome dele(a)</button>}</span></li>))}</ul>
    </section>
  );
};
