import { createContext, useCallback, useContext, useEffect, useMemo, useRef, useState, type ReactNode } from "react";
import { createPortal } from "react-dom";
import { CartesianGrid, Line, LineChart, ReferenceLine, ResponsiveContainer, Tooltip, XAxis, YAxis } from "recharts";
import { ChevronLeft, ChevronRight, PlayCircle, VideoOff } from "lucide-react";
import type { Measure } from "./types";
import { fmtDay } from "./store";

export const cx = (...a: (string | false | null | undefined)[]) => a.filter(Boolean).join(" ");

// ---------------------------------------------------------------- navegação (pilha por aba) + sobreposições (sheet, alerta, aviso) dentro da moldura
export interface Screen { id: string; params?: Record<string, string> }
interface NavApi { push: (s: Screen) => void; pop: () => void; tab: string; setTab: (t: string) => void; depth: number; overlay: HTMLElement | null; toast: (m: string) => void }
const NavCtx = createContext<NavApi | null>(null);
export const useNav = () => { const c = useContext(NavCtx); if (!c) throw new Error("useNav fora do NavHost"); return c; };

export const NavHost = ({ tabs, initial, render, renderTabBar }: { tabs: string[]; initial: string; render: (s: Screen, tab: string) => ReactNode; renderTabBar: (tab: string, setTab: (t: string) => void) => ReactNode }) => {
  const [tab, setTab] = useState(initial); const [stacks, setStacks] = useState<Record<string, Screen[]>>(() => Object.fromEntries(tabs.map((t) => [t, [{ id: t }]])));
  const [overlay, setOverlay] = useState<HTMLElement | null>(null); const [toastMsg, setToastMsg] = useState<string | null>(null); const dir = useRef<"push" | "pop">("push");
  const push = useCallback((s: Screen) => { dir.current = "push"; setStacks((p) => ({ ...p, [tab]: [...p[tab], s] })); }, [tab]);
  const pop = useCallback(() => { dir.current = "pop"; setStacks((p) => (p[tab].length > 1 ? { ...p, [tab]: p[tab].slice(0, -1) } : p)); }, [tab]);
  const switchTab = useCallback((t: string) => { dir.current = "pop"; setTab((cur) => { if (cur === t) setStacks((p) => ({ ...p, [t]: [p[t][0]] })); return t; }); }, []);
  const toast = useCallback((m: string) => { setToastMsg(m); window.setTimeout(() => setToastMsg((c) => (c === m ? null : c)), 2600); }, []);
  const stack = stacks[tab]; const top = stack[stack.length - 1];
  const api = useMemo<NavApi>(() => ({ push, pop, tab, setTab: switchTab, depth: stack.length, overlay, toast }), [push, pop, tab, switchTab, stack.length, overlay, toast]);
  return (
    <NavCtx.Provider value={api}>
      <div className="ios-screen">
        <div className="ios-view" style={{ position: "relative", flex: 1, minHeight: 0 }}>
          <div key={`${tab}/${stack.length}/${top.id}/${JSON.stringify(top.params ?? {})}`} className={cx("ios-view", dir.current === "push" ? "ios-push" : "ios-pop")}>{render(top, tab)}</div>
        </div>
        {renderTabBar(tab, switchTab)}
        <div ref={setOverlay} data-overlay />
        {toastMsg && <div className="ios-toast" role="status">{toastMsg}</div>}
      </div>
    </NavCtx.Provider>
  );
};

/** Tela com barra superior, botão voltar e título grande que “colapsa” ao rolar (comportamento familiar ao iOS). */
export const Page = ({ title, large = true, right, children, back }: { title: string; large?: boolean; right?: ReactNode; children: ReactNode; back?: boolean }) => {
  const { pop, depth } = useNav(); const [compact, setCompact] = useState(!large);
  return (
    <>
      <header className="ios-bar" data-compact={compact}>
        <div style={{ minWidth: 60 }}>{(back ?? depth > 1) && <button className="ios-bar-btn" onClick={pop} aria-label="Voltar"><ChevronLeft size={24} aria-hidden />Voltar</button>}</div>
        <div className="ios-bar-title" aria-hidden>{title}</div><div style={{ minWidth: 60, display: "flex", justifyContent: "flex-end" }}>{right}</div>
      </header>
      <div className="ios-scroll" data-scroll onScroll={(e) => setCompact(!large || e.currentTarget.scrollTop > 28)}>
        {large && <h1 className="ios-large">{title}</h1>}{children}
      </div>
    </>
  );
};

