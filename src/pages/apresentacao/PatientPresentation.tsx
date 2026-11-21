import { Link } from "react-router-dom";
import { useQuery } from "@tanstack/react-query";
import { ArrowRight, Hourglass } from "lucide-react";
import { EmptyState, State } from "@/lib/ui";
import { fmtDate } from "@/lib/format";
import { useLiveJourney } from "@/portal/journey/live";
import PresentationSteps from "./PresentationSteps";
import { myPresentation } from "./api";
import "@/portal/journey/journey.css";
import "./presentation.css";

/** /paciente/apresentacao — a versão LIBERADA pelo fisioterapeuta, vista pelo próprio paciente (pendente ou ativo). Só leitura: o paciente não aprova diagnóstico, prescrição nem plano. */
const PatientPresentation = () => {
  const q = useQuery({ queryKey: ["my-presentation"], retry: false, queryFn: myPresentation });
  const { model } = useLiveJourney();
  const d = q.data;
  return (
    <div className="mx-auto grid max-w-4xl gap-3" data-testid="patient-presentation">
      <State loading={q.isLoading} error={q.error ? new Error("Não foi possível carregar a apresentação.") : undefined} />
      {d && !d.available && (
        <EmptyState title="Sua apresentação ainda não foi liberada" action={<Link to="/paciente" className="hp-btn hp-btn-outline">Voltar ao início</Link>}>
          Depois da avaliação, o seu fisioterapeuta libera aqui o resumo personalizado do seu acompanhamento.
        </EmptyState>)}
      {d?.available && d.content && (<>
        <div className="jr"><div className="jr-card is-soft" data-testid="pp-patient-banner">
          <p className="jr-eyebrow">Apresentação personalizada · versão {d.version}{d.published_at ? ` · liberada em ${fmtDate(d.published_at)}` : ""}</p>
          <p style={{ marginTop: 4 }}>Preparada por {d.professional ?? "seu fisioterapeuta"} a partir da sua avaliação. O plano clínico é definido por ele; aqui você acompanha e participa das decisões.</p>
          {d.enrollment_status === "pending" && <p className="jr-small" style={{ marginTop: 6, display: "flex", gap: 6, alignItems: "center" }} data-testid="pp-patient-pending"><Hourglass size={14} aria-hidden />Seu acompanhamento está pendente: será ativado quando a contratação e o pagamento forem confirmados. Nada é cobrado por esta tela.</p>}
        </div></div>
        <PresentationSteps content={d.content} model={model} firstName={(d.person_name ?? "").split(" ")[0]} final={
          <div className="grid gap-3" data-testid="pp-final-patient">
            <p>Tudo o que você viu aqui fica na sua área do paciente: objetivo, plano, evolução, agenda e exercícios — com data e autoria de cada registro.</p>
            <div className="flex flex-wrap gap-2"><Link to="/paciente" className="jr-btn" data-testid="pp-open-portal">Abrir minha área do paciente<ArrowRight size={16} aria-hidden /></Link><Link to="/paciente/ebook" className="jr-btn" data-testid="pp-open-ebook">Ver meu e-book: plano, valores e pagamento</Link></div>
          </div>} />
      </>)}
    </div>
  );
};
export default PatientPresentation;
