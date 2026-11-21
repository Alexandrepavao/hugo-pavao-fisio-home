import { useEffect, useState } from "react";
import { Link, useNavigate, useParams, useSearchParams } from "react-router-dom";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { CheckCircle2, FileText, RefreshCw } from "lucide-react";
import { brl, fmtDateTime } from "@/lib/format";
import { btnGhost, btnPrimary, EmptyState, Msg, State, useMsg } from "@/lib/ui";
import { apiText, deckApprove, deckExportLog, deckGet, deckGenerate, deckOptions, deckRead, deckUpdate, myDeck, myDeckRespond, type DeckOption } from "@/pages/apresentacao/api";
import { SELECTION_LABEL, type DeckSelection } from "./deckModel";
import DeckViewer from "./DeckViewer";
import { ensureDeckFonts } from "./fonts";

/** Endereço do aplicativo para os links do PDF: origem desta página (nunca recebida do servidor ou digitada) + base da organização. A identificação da proposta é o id; o acesso exige login. */
const useAppBase = () => window.location.origin;

/** Aba "6. Apresentação PDF": gerar rascunho → revisar (o que entra, oferta) → aprovar versão → visualizar → exportar. */
export const DeckTab = ({ enrollmentId, publishedVersion }: { enrollmentId: string; publishedVersion: number }) => {
  const qc = useQueryClient(); const nav = useNavigate(); const [msg, m] = useMsg(); const appBase = useAppBase(); const [product, setProduct] = useState("");
  const st = useQuery({ queryKey: ["deck", enrollmentId], retry: false, queryFn: () => deckGet(enrollmentId) });
  const opts = useQuery({ queryKey: ["deck-options", enrollmentId], retry: false, queryFn: () => deckOptions(enrollmentId) });
  const refresh = () => qc.invalidateQueries({ queryKey: ["deck", enrollmentId] });
  const wrap = (f: () => Promise<unknown>, ok: string) => async () => { try { await f(); m.ok(ok); await refresh(); } catch (e) { m.err(apiText(e)); } };
  const gen = useMutation({ mutationFn: () => deckGenerate(enrollmentId, product || null) });
  const draft = st.data?.draft ?? null;
  useEffect(() => { if (draft) setProduct(draft.offer?.product_id ?? ""); }, [draft?.id, draft?.offer?.product_id]); // eslint-disable-line react-hooks/exhaustive-deps
  const toggle = (k: keyof DeckSelection) => async () => { if (!draft) return; try { await deckUpdate(draft.id, { [k]: !draft.selection[k] }, undefined, false); await refresh(); } catch (e) { m.err(apiText(e)); } };
  const chooseProduct = async (id: string) => { setProduct(id); if (!draft) return; try { await deckUpdate(draft.id, null, id || undefined, !id); await refresh(); } catch (e) { m.err(apiText(e)); } };
  const hasEv = (draft?.snapshot.presentation.content.evidence ?? []).length > 0;
  return (
    <div className="grid gap-3" data-testid="pw-deck">
      <div className="pw-card">
        <h2 className="font-semibold">Apresentação em PDF (16:9) para o paciente</h2>
        <p className="text-sm">Fluxo: <b>gerar rascunho</b> (retrato da avaliação e da apresentação publicada) → <b>revisar</b> (escolher o que entra e a oferta) → <b>aprovar versão</b> (fica congelada) → <b>visualizar</b> → <b>exportar PDF</b>. Anotações internas nunca entram; nada é enviado ao paciente sozinho.</p>
        {publishedVersion === 0 && <div className="pw-warn" data-testid="pw-deck-needs-publish">Publique a apresentação (aba 5) antes de gerar: o documento usa exatamente o que o paciente já pode ver.</div>}
        <Msg m={msg} /><State loading={st.isLoading} error={st.error ? new Error(apiText(st.error)) : undefined} />
        {!draft && <div className="flex flex-wrap items-end gap-2"><button type="button" className={btnPrimary} disabled={publishedVersion === 0 || gen.isPending} onClick={() => void wrap(async () => { await gen.mutateAsync(); }, "Rascunho gerado a partir da avaliação.")()} data-testid="pw-deck-generate"><FileText size={14} className="mr-1 inline" aria-hidden />Gerar rascunho</button></div>}
      </div>

      {draft && (<>
        <div className="pw-card" data-testid="pw-deck-review">
          <h3 className="font-semibold">Revisão do rascunho <span className="text-xs font-normal text-muted-foreground">· dados de {fmtDateTime(draft.snapshot.generated_at)}</span></h3>
          <fieldset className="grid gap-1 sm:grid-cols-2"><legend className="text-xs text-muted-foreground mb-1">O que entra no documento</legend>
            {(Object.keys(SELECTION_LABEL) as (keyof DeckSelection)[]).map((k) => (
              <label key={k} className="flex items-center gap-2 text-sm !font-normal"><input type="checkbox" checked={draft.selection[k]} disabled={(k === "evidence" && !hasEv) || (k === "commercial" && !draft.offer)} onChange={() => void toggle(k)()} data-testid={`pw-deck-sel-${k}`} />{SELECTION_LABEL[k]}{k === "evidence" && !hasEv ? " — nenhuma ficha aprovada escolhida (a página não é criada)" : ""}</label>))}
          </fieldset>
          <div className="mt-2 flex flex-wrap items-end gap-2">
            <label className="text-sm"><span className="block text-xs text-muted-foreground mb-1">Produto para as condições comerciais (opcional)</span>
              <select className="hp-input" value={product} onChange={(e) => void chooseProduct(e.target.value)} data-testid="pw-deck-product"><option value="">Sem valores neste documento</option>{opts.data?.map((o: DeckOption) => <option key={o.id} value={o.id}>{o.name} — {brl(o.price_cents)}{o.sessions_count ? ` · ${o.sessions_count} sessões` : ""}</option>)}</select></label>
            <button type="button" className={btnGhost} onClick={() => void wrap(async () => { await gen.mutateAsync(); }, "Rascunho refeito com os dados atuais.")()} data-testid="pw-deck-regenerate"><RefreshCw size={14} className="mr-1 inline" aria-hidden />Atualizar com os dados atuais</button>
            <button type="button" className={btnPrimary} onClick={() => void wrap(() => deckApprove(draft.id), "Versão aprovada. Ela agora é um retrato: mudanças futuras não a alteram.")()} data-testid="pw-deck-approve"><CheckCircle2 size={14} className="mr-1 inline" aria-hidden />Aprovar versão</button>
          </div>
          <p className="pw-help">O rascunho é só para revisão: o paciente <b>não</b> o vê. Aprovar não envia nada, não cria venda nem ativa o paciente.</p>
        </div>
        <div data-testid="pw-deck-preview"><DeckViewer d={draft} ctx={{ appBase, interactive: false }} /></div>
      </>)}

      <div className="pw-card" data-testid="pw-deck-versions">
        <h3 className="font-semibold">Versões aprovadas</h3>
        {!st.data?.versions.length ? <p className="text-sm text-muted-foreground">Nenhuma versão aprovada ainda.</p> : <ul className="grid gap-2">{st.data.versions.map((v) => (
          <li key={v.id} className="flex flex-wrap items-center gap-2 text-sm" data-testid="pw-deck-version"><b>Versão {v.version}</b><span className="text-muted-foreground">aprovada em {fmtDateTime(v.approved_at)} · impressão digital {v.content_hash.slice(0, 10)}</span>{v.status === "superseded" && <span className="text-xs">substituída</span>}
            <button type="button" className={btnGhost + " h-8 text-xs"} onClick={() => nav(`/apresentacao/proposta/${v.id}`)} data-testid="pw-deck-open">Visualizar</button>
            <button type="button" className={btnGhost + " h-8 text-xs"} onClick={() => nav(`/apresentacao/proposta/${v.id}?imprimir=1`)} data-testid="pw-deck-pdf">Exportar PDF</button></li>))}</ul>}
      </div>
    </div>
  );
};

