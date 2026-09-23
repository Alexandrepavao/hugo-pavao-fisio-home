import { Link } from "react-router-dom";
import { ClipboardList } from "lucide-react";
import { JOURNEY_ROUTE, type Journey } from "@/lib/quiz";

/** Botão fixo discreto, só no celular (sm:hidden) — nunca cobre o botão do WhatsApp nem controles;
 * nunca abre sozinho (sem pop-up automático). */
const QuizFloatButton = ({ journey, label }: { journey: Journey; label: string }) => (
  <Link
    to={JOURNEY_ROUTE[journey]}
    className="sm:hidden fixed bottom-24 right-6 z-40 inline-flex items-center gap-2 rounded-full border border-accent/40 bg-card/95 backdrop-blur px-4 py-2.5 text-[12px] text-navy-700 shadow-sm"
    aria-label={label}
  >
    <ClipboardList className="w-4 h-4 text-accent" aria-hidden="true" strokeWidth={1.75} />
    {label}
  </Link>
);

export default QuizFloatButton;
