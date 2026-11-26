import { useLayoutEffect, useRef, useState, type ReactNode } from "react";
import { deckFontsLoaded, ensureDeckFonts } from "./fonts";
import type { DeckData } from "./deckModel";
import type { Series } from "@/portal/Evolution";
import { fmtDate } from "@/lib/format";

/** Peças reutilizáveis da apresentação: página, cartão de vidro, indicador, etapas, celular, chamadas e gráfico. Estilos em deck.css (tokens t-*, glass, phone). */
export const SLIDE_W = 1280, SLIDE_H = 720;
export const short = (iso?: string | null) => (iso ? fmtDate(iso.length === 10 ? `${iso}T12:00:00Z` : iso) : null);
export const DEMO_TEXT = "Exemplo ilustrativo · paciente fictício";

/** Página: seção, título, conteúdo e rodapé com paginação real (n / total). */
export const Page = ({ n, total, d, tone = "cream", title, eyebrow, children, className = "" }: { n: number; total: number; d: DeckData; tone?: "cream" | "navy"; title?: ReactNode; eyebrow?: string; children: ReactNode; className?: string }) => (
  <section className={`slide is-${tone} ${className}`} data-testid={`slide-${n}`} aria-label={eyebrow}>
    <div className="slide-flow"><PageHead eyebrow={eyebrow} title={title} />{children}</div>
    <PageFoot d={d} n={n} total={total} />
  </section>
);
/** Cabeçalho posicionado à parte para poder ficar em coluna estreita quando há celular. */
export const PageHead = ({ eyebrow, title, sub }: { eyebrow?: string; title?: ReactNode; sub?: ReactNode }) => (
  <header className="page-head">{eyebrow && <p className="t-eyebrow">{eyebrow}</p>}{title && <h2 className="t-title">{title}</h2>}{sub && <p className="t-sub">{sub}</p>}</header>
);
export const PageFoot = ({ d, n, total }: { d: DeckData; n: number; total: number }) => (
  <footer className="slide-foot"><span className="t-label">{d.snapshot.clinic.name}</span>{d.is_demo ? <b className="slide-demo">{DEMO_TEXT}</b> : <span />}<span className="t-label">{n} / {total}</span></footer>
);

/** Cartão de vidro. Claro sobre fundo claro; escuro sobre azul-marinho/foto. Acabamento estático (preenchimento, borda, brilho superior, sombra) — o desfoque é só um reforço na tela. */
export const Glass = ({ children, tone = "light", className = "", testid, as: Tag = "div", ...rest }: { children: ReactNode; tone?: "light" | "dark" | "tint"; className?: string; testid?: string; as?: "div" | "section" | "article" | "blockquote" } & Record<string, unknown>) => (
  <Tag className={`glass is-${tone} ${className}`} data-testid={testid} {...rest}>{children}</Tag>
);

/** Indicador: valor (número) + unidade + rótulo + apoio, em estilos separados. Valor ausente = "A definir" (nunca um traço gigante). */
export const Metric = ({ label, value, unit, hint, testid }: { label: string; value?: string | number | null; unit?: string; hint?: string; testid?: string }) => {
  const has = value !== null && value !== undefined && value !== "";
  return (
    <Glass className="metric" testid={testid}>
      <span className="t-label">{label}</span>
      {has ? <span className="metric-val"><b className="t-num">{value}</b>{unit && <span className="t-unit">{unit}</span>}</span> : <b className="metric-undef">A definir</b>}
      <span className="t-cap">{has ? hint : "Após revisão do plano"}</span>
    </Glass>
  );
};

/** Sequência contínua do acompanhamento: nós numerados ligados por uma linha; Reavaliar e Ajustar marcados como repetíveis. */
export const Steps = ({ items, repeat }: { items: { title: string; text: string }[]; repeat: [number, number] }) => (
  <div className="steps-track" data-testid="deck-flow">
    <ol>
      {items.map((it, i) => (
        <li key={it.title} className={i === items.length - 1 ? "is-end" : ""}>
          <span className="step-node t-num">{i + 1}</span>
          <b className="step-title">{it.title}</b>
          <span className="t-cap step-text">{it.text}</span>
        </li>
      ))}
    </ol>
    <div className="steps-repeat" style={{ gridColumn: `${repeat[0] + 1} / ${repeat[1] + 2}` }} aria-label="Reavaliar e ajustar podem se repetir"><span>pode se repetir a cada reavaliação</span></div>
  </div>
);