/** /apresentacao/proposta/:deckId — versão (aprovada) ou rascunho, vista pela equipe com vínculo; exportar registra o evento. */
export const DeckPage = () => {
  const { deckId = "" } = useParams(); const appBase = useAppBase(); const [sp] = useSearchParams();
  const q = useQuery({ queryKey: ["deck-read", deckId], retry: false, queryFn: () => deckRead(deckId) });
  useEffect(() => { if (q.data && sp.get("imprimir") === "1") { void deckExportLog(q.data.id).catch(() => undefined); let t: ReturnType<typeof setTimeout> | undefined; void ensureDeckFonts().then(() => { t = setTimeout(() => window.print(), 1200); }); return () => clearTimeout(t); } }, [q.data, sp]);
  return (
    <div className="mx-auto max-w-6xl p-4" data-testid="deck-page">
      <div className="mb-2 print:hidden"><button type="button" className={btnGhost} onClick={() => history.back()}>← Voltar</button></div>
      <State loading={q.isLoading} error={q.error ? new Error(apiText(q.error)) : undefined} />
      {q.data && <DeckViewer d={q.data} ctx={{ appBase, interactive: false }} onExport={() => void deckExportLog(q.data!.id).catch(() => undefined)} />}
    </div>
  );
};

/** /paciente/proposta — a ÚLTIMA versão aprovada, lida pelo próprio paciente. "Próximo passo" só registra interesse na equipe. */
export const PatientDeck = () => {
  const qc = useQueryClient(); const appBase = useAppBase(); const [sp] = useSearchParams(); const [msg, m] = useMsg();
  const q = useQuery({ queryKey: ["my-deck"], retry: false, queryFn: myDeck });
  const respond = async (c: "questions" | "start") => { if (!q.data?.deck) return; try { await myDeckRespond(q.data.deck.id, c); m.ok("Recebemos o seu pedido: a equipe vai falar com você. Nada foi contratado nem cobrado."); await qc.invalidateQueries({ queryKey: ["my-deck"] }); } catch (e) { m.err(apiText(e)); } };
  const d = q.data;
  return (
    <div className="mx-auto max-w-6xl" data-testid="patient-deck">
      <State loading={q.isLoading} error={q.error ? new Error("Não foi possível carregar a sua proposta.") : undefined} />
      {d && !d.exists && <EmptyState title="Sua apresentação ainda não foi liberada" action={<Link to="/paciente" className="hp-btn hp-btn-outline">Voltar ao início</Link>}>Depois da avaliação, o seu fisioterapeuta aprova aqui o plano de cuidado personalizado.</EmptyState>}
      {d?.exists && d.deck && (<><Msg m={msg} />
        <DeckViewer d={d.deck} startAtEnd={!!sp.get("acao")} ctx={{ appBase, interactive: true, onRespond: (c) => void respond(c), live: { payment: d.payment, installments: d.installments, responded: d.responded, enrollment_status: d.enrollment_status } }} /></>)}
    </div>
  );
};