export const TabBar = ({ items, active, onChange, badges = {} }: { items: { id: string; label: string; icon: ReactNode }[]; active: string; onChange: (t: string) => void; badges?: Record<string, number> }) => (
  <nav className="ios-tabbar" style={{ gridTemplateColumns: `repeat(${items.length}, 1fr)` }} aria-label="Navegação principal">
    {items.map((i) => <button key={i.id} className="ios-tab" aria-current={active === i.id ? "page" : undefined} onClick={() => onChange(i.id)}>{i.icon}<span>{i.label}</span>{badges[i.id] ? <span className="ios-dot" aria-label={`${badges[i.id]} pendência(s)`}>{badges[i.id]}</span> : null}</button>)}
  </nav>
);

// ---------------------------------------------------------------- sobreposições
const Portal = ({ children }: { children: ReactNode }) => { const { overlay } = useNav(); return overlay ? createPortal(children, overlay) : null; };
export const Sheet = ({ open, onClose, title, children }: { open: boolean; onClose: () => void; title: string; children: ReactNode }) => {
  useEffect(() => { if (!open) return; const h = (e: KeyboardEvent) => e.key === "Escape" && onClose(); window.addEventListener("keydown", h); return () => window.removeEventListener("keydown", h); }, [open, onClose]);
  if (!open) return null;
  return <Portal><div className="ios-backdrop" onClick={onClose} /><div className="ios-sheet" role="dialog" aria-modal="true" aria-label={title}><div className="ios-sheet-grab" /><div className="ios-sheet-head"><h2 style={{ fontSize: 18 }}>{title}</h2><button className="ios-bar-btn" style={{ minHeight: 36 }} onClick={onClose}>Fechar</button></div><div className="ios-sheet-body">{children}</div></div></Portal>;
};
export const AlertBox = ({ open, title, message, actions }: { open: boolean; title: string; message: string; actions: { label: string; onClick: () => void; danger?: boolean }[] }) => open ? (
  <Portal><div className="ios-backdrop" /><div className="ios-alert" role="alertdialog" aria-modal="true" aria-label={title}><div className="ios-alert-body"><h3 style={{ fontSize: 16, marginBottom: 6 }}>{title}</h3><p className="ios-dim" style={{ fontSize: 13.5 }}>{message}</p></div>
    <div className="ios-alert-actions">{actions.map((a) => <button key={a.label} className={a.danger ? "danger" : ""} onClick={a.onClick}>{a.label}</button>)}</div></div></Portal>) : null;

// ---------------------------------------------------------------- primitivos
export const Avatar = ({ name, hue, size = 44 }: { name: string; hue: number; size?: number }) => <div className="ios-avatar" aria-hidden style={{ width: size, height: size, fontSize: size * 0.38, background: `linear-gradient(135deg, hsl(${hue} 52% 42%), hsl(${(hue + 30) % 360} 50% 32%))` }}>{name.split(" ").filter((p) => /^[A-ZÁÉÍÓÚ]/.test(p)).map((p) => p[0]).slice(0, 2).join("")}</div>;
export const Group = ({ title, foot, children, className }: { title?: string; foot?: string; children: ReactNode; className?: string }) => <section className={className}>{title && <h2 className="ios-group-title">{title}</h2>}<div className="ios-card ios-list">{children}</div>{foot && <p className="ios-group-foot">{foot}</p>}</section>;
export const Row = ({ title, sub, left, right, onClick, chevron }: { title: ReactNode; sub?: ReactNode; left?: ReactNode; right?: ReactNode; onClick?: () => void; chevron?: boolean }) => {
  const body = <>{left}<div className="ios-row-body"><div className="ios-row-title">{title}</div>{sub && <div className="ios-row-sub">{sub}</div>}</div>{right}{(chevron ?? !!onClick) && <ChevronRight size={18} className="ios-chev" aria-hidden />}</>;
  return onClick ? <button className="ios-row" onClick={onClick}>{body}</button> : <div className="ios-row">{body}</div>;
};
export const Btn = ({ children, variant = "primary", onClick, disabled, small, type = "button" }: { children: ReactNode; variant?: "primary" | "secondary" | "danger" | "plain"; onClick?: () => void; disabled?: boolean; small?: boolean; type?: "button" | "submit" }) =>
  <button type={type} className={cx("ios-btn", `ios-btn-${variant}`, small && "ios-btn-sm")} onClick={onClick} disabled={disabled}>{children}</button>;
