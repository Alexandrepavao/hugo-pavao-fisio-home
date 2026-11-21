import { brl, fmtDate } from "@/lib/format";
import { brandLogoUrl } from "@/lib/org";
import type { PatientPayload } from "./api";
import "./ebook.css";

/** Instantâneo do e-book (migration 150). Tudo vem do servidor: a apresentação publicada, a oferta (produto da própria organização) e a marca. Nada fixo da HP no código. */
export interface EbookSnapshot {
  clinic: { name: string; logo_path?: string | null; color_primary?: string | null; support_email?: string | null; website_url?: string | null; is_default_brand?: boolean };
  patient: { first_name: string };
  professional: string | null;
  presentation: { version: number; content: PatientPayload };
  offer: { product_id: string; name: string; price_cents: number; sessions_count: number | null; validity_days: number | null; per_session_cents: number | null; consume_on_no_show: boolean | null; late_cancel_hours: number | null };
  payment_rule: string[];
  app: string[];
}
export interface EbookData { exists: boolean; version?: number; created_at?: string; snapshot?: EbookSnapshot; payment?: "no_contract" | "awaiting" | "confirmed"; enrollment_status?: "pending" | "active"; installments?: { no: number; due_date: string; amount_cents: number; status: string }[] }

const PAY_TEXT: Record<string, string> = { no_contract: "Contratação ainda não feita", awaiting: "Aguardando o pagamento da 1ª parcela", confirmed: "Pagamento confirmado — acompanhamento ativo" };
const REC_ST: Record<string, string> = { open: "Em aberto", partial: "Parcial", paid: "Paga", refunded: "Estornada", cancelled: "Cancelada" };
const short = (iso?: string | null) => (iso ? fmtDate(iso.length === 10 ? `${iso}T12:00:00Z` : iso) : null);

