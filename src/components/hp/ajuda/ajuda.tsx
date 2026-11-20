import { createContext, useCallback, useContext, useEffect, useLayoutEffect, useMemo, useRef, useState, type ReactNode } from "react";
import { Link, useLocation } from "react-router-dom";
import { ArrowLeft, ArrowRight, BookOpen, CircleHelp, Compass, X } from "lucide-react";
import { Popover, PopoverContent, PopoverTrigger } from "@/components/ui/popover";
import { useAuth } from "@/auth/AuthProvider";
import { genericHelp, HELP, helpKeyFor, TARGET_SELECTOR, type HelpEntry, type HelpStep } from "@/content/ajuda";
import { usePageMetaContext } from "../pageMeta";

/** Ajuda por tela: menu “Ajuda” (Sobre esta tela · Conhecer esta tela), convite discreto no primeiro acesso e tour guiado que destaca elementos REAIS, um por vez.
 *  Conteúdo: src/content/ajuda.ts (fonte única). Persistência: por usuário, organização, tela e versão (localStorage do navegador, como o tutorial existente).
 *  O tour nunca executa ações: uma camada transparente bloqueia cliques durante os passos. */
const orgKey = () => { try { return sessionStorage.getItem("hp.activeOrg") || "hp"; } catch { return "hp"; } };
const storeKey = (uid: string, key: string) => `hp-ajuda:${uid}:${orgKey()}:${key}`;
type Stored = { v: number; s: "feito" | "dispensado" } | null;
const readStored = (uid: string, key: string): Stored => { try { const r = localStorage.getItem(storeKey(uid, key)); return r ? (JSON.parse(r) as Stored) : null; } catch { return null; } };
const writeStored = (uid: string, key: string, v: number, s: "feito" | "dispensado") => { try { localStorage.setItem(storeKey(uid, key), JSON.stringify({ v, s })); } catch { /* sem storage: não insiste */ } };
const reduced = () => typeof window !== "undefined" && window.matchMedia?.("(prefers-reduced-motion: reduce)").matches;

interface HelpCtx { entry: HelpEntry; routeKey: string; startTour: () => void; touring: boolean; seen: Stored; dismissInvite: () => void }
const Ctx = createContext<HelpCtx | null>(null);
export const useHelp = () => useContext(Ctx);

export const HelpProvider = ({ children }: { children: ReactNode }) => {
  const { pathname, search } = useLocation();
  const { user } = useAuth();
  const meta = usePageMetaContext()?.meta ?? null;
  const routeKey = helpKeyFor(pathname, search);
  const entry = useMemo(() => HELP[routeKey] ?? genericHelp(meta?.title ?? "Esta tela", meta?.description), [routeKey, meta?.title, meta?.description]);
  const uid = user?.id ?? "anon";
  const [touring, setTouring] = useState(false);
  const [seen, setSeen] = useState<Stored>(null);
  useEffect(() => { setTouring(false); setSeen(readStored(uid, routeKey)); }, [uid, routeKey]);
  const finish = useCallback((s: "feito" | "dispensado") => { writeStored(uid, routeKey, entry.version, s); setSeen({ v: entry.version, s }); setTouring(false); }, [uid, routeKey, entry.version]);
  const value = useMemo<HelpCtx>(() => ({ entry, routeKey, startTour: () => setTouring(true), touring, seen, dismissInvite: () => finish("dispensado") }), [entry, routeKey, touring, seen, finish]);
  return (
    <Ctx.Provider value={value}>
      {children}
      {touring && <Tour steps={entry.passos} onEnd={(completed) => finish(completed ? "feito" : "dispensado")} />}
    </Ctx.Provider>
  );
};

