import { useCallback, useEffect, useMemo, useState } from "react";
import { Battery, Signal, Wifi } from "lucide-react";
import logo from "@/assets/hp-logo.png";
import "./ios.css";
import { AdminApp } from "./admin";
import { PatientApp } from "./patient";
import { PhysioApp } from "./physio";
import { ShellCtx, type ShellApi } from "./shell-context";
import { resetDemo, setNowOverride } from "./store";
import type { Role } from "./types";

const SIZES = { se: { label: "iPhone SE", w: 375, h: 667 }, std: { label: "iPhone 15", w: 393, h: 852 }, max: { label: "iPhone 15 Pro Max", w: 430, h: 932 } } as const;
type SizeKey = keyof typeof SIZES;
const ENTERED = "hp-ios-preview-entered";
const q = () => new URLSearchParams(window.location.search);
const useMedia = (query: string) => { const [m, setM] = useState(() => window.matchMedia(query).matches); useEffect(() => { const mq = window.matchMedia(query); const h = () => setM(mq.matches); mq.addEventListener("change", h); return () => mq.removeEventListener("change", h); }, [query]); return m; };

const Welcome = ({ role, setRole, enter }: { role: Role; setRole: (r: Role) => void; enter: () => void }) => (
  <div className="ios-screen" style={{ justifyContent: "center", padding: "calc(var(--sat, 0px) + 24px) 24px calc(var(--sab, 0px) + 24px)" }} data-testid="welcome">
    <div style={{ textAlign: "center", marginBottom: 28 }}><img src={logo} alt="HP Fisioterapia" style={{ height: 64, width: "auto", margin: "0 auto" }} /><h1 className="ios-display" style={{ fontSize: 26, fontWeight: 800, marginTop: 14 }}>HP Group</h1><p className="ios-dim" style={{ marginTop: 4 }}>Prévia do aplicativo · Paciente, Fisioterapeuta e Administrador</p></div>
    <div className="ios-card ios-card-pad" style={{ display: "grid", gap: 12 }}>
      <p style={{ fontWeight: 700 }}>Como você quer experimentar?</p>
      <div className="ios-seg" role="group" aria-label="Experiência"><button aria-pressed={role === "patient"} onClick={() => setRole("patient")}>Paciente</button><button aria-pressed={role === "physio"} onClick={() => setRole("physio")}>Fisioterapeuta</button><button aria-pressed={role === "admin"} onClick={() => setRole("admin")}>Administrador</button></div>
      <button className="ios-btn ios-btn-primary" onClick={enter}>Entrar na demonstração</button>
      <p className="ios-dim ios-small" style={{ textAlign: "center" }}>Sem login real. Todos os nomes, valores e datas são <b>fictícios</b>. Nada é enviado ou salvo no servidor.</p>
    </div>
  </div>
);

const StatusBar = () => <div className="ios-status" aria-hidden><span>9:41</span><span style={{ display: "flex", gap: 6, alignItems: "center" }}><Signal size={15} /><Wifi size={15} /><Battery size={19} /></span></div>;