export const Badge = ({ tone = "gray", children }: { tone?: "info" | "ok" | "warn" | "bad" | "gray" | "gold"; children: ReactNode }) => <span className={cx("ios-badge", `ios-b-${tone}`)}>{children}</span>;
export const Segmented = ({ options, value, onChange, label }: { options: { id: string; label: string }[]; value: string; onChange: (v: string) => void; label: string }) =>
  <div className="ios-seg" role="group" aria-label={label}>{options.map((o) => <button key={o.id} aria-pressed={value === o.id} onClick={() => onChange(o.id)}>{o.label}</button>)}</div>;
export const Switch = ({ checked, onChange, label }: { checked: boolean; onChange: (v: boolean) => void; label: string }) => <button className="ios-switch" role="switch" aria-checked={checked} aria-label={label} onClick={() => onChange(!checked)} />;
export const Progress = ({ value, max, label }: { value: number; max: number; label: string }) => <div className="ios-progress" role="progressbar" aria-label={label} aria-valuemin={0} aria-valuemax={max} aria-valuenow={Math.min(value, max)}><div style={{ width: `${Math.min(100, (100 * value) / Math.max(1, max))}%` }} /></div>;
export const Field = ({ label, value, onChange, placeholder, multiline, type = "text", id }: { label: string; value: string; onChange: (v: string) => void; placeholder?: string; multiline?: boolean; type?: string; id: string }) => (
  <div><label className="ios-label" htmlFor={id}>{label}</label>{multiline ? <textarea id={id} className="ios-field" value={value} placeholder={placeholder} onChange={(e) => onChange(e.target.value)} /> : <input id={id} className="ios-field" type={type} value={value} placeholder={placeholder} onChange={(e) => onChange(e.target.value)} />}</div>
);
export const Empty = ({ title, text }: { title: string; text: string }) => <div className="ios-card ios-card-pad" style={{ textAlign: "center" }}><p style={{ fontWeight: 700 }}>{title}</p><p className="ios-dim ios-small" style={{ marginTop: 4 }}>{text}</p></div>;

/** Indicador com período, definição e detalhamento (abre uma folha). Todo número do app que seja “indicador” passa por aqui. */
export const Indicator = ({ label, value, sub, period, definition, rows, tone }: { label: string; value: string; sub?: string; period: string; definition: string; rows: { title: string; sub?: string; right?: string }[]; tone?: "ok" | "warn" | "bad" }) => {
  const [open, setOpen] = useState(false);
  return (
    <>
      <button className="ios-kpi" onClick={() => setOpen(true)} aria-label={`${label}: ${value}. Ver detalhes`}><div className="l">{label}</div><div className="v" style={tone ? { color: `var(--${tone === "ok" ? "success" : tone === "warn" ? "warning" : "danger"})` } : undefined}>{value}</div>{sub && <div className="ios-dim ios-small">{sub}</div>}</button>
      <Sheet open={open} onClose={() => setOpen(false)} title={label}>
        <p style={{ fontSize: 28, fontWeight: 800, fontFamily: "Manrope, Inter" }}>{value}</p>
        <p className="ios-dim ios-small" style={{ marginTop: 4 }}><b>Período:</b> {period}</p><p className="ios-dim ios-small" style={{ marginTop: 4 }}><b>Definição:</b> {definition}</p>
        <h3 className="ios-group-title">Detalhamento</h3>
        {rows.length === 0 ? <Empty title="Sem registros" text="Nada compõe este indicador no período." /> : <div className="ios-card ios-list">{rows.map((r, i) => <Row key={i} title={r.title} sub={r.sub} right={r.right ? <b className="ios-small">{r.right}</b> : undefined} />)}</div>}
      </Sheet>
    </>
  );
};