/** Entrada única: botão “Ajuda” no cabeçalho. */
export const HelpMenu = () => {
  const h = useHelp();
  const [open, setOpen] = useState(false);
  if (!h) return null;
  const { entry } = h;
  return (
    <Popover open={open} onOpenChange={setOpen}>
      <PopoverTrigger asChild>
        <button className="hp-hd-iconbtn" aria-label="Ajuda desta tela" data-testid="ajuda-botao"><CircleHelp size={18} /></button>
      </PopoverTrigger>
      <PopoverContent align="end" collisionPadding={12} className="w-[min(22rem,calc(100vw-1.5rem))] max-h-[var(--radix-popover-content-available-height)] overflow-y-auto p-0" data-testid="ajuda-painel">
        <div className="p-4 border-b border-border">
          <p className="eyebrow mb-1">Ajuda</p>
          <h2 className="text-base">{entry.titulo}</h2>
          <p className="text-sm text-muted-foreground mt-1">{entry.finalidade}</p>
          <button className="hp-btn hp-btn-primary mt-3 w-full" data-testid="ajuda-conhecer" onClick={() => { setOpen(false); window.setTimeout(h.startTour, 120); }}><Compass size={15} aria-hidden />Conhecer esta tela</button>
        </div>
        <div className="p-4 grid gap-3 text-sm">
          <section><h3 className="text-[0.8125rem] mb-1">Tarefa principal</h3><p className="text-muted-foreground">{entry.tarefa}</p></section>
          <section><h3 className="text-[0.8125rem] mb-1">O que fazer primeiro</h3><ol className="list-decimal pl-4 grid gap-0.5 text-muted-foreground">{entry.primeiro.map((p) => <li key={p}>{p}</li>)}</ol></section>
          {entry.numeros && <section><h3 className="text-[0.8125rem] mb-1">Números a observar</h3><ul className="list-disc pl-4 grid gap-0.5 text-muted-foreground">{entry.numeros.map((p) => <li key={p}>{p}</li>)}</ul></section>}
          {entry.graficos && <section><h3 className="text-[0.8125rem] mb-1">Como ler os gráficos</h3><ul className="list-disc pl-4 grid gap-0.5 text-muted-foreground">{entry.graficos.map((p) => <li key={p}>{p}</li>)}</ul></section>}
          {entry.relacionadas && <section><h3 className="text-[0.8125rem] mb-1">Telas relacionadas</h3><ul className="grid gap-0.5">{entry.relacionadas.map((r) => <li key={r.para}><Link className="text-primary hover:underline" to={r.para} onClick={() => setOpen(false)}>{r.rotulo}</Link></li>)}</ul></section>}
          {h.seen && <p className="text-xs text-muted-foreground">Tour {h.seen.s === "feito" ? "concluído" : "dispensado"} nesta tela. Você pode refazê-lo quando quiser.</p>}
        </div>
      </PopoverContent>
    </Popover>
  );
};

/** Convite discreto (uma vez por usuário, organização, tela e versão): nunca abre sozinho e some ao dispensar. */
export const HelpInvite = () => {
  const h = useHelp();
  if (!h || h.touring) return null;
  if (h.seen && h.seen.v >= h.entry.version) return null;
  return (
    <div className="hp-help-invite" role="region" aria-label="Convite para conhecer a tela" data-testid="ajuda-convite">
      <BookOpen size={16} aria-hidden />
      <span>Primeira vez aqui? Em poucos passos mostramos onde clicar.</span>
      <button className="hp-btn hp-btn-outline hp-btn-sm" onClick={h.startTour}>Conhecer esta tela</button>
      <button className="hp-btn hp-btn-ghost hp-btn-sm" onClick={h.dismissInvite} aria-label="Dispensar o convite">Agora não</button>
    </div>
  );
};

/** Resolve o elemento de um passo (aguarda até ~1,5 s por conteúdo carregado de forma assíncrona). */
const resolve = (step: HelpStep): HTMLElement | null => document.querySelector<HTMLElement>(TARGET_SELECTOR[step.alvo]);
const waitFor = async (step: HelpStep): Promise<HTMLElement | null> => { for (let i = 0; i < 10; i++) { const el = resolve(step); if (el && el.getBoundingClientRect().height > 0) return el; await new Promise((r) => setTimeout(r, 150)); } return null; };

