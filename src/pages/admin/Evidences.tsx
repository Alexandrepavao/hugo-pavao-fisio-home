import { useState } from "react";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { Check, FlaskConical, RotateCcw, Archive } from "lucide-react";
import { Badge, btnGhost, btnPrimary, EmptyState, Msg, PageHead, State, Tabs, useMsg } from "@/lib/ui";
import { fmtDateTime } from "@/lib/format";
import { apiText, evidenceList, evidenceReview, type LibraryItem } from "@/pages/apresentacao/api";
import "@/pages/apresentacao/presentation.css";

const LABEL: Record<string, string> = { draft: "Em revisão", approved: "Aprovada", retired: "Aposentada" };

/** Revisão clínica da biblioteca de evidências (gestão). A biblioteca nasce vazia; nada é aprovado sem o revisor confirmar que conferiu a FONTE ORIGINAL. Só fichas aprovadas chegam ao paciente. */
const Evidences = () => {
  const qc = useQueryClient(); const [msg, m] = useMsg(); const [tab, setTab] = useState("draft"); const [checked, setChecked] = useState<Record<string, boolean>>({}); const [note, setNote] = useState<Record<string, string>>({});
  const q = useQuery({ queryKey: ["evidence-list"], retry: false, queryFn: () => evidenceList() });
  const rows = (q.data ?? []).filter((r) => r.status === tab);
  const act = async (r: LibraryItem, d: "approve" | "retire" | "reject") => {
    try { await evidenceReview(r.id, d, !!checked[r.id], note[r.id] || null); m.ok(d === "approve" ? "Ficha aprovada: já pode ser usada com pacientes." : d === "retire" ? "Ficha aposentada." : "Ficha devolvida para ajustes."); await qc.invalidateQueries({ queryKey: ["evidence-list"] }); }
    catch (e) { m.err(apiText(e)); }
  };
  return (
    <div className="grid gap-4" data-testid="evidences-admin">
      <PageHead eyebrow="Gestão" title="Biblioteca de evidências" hint="Revisão clínica das referências usadas nas apresentações. A biblioteca começa vazia: nenhuma referência é criada automaticamente." />
      <Msg m={msg} />
      <Tabs tabs={[["draft", `Para revisar (${(q.data ?? []).filter((r) => r.status === "draft").length})`], ["approved", "Aprovadas"], ["retired", "Aposentadas"]]} value={tab} onChange={setTab} />
      <State loading={q.isLoading} error={q.error ? new Error(apiText(q.error)) : undefined} />
      {!q.isLoading && rows.length === 0 && <EmptyState icon={FlaskConical} title={tab === "draft" ? "Nada para revisar" : "Nenhuma ficha aqui"}>{tab === "draft" ? "Quando uma fisioterapeuta propuser uma referência, ela aparece aqui para a revisão clínica." : "As fichas aprovadas ficam disponíveis para as apresentações."}</EmptyState>}
      {rows.map((r) => (
        <article key={r.id} className="pw-card" data-testid="evidence-row">
          <div className="flex flex-wrap items-center gap-2"><h2 className="font-semibold">{r.title}</h2><Badge tone={r.status === "approved" ? "info" : r.status === "retired" ? "neutral" : "warning"}>{LABEL[r.status]}</Badge><span className="pw-help">versão {r.version}</span></div>
          <p className="pw-help">{[r.authors, r.journal, r.year, r.design].filter(Boolean).join(" · ")}</p>
          <dl className="grid gap-1 text-sm">{([["Quem participou", r.population], ["O que foi comparado", r.comparison], ["Benefícios", r.benefits], ["Duração", r.duration], ["Seguimento", r.follow_up], ["Limitações", r.limitations]] as const).map(([k, v]) => v ? <div key={k}><dt className="inline font-semibold">{k}: </dt><dd className="inline">{v}</dd></div> : null)}</dl>
          <p className="text-sm"><a className="underline" href={r.url ?? `https://doi.org/${r.doi}`} target="_blank" rel="noopener noreferrer" data-testid="evidence-source">Abrir a fonte original</a>{r.doi && <span className="pw-help"> · DOI {r.doi}</span>}</p>
          {r.status === "approved" && <p className="pw-help">Aprovada em {fmtDateTime(r.reviewed_at)} · fonte conferida em {fmtDateTime(r.source_verified_at)}.</p>}
          {r.status === "draft" && (
            <div className="grid gap-2">
              <label className="flex items-center gap-2 text-sm"><input type="checkbox" checked={!!checked[r.id]} onChange={(e) => setChecked((c) => ({ ...c, [r.id]: e.target.checked }))} data-testid="evidence-checked" />Conferi a fonte original (DOI/link) e os dados desta ficha</label>
              <input className="hp-input" placeholder="Observação da revisão (opcional)" value={note[r.id] ?? ""} onChange={(e) => setNote((n) => ({ ...n, [r.id]: e.target.value }))} aria-label="Observação da revisão" />
              <div className="flex flex-wrap gap-2"><button type="button" className={btnPrimary} disabled={!checked[r.id]} onClick={() => void act(r, "approve")} data-testid="evidence-approve"><Check size={14} className="mr-1 inline" aria-hidden />Aprovar</button>
                <button type="button" className={btnGhost} onClick={() => void act(r, "reject")}><RotateCcw size={14} className="mr-1 inline" aria-hidden />Devolver para ajustes</button></div>
            </div>)}
          {r.status === "approved" && <div><button type="button" className={btnGhost} onClick={() => void act(r, "retire")}><Archive size={14} className="mr-1 inline" aria-hidden />Aposentar</button></div>}
        </article>))}
    </div>
  );
};
export default Evidences;