// ---------------------------------------------------------------- gráfico de medida (valor inicial, atual e meta; origem do dado explícita)
export const MeasureChart = ({ m, viewer = "patient" }: { m: Measure; viewer?: "patient" | "physio" }) => {
  const first = m.points[0]; const last = m.points[m.points.length - 1]; const delta = last.value - first.value;
  const good = m.better === "lower" ? delta < 0 : delta > 0; const reached = m.better === "lower" ? last.value <= m.goal : last.value >= m.goal;
  const rows = m.points.map((p) => ({ t: new Date(p.date + "T12:00:00").getTime(), v: p.value, date: p.date }));
  const dom: [number, number] = [Math.min(m.goal, ...m.points.map((p) => p.value)) - 1, Math.max(m.goal, ...m.points.map((p) => p.value)) + 1];
  return (
    <div className="ios-card ios-card-pad" data-testid="measure-card">
      <div style={{ display: "flex", justifyContent: "space-between", gap: 8, alignItems: "flex-start" }}><div><p style={{ fontWeight: 700 }}>{m.label}</p><p className="ios-dim ios-small">{m.hint}</p></div><Badge tone={m.source === "paciente" ? "gold" : "info"}>{m.source === "paciente" ? (viewer === "patient" ? "Relatado por você" : "Relatado pelo paciente") : (viewer === "patient" ? "Avaliação do profissional" : "Sua avaliação")}</Badge></div>
      <div className="ios-grid2" style={{ marginTop: 10, gridTemplateColumns: "1fr 1fr 1fr" }}>
        {[["Inicial", first.value, fmtDay(first.date)], ["Atual", last.value, fmtDay(last.date)], ["Meta", m.goal, reached ? "atingida" : "definida"]].map(([l, v, s]) => <div key={String(l)}><p className="ios-dim ios-small">{l}</p><p style={{ fontWeight: 800, fontSize: 20, fontFamily: "Manrope, Inter" }}>{String(v).replace(".", ",")}</p><p className="ios-dim" style={{ fontSize: 11 }}>{s} · {m.unit}</p></div>)}
      </div>
      <div style={{ height: 130, marginTop: 8 }} role="img" aria-label={`Gráfico de ${m.label}: de ${first.value} para ${last.value} ${m.unit}; meta ${m.goal}`}>
        <ResponsiveContainer width="100%" height="100%">
          <LineChart data={rows} margin={{ top: 8, right: 8, left: -22, bottom: 0 }}>
            <CartesianGrid strokeDasharray="3 3" stroke="var(--sep)" /><XAxis dataKey="t" type="number" scale="time" domain={["dataMin", "dataMax"]} fontSize={10} tick={{ fill: "var(--label3)" }} tickFormatter={(v) => fmtDay(new Date(v).toISOString().slice(0, 10))} />
            <YAxis domain={dom} fontSize={10} tick={{ fill: "var(--label3)" }} allowDecimals={false} /><Tooltip contentStyle={{ background: "var(--surface)", border: "0.5px solid var(--sep)", borderRadius: 10, fontSize: 12, color: "var(--label)" }} labelFormatter={(v) => fmtDay(new Date(v as number).toISOString().slice(0, 10))} formatter={(v: number) => [`${String(v).replace(".", ",")} ${m.unit}`, m.label]} />
            <ReferenceLine y={m.goal} stroke="var(--success)" strokeDasharray="5 4" label={{ value: "meta", fill: "var(--success)", fontSize: 10, position: "insideTopRight" }} />
            <Line type="monotone" dataKey="v" stroke="var(--primary)" strokeWidth={2.5} dot={{ r: 3.5, fill: "var(--primary)" }} isAnimationActive={false} />
          </LineChart>
        </ResponsiveContainer>
      </div>
      <p className="ios-small" style={{ marginTop: 6, color: good ? "var(--success)" : "var(--label2)" }}>{delta === 0 ? "Sem variação desde o início." : `${delta > 0 ? "+" : "−"}${String(Math.abs(Math.round(delta * 10) / 10)).replace(".", ",")} ${m.unit} desde o início. `}<span className="ios-dim">{reached ? "A meta foi atingida." : viewer === "patient" ? "Quem interpreta a evolução é o seu fisioterapeuta." : "Interpretação clínica é sua."}</span></p>
    </div>
  );
};