/** Preview do app iOS da HP: DUAS experiências (Paciente e Fisioterapeuta) sobre o MESMO estado de demonstração. Não é um aplicativo nativo. */
const PreviewIos = () => {
  const params = useMemo(q, []); const desktop = useMedia("(min-width: 901px) and (min-height: 640px)");
  const [role, setRole] = useState<Role>(params.get("role") === "physio" ? "physio" : params.get("role") === "admin" ? "admin" : "patient"); const [size, setSize] = useState<SizeKey>((params.get("size") as SizeKey) in SIZES ? (params.get("size") as SizeKey) : "std");
  const [theme, setTheme] = useState<"light" | "dark">(params.get("theme") === "dark" ? "dark" : "light"); const [textScale, setTextScale] = useState(Number(params.get("text")) || 1);
  const [entered, setEntered] = useState(() => { try { return params.get("entrar") === "1" || sessionStorage.getItem(ENTERED) === "1"; } catch { return params.get("entrar") === "1"; } }); const [epoch, setEpoch] = useState(0);
  useState(() => { setNowOverride(params.get("now")); return 0; });
  useEffect(() => { document.title = "Preview iOS · HP Group"; }, []);
  useEffect(() => { const v = window.visualViewport; if (!v) return; const set = () => document.documentElement.style.setProperty("--vvh", `${v.height}px`); set(); v.addEventListener("resize", set); return () => { v.removeEventListener("resize", set); document.documentElement.style.removeProperty("--vvh"); }; }, []);
  const enter = useCallback(() => { setEntered(true); try { sessionStorage.setItem(ENTERED, "1"); } catch { /* ignorar */ } }, []);
  const exit = useCallback(() => { setEntered(false); setEpoch((e) => e + 1); try { sessionStorage.removeItem(ENTERED); } catch { /* ignorar */ } }, []);
  const reset = useCallback(() => { resetDemo(); setEpoch((e) => e + 1); }, []);
  const switchRole = useCallback((r: Role) => { setRole(r); setEpoch((e) => e + 1); }, []);
  const api: ShellApi = useMemo(() => ({ role, setRole: switchRole, theme, setTheme, textScale, setTextScale, reset, exit }), [role, switchRole, theme, textScale, reset, exit]);
  const dev = SIZES[size]; const scale = desktop ? Math.min(1, (window.innerHeight - 56) / (dev.h + 24)) : 1;
  const app = <div className="ios-root" data-theme={theme} style={{ ["--ios-text" as string]: textScale }}>{entered ? (role === "patient" ? <PatientApp key={`p${epoch}`} /> : role === "physio" ? <PhysioApp key={`f${epoch}`} /> : <AdminApp key={`a${epoch}`} />) : <Welcome role={role} setRole={switchRole} enter={enter} />}</div>;
  return (
    <ShellCtx.Provider value={api}>
      {desktop ? (
        <div className="ios-stage" data-theme={theme} data-testid="stage">
          <aside className="ios-side" aria-label="Controles da prévia">
            <img src={logo} alt="HP Fisioterapia" style={{ height: 52, width: "auto", alignSelf: "flex-start", background: "#fff", borderRadius: 10, padding: "4px 8px" }} /><h2>Preview do app iOS</h2>
            <p style={{ fontSize: 13, opacity: .8 }}>Protótipo navegável, <b>não é um aplicativo nativo</b>. Dados fictícios; nada é salvo no servidor.</p>
            <div><p className="lbl" style={{ marginBottom: 6 }}>Experiência</p><div className="seg" role="group" aria-label="Experiência" style={{ gridAutoFlow: "row" }}><button aria-pressed={role === "patient"} onClick={() => switchRole("patient")}>Paciente</button><button aria-pressed={role === "physio"} onClick={() => switchRole("physio")}>Fisioterapeuta</button><button aria-pressed={role === "admin"} onClick={() => switchRole("admin")}>Administrador</button></div></div>
            <div><p className="lbl" style={{ marginBottom: 6 }}>Tamanho da tela</p><div className="seg" role="group" aria-label="Tamanho da tela">{(Object.keys(SIZES) as SizeKey[]).map((k) => <button key={k} aria-pressed={size === k} onClick={() => setSize(k)}>{k === "se" ? "SE" : k === "std" ? "15" : "Pro Max"}</button>)}</div><p style={{ fontSize: 12, opacity: .7, marginTop: 4 }}>{dev.label} · {dev.w}×{dev.h}</p></div>
            <div><p className="lbl" style={{ marginBottom: 6 }}>Tema</p><div className="seg" role="group" aria-label="Tema"><button aria-pressed={theme === "light"} onClick={() => setTheme("light")}>Claro</button><button aria-pressed={theme === "dark"} onClick={() => setTheme("dark")}>Escuro</button></div></div>
            <div><p className="lbl" style={{ marginBottom: 6 }}>Tamanho do texto</p><div className="seg" role="group" aria-label="Tamanho do texto">{[["1", "Padrão"], ["1.15", "Maior"], ["1.3", "Bem maior"]].map(([v, l]) => <button key={v} aria-pressed={String(textScale) === v} onClick={() => setTextScale(Number(v))}>{l}</button>)}</div></div>
            <button className="act" onClick={reset}>Restaurar demonstração</button>{entered && <button className="act" onClick={exit}>Voltar à tela de entrada</button>}
            <p style={{ fontSize: 11.5, opacity: .65, marginTop: "auto" }}>Em um celular, o app ocupa a tela inteira, sem moldura.</p>
          </aside>
          <div className="ios-device-wrap"><div style={{ width: (dev.w + 24) * scale, height: (dev.h + 24) * scale }}><div className="ios-device" style={{ width: dev.w + 24, transform: `scale(${scale})`, transformOrigin: "top left" }} data-testid="device"><div className="ios-device-screen" style={{ width: dev.w, height: dev.h }} data-theme={theme}><div className="ios-island" /><StatusBar />{app}<div className="ios-home" /></div></div></div></div>
        </div>
      ) : <div className="ios-full" style={{ height: "var(--vvh, 100dvh)" }} data-testid="fullscreen">{app}</div>}
    </ShellCtx.Provider>
  );
};
export default PreviewIos;
