import { useCallback, useEffect, useRef, useState } from "react";
import { Link, useNavigate, useParams, useSearchParams } from "react-router-dom";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { CheckCircle2, FileText, Presentation, RefreshCw, X } from "lucide-react";
import { brl, fmtDateTime } from "@/lib/format";
import { btnGhost, btnPrimary, confirmDialog, EmptyState, inputCls, Msg, State, useMsg } from "@/lib/ui";
import { apiText, deckQuoteUpdate, presentationPublish, type QuoteInput, deckApprove, deckExportLog, deckGet, deckGenerate, deckOptions, deckRead, deckUpdate, myDeck, myDeckRespond, type DeckOption } from "@/pages/apresentacao/api";
import { PAY_METHOD_LABEL, SELECTION_LABEL, type DeckData, type DeckSelection } from "./deckModel";
import DeckViewer from "./DeckViewer";
import { ensureDeckFonts } from "./fonts";

/** Endereço do aplicativo para os links do PDF: origem desta página (nunca recebida do servidor ou digitada) + base da organização. A identificação da proposta é o id; o acesso exige login. */
const useAppBase = () => window.location.origin;

/** Modo de apresentação ao vivo: o fisioterapeuta mostra o documento ao paciente em tela cheia (Esc ou "Fechar" volta à revisão). Mostra o RASCUNHO gerado agora; o paciente só recebe a versão aprovada. */
const LiveDeck = ({ d, appBase, onClose }: { d: import("./deckModel").DeckData; appBase: string; onClose: () => void }) => {
  const ref = useRef<HTMLDivElement>(null);
  useEffect(() => {
    const el = ref.current; void el?.requestFullscreen?.().catch(() => undefined);   // sem tela cheia (negada/indisponível): continua como camada que cobre a tela
    const onKey = (e: KeyboardEvent) => { if (e.key === "Escape") onClose(); }; const onFs = () => { if (!document.fullscreenElement) onClose(); };
    window.addEventListener("keydown", onKey); document.addEventListener("fullscreenchange", onFs);
    return () => { window.removeEventListener("keydown", onKey); document.removeEventListener("fullscreenchange", onFs); if (document.fullscreenElement) void document.exitFullscreen().catch(() => undefined); };
  }, [onClose]);
  return (
    <div ref={ref} className="deck-live" role="dialog" aria-label="Apresentação ao vivo" data-testid="deck-live">
      <button type="button" className="absolute right-3 top-3 z-10 rounded-full border border-white/40 p-2 text-white" onClick={onClose} aria-label="Fechar apresentação" data-testid="deck-live-close"><X size={18} aria-hidden /></button>
      <DeckViewer d={d} presenter ctx={{ appBase, interactive: false }} />
    </div>
  );
};

/** Aba "6. Apresentação PDF": gerar rascunho → revisar (o que entra, oferta) → aprovar versão → visualizar → exportar. */
const reais = (c: number) => (c / 100).toFixed(2).replace(".", ",");
const toCents = (t: string) => { const n = Number(t.replace(/\./g, "").replace(",", ".")); return Number.isFinite(n) && n >= 0 ? Math.round(n * 100) : null; };

