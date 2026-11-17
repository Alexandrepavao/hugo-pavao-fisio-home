import { useEffect, useState } from "react";
import { Link, useNavigate } from "react-router-dom";
import { ArrowRight, ClipboardList, HeartHandshake, LineChart, PlayCircle, Stethoscope } from "lucide-react";
import logo from "@/assets/hp-logo.png";
import DemoApp from "@/portal/journey/demo/DemoApp";
import "@/portal/journey/journey.css";
import "./presentation.css";

/** /apresentacao — versão INSTITUCIONAL/DEMONSTRATIVA. Sem dados pessoais, sem chamadas ao banco: só explica o acompanhamento e abre a demonstração com exemplos ilustrativos.
 *  A apresentação PERSONALIZADA (da avaliação de um paciente) exige login e vínculo: fisioterapeuta abre pela ficha; paciente abre pelo portal. */
const ApresentacaoPublic = () => {
  const nav = useNavigate(); const [demo, setDemo] = useState(false);
  useEffect(() => {
    document.title = "Apresentação do acompanhamento · HP Fisioterapia";
    const meta = document.createElement("meta"); meta.name = "robots"; meta.content = "noindex, nofollow"; document.head.appendChild(meta);
    return () => { meta.remove(); };
  }, []);
  if (demo) return <DemoApp onExit={() => setDemo(false)} />;
  return (
    <main className="jr mx-auto grid max-w-3xl gap-4 p-4" data-testid="apresentacao-publica" aria-label="Apresentação do acompanhamento">
      <header className="flex items-center justify-between gap-3"><img src={logo} alt="HP Fisioterapia" style={{ height: 36 }} /><Link to="/login" className="jr-btn is-soft">Entrar</Link></header>
      <section className="jr-card is-soft">
        <p className="jr-eyebrow">Demonstração</p>
        <h1 className="jr-big" style={{ marginTop: 4 }}>Como funciona o seu acompanhamento</h1>
        <p style={{ marginTop: 8 }}>Uma avaliação, um plano feito para você e uma área do paciente para acompanhar sua evolução, com data e autoria de cada registro. Você entende o motivo do tratamento, acompanha sua evolução e participa das decisões sobre sua recuperação.</p>
      </section>
      <section className="jr-card" aria-label="As etapas">
        <ol className="pp-flow">{["Avaliação", "Plano individual", "Atendimentos e rotina orientada", "Reavaliação", "Ajuste, continuidade ou alta"].map((t, n, a) => <li key={t}><span className="pp-flow-n">{n + 1}</span><b>{t}</b>{n < a.length - 1 && <ArrowRight className="pp-flow-arrow" size={16} aria-hidden />}</li>)}</ol>
        <div className="jr-row" style={{ marginTop: 14 }}><button type="button" className="jr-btn" onClick={() => setDemo(true)} data-testid="ver-demonstracao"><PlayCircle size={16} aria-hidden />Ver a demonstração da área do paciente</button></div>
        <p className="jr-small jr-muted" style={{ marginTop: 8 }} data-testid="aviso-demo">A demonstração usa exemplos ilustrativos. Nenhum dado de paciente aparece aqui nem é gravado.</p>
      </section>
      <section className="jr-card" aria-label="Acesso personalizado">
        <h2 className="jr-title"><HeartHandshake size={18} aria-hidden />Sua apresentação personalizada</h2>
        <p>Depois da sua avaliação, o fisioterapeuta prepara um resumo só seu — objetivo, ponto de partida, plano e a ciência que sustenta o acompanhamento. Ela fica na sua área do paciente, protegida por login.</p>
        <div className="jr-row" style={{ marginTop: 10 }}><Link to="/login" className="jr-btn is-soft"><LineChart size={16} aria-hidden />Entrar na minha área</Link><Link to="/primeiro-acesso" className="jr-btn is-soft"><ClipboardList size={16} aria-hidden />Primeiro acesso</Link></div>
        <p className="jr-small jr-muted" style={{ marginTop: 10, display: "flex", gap: 6, alignItems: "center" }}><Stethoscope size={14} aria-hidden />Fisioterapeuta: abra a apresentação pela ficha do paciente (Acompanhamento).</p>
      </section>
      <button type="button" className="jr-small jr-muted underline" style={{ justifySelf: "start", background: "none", border: 0, cursor: "pointer" }} onClick={() => nav("/")}>Voltar ao site</button>
    </main>
  );
};
export default ApresentacaoPublic;
