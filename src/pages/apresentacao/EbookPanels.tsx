import { useState } from "react";
import { Link } from "react-router-dom";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { FileDown, FileText } from "lucide-react";
import { brl } from "@/lib/format";
import { btnGhost, btnPrimary, EmptyState, Msg, State, useMsg } from "@/lib/ui";
import { useOrgBase } from "@/org/useOrgBase";
import { apiText, ebookGenerate, ebookGet, ebookOptions, myEbook, type EbookOption } from "./api";
import EbookDocument from "./Ebook";

/** Endereço de entrada do aplicativo da organização (montado aqui, a partir da origem desta página e do slug validado; nunca vindo de dado digitado). */
const useAccessUrl = () => { const ob = useOrgBase(); return `${window.location.origin}${ob.to("/login")}`; };

/** Aba "6. E-book" da fisioterapeuta: escolhe o pacote, gera o e-book (versão imutável) e vê/baixa o documento. Só depois de publicar a apresentação. */
export const EbookTab = ({ enrollmentId, publishedVersion }: { enrollmentId: string; publishedVersion: number }) => {
  const qc = useQueryClient(); const [msg, m] = useMsg(); const [product, setProduct] = useState(""); const [busy, setBusy] = useState(false); const accessUrl = useAccessUrl();
  const opts = useQuery({ queryKey: ["ebook-options", enrollmentId], retry: false, queryFn: () => ebookOptions(enrollmentId) });
  const cur = useQuery({ queryKey: ["ebook", enrollmentId], retry: false, queryFn: () => ebookGet(enrollmentId) });
  const generate = async () => {
    setBusy(true);
    try { const r = await ebookGenerate(enrollmentId, product); m.ok(r.created ? `E-book versão ${r.version} gerado. O paciente o vê na área dele.` : "Nada mudou: este e-book já é o mais recente."); await qc.invalidateQueries({ queryKey: ["ebook", enrollmentId] }); }
    catch (e) { m.err(apiText(e)); } finally { setBusy(false); }
  };
  return (
    <div className="grid gap-3" data-testid="pw-ebook">
      <div className="pw-card">
        <h2 className="font-semibold">E-book do acompanhamento (proposta com valores e acesso ao aplicativo)</h2>
        {publishedVersion === 0 && <div className="pw-warn" data-testid="pw-ebook-needs-publish">Publique a apresentação antes de gerar o e-book: ele usa exatamente o que o paciente vê.</div>}
        <p className="text-sm">Reúne objetivo, ponto de partida, plano, ciência, o <b>valor do pacote escolhido</b>, como o pagamento ativa o acompanhamento e como acessar o aplicativo. Cada geração cria uma versão; o paciente lê a mais recente.</p>
        <Msg m={msg} />
        <State loading={opts.isLoading} error={opts.error ? new Error(apiText(opts.error)) : undefined} />
        <div className="flex flex-wrap items-end gap-2">
          <label className="text-sm"><span className="block text-xs text-muted-foreground mb-1">Pacote oferecido</span>
            <select data-testid="pw-ebook-product" value={product} onChange={(e) => setProduct(e.target.value)} className="hp-input"><option value="">Escolha…</option>{opts.data?.map((o: EbookOption) => <option key={o.id} value={o.id}>{o.name} — {brl(o.price_cents)}{o.sessions_count ? ` · ${o.sessions_count} sessões` : ""}</option>)}</select></label>
          <button type="button" className={btnPrimary} disabled={!product || busy || publishedVersion === 0} onClick={() => void generate()} data-testid="pw-ebook-generate"><FileText size={14} className="mr-1 inline" aria-hidden />Gerar e-book</button>
        </div>
        {opts.data && opts.data.length === 0 && <p className="text-sm text-muted-foreground" data-testid="pw-ebook-no-products">Nenhum pacote ativo com valor cadastrado. Peça à gestão para cadastrar em Configurações ▸ Operação.</p>}
      </div>
      {cur.data?.exists && (<>
        <div className="flex flex-wrap items-center gap-2 print:hidden"><span className="text-sm" data-testid="pw-ebook-version">Versão atual: <b>{cur.data.version}</b></span>
          <button type="button" className={btnGhost} onClick={() => window.print()} data-testid="pw-ebook-print"><FileDown size={14} className="mr-1 inline" aria-hidden />Salvar em PDF / imprimir</button></div>
        <EbookDocument data={cur.data} accessUrl={accessUrl} />
      </>)}
    </div>
  );
};

/** /paciente/ebook — o último e-book, lido pelo PRÓPRIO paciente, com o andamento atual do pagamento e as parcelas da contratação. */
export const PatientEbook = () => {
  const accessUrl = useAccessUrl(); const q = useQuery({ queryKey: ["my-ebook"], retry: false, queryFn: myEbook });
  return (
    <div className="mx-auto grid max-w-4xl gap-3" data-testid="patient-ebook">
      <State loading={q.isLoading} error={q.error ? new Error("Não foi possível carregar o e-book.") : undefined} />
      {q.data && !q.data.exists && <EmptyState title="Seu e-book ainda não foi gerado" action={<Link to="/paciente" className="hp-btn hp-btn-outline">Voltar ao início</Link>}>Depois da apresentação, o seu fisioterapeuta gera aqui o resumo com o plano, os valores e como acessar o aplicativo.</EmptyState>}
      {q.data?.exists && (<>
        <div className="print:hidden"><button type="button" className={btnGhost} onClick={() => window.print()} data-testid="patient-ebook-print"><FileDown size={14} className="mr-1 inline" aria-hidden />Salvar em PDF / imprimir</button></div>
        <EbookDocument data={q.data} accessUrl={accessUrl} patientView />
      </>)}
    </div>
  );
};