/** Orçamento do documento: produtos e preços EXISTENTES; quantidade, desconto (até o máximo autorizado no produto), parcelas, vencimento, formas e validade. Não cria venda nem lançamento. */
const QuoteEditor = ({ d, onDraft }: { d: DeckData; onDraft: () => void }) => {
  const o = d.offer; const [msg, m] = useMsg(); const [busy, setBusy] = useState(false);
  const [disc, setDisc] = useState(o ? reais(o.discount_cents ?? 0) : "0,00");
  useEffect(() => { if (o) setDisc(reais(o.discount_cents ?? 0)); }, [o?.discount_cents, d.id]); // eslint-disable-line react-hooks/exhaustive-deps
  if (!o || o.total_cents == null) return null;
  const send = async (q: QuoteInput) => { setBusy(true); try { await deckQuoteUpdate(d.id, q); onDraft(); m.ok("Orçamento recalculado."); } catch (e) { m.err(apiText(e)); } finally { setBusy(false); } };
  const cur = (): QuoteInput => ({ quantity: o.quantity, quantity_source: o.quantity_source, discount_cents: o.discount_cents ?? 0, installments_count: o.installments_count ?? 1, first_due: o.first_due ?? null, payment_methods: o.payment_methods ?? ["pix"], valid_until: o.valid_until ?? null });
  const methods = o.payment_methods ?? [];
  return (
    <div className="grid gap-2" data-testid="pw-quote">
      <h4 className="font-semibold">Orçamento</h4>
      <p className="pw-help">Valores vêm do cadastro de produtos. O orçamento não gera venda nem cobrança: a venda segue pelo fluxo atual (CRM ▸ converter em venda), e o paciente só é ativado com a 1ª parcela quitada.</p>
      <Msg m={msg} />
      <div className="pw-grid">
        <div className="pw-field"><label htmlFor="q-qty">Quantidade {o.quantity_source === "auto" ? "(automática)" : "(manual)"}</label>
          <div className="flex gap-2"><input id="q-qty" type="number" min={1} max={200} className={inputCls} value={o.quantity ?? 1} onChange={(e) => void send({ ...cur(), quantity: Number(e.target.value) || 1, quantity_source: "manual" })} data-testid="pw-quote-qty" />
            {o.quantity_source === "manual" && <button type="button" className={btnGhost} onClick={() => void send({ ...cur(), quantity_source: "auto" })}>Voltar ao automático</button>}</div></div>
        <div className="pw-field"><label htmlFor="q-disc">Desconto (R$) — máximo autorizado: {o.discount_max_pct ?? 0}%</label>
          <input id="q-disc" className={inputCls} inputMode="decimal" value={disc} onChange={(e) => setDisc(e.target.value)} onBlur={() => { const c = toCents(disc); if (c == null) return m.err("Valor de desconto inválido."); if (c !== (o.discount_cents ?? 0)) void send({ ...cur(), discount_cents: c }); }} data-testid="pw-quote-discount" /></div>
        <div className="pw-field"><label htmlFor="q-inst">Parcelas</label><select id="q-inst" className={inputCls} value={o.installments_count ?? 1} onChange={(e) => void send({ ...cur(), installments_count: Number(e.target.value) })} data-testid="pw-quote-installments">{Array.from({ length: 12 }, (_, i) => i + 1).map((n) => <option key={n} value={n}>{n === 1 ? "À vista" : `${n}x`}</option>)}</select></div>
        <div className="pw-field"><label htmlFor="q-due">1º vencimento</label><input id="q-due" type="date" className={inputCls} value={o.first_due ?? ""} onChange={(e) => void send({ ...cur(), first_due: e.target.value || null })} data-testid="pw-quote-due" /></div>
        <div className="pw-field"><label htmlFor="q-valid">Proposta válida até</label><input id="q-valid" type="date" className={inputCls} value={o.valid_until ?? ""} onChange={(e) => void send({ ...cur(), valid_until: e.target.value || null })} data-testid="pw-quote-valid" /></div>
      </div>
      <fieldset className="flex flex-wrap gap-3"><legend className="text-xs text-muted-foreground mb-1">Formas de pagamento oferecidas</legend>{Object.entries(PAY_METHOD_LABEL).map(([k, l]) => <label key={k} className="flex items-center gap-2 text-sm !font-normal"><input type="checkbox" checked={methods.includes(k)} disabled={busy || (methods.length === 1 && methods[0] === k)} onChange={() => void send({ ...cur(), payment_methods: methods.includes(k) ? methods.filter((x) => x !== k) : [...methods, k] })} data-testid={`pw-quote-method-${k}`} />{l}</label>)}</fieldset>
      <p className="text-sm" data-testid="pw-quote-summary">Subtotal <b>{brl(o.subtotal_cents ?? 0)}</b> · desconto <b>{brl(o.discount_cents ?? 0)}</b> · total <b data-testid="pw-quote-total">{brl(o.total_cents)}</b>{(o.installments ?? []).length > 1 ? ` · ${(o.installments ?? []).length}x de ${brl((o.installments ?? [])[0].amount_cents)}` : " · à vista"}</p>
      {o.discount_adjusted && <div className="pw-warn" data-testid="pw-quote-adjusted">O plano mudou e o desconto anterior passou do máximo autorizado para este produto: ele foi reduzido ao limite. Confira o total.</div>}
      {o.plan_mismatch && <div className="pw-warn" data-testid="pw-quote-mismatch">O produto cobre {o.sessions_covered} sessões e o plano inicial propõe {o.plan_sessions}. Confira: o documento mostra os dois números, sem fingir que são iguais.</div>}
    </div>
  );
};