/** Gráfico de escala 0–10: UMA escala por medida (nada é somado). Mostra título, valor, unidade, data, origem, legenda e leitura. */
export const MeasureChart = ({ s, big = false, demo = false }: { s: Series; big?: boolean; demo?: boolean }) => {
  const pts = s.points; const last = pts[pts.length - 1]; const first = pts[0]; const x = (v: number) => 24 + (v / 10) * 552;
  const multi = pts.length > 1; const unit = s.instrument === "nprs" ? "de 10" : "de 10";
  const readText = s.instrument === "nprs" ? "Quanto menor, menos dor." : "Quanto maior, mais você consegue retomar o que quer fazer.";
  return (
    <Glass className={`measure ${big ? "is-big" : ""}`} testid="deck-measure">
      <div className="measure-head"><span className="t-label">{s.label ?? s.name}</span>{demo && <span className="chip">Exemplo</span>}</div>
      <div className="measure-main">
        <span className="metric-val"><b className="t-num">{String(last.value).replace(".", ",")}</b><span className="t-unit">{unit}</span></span>
        <span className="t-cap">{multi ? "resultado observado em" : "avaliação inicial em"} {short(last.at)}<br />{last.by === "professional" ? "registrado pelo fisioterapeuta" : "relatado por você"}</span>
      </div>
      <svg viewBox="0 0 600 78" role="img" aria-label={`${s.label ?? s.name}: ${last.value} de 10`} className="measure-svg">
        <rect x="24" y="26" width="552" height="12" rx="6" className="sc-track" />
        {[0, 2, 4, 6, 8, 10].map((t) => <g key={t}><line x1={x(t)} y1="22" x2={x(t)} y2="42" className="sc-tick" /><text x={x(t)} y="66" textAnchor="middle" className="sc-num">{t}</text></g>)}
        {multi && <polyline points={pts.map((p) => `${x(p.value)},32`).join(" ")} className="sc-line" />}
        {multi && <circle cx={x(first.value)} cy="32" r="9" className="sc-first" />}
        <circle cx={x(last.value)} cy="32" r="12" className="sc-dot" />
      </svg>
      <div className="measure-legend t-cap">
        <span><i className="lg-dot is-solid" />{multi ? "Resultado observado" : "Avaliação inicial"}</span>{multi && <span><i className="lg-dot is-ring" />Primeiro registro ({String(first.value).replace(".", ",")} em {short(first.at)})</span>}
      </div>
      <p className="t-cap measure-read">{readText} {s.instrument === "nprs" ? "Escala de 0 (sem dor) a 10 (a pior dor imaginável)." : "Escala de 0 (não consigo) a 10 (consigo como antes)."}</p>
    </Glass>
  );
};

/* ------------------------------------------------------------------ celular */
export const PHONE_W = 289, PHONE_H = 626, PHONE_BEZEL = 7, PHONE_TOP = 38, LOGICAL_W = 320;   /* 289×626 ≈ 9:19,5 */
const SCALE = (PHONE_W - PHONE_BEZEL * 2) / LOGICAL_W;
const topIn = (el: HTMLElement, root: HTMLElement) => { let y = 0; let e: HTMLElement | null = el; while (e && e !== root) { y += e.offsetTop; e = e.offsetParent as HTMLElement | null; } return y; };

export interface PhoneMark { target: string; text: string }
/**
 * Celular (proporção ≈ 9:19,5) que mostra a interface REAL do portal, renderizada em largura de celular (340 px) e reduzida sem distorção.
 * `skipTo` rola a tela até o bloco indicado (data-testid); `marks` são as chamadas — só aparecem as que existem na tela (numeração sequencial 1, 2, 3).
 * Os marcadores ficam na moldura (lado do texto), nunca sobre o conteúdo do aplicativo.
 */
export const Phone = ({ children, skipTo, marks, side, testid, onMarks }: { children: ReactNode; skipTo?: string; marks: PhoneMark[]; side: "left" | "right"; testid: string; onMarks?: (present: PhoneMark[]) => void }) => {
  const inner = useRef<HTMLDivElement>(null); const [offset, setOffset] = useState(0); const [pos, setPos] = useState<{ mark: PhoneMark; y: number }[]>([]);
  useLayoutEffect(() => {
    const root = inner.current; if (!root) return; let alive = true;
    const measure = () => {
      if (!alive) return;
      const t = skipTo ? root.querySelector<HTMLElement>(`[data-testid="${skipTo}"]`) : null; const off = t ? Math.max(0, topIn(t, root) - 8) : 0; setOffset(off);
      const out: { mark: PhoneMark; y: number }[] = [];
      for (const m of marks) { const el = root.querySelector<HTMLElement>(`[data-testid="${m.target}"]`); if (!el) continue; const y = PHONE_TOP + (topIn(el, root) - off + 24) * SCALE; if (y > PHONE_TOP + 8 && y < PHONE_H - 40) out.push({ mark: m, y }); }
      // marcadores muito próximos não se tocam: afasta o seguinte
      for (let i = 1; i < out.length; i++) if (out[i].y - out[i - 1].y < 36) out[i].y = out[i - 1].y + 36;
      setPos(out); onMarks?.(out.map((o) => o.mark));
    };
    measure(); const ro = new ResizeObserver(measure); ro.observe(root);
    if (!deckFontsLoaded()) void ensureDeckFonts().then(measure);
    return () => { alive = false; ro.disconnect(); };
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [skipTo, marks.map((m) => m.target).join("|")]);
  return (
    <div className={`phone is-${side}`} data-testid={testid}>
      <i className="phone-btn is-power" aria-hidden /><i className="phone-btn is-vol1" aria-hidden /><i className="phone-btn is-vol2" aria-hidden />
      <div className="phone-screen" style={{ ["--phone-top" as string]: `${PHONE_TOP}px` }}>
        <i className="phone-island" aria-hidden><b /></i>
        <div className="phone-view"><div ref={inner} className="phone-inner" style={{ width: LOGICAL_W, transform: `scale(${SCALE}) translateY(${-offset}px)` }}>{children}</div></div>
        <i className="phone-home" aria-hidden />
      </div>
      {pos.map((p, i) => <span key={p.mark.target} className="callout" style={{ top: p.y - 15 }} data-n={i + 1}>{i + 1}</span>)}
    </div>
  );
};

/** Legenda numerada, na mesma ordem dos marcadores do celular. */
export const Legend = ({ items }: { items: PhoneMark[] }) => (
  <ol className="legend">{items.map((m, i) => <li key={m.target}><span className="callout is-static">{i + 1}</span><span className="t-body">{m.text}</span></li>)}</ol>
);