/** Documento do e-book (tela e impressão/PDF). `accessUrl` é o endereço de entrada da organização (nunca recebido do servidor/cliente arbitrário: montado pela tela). */
const EbookDocument = ({ data, accessUrl, patientView }: { data: EbookData; accessUrl: string; patientView?: boolean }) => {
  const s = data.snapshot; if (!data.exists || !s) return null;
  const c = s.presentation.content; const o = s.offer; const logo = brandLogoUrl(s.clinic.logo_path);
  const initials = s.clinic.name.split(/\s+/).filter(Boolean).slice(0, 2).map((w) => w[0]?.toUpperCase()).join("");
  const rows: [string, string | null][] = [["Há quanto tempo", c.reported.symptom_duration], ["Limitações no dia a dia", c.reported.limitations], ["O que você quer retomar", c.reported.activities]];
  return (
    <article className="eb" data-testid="ebook-doc" aria-label="E-book do seu acompanhamento">
      <header className="eb-cover">
        <div className="eb-brand">{logo ? <img src={logo} alt={s.clinic.name} /> : <span className="eb-mono" role="img" aria-label={s.clinic.name}>{initials}</span>}<b>{s.clinic.name}</b></div>
        <p className="eb-eyebrow">Seu acompanhamento personalizado</p>
        <h1 data-testid="ebook-title">{s.patient.first_name}, este é o seu plano de cuidado</h1>
        <p className="eb-sub">Preparado por {s.professional ?? "seu fisioterapeuta"} a partir da sua avaliação · versão {data.version} · {short(data.created_at)}</p>
      </header>

      <section className="eb-sec" data-testid="ebook-objetivo">
        <h2>1. Seu objetivo</h2>
        {c.goal ? <p className="eb-goal"><b>{c.goal.title}</b>{c.goal.target_date ? <span> · meta para {short(c.goal.target_date)}</span> : null}</p> : <p className="eb-tbd">A definir com seu fisioterapeuta</p>}
      </section>

      <section className="eb-sec" data-testid="ebook-partida">
        <h2>2. Seu ponto de partida</h2>
        <p><span className="eb-who">Relatado por você</span> {c.reported.complaint ?? <i className="eb-tbd">não informado</i>}</p>
        {rows.filter(([, v]) => v).map(([k, v]) => <p key={k}><span className="eb-k">{k}:</span> {v}</p>)}
        {c.assessed.condition_text && <p><span className="eb-who is-pro">{c.assessed.condition_kind === "hypothesis" ? "Hipótese em investigação" : "Avaliado pelo fisioterapeuta"}</span> {c.assessed.condition_text}</p>}
      </section>

      <section className="eb-sec" data-testid="ebook-plano">
        <h2>3. Como será o acompanhamento</h2>
        <dl className="eb-plan">
          <div><dt>Frequência</dt><dd>{c.plan.freq_per_week ? `${c.plan.freq_per_week}x por semana` : <i className="eb-tbd">a definir</i>}</dd></div>
          <div><dt>Duração prevista</dt><dd>{c.plan.duration_weeks ? `${c.plan.duration_weeks} semanas` : <i className="eb-tbd">a definir</i>}</dd></div>
          <div><dt>Rotina orientada</dt><dd>{c.plan.routine ?? <i className="eb-tbd">a definir</i>}</dd></div>
          <div><dt>Reavaliação</dt><dd>{c.plan.reassessment_on ? short(c.plan.reassessment_on) : <i className="eb-tbd">a definir com seu fisioterapeuta</i>}{c.plan.reassessment_criteria ? ` · ${c.plan.reassessment_criteria}` : ""}</dd></div>
        </dl>
        <p className="eb-note">O plano clínico é definido pelo fisioterapeuta; você participa das decisões. Este documento não substitui a avaliação clínica.</p>
      </section>

      {c.evidence.length > 0 && (
        <section className="eb-sec" data-testid="ebook-ciencia">
          <h2>4. A ciência por trás do plano</h2>
          <ul className="eb-ev">{c.evidence.map((e) => <li key={e.id}><b>{e.title}</b>{e.year ? ` (${e.year})` : ""}{e.relation ? <span className="eb-why"> — {e.relation}</span> : null}</li>)}</ul>
        </section>)}

      <section className="eb-sec eb-offer" data-testid="ebook-valores">
        <h2>{c.evidence.length > 0 ? "5" : "4"}. Investimento no seu acompanhamento</h2>
        <div className="eb-price"><span>{o.name}</span><b data-testid="ebook-preco">{brl(o.price_cents)}</b></div>
        <ul className="eb-facts">
          {o.sessions_count ? <li><b>{o.sessions_count}</b> sessões{o.per_session_cents ? ` · cerca de ${brl(o.per_session_cents)} por sessão` : ""}</li> : null}
          {o.validity_days ? <li>Validade do pacote: <b>{o.validity_days} dias</b></li> : null}
          {o.late_cancel_hours ? <li>Cancelamentos com menos de {o.late_cancel_hours} h de antecedência são tratados como sessão realizada</li> : null}
          {o.consume_on_no_show ? <li>Falta sem aviso consome uma sessão</li> : null}
        </ul>
        <p className="eb-note">Valor do dia em que este e-book foi gerado ({short(data.created_at)}). Forma e parcelas são combinadas com a clínica na contratação.</p>
      </section>

      <section className="eb-sec" data-testid="ebook-pagamento">
        <h2>{c.evidence.length > 0 ? "6" : "5"}. Como finalizar o pagamento</h2>
        <ol className="eb-steps">{s.payment_rule.map((t, i) => <li key={i}>{t}</li>)}</ol>
        {patientView && data.payment && <p className={`eb-status is-${data.payment}`} data-testid="ebook-status-pagamento">Situação agora: <b>{PAY_TEXT[data.payment]}</b></p>}
        {patientView && data.installments && data.installments.length > 0 && (
          <table className="eb-table" data-testid="ebook-parcelas"><thead><tr><th>Parcela</th><th>Vencimento</th><th>Valor</th><th>Situação</th></tr></thead>
            <tbody>{data.installments.map((p) => <tr key={p.no}><td>{p.no}/{data.installments!.length}</td><td>{short(p.due_date)}</td><td>{brl(p.amount_cents)}</td><td>{REC_ST[p.status] ?? p.status}</td></tr>)}</tbody></table>)}
      </section>

      <section className="eb-sec" data-testid="ebook-app">
        <h2>{c.evidence.length > 0 ? "7" : "6"}. Seu acesso ao aplicativo</h2>
        <ol className="eb-steps">{s.app.map((t, i) => <li key={i}>{t}</li>)}</ol>
        <p className="eb-access">Endereço de entrada: <b data-testid="ebook-link">{accessUrl}</b></p>
      </section>

      <footer className="eb-foot">{s.clinic.name}{s.clinic.support_email ? ` · ${s.clinic.support_email}` : ""}{s.clinic.website_url ? ` · ${s.clinic.website_url}` : ""}</footer>
    </article>
  );
};
export default EbookDocument;