const Tour = ({ steps, onEnd }: { steps: HelpStep[]; onEnd: (completed: boolean) => void }) => {
  const [list, setList] = useState<{ step: HelpStep; el: HTMLElement }[] | null>(null);
  const [i, setI] = useState(0);
  const [rect, setRect] = useState<DOMRect | null>(null);
  const card = useRef<HTMLDivElement>(null);
  const endRef = useRef(onEnd); endRef.current = onEnd;
  // só entram os passos cujo elemento existe (sem permissão/sem módulo/sem dados: o passo é pulado)
  useEffect(() => { let live = true; void (async () => { const found: { step: HelpStep; el: HTMLElement }[] = []; for (const s of steps) { const el = await waitFor(s); if (el) found.push({ step: s, el }); } if (!live) return; if (!found.length) { endRef.current(false); return; } setList(found); })(); return () => { live = false; }; }, [steps]);
  const cur = list?.[i];
  const place = useCallback(() => { if (cur) setRect(cur.el.getBoundingClientRect()); }, [cur]);
  useLayoutEffect(() => {
    if (!cur) return;
    cur.el.scrollIntoView({ block: "center", behavior: reduced() ? "auto" : "smooth" });
    place(); const t = window.setTimeout(place, reduced() ? 0 : 350);
    window.addEventListener("resize", place); window.addEventListener("scroll", place, true);
    return () => { window.clearTimeout(t); window.removeEventListener("resize", place); window.removeEventListener("scroll", place, true); };
  }, [cur, place]);
  useEffect(() => { card.current?.querySelector<HTMLButtonElement>("[data-primary]")?.focus(); }, [i, list]);
  const last = !!list && i === list.length - 1;
  const next = () => (last ? onEnd(true) : setI((n) => n + 1));
  const prev = () => setI((n) => Math.max(0, n - 1));
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") { e.preventDefault(); onEnd(false); }
      else if (e.key === "ArrowRight") { e.preventDefault(); next(); }
      else if (e.key === "ArrowLeft") { e.preventDefault(); prev(); }
      else if (e.key === "Tab" && card.current) {   // foco preso no cartão do tour
        const f = [...card.current.querySelectorAll<HTMLElement>("button")]; if (!f.length) return;
        const first = f[0], lastEl = f[f.length - 1];
        if (e.shiftKey && document.activeElement === first) { e.preventDefault(); lastEl.focus(); } else if (!e.shiftKey && document.activeElement === lastEl) { e.preventDefault(); first.focus(); }
      }
    };
    window.addEventListener("keydown", onKey, true); return () => window.removeEventListener("keydown", onKey, true);
  }); // eslint-disable-line react-hooks/exhaustive-deps
  if (!list || !cur || !rect) return null;
  const pad = 6; const vw = window.innerWidth, vh = window.innerHeight;
  const cardW = Math.min(340, vw - 24); const below = rect.bottom + 12 + 190 < vh;
  const top = below ? Math.min(rect.bottom + 12, vh - 200) : Math.max(12, rect.top - 12 - 190);
  const left = Math.min(Math.max(12, rect.left), vw - cardW - 12);
  return (
    <div className="hp-tour" data-testid="tour" role="presentation">
      <div className="hp-tour-block" onClick={(e) => e.stopPropagation()} />
      <div className="hp-tour-spot" style={{ top: rect.top - pad, left: rect.left - pad, width: rect.width + pad * 2, height: rect.height + pad * 2 }} aria-hidden />
      <div ref={card} className="hp-tour-card" role="dialog" aria-label={`Conhecer esta tela: passo ${i + 1} de ${list.length}`} style={{ top, left, width: cardW }}>
        <button className="hp-tour-x" onClick={() => onEnd(false)} aria-label="Encerrar o tour"><X size={16} aria-hidden /></button>
        <p className="hp-tour-progress" data-testid="tour-progresso">Passo {i + 1} de {list.length}</p>
        <h3 className="hp-tour-title">{cur.step.titulo}</h3>
        <p className="hp-tour-text">{cur.step.texto}</p>
        <div className="hp-tour-actions">
          <button className="hp-btn hp-btn-ghost hp-btn-sm" onClick={() => onEnd(false)}>Pular</button>
          <span className="flex-1" />
          <button className="hp-btn hp-btn-outline hp-btn-sm" onClick={prev} disabled={i === 0}><ArrowLeft size={14} aria-hidden />Voltar</button>
          <button className="hp-btn hp-btn-primary hp-btn-sm" onClick={next} data-primary data-testid="tour-proximo">{last ? "Concluir" : "Próximo"}{!last && <ArrowRight size={14} aria-hidden />}</button>
        </div>
      </div>
    </div>
  );
};
