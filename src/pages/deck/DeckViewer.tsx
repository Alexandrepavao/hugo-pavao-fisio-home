import { useEffect, useMemo, useRef, useState } from "react";
import { ChevronLeft, ChevronRight, FileDown, MonitorSmartphone } from "lucide-react";
import { Dialog, DialogContent, DialogDescription, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { btnGhost, btnPrimary } from "@/lib/ui";
import { EducationCard, ExerciseCards, FunctionalCard, JourneyProvider, JourneyTimeline, NextAppointmentCard, PainChartCard, PatientDashboard, SessionsCard, WeekCard } from "@/portal/journey/ui";
import type { JourneyTab } from "@/portal/journey/model";
import { deckModel, presentable, type DeckData } from "./deckModel";
import { ensureDeckFonts } from "./fonts";
import { DeckSlide, SLIDE_H, SLIDE_W, slideKeys, type SlideCtx } from "./Slides";
import "./deck.css";

/** Demonstração no navegador: o portal real (mesmos componentes) com os dados CONGELADOS desta proposta. Nada é gravado; nenhuma consulta, presença ou exercício é alterado. */
const Explorer = ({ d, open, onClose }: { d: DeckData; open: boolean; onClose: () => void }) => {
  const model = useMemo(() => deckModel(d.snapshot), [d]); const [tab, setTab] = useState<JourneyTab>("inicio");
  const TABS: [JourneyTab, string][] = [["inicio", "Início"], ["evolucao", "Evolução"], ["exercicios", "Exercícios"], ["agenda", "Agenda"], ["mais", "Mais"]];
  return (
    <Dialog open={open} onOpenChange={(o) => !o && onClose()}>
      <DialogContent className="max-w-3xl max-h-[90vh] overflow-y-auto" data-testid="deck-explorer">
        <DialogHeader><DialogTitle>Explore a sua área do paciente</DialogTitle><DialogDescription>Demonstração com os dados desta proposta, congelados na data de aprovação. Nada é gravado e nada é alterado de verdade.</DialogDescription></DialogHeader>
        <div className="flex flex-wrap gap-2" role="tablist" aria-label="Áreas do aplicativo">{TABS.map(([k, l]) => <button key={k} role="tab" aria-selected={tab === k} className={tab === k ? btnPrimary : btnGhost} onClick={() => setTab(k)} data-testid={`deck-explorer-tab-${k}`}>{l}</button>)}</div>
        {model && <JourneyProvider value={{ go: (t: JourneyTab) => setTab(t) }}><div className="jr">
          {tab === "inicio" && <PatientDashboard m={model} />}
          {tab === "evolucao" && <div className="jr-grid"><PainChartCard m={model} /><FunctionalCard m={model} /><JourneyTimeline m={model} /></div>}
          {tab === "exercicios" && <div className="jr-grid"><ExerciseCards m={model} showAll /><WeekCard m={model} /></div>}
          {tab === "agenda" && <div className="jr-grid"><NextAppointmentCard m={model} /><WeekCard m={model} /></div>}
          {tab === "mais" && <div className="jr-grid"><SessionsCard m={model} /><EducationCard m={model} /></div>}
        </div></JourneyProvider>}
      </DialogContent>
    </Dialog>
  );
};

/** Visualizador 16:9: um slide por vez na tela; TODOS os slides em páginas 16:9 na impressão/PDF (cópia fora da tela, com o mesmo layout). */
const DeckViewer = ({ d: raw, ctx, onExport, startAtEnd }: { d: DeckData; ctx: Omit<SlideCtx, "model">; onExport?: () => void; startAtEnd?: boolean }) => {
  const d = useMemo(() => presentable(raw), [raw]); useEffect(() => { void ensureDeckFonts(); }, []);   /* nomes de demonstração sem identificadores técnicos; fontes carregadas antes de qualquer impressão */
  const keys = useMemo(() => slideKeys(d), [d]); const model = useMemo(() => deckModel(d.snapshot), [d]); const [i, setI] = useState(startAtEnd ? (keys.includes("next") ? keys.indexOf("next") : keys.length - 1) : 0); const [explore, setExplore] = useState(false);
  const box = useRef<HTMLDivElement>(null); const [scale, setScale] = useState(0.6); const [narrow, setNarrow] = useState(false);
  useEffect(() => { const el = box.current; if (!el) return; const fit = () => { const w = el.clientWidth; setNarrow(w < 700); setScale(Math.min(1, Math.max(0.55, w / SLIDE_W))); };   /* celular em pé: leitura com rolagem lateral em vez de texto minúsculo */
    const ro = new ResizeObserver(fit); ro.observe(el); fit(); return () => ro.disconnect(); }, []);
  useEffect(() => { const h = (e: KeyboardEvent) => { if (e.key === "ArrowRight") setI((x) => Math.min(keys.length - 1, x + 1)); if (e.key === "ArrowLeft") setI((x) => Math.max(0, x - 1)); }; window.addEventListener("keydown", h); return () => window.removeEventListener("keydown", h); }, [keys.length]);
  const full: SlideCtx = { ...ctx, model };
  return (
    <div className="deck deck-viewer" data-testid="deck-viewer">
      <div className="deck-nav print:hidden">
        <button type="button" className={btnGhost} onClick={() => setI((x) => Math.max(0, x - 1))} disabled={i === 0} aria-label="Slide anterior" data-testid="deck-prev"><ChevronLeft size={16} aria-hidden /></button>
        <span className="text-sm" data-testid="deck-counter">{i + 1} / {keys.length}</span>
        <button type="button" className={btnGhost} onClick={() => setI((x) => Math.min(keys.length - 1, x + 1))} disabled={i === keys.length - 1} aria-label="Próximo slide" data-testid="deck-next"><ChevronRight size={16} aria-hidden /></button>
        <span className="flex-1" />
        <button type="button" className={btnGhost} onClick={() => setExplore(true)} data-testid="deck-open-explorer"><MonitorSmartphone size={14} className="mr-1 inline" aria-hidden />Explorar a demonstração do aplicativo</button>
        <button type="button" className={btnPrimary} onClick={() => { onExport?.(); void ensureDeckFonts().then(() => setTimeout(() => window.print(), 300)); }} data-testid="deck-export"><FileDown size={14} className="mr-1 inline" aria-hidden />Exportar PDF</button>
      </div>
      {narrow && <p className="text-xs text-muted-foreground print:hidden" data-testid="deck-rotate-hint">Dica: gire o celular para o lado e arraste para ver a página inteira.</p>}
      <div className="deck-slide-box deck-view print:hidden" ref={box} style={{ height: SLIDE_H * scale, overflowX: narrow ? "auto" : "hidden" }} data-testid="deck-current">
        <div style={{ position: "absolute", left: 0, top: 0, width: SLIDE_W, height: SLIDE_H, transform: `scale(${scale})`, transformOrigin: "top left" }}>
          <DeckSlide key={keys[i]} k={keys[i]} d={d} n={i + 1} total={keys.length} ctx={full} />
        </div>
      </div>
      <div className="mt-2 flex flex-wrap gap-1 print:hidden" aria-label="Ir para o slide">{keys.map((k, x) => <button key={k} type="button" className={`${x === i ? btnPrimary : btnGhost} h-8 min-w-8 text-xs`} onClick={() => setI(x)} aria-label={`Slide ${x + 1}`} data-testid={`deck-go-${k}`}>{x + 1}</button>)}</div>
      {/* cópia para impressão/PDF: fora da tela, com layout real (necessário para as chamadas numeradas do aplicativo) */}
      <div className="deck-print" style={{ position: "absolute", left: -30000, top: 0, width: SLIDE_W }} aria-hidden data-testid="deck-print">
        {keys.map((k, x) => <div key={k} className="slide-box" style={{ position: "relative", width: SLIDE_W, height: SLIDE_H }}><DeckSlide k={k} d={d} n={x + 1} total={keys.length} ctx={{ ...full, interactive: false }} /></div>)}
      </div>
      <Explorer d={d} open={explore} onClose={() => setExplore(false)} />
    </div>
  );
};
export default DeckViewer;
