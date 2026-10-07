import { useLocation, useNavigate } from "react-router-dom";
import { buildJourneyHref, type Journey } from "@/lib/quiz";
import { utmFromLocation } from "@/features/pages/PageRenderer";

/** Botões do site nunca abrem o WhatsApp direto: levam ao quiz da jornada (paciente = atendimento, fisioterapeuta = parceria),
 *  cuja 1ª etapa captura nome completo, e-mail e WhatsApp. A página de origem e a campanha vão junto. */
export const useStartJourney = (journey: Journey) => {
  const navigate = useNavigate(); const { pathname } = useLocation();
  return () => navigate(buildJourneyHref(journey, { from: pathname, utm: utmFromLocation() }));
};