// ---------------------------------------------------------------- ilustração do exercício (SEMPRE rotulada como ilustração; não é vídeo) e espaço reservado para vídeo privado
const POSES: Record<string, { a: string[]; b: string[] }> = {
  stand: { a: ["50,28 50,62", "50,38 38,54", "50,38 62,54", "50,62 42,92", "50,62 58,92"], b: ["50,44 50,68", "50,50 38,62", "50,50 62,62", "50,68 38,80 40,92", "50,68 62,80 60,92"] },
  lying: { a: ["20,84 60,84", "60,84 72,66 84,84", "20,84 30,76"], b: ["20,84 52,70", "52,70 72,66 84,84", "20,84 30,76"] },
  seated: { a: ["38,40 38,68", "38,68 62,68", "62,68 62,92", "38,48 52,58"], b: ["38,40 38,68", "38,68 62,68", "62,68 86,68", "38,48 52,58"] },
};
export const ExerciseArt = ({ pose, size = 120 }: { pose: "stand" | "lying" | "seated"; size?: number }) => {
  const P = POSES[pose]; const head = pose === "stand" ? [50, 20] : pose === "lying" ? [14, 80] : [38, 30]; const headB = pose === "stand" ? [50, 36] : pose === "lying" ? [14, 80] : [38, 30];
  const draw = (lines: string[], h: number[], cls: string) => <g className={cls} fill="none" stroke="currentColor" strokeWidth="5" strokeLinecap="round" strokeLinejoin="round"><circle cx={h[0]} cy={h[1]} r="8" fill="currentColor" stroke="none" />{lines.map((l, i) => <polyline key={i} points={l} />)}</g>;
  return <div className="ios-art" style={{ width: "100%", height: size }} role="img" aria-label="Ilustração do movimento (não é vídeo)"><svg viewBox="0 0 100 100" height={size - 16}><line x1="6" y1="94" x2="94" y2="94" stroke="currentColor" strokeOpacity=".25" strokeWidth="2" />{draw(P.a, head, "a")}{draw(P.b, headB, "b")}</svg></div>;
};
export const PrivateVideoSlot = ({ videoRef }: { videoRef: string | null }) => (
  <div className="ios-card ios-card-pad" style={{ display: "flex", gap: 12, alignItems: "center", borderStyle: "dashed" }} data-testid="video-slot">
    {videoRef ? <PlayCircle size={28} aria-hidden /> : <VideoOff size={28} aria-hidden className="ios-dim" />}
    <div><p style={{ fontWeight: 700, fontSize: 14 }}>{videoRef ? "Vídeo de demonstração" : "Vídeo de demonstração indisponível"}</p><p className="ios-dim ios-small">{videoRef ? "Reprodução privada (Bunny) — ainda não conectada." : "Nesta prévia não há arquivo de vídeo apropriado. Veja a ilustração e os passos abaixo. No app definitivo, o vídeo será privado e liberado só ao paciente."}</p></div>
  </div>
);

// ---------------------------------------------------------------- calendário mensal
export const MonthCalendar = ({ selected, onSelect, today, marks }: { selected: string; onSelect: (d: string) => void; today: string; marks: Set<string> }) => {
  const [cursor, setCursor] = useState(selected.slice(0, 7)); const [y, m] = cursor.split("-").map(Number); const first = new Date(y, m - 1, 1); const start = new Date(y, m - 1, 1 - first.getDay());
  const days = Array.from({ length: 42 }, (_, i) => { const d = new Date(start.getFullYear(), start.getMonth(), start.getDate() + i); return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-${String(d.getDate()).padStart(2, "0")}`; });
  const title = first.toLocaleDateString("pt-BR", { month: "long", year: "numeric" }); const go = (n: number) => { const d = new Date(y, m - 1 + n, 1); setCursor(`${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}`); };
  return (
    <div className="ios-card ios-card-pad" data-testid="calendar">
      <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", marginBottom: 6 }}><button className="ios-bar-btn" onClick={() => go(-1)} aria-label="Mês anterior"><ChevronLeft size={22} /></button><b style={{ textTransform: "capitalize" }}>{title}</b><button className="ios-bar-btn" onClick={() => go(1)} aria-label="Próximo mês"><ChevronRight size={22} /></button></div>
      <div className="ios-cal">{["D", "S", "T", "Q", "Q", "S", "S"].map((d, i) => <div key={i} className="ios-cal-h">{d}</div>)}
        {days.map((d) => <button key={d} className="ios-cal-d" aria-pressed={d === selected} data-today={d === today} data-out={d.slice(0, 7) !== cursor} onClick={() => onSelect(d)} aria-label={`${Number(d.slice(8))} de ${new Date(d + "T12:00").toLocaleDateString("pt-BR", { month: "long" })}${marks.has(d) ? ", com atendimento" : ""}`}>{Number(d.slice(8))}{marks.has(d) && <span className="m" />}</button>)}</div>
    </div>
  );
};