export const DeckTab = ({ enrollmentId, presentationId, publishedVersion, unpublished, canPublish, onPublished }: { enrollmentId: string; presentationId: string; publishedVersion: number; unpublished: boolean; canPublish: boolean; onPublished: () => void }) => {
  const qc = useQueryClient(); const nav = useNavigate(); const [msg, m] = useMsg(); const appBase = useAppBase(); const [product, setProduct] = useState("");
  const st = useQuery({ queryKey: ["deck", enrollmentId], retry: false, queryFn: () => deckGet(enrollmentId) });
  const opts = useQuery({ queryKey: ["deck-options", enrollmentId], retry: false, queryFn: () => deckOptions(enrollmentId) });
  const refresh = () => qc.invalidateQueries({ queryKey: ["deck", enrollmentId] });
  const wrap = (f: () => Promise<unknown>, ok: string) => async () => { try { await f(); m.ok(ok); await refresh(); } catch (e) { m.err(apiText(e)); } };
  const gen = useMutation({ mutationFn: () => deckGenerate(enrollmentId, product || null) });
  const [live, setLive] = useState<import("./deckModel").DeckData | null>(null); const closeLive = useCallback(() => setLive(null), []);
  const startLive = async () => {
    try {
      // a apresentação é gerada a partir da versão PUBLICADA: se há alterações (ou nada publicado), publica antes, com confirmação
      if (publishedVersion === 0 || unpublished) {
        if (!canPublish) { m.err("Complete a avaliação (área, queixa e objetivo) antes de gerar a apresentação."); return; }
        if (!(await confirmDialog("Publicar e gerar a apresentação?", "As alterações da avaliação serão publicadas para o paciente (sem as suas anotações internas) e a apresentação será gerada a partir delas.", "Publicar e gerar"))) return;
        await presentationPublish(presentationId); onPublished();
      }
      const d = await gen.mutateAsync(); await refresh(); setLive(d);
    } catch (e) { m.err(apiText(e)); }
  };   // puxa os dados atuais da avaliação, gera o rascunho com a seleção padrão e abre em tela cheia
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
        {publishedVersion === 0 && <div className="pw-warn" data-testid="pw-deck-needs-publish">{canPublish ? "Ainda não há apresentação publicada: ao gerar, ela será publicada antes (com a sua confirmação), porque o documento usa exatamente o que o paciente pode ver." : "Complete a avaliação (área, queixa e objetivo) para poder gerar a apresentação."}</div>}{publishedVersion > 0 && unpublished && <div className="pw-warn" data-testid="pw-deck-unpublished">Há alterações na avaliação ainda não publicadas: ao gerar, elas serão publicadas antes (com a sua confirmação).</div>}
        <Msg m={msg} /><State loading={st.isLoading} error={st.error ? new Error(apiText(st.error)) : undefined} />
        <div className="flex flex-wrap items-center gap-2"><button type="button" className={btnPrimary} disabled={gen.isPending || (publishedVersion === 0 && !canPublish)} onClick={() => void startLive()} data-testid="pw-deck-live"><Presentation size={14} className="mr-1 inline" aria-hidden />Gerar apresentação para mostrar ao paciente</button><span className="text-xs text-muted-foreground">Usa os dados que você acabou de registrar, gera o rascunho e abre em tela cheia. Depois você revisa e aprova a versão que o paciente recebe.</span></div>
        {!draft && <div className="flex flex-wrap items-end gap-2"><button type="button" className={btnPrimary} disabled={publishedVersion === 0 || gen.isPending} onClick={() => void wrap(async () => { await gen.mutateAsync(); }, "Rascunho gerado a partir da avaliação.")()} data-testid="pw-deck-generate"><FileText size={14} className="mr-1 inline" aria-hidden />Gerar rascunho</button></div>}
      </div>

      {live && <LiveDeck d={live} appBase={appBase} onClose={closeLive} />}
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
        {draft.offer && <div className="pw-card"><QuoteEditor d={draft} onDraft={() => void refresh()} /></div>}
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
